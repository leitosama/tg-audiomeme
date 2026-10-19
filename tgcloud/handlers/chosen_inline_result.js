// handlers/chosen_inline_result — runs when a user picks one of the bot's inline results
// (needs inline feedback on in @BotFather): counts a meme send, once.

import { checkingBackup } from '../lib/backup.js';
import { loggingBotApiFailures } from '../lib/bot_api.js';
import { checkingMedia } from '../lib/media_check.js';
import {
  getMeme,
  incrementMemeCount,
  pruneSentMessages,
  recordSentMessage,
  recordUserSend,
} from '../lib/store.js';

/** How long a counted send's ID is remembered for spotting redeliveries. */
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @typedef {import('@grammyjs/types').ChosenInlineResult} ChosenInlineResult */
/** @typedef {import('@grammyjs/types').Update} Update */

export default checkingBackup(
  checkingMedia(loggingBotApiFailures('handlers/chosen_inline_result', countSend)),
);

/**
 * @param {ChosenInlineResult} chosen
 * @param {{ update: Update }} ctx
 */
async function countSend(chosen, ctx) {
  // Meme results carry the meme's ID; leaderboards and the approval notice don't count.
  if (!/^\d+$/.test(chosen.result_id)) return;
  const memeId = Number(chosen.result_id);
  // A meme deleted since the query was answered counts for neither it nor the user.
  if (!(await getMeme(memeId))) {
    console.warn(`Send of deleted meme ${memeId} by user ${chosen.from.id}, not counted`);
    return;
  }

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
  await incrementMemeCount(memeId);
}
