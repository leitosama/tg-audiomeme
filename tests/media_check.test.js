import { afterEach, describe, expect, test, vi } from 'vitest';
import handleInlineQuery from '../tgcloud/handlers/inline_query.js';
import {
  checkingMedia,
  checkMediaIfDue,
  MEDIA_BROKEN_AFTER,
  MEDIA_CHECK_BATCH,
  MEDIA_CHECK_INTERVAL_MS,
  MEDIA_CHECK_RETRY_MS,
} from '../tgcloud/lib/media_check.js';
import { BotApiError, callsTo, stubApi } from './fakes/sdk.js';
import { mediaCheckState, tables } from './fakes/store.js';
import { ADMIN_ID, inlineQuery } from './payloads.js';

/** @typedef {import('../tgcloud/lib/store.js').Meme} Meme */

const NOW = Date.UTC(2026, 9, 19, 15, 30);

const GONE = new BotApiError(
  'getFile',
  400,
  'Bad Request: wrong file_id or the file is temporarily unavailable',
);

/**
 * Adds a meme to the fake library; ids are assigned in insertion order.
 * @param {Partial<Meme>} [fields]
 * @returns {Meme} the stored row, to inspect after a check
 */
function seedMeme(fields = {}) {
  const id = tables.memes.length + 1;
  /** @type {Meme} */
  const meme = {
    id,
    name: `Мем ${id}`,
    fileId: `file-${id}`,
    mediaType: 'audio',
    emoji: '',
    count: 0,
    ...fields,
  };
  tables.memes.push(meme);
  return meme;
}

/** getFile fails with `error` for these file IDs and finds every other file. */
function missing(/** @type {string[]} */ fileIds, error = GONE) {
  stubApi('getFile', (/** @type {Record<string, any>} */ params) =>
    fileIds.includes(params.file_id) ? error : { file_id: params.file_id },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('checkMediaIfDue', () => {
  test('checks the memes checked longest ago, never-checked first, a batch at a time', async () => {
    mediaCheckState.nextAt = 0;
    seedMeme({ checkedAt: NOW - 1000 });
    seedMeme({ checkedAt: NOW - 5000 });
    for (let i = 0; i < MEDIA_CHECK_BATCH; i++) seedMeme();

    await checkMediaIfDue(NOW);

    const checked = callsTo('getFile').map((p) => p.file_id);
    expect(checked).toEqual(['file-3', 'file-4', 'file-5'].slice(0, MEDIA_CHECK_BATCH));
    expect(tables.memes.filter((m) => m.checkedAt === NOW)).toHaveLength(MEDIA_CHECK_BATCH);
    expect(mediaCheckState.nextAt).toBe(NOW + MEDIA_CHECK_INTERVAL_MS);
  });

  test('does nothing until the check is due', async () => {
    mediaCheckState.nextAt = NOW + 1;
    seedMeme();

    await checkMediaIfDue(NOW);

    expect(callsTo('getFile')).toHaveLength(0);
  });

  test('a found file resets the failed checks and tells nobody', async () => {
    mediaCheckState.nextAt = 0;
    const meme = seedMeme({ failedChecks: 1 });

    await checkMediaIfDue(NOW);

    expect(meme).toMatchObject({ checkedAt: NOW, failedChecks: 0 });
    expect(callsTo('sendMessage')).toHaveLength(0);
  });

  test('one missing-file answer is only counted: Telegram says it may be temporary', async () => {
    mediaCheckState.nextAt = 0;
    const meme = seedMeme();
    missing(['file-1']);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    await checkMediaIfDue(NOW);

    expect(meme).toMatchObject({ checkedAt: NOW, failedChecks: 1 });
    expect(callsTo('sendMessage')).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('meme 1'));
  });

  test('the miss that makes a meme broken tells the admin once', async () => {
    mediaCheckState.nextAt = 0;
    const meme = seedMeme({ name: 'Кот', emoji: '🐱', failedChecks: MEDIA_BROKEN_AFTER - 1 });
    missing(['file-1']);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await checkMediaIfDue(NOW);
    mediaCheckState.nextAt = 0;
    await checkMediaIfDue(NOW + 1);

    expect(meme.failedChecks).toBe(MEDIA_BROKEN_AFTER + 1);
    const messages = callsTo('sendMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0].chat_id).toBe(ADMIN_ID);
    expect(messages[0].text).toContain("'🐱 Кот'");
    expect(messages[0].text).toContain('скрыт из inline-поиска');
  });

  test('a broken meme whose file is found again heals and the admin hears so', async () => {
    mediaCheckState.nextAt = 0;
    const meme = seedMeme({ name: 'Кот', failedChecks: MEDIA_BROKEN_AFTER });

    await checkMediaIfDue(NOW);

    expect(meme.failedChecks).toBe(0);
    const [message] = callsTo('sendMessage');
    expect(message.text).toContain('снова доступен');
  });

  test('a file too big for bots to download still exists', async () => {
    mediaCheckState.nextAt = 0;
    const meme = seedMeme({ failedChecks: 1 });
    missing(['file-1'], new BotApiError('getFile', 400, 'Bad Request: file is too big'));

    await checkMediaIfDue(NOW);

    expect(meme.failedChecks).toBe(0);
  });

  test('another failure stops the check, leaves the meme alone, and retries in an hour', async () => {
    mediaCheckState.nextAt = 0;
    const first = seedMeme();
    const second = seedMeme();
    const error = new BotApiError('getFile', 429, 'Too Many Requests: retry after 5');
    missing(['file-1'], error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(checkMediaIfDue(NOW)).resolves.toBeUndefined();

    expect(first.checkedAt).toBeUndefined();
    expect(second.checkedAt).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Media check failed'), error);
    expect(mediaCheckState.nextAt).toBe(NOW + MEDIA_CHECK_RETRY_MS);
  });

  test('an empty library checks nothing', async () => {
    mediaCheckState.nextAt = 0;

    await checkMediaIfDue(NOW);

    expect(callsTo('getFile')).toHaveLength(0);
    expect(mediaCheckState.nextAt).toBe(NOW + MEDIA_CHECK_INTERVAL_MS);
  });
});

describe('checkingMedia', () => {
  test('every handler runs a due media check after the update', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    mediaCheckState.nextAt = 0;
    seedMeme();

    await handleInlineQuery(inlineQuery(''));

    expect(callsTo('answerInlineQuery')).toHaveLength(1);
    expect(callsTo('getFile')).toEqual([{ file_id: 'file-1' }]);
  });

  test("checks even when the handler throws, and rethrows the handler's error", async () => {
    mediaCheckState.nextAt = 0;
    seedMeme();
    const error = new Error('db is down');
    const handler = checkingMedia(async () => {
      throw error;
    });

    await expect(handler()).rejects.toBe(error);
    expect(callsTo('getFile')).toHaveLength(1);
  });
});

describe('a broken meme', () => {
  test('is left out of inline results', async () => {
    seedMeme({ name: 'live' });
    seedMeme({ name: 'gone', failedChecks: MEDIA_BROKEN_AFTER });
    seedMeme({ name: 'flaky', failedChecks: MEDIA_BROKEN_AFTER - 1 });

    await handleInlineQuery(inlineQuery(''));

    const [answer] = callsTo('answerInlineQuery');
    expect(answer.results.map((/** @type {any} */ r) => r.title).sort()).toEqual(['flaky', 'live']);
  });
});
