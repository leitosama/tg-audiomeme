// handlers/chosen_inline_result — runs when a user sends one of the inline results
// (needs inline feedback, on for every bot instance): counts meme sends, once each.

import {
  incrementMemeCount,
  markSendSeen,
  pruneSeenSends,
  recordUserSend,
  unmarkSendSeen,
} from '../lib/store.js';

/** @typedef {import('@grammyjs/types').ChosenInlineResult} ChosenInlineResult */
/** @typedef {{ update: { update_id: number } }} Context */

/** How long a send is remembered to catch repeated deliveries. */
const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * @param {ChosenInlineResult} chosen
 * @param {Context} ctx
 */
export default async function (chosen, ctx) {
  // Only memes have numeric result IDs (their meme ID); leaderboards and the
  // approval notice don't count as sends.
  if (!/^\d+$/.test(chosen.result_id)) return;

  // Telegram sets inline_message_id only when the sent message has an inline
  // keyboard, which meme results don't; a redelivered update keeps its update_id.
  const sendKey = chosen.inline_message_id ?? `update:${ctx.update.update_id}`;
  const now = Math.floor(Date.now() / 1000);
  await pruneSeenSends(now - SEEN_TTL_SECONDS);
  if (!(await markSendSeen(sendKey, now))) {
    console.warn(`Duplicate send ${sendKey} from user ${chosen.from.id}, not counted`);
    return;
  }

  try {
    await recordUserSend(chosen.from.id, chosen.from.first_name);
    await incrementMemeCount(Number(chosen.result_id));
  } catch (error) {
    // Let a redelivery count it rather than skip it as a duplicate.
    await unmarkSendSeen(sendKey);
    throw error;
  }
}
