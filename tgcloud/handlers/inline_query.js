// handlers/inline_query — runs on each `inline_query` update (`@bot <text>` in any
// chat): offers the library's memes as cached voice / video results to send. With
// approval mode on, only approved users get memes.

import { api } from 'sdk';
import { REQUIRE_APPROVAL } from '../lib/config.js';
import { isUserApproved, registerUser, searchMemes } from '../lib/store.js';

/** @typedef {import('@grammyjs/types').InlineQuery} InlineQuery */
/** @typedef {import('@grammyjs/types').InlineQueryResult} InlineQueryResult */
/** @typedef {import('../lib/store.js').Meme} Meme */

/** Bot API cap on results per answer; further memes are paged via `next_offset`. */
const PAGE_SIZE = 50;
const CACHE_TIME = 300;

const PENDING_TEXT = 'Ожидайте разрешение администратором';
/** Shown instead of memes to users the admin hasn't approved. Not a meme: not counted. */
/** @type {InlineQueryResult} */
const PENDING_RESULT = {
  type: 'article',
  id: 'approval-required',
  title: PENDING_TEXT,
  input_message_content: { message_text: PENDING_TEXT },
};

/** @param {InlineQuery} inlineQuery */
export default async function (inlineQuery) {
  if (REQUIRE_APPROVAL && !(await isApproved(inlineQuery))) {
    // Uncached, so the user gets memes as soon as the admin approves them.
    await answer(inlineQuery, [PENDING_RESULT], { cache_time: 0 });
    return;
  }
  const found = await searchMemes(inlineQuery.query);
  const offset = Number.parseInt(inlineQuery.offset, 10) || 0;
  const end = offset + PAGE_SIZE;
  await answer(inlineQuery, found.slice(offset, end).map(toResult), {
    cache_time: CACHE_TIME,
    next_offset: end < found.length ? String(end) : '',
  });
}

/**
 * Registers the querying user, so they show up in the admin's /users list, and
 * tells whether they're approved.
 * @param {InlineQuery} inlineQuery
 */
async function isApproved(inlineQuery) {
  const { id, first_name } = inlineQuery.from;
  await registerUser(id, first_name);
  if (await isUserApproved(id)) return true;
  console.log(`User ${id} not approved, showing the pending notice`);
  return false;
}

/**
 * Answers the query. With approval mode on every answer is personal, so per-user
 * state never leaks through Telegram's shared inline cache.
 * @param {InlineQuery} inlineQuery
 * @param {InlineQueryResult[]} results
 * @param {{ cache_time: number, next_offset?: string }} options
 */
async function answer(inlineQuery, results, options) {
  try {
    await api.answerInlineQuery({
      inline_query_id: inlineQuery.id,
      results,
      ...options,
      is_personal: REQUIRE_APPROVAL,
    });
  } catch (error) {
    console.error(`Failed to answer inline query from user ${inlineQuery.from.id}`, error);
  }
}

/**
 * A meme as a cached result: its ID is the meme's ID (send counting relies on it).
 * @param {Meme} meme
 * @returns {InlineQueryResult}
 */
function toResult(meme) {
  const id = String(meme.id);
  const title = meme.emoji ? `${meme.emoji} ${meme.name}` : meme.name;
  return meme.mediaType === 'audio'
    ? { type: 'voice', id, voice_file_id: meme.fileId, title }
    : { type: 'video', id, video_file_id: meme.fileId, title };
}
