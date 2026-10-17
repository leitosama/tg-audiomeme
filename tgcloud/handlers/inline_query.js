// handlers/inline_query — runs on each `inline_query` update (`@bot <text>` in any
// chat): offers the library's memes as cached voice / video results to send, or a
// leaderboard for the reserved queries `stats` / `userstats`.

import { api } from 'sdk';
import { leaderboardArticle } from '../lib/leaderboard.js';
import { searchMemes, topMemes, topUsers } from '../lib/store.js';

/** @typedef {import('@grammyjs/types').InlineQuery} InlineQuery */
/** @typedef {import('@grammyjs/types').InlineQueryResult} InlineQueryResult */
/** @typedef {import('../lib/store.js').Meme} Meme */

/** Bot API cap on results per answer; further memes are paged via `next_offset`. */
const PAGE_SIZE = 50;
const CACHE_TIME = 300;

/** @param {InlineQuery} inlineQuery */
export default async function (inlineQuery) {
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
        label: u.displayName ?? String(u.userId),
        count: u.count,
      }));
      return leaderboardArticle('userstats', '🏆 Топ-3 пользователей:', rows);
    }
    default:
      return null;
  }
}

/**
 * Answers the query, logging (not throwing) Bot API failures such as an expired query.
 * @param {InlineQuery} inlineQuery
 * @param {{ results: InlineQueryResult[], cache_time: number, next_offset?: string }} params
 */
async function answer(inlineQuery, params) {
  try {
    await api.answerInlineQuery({ inline_query_id: inlineQuery.id, ...params });
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
