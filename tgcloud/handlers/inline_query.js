// handlers/inline_query — runs on each `inline_query` update (`@bot <text>` in any
// chat): offers the library's memes as cached voice / video results to send, or a
// leaderboard for the reserved queries `stats` / `userstats`. With approval mode on,
// only approved users get either.

import { api } from 'sdk';
import { loggingBotApiFailures } from '../lib/bot_api.js';
import { REQUIRE_APPROVAL } from '../lib/config.js';
import { leaderboardArticle } from '../lib/leaderboard.js';
import { titleOf } from '../lib/meme_title.js';
import { isUserApproved, registerUser, searchMemes, topMemes, topUsers } from '../lib/store.js';

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

export default loggingBotApiFailures('handlers/inline_query', handleInlineQuery);

/** @param {InlineQuery} inlineQuery */
async function handleInlineQuery(inlineQuery) {
  if (REQUIRE_APPROVAL && !(await isApproved(inlineQuery))) {
    // Uncached, so the user gets memes as soon as the admin approves them.
    await answer(inlineQuery, { results: [PENDING_RESULT], cache_time: 0 });
    return;
  }
  const leaderboard = await leaderboardFor(inlineQuery.query);
  if (leaderboard) {
    await answer(inlineQuery, { results: [leaderboard], cache_time: 0 });
    return;
  }
  const found = await searchMemes(inlineQuery.query);
  const offset = Number.parseInt(inlineQuery.offset, 10) || 0;
  const end = offset + PAGE_SIZE;
  await answer(inlineQuery, {
    results: found.slice(offset, end).map(toResult),
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
 * The leaderboard article a reserved query asks for (case and surrounding whitespace
 * ignored), or null for an ordinary search.
 * @param {string} query
 * @returns {Promise<InlineQueryResult | null>}
 */
async function leaderboardFor(query) {
  switch (query.trim().toLowerCase()) {
    case 'stats': {
      const rows = (await topMemes()).map((m) => ({ label: m.name, count: m.count }));
      return leaderboardArticle('stats', '🏆 Топ-3 мемов:', rows);
    }
    case 'userstats': {
      const rows = (await topUsers()).map((u) => ({
        label: u.displayName || String(u.userId),
        count: u.count,
      }));
      return leaderboardArticle('userstats', '🏆 Топ-3 пользователей:', rows);
    }
    default:
      return null;
  }
}

/**
 * Answers the query. With approval mode on every answer is personal, so per-user
 * state never leaks through Telegram's shared inline cache.
 * @param {InlineQuery} inlineQuery
 * @param {{ results: InlineQueryResult[], cache_time: number, next_offset?: string }} params
 */
async function answer(inlineQuery, params) {
  await api.answerInlineQuery({
    inline_query_id: inlineQuery.id,
    ...params,
    is_personal: REQUIRE_APPROVAL,
  });
}

/**
 * A meme as a cached result: its ID is the meme's ID (send counting relies on it).
 * @param {Meme} meme
 * @returns {InlineQueryResult}
 */
function toResult(meme) {
  const id = String(meme.id);
  const title = titleOf(meme);
  return meme.mediaType === 'audio'
    ? { type: 'voice', id, voice_file_id: meme.fileId, title }
    : { type: 'video', id, video_file_id: meme.fileId, title };
}
