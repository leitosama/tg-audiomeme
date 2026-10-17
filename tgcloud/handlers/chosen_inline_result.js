// handlers/chosen_inline_result — runs when a user picks one of the bot's inline results
// (needs inline feedback on in @BotFather): counts a meme send, once.

import {
  incrementMemeCount,
  pruneSentMessages,
  recordSentMessage,
  recordUserSend,
} from '../lib/store.js';

/** How long a counted send's ID is remembered for spotting redeliveries. */
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @typedef {import('@grammyjs/types').ChosenInlineResult} ChosenInlineResult */
/** @typedef {import('@grammyjs/types').Update} Update */

/**
 * @param {ChosenInlineResult} chosen
 * @param {{ update: Update }} ctx
 */
export default async function (chosen, ctx) {
  // Meme results carry the meme's ID; leaderboards and the approval notice don't count.
  if (!/^\d+$/.test(chosen.result_id)) return;

  // Telegram only reports inline_message_id when the sent message has an inline
  // keyboard; without it, a redelivered update still repeats its update ID.
  const sentId = chosen.inline_message_id ?? `update:${ctx.update.update_id}`;
  const now = Date.now();
  await pruneSentMessages(now - SEEN_TTL_MS);
  if (!(await recordSentMessage(sentId, now))) {
    console.warn(`Send ${sentId} by user ${chosen.from.id} already counted, skipping`);
    return;
  }

  await recordUserSend(chosen.from.id, chosen.from.first_name);
  await incrementMemeCount(Number(chosen.result_id));
}
