import { beforeEach, describe, expect, test } from 'vitest';
import handleInlineQuery from '../tgcloud/handlers/inline_query.js';
import { setRequireApproval } from './fakes/config.js';
import { callsTo } from './fakes/sdk.js';
import { tables } from './fakes/store.js';
import { inlineQuery, USER_ID } from './payloads.js';

/** @param {Partial<import('../tgcloud/lib/store.js').User>} [fields] */
function seedUser(fields = {}) {
  tables.users.push({
    userId: USER_ID,
    displayName: `User ${USER_ID}`,
    approved: false,
    count: 0,
    ...fields,
  });
}

function seedMeme() {
  tables.memes.push({
    id: 1,
    name: 'hit',
    fileId: 'file-1',
    mediaType: 'audio',
    emoji: '',
    count: 0,
  });
}

/** The single answerInlineQuery call's params. */
function answer() {
  const calls = callsTo('answerInlineQuery');
  expect(calls).toHaveLength(1);
  return calls[0];
}

const PENDING_TEXT = 'Ожидайте разрешение администратором';

describe('approval mode on', () => {
  beforeEach(() => {
    setRequireApproval(true);
    seedMeme();
  });

  test('an unapproved user gets only the pending article, uncached and personal', async () => {
    seedUser({ approved: false });

    await handleInlineQuery(inlineQuery(''));

    expect(answer()).toMatchObject({
      cache_time: 0,
      is_personal: true,
      results: [
        {
          type: 'article',
          id: 'approval-required',
          title: PENDING_TEXT,
          input_message_content: { message_text: PENDING_TEXT },
        },
      ],
    });
  });

  test("a new user's first query registers them, pending, under their first name", async () => {
    await handleInlineQuery(inlineQuery(''));

    expect(tables.users).toEqual([
      { userId: USER_ID, displayName: `User ${USER_ID}`, approved: false, count: 0 },
    ]);
    expect(answer().results.map((/** @type {any} */ r) => r.id)).toEqual(['approval-required']);
  });

  test('a known user is refreshed without losing approval or send count', async () => {
    seedUser({ displayName: 'Old name', approved: true, count: 7 });

    await handleInlineQuery(inlineQuery(''));

    expect(tables.users).toEqual([
      { userId: USER_ID, displayName: `User ${USER_ID}`, approved: true, count: 7 },
    ]);
  });

  test('an approved user gets memes, as a personal answer', async () => {
    seedUser({ approved: true });

    await handleInlineQuery(inlineQuery(''));

    expect(answer()).toMatchObject({
      cache_time: 300,
      is_personal: true,
      results: [{ type: 'voice', id: '1', voice_file_id: 'file-1', title: 'hit' }],
    });
  });

  test.each(['stats', 'userstats'])(
    'an approved user gets the %s leaderboard, personal',
    async (q) => {
      seedUser({ approved: true });

      await handleInlineQuery(inlineQuery(q));

      expect(answer()).toMatchObject({ is_personal: true, results: [{ type: 'article', id: q }] });
    },
  );

  test.each(['stats', 'userstats'])(
    'an unapproved user asking for %s gets the pending article',
    async (q) => {
      seedUser({ approved: false });

      await handleInlineQuery(inlineQuery(q));

      expect(answer().results.map((/** @type {any} */ r) => r.id)).toEqual(['approval-required']);
    },
  );
});

describe('approval mode off', () => {
  beforeEach(seedMeme);

  test('an unapproved user gets memes, in a shared answer', async () => {
    seedUser({ approved: false });

    await handleInlineQuery(inlineQuery(''));

    expect(answer()).toMatchObject({
      cache_time: 300,
      is_personal: false,
      results: [{ id: '1', title: 'hit' }],
    });
  });

  test('nobody is registered by an inline query', async () => {
    await handleInlineQuery(inlineQuery(''));

    expect(tables.users).toEqual([]);
  });
});
