// handlers/inline_query — runs on each `inline_query` update (`@bot <text>` in any
// chat): offers the library's memes as cached voice / video results to send.

import { api } from 'sdk';
import { searchMemes } from '../lib/store.js';

/** @typedef {import('@grammyjs/types').InlineQuery} InlineQuery */
/** @typedef {import('@grammyjs/types').InlineQueryResult} InlineQueryResult */
/** @typedef {import('../lib/store.js').Meme} Meme */

/** Bot API cap on results per answer; further memes are paged via `next_offset`. */
const PAGE_SIZE = 50;
const CACHE_TIME = 300;

/** @param {InlineQuery} inlineQuery */
export default async function (inlineQuery) {
  const found = await searchMemes(inlineQuery.query);
  const offset = Number.parseInt(inlineQuery.offset, 10) || 0;
  const end = offset + PAGE_SIZE;
  try {
    await api.answerInlineQuery({
      inline_query_id: inlineQuery.id,
      results: found.slice(offset, end).map(toResult),
      cache_time: CACHE_TIME,
      next_offset: end < found.length ? String(end) : '',
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
