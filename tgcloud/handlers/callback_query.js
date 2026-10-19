// handlers/callback_query — runs on each `callback_query` update (a tap on an inline
// button of the bot's messages): routes it by its callback data prefix.

import { checkingBackup } from '../lib/backup.js';
import { loggingBotApiFailures } from '../lib/bot_api.js';
import { answerTap } from '../lib/callbacks.js';
import { handleMemeAction, MEME_CALLBACK_PREFIX } from '../lib/list.js';
import { handleUserAction, USER_CALLBACK_PREFIX } from '../lib/users.js';

/** @typedef {import('@grammyjs/types').CallbackQuery} CallbackQuery */

export default checkingBackup(
  loggingBotApiFailures('handlers/callback_query', handleCallbackQuery),
);

/** @param {CallbackQuery} query */
async function handleCallbackQuery(query) {
  if (query.data?.startsWith(MEME_CALLBACK_PREFIX)) {
    await handleMemeAction(query);
    return;
  }
  if (query.data?.startsWith(USER_CALLBACK_PREFIX)) {
    await handleUserAction(query);
    return;
  }
  // A button this code no longer knows: stop the client's loading spinner.
  await answerTap(query);
}
