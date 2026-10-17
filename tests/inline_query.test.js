import { describe, expect, test, vi } from 'vitest';
import handleInlineQuery from '../tgcloud/handlers/inline_query.js';
import { BotApiError, callsTo, stubApi } from './fakes/sdk.js';
import { tables } from './fakes/store.js';
import { inlineQuery } from './payloads.js';

/** @typedef {import('../tgcloud/lib/store.js').Meme} Meme */

/**
 * Adds a meme to the fake library; ids are assigned in insertion order.
 * @param {Partial<Meme> & { name: string }} fields
 */
function seedMeme(fields) {
  const id = tables.memes.length + 1;
  tables.memes.push({
    id,
    fileId: `file-${id}`,
    mediaType: 'audio',
    emoji: '',
    count: 0,
    ...fields,
  });
}

/** The single answerInlineQuery call's params. */
function answer() {
  const calls = callsTo('answerInlineQuery');
  expect(calls).toHaveLength(1);
  return calls[0];
}

/** @param {Record<string, any>} params */
const titles = (params) => params.results.map((/** @type {any} */ r) => r.title);

describe('an empty query', () => {
  test('returns every meme, most-sent first', async () => {
    seedMeme({ name: 'rare', count: 1 });
    seedMeme({ name: 'hit', count: 10 });
    seedMeme({ name: 'mid', count: 5 });

    await handleInlineQuery(inlineQuery(''));

    expect(titles(answer())).toEqual(['hit', 'mid', 'rare']);
  });

  test('breaks send-count ties by meme name', async () => {
    seedMeme({ name: 'b', count: 3 });
    seedMeme({ name: 'a', count: 3 });

    await handleInlineQuery(inlineQuery('   '));

    expect(titles(answer())).toEqual(['a', 'b']);
  });

  test('answers the query by its id, cached for 300 seconds', async () => {
    seedMeme({ name: 'hit' });

    await handleInlineQuery(inlineQuery(''));

    expect(answer()).toMatchObject({ inline_query_id: 'iq-2000', cache_time: 300 });
  });

  test('answers with no results when the library is empty', async () => {
    await handleInlineQuery(inlineQuery(''));

    expect(answer().results).toEqual([]);
  });
});

describe('a query with text', () => {
  test('filters by meme name, case-insensitively (incl. Cyrillic)', async () => {
    seedMeme({ name: 'Привет мир' });
    seedMeme({ name: 'пока' });
    seedMeme({ name: 'Hello' });

    await handleInlineQuery(inlineQuery('ПРИВ'));
    expect(titles(answer())).toEqual(['Привет мир']);
  });

  test('matches a substring anywhere in the name, ASCII case-insensitively', async () => {
    seedMeme({ name: 'Say HELLO' });
    seedMeme({ name: 'bye' });

    await handleInlineQuery(inlineQuery('  hello '));

    expect(titles(answer())).toEqual(['Say HELLO']);
  });

  test('filters by emoji', async () => {
    seedMeme({ name: 'laugh', emoji: '😂' });
    seedMeme({ name: 'cry', emoji: '😭' });

    await handleInlineQuery(inlineQuery('😭'));

    expect(titles(answer())).toEqual(['😭 cry']);
  });

  test('keeps matches ordered by send count', async () => {
    seedMeme({ name: 'cat 1', count: 1 });
    seedMeme({ name: 'dog', count: 100 });
    seedMeme({ name: 'cat 2', count: 7 });

    await handleInlineQuery(inlineQuery('cat'));

    expect(titles(answer())).toEqual(['cat 2', 'cat 1']);
  });

  test('treats LIKE wildcards literally', async () => {
    seedMeme({ name: '100% мем' });
    seedMeme({ name: 'other' });

    await handleInlineQuery(inlineQuery('%'));

    expect(titles(answer())).toEqual(['100% мем']);
  });

  test('answers with no results when nothing matches', async () => {
    seedMeme({ name: 'hit' });

    await handleInlineQuery(inlineQuery('zzz'));

    expect(answer().results).toEqual([]);
  });
});

describe('results', () => {
  test('a voice meme is a cached voice result titled with its emoji and name', async () => {
    seedMeme({ name: 'laugh', emoji: '😂', mediaType: 'audio', fileId: 'voice-file' });

    await handleInlineQuery(inlineQuery(''));

    expect(answer().results).toEqual([
      { type: 'voice', id: '1', voice_file_id: 'voice-file', title: '😂 laugh' },
    ]);
  });

  test('a video meme is a cached video result titled with its name', async () => {
    seedMeme({ name: 'dance', mediaType: 'video', fileId: 'video-file' });

    await handleInlineQuery(inlineQuery(''));

    expect(answer().results).toEqual([
      { type: 'video', id: '1', video_file_id: 'video-file', title: 'dance' },
    ]);
  });
});

