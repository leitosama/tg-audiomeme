import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import handleChosen from '../tgcloud/handlers/chosen_inline_result.js';
import { apiCalls } from './fakes/sdk.js';
import { sentMessages, tables } from './fakes/store.js';
import { chosenResult, USER_ID } from './payloads.js';

/** @param {number} id @param {number} [count] */
function seedMeme(id, count = 0) {
  tables.memes.push({
    id,
    name: `meme ${id}`,
    fileId: `f${id}`,
    mediaType: 'audio',
    emoji: '',
    count,
  });
}

/** @param {number} id */
const memeCount = (id) => tables.memes.find((m) => m.id === id)?.count;

test('a send bumps the meme and registers the new sender with one send', async () => {
  seedMeme(7, 4);

  await handleChosen(...chosenResult('7', { firstName: 'Аня', inlineMessageId: 'im-1' }));

  expect(memeCount(7)).toBe(5);
  expect(tables.users).toEqual([
    { userId: USER_ID, displayName: 'Аня', approved: false, count: 1 },
  ]);
  expect(apiCalls).toEqual([]);
});

test('a send by a known user adds to their count and refreshes their display name', async () => {
  seedMeme(1);
  tables.users.push({ userId: USER_ID, displayName: 'old name', approved: true, count: 9 });

  await handleChosen(...chosenResult('1', { firstName: 'new name', inlineMessageId: 'im-1' }));

  expect(tables.users).toEqual([
    { userId: USER_ID, displayName: 'new name', approved: true, count: 10 },
  ]);
});

test('a send of a meme deleted since the query counts for neither meme nor user', async () => {
  seedMeme(1, 3);

  await handleChosen(...chosenResult('9', { inlineMessageId: 'im-1' }));

  expect(memeCount(1)).toBe(3);
  expect(tables.users).toEqual([]);
});

test.each(['stats', 'userstats', 'pending', '1a', ''])(
  'choosing the non-meme result %j changes nothing',
  async (id) => {
    seedMeme(1, 3);

    await handleChosen(...chosenResult(id, { inlineMessageId: 'im-1' }));

    expect(memeCount(1)).toBe(3);
    expect(tables.users).toEqual([]);
  },
);

describe('a send Telegram delivers more than once', () => {
  test('is counted once per inline message ID', async () => {
    seedMeme(1);

    await handleChosen(...chosenResult('1', { inlineMessageId: 'im-1', updateId: 10 }));
    await handleChosen(...chosenResult('1', { inlineMessageId: 'im-1', updateId: 11 }));

    expect(memeCount(1)).toBe(1);
    expect(tables.users[0].count).toBe(1);
  });

  test('still counts sends of other inline messages', async () => {
    seedMeme(1);

    await handleChosen(...chosenResult('1', { inlineMessageId: 'im-1', updateId: 10 }));
    await handleChosen(...chosenResult('1', { inlineMessageId: 'im-2', updateId: 11 }));

    expect(memeCount(1)).toBe(2);
  });

  // Telegram omits inline_message_id when the sent message has no inline keyboard,
  // as is the case for meme results; a webhook retry still repeats the update ID.
  test('without an inline message ID, is counted once per update', async () => {
    seedMeme(1);

    await handleChosen(...chosenResult('1', { updateId: 10 }));
    await handleChosen(...chosenResult('1', { updateId: 10 }));
    await handleChosen(...chosenResult('1', { updateId: 11 }));

    expect(memeCount(1)).toBe(2);
  });
});

describe('seen sent-message IDs', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 9, 17, 12);

  beforeEach(() => vi.useFakeTimers({ now, toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  test('older than seven days are dropped on the next send; newer ones kept', async () => {
    seedMeme(1);
    sentMessages.set('im-old', now - 7 * DAY - 1);
    sentMessages.set('im-recent', now - 7 * DAY + 1);

    await handleChosen(...chosenResult('1', { inlineMessageId: 'im-new' }));

    expect([...sentMessages.keys()].sort()).toEqual(['im-new', 'im-recent']);
  });

  test('a recent one still blocks a replay', async () => {
    seedMeme(1);
    sentMessages.set('im-recent', now - 6 * DAY);

    await handleChosen(...chosenResult('1', { inlineMessageId: 'im-recent' }));

    expect(memeCount(1)).toBe(0);
  });
});
