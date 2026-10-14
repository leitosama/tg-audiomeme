import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import handleChosenResult from '../tgcloud/handlers/chosen_inline_result.js';
import * as store from '../tgcloud/lib/store.js';
import { apiCalls } from './fakes/sdk.js';
import { tables } from './fakes/store.js';
import { chosenResult, USER_ID, updateContext } from './payloads.js';

const DAY = 24 * 60 * 60;
const NOW = Date.UTC(2026, 9, 14) / 1000;

let nextUpdateId = 1;

/**
 * Delivers a send as a fresh update (a new update_id) unless `updateId` is given.
 * @param {string} resultId
 * @param {Parameters<typeof chosenResult>[1] & { updateId?: number }} [opts]
 */
function send(resultId, { updateId = nextUpdateId++, ...opts } = {}) {
  return handleChosenResult(chosenResult(resultId, opts), updateContext(updateId));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
  tables.memes.push(
    { id: 1, name: 'laugh', fileId: 'f1', mediaType: 'audio', emoji: '', count: 4 },
    { id: 2, name: 'cry', fileId: 'f2', mediaType: 'video', emoji: '', count: 0 },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** @param {number} id */
const memeCount = (id) => tables.memes.find((m) => m.id === id)?.count;
const user = () => tables.users.find((u) => u.userId === USER_ID);
const seenKeys = () => tables.seenSends.map((s) => s.sendKey);

describe('a send', () => {
  test("increments the meme's send count", async () => {
    await send('1');

    expect(memeCount(1)).toBe(5);
    expect(memeCount(2)).toBe(0);
  });

  test('registers a new user with one send and their display name', async () => {
    await send('1', { firstName: 'Ann' });

    expect(user()).toEqual({ userId: USER_ID, displayName: 'Ann', approved: false, count: 1 });
  });

  test("increments a known user's send count, refreshing their display name only", async () => {
    tables.users.push({ userId: USER_ID, displayName: 'Old', approved: true, count: 7 });

    await send('2', { firstName: 'New' });

    expect(user()).toEqual({ userId: USER_ID, displayName: 'New', approved: true, count: 8 });
  });

  test('is remembered by its inline message ID, at the current time', async () => {
    await send('1', { inlineMessageId: 'abc' });

    expect(tables.seenSends).toEqual([{ sendKey: 'abc', seenAt: NOW }]);
  });

  test('without an inline message ID is remembered by its update ID', async () => {
    await send('1', { updateId: 42 });

    expect(tables.seenSends).toEqual([{ sendKey: 'update:42', seenAt: NOW }]);
  });

  test('makes no Bot API calls', async () => {
    await send('1');

    expect(apiCalls).toEqual([]);
  });
});

describe('a send delivered more than once', () => {
  test('with the same inline message ID is counted once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await send('1', { inlineMessageId: 'abc' });
    await send('1', { inlineMessageId: 'abc', firstName: 'Renamed' });

    expect(memeCount(1)).toBe(5);
    expect(user()).toMatchObject({ count: 1, displayName: 'User 2000' });
  });

  test('as the same update is counted once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await send('1', { updateId: 42 });
    await send('1', { updateId: 42 });

    expect(memeCount(1)).toBe(5);
    expect(user()?.count).toBe(1);
  });

  test('is logged as a duplicate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await send('1', { inlineMessageId: 'abc' });
    await send('1', { inlineMessageId: 'abc' });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('abc'));
  });

  test('is counted when its first delivery failed to count', async () => {
    const error = new Error('db timeout');
    vi.spyOn(store, 'incrementMemeCount').mockRejectedValueOnce(error);

    await expect(send('1', { updateId: 42 })).rejects.toBe(error);
    expect(seenKeys()).toEqual([]);

    await send('1', { updateId: 42 });
    expect(memeCount(1)).toBe(5);
  });
});

test('different sends are each counted', async () => {
  await send('1', { inlineMessageId: 'abc' });
  await send('1', { inlineMessageId: 'def' });
  await send('1');
  await send('1');

  expect(memeCount(1)).toBe(8);
  expect(user()?.count).toBe(4);
});

describe('seen sends', () => {
  test('older than seven days are pruned on the next send', async () => {
    tables.seenSends.push(
      { sendKey: 'stale', seenAt: NOW - 7 * DAY - 1 },
      { sendKey: 'fresh', seenAt: NOW - 7 * DAY + 1 },
    );

    await send('1', { inlineMessageId: 'new' });

    expect(seenKeys()).toEqual(['fresh', 'new']);
  });

  test('once pruned, no longer block a replay', async () => {
    tables.seenSends.push({ sendKey: 'old', seenAt: NOW - 8 * DAY });

    await send('1', { inlineMessageId: 'old' });

    expect(memeCount(1)).toBe(5);
  });
});

describe('a non-meme result', () => {
  test.each(['stats', 'userstats', 'pending', '1a', '', '-1', '1.5'])(
    'with result ID %j changes nothing',
    async (resultId) => {
      tables.seenSends.push({ sendKey: 'stale', seenAt: NOW - 30 * DAY });

      await send(resultId, { inlineMessageId: 'abc' });

      expect(memeCount(1)).toBe(4);
      expect(tables.users).toEqual([]);
      expect(seenKeys()).toEqual(['stale']);
    },
  );
});

test('a send of a meme that no longer exists still counts for the user', async () => {
  await send('99');

  expect(tables.memes.map((m) => m.count)).toEqual([4, 0]);
  expect(user()?.count).toBe(1);
});