describe('more than 50 memes', () => {
  /** @param {number} n */
  const seedMany = (n) => {
    for (let i = 0; i < n; i++) seedMeme({ name: `m${String(i).padStart(3, '0')}` });
  };

  test('the first answer holds 50 results and points at the next page', async () => {
    seedMany(120);

    await handleInlineQuery(inlineQuery(''));

    const params = answer();
    expect(params.results).toHaveLength(50);
    expect(params.results[0].title).toBe('m000');
    expect(params.next_offset).toBe('50');
  });

  test('a later page continues from the offset', async () => {
    seedMany(120);

    await handleInlineQuery(inlineQuery('', { offset: '100' }));

    const params = answer();
    expect(titles(params)).toHaveLength(20);
    expect(params.results[0].title).toBe('m100');
    expect(params.next_offset).toBe('');
  });

  test('an unparseable offset starts from the first page', async () => {
    seedMany(3);

    await handleInlineQuery(inlineQuery('', { offset: 'junk' }));

    expect(titles(answer())).toEqual(['m000', 'm001', 'm002']);
  });

  test('a single page has no next offset', async () => {
    seedMany(50);

    await handleInlineQuery(inlineQuery(''));

    expect(answer().next_offset).toBe('');
  });
});

test('a failing answerInlineQuery is logged and does not throw', async () => {
  seedMeme({ name: 'hit' });
  const error = new BotApiError('answerInlineQuery', 400, 'query is too old');
  stubApi('answerInlineQuery', error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});

  await expect(handleInlineQuery(inlineQuery(''))).resolves.toBeUndefined();

  expect(log).toHaveBeenCalledWith(expect.stringContaining('2000'), error);
  log.mockRestore();
});

// --- Leaderboards (issue #17) ---

/**
 * The single article a leaderboard answer holds, as { title, text }.
 * @param {Record<string, any>} params
 */
function leaderboard(params) {
  expect(params.results).toHaveLength(1);
  const [article] = params.results;
  expect(article.type).toBe('article');
  return { title: article.title, text: article.input_message_content.message_text };
}

describe('the stats leaderboard', () => {
  test('lists the top three memes by send count', async () => {
    seedMeme({ name: 'a', count: 2 });
    seedMeme({ name: 'b', count: 1 });
    seedMeme({ name: 'c', count: 5 });
    seedMeme({ name: 'd', count: 3 });

    await handleInlineQuery(inlineQuery('stats'));

    expect(leaderboard(answer())).toEqual({
      title: '🏆 Топ-3 мемов:',
      text: '🏆 Топ-3 мемов:\n1. c — 5\n2. d — 3\n3. a — 2',
    });
  });

  test('leaves out memes never sent', async () => {
    seedMeme({ name: 'hit', count: 1 });
    seedMeme({ name: 'unsent', count: 0 });

    await handleInlineQuery(inlineQuery('stats'));

    expect(leaderboard(answer()).text).toBe('🏆 Топ-3 мемов:\n1. hit — 1');
  });

  test('says there are no statistics yet when nothing was sent', async () => {
    seedMeme({ name: 'unsent' });

    await handleInlineQuery(inlineQuery('stats'));

    expect(leaderboard(answer()).text).toBe('Пока нет статистики');
  });

  test('ignores case and surrounding whitespace', async () => {
    seedMeme({ name: 'hit', count: 1 });

    await handleInlineQuery(inlineQuery('  STATS '));

    expect(leaderboard(answer()).text).toBe('🏆 Топ-3 мемов:\n1. hit — 1');
  });

  test('is answered uncached, by the query id', async () => {
    await handleInlineQuery(inlineQuery('stats'));

    expect(answer()).toMatchObject({ inline_query_id: 'iq-2000', cache_time: 0 });
  });

  test('has a non-numeric result id, so choosing it is not a send', async () => {
    await handleInlineQuery(inlineQuery('stats'));

    expect(answer().results[0].id).not.toMatch(/^\d+$/);
  });
});

describe('the userstats leaderboard', () => {
  /** @param {import('../tgcloud/lib/store.js').User} user */
  const seedUser = (user) => tables.users.push(user);

  test('lists the top three users by send count', async () => {
    seedUser({ userId: 1, displayName: 'Alice', approved: false, count: 2 });
    seedUser({ userId: 2, displayName: 'Bob', approved: true, count: 7 });
    seedUser({ userId: 3, displayName: 'Carol', approved: false, count: 1 });
    seedUser({ userId: 4, displayName: 'Dave', approved: false, count: 4 });
    seedUser({ userId: 5, displayName: 'Eve', approved: false, count: 0 });

    await handleInlineQuery(inlineQuery('userstats'));

    expect(leaderboard(answer())).toEqual({
      title: '🏆 Топ-3 пользователей:',
      text: '🏆 Топ-3 пользователей:\n1. Bob — 7\n2. Dave — 4\n3. Alice — 2',
    });
  });

  test('breaks send-count ties by user id', async () => {
    seedUser({ userId: 9, displayName: 'Late', approved: false, count: 3 });
    seedUser({ userId: 1, displayName: 'Early', approved: false, count: 3 });

    await handleInlineQuery(inlineQuery('userstats'));

    expect(leaderboard(answer()).text).toBe('🏆 Топ-3 пользователей:\n1. Early — 3\n2. Late — 3');
  });

  test('says there are no statistics yet when nobody has sent anything', async () => {
    seedUser({ userId: 1, displayName: 'Idle', approved: true, count: 0 });

    await handleInlineQuery(inlineQuery(' UserStats '));

    expect(leaderboard(answer()).text).toBe('Пока нет статистики');
    expect(answer().cache_time).toBe(0);
  });

  test('labels a user with no display name by their user id', async () => {
    seedUser({ userId: 42, displayName: null, approved: false, count: 1 });

    await handleInlineQuery(inlineQuery('userstats'));

    expect(leaderboard(answer()).text).toBe('🏆 Топ-3 пользователей:\n1. 42 — 1');
  });
});
