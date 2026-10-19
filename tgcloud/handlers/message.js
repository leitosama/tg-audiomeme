// handlers/message — runs on each `message` update: bot commands (/start, /add,
// /list and its /delete alias, /users, /backup) and the admin's pending conversation
// step (/add, or a hub rename/emoji edit). The platform calls the default export with
// the Message.

import { api } from 'sdk';
import { continueAdd, startAdd } from '../lib/add.js';
import { checkingBackup, startBackup } from '../lib/backup.js';
import { loggingBotApiFailures } from '../lib/bot_api.js';
import { commandOf, isAdminPrivate } from '../lib/commands.js';
import { continueEdit, startList } from '../lib/list.js';
import { checkingMedia } from '../lib/media_check.js';
import { CANCEL_TEXT, cancelStep, stepTakesCommand } from '../lib/meme_input.js';
import { startReply } from '../lib/start.js';
import { clearStep, getStep } from '../lib/store.js';
import { startUsers } from '../lib/users.js';

/** @typedef {import('@grammyjs/types').Message} Message */

export default checkingBackup(
  checkingMedia(loggingBotApiFailures('handlers/message', handleMessage)),
);

/** @param {Message} message */
async function handleMessage(message) {
  const command = commandOf(message);
  const isAdmin = isAdminPrivate(message);
  const chatId = message.chat.id;

  const step = isAdmin ? await getStep(chatId) : null;
  if (step) {
    if (command === 'cancel' || message.text?.trim() === CANCEL_TEXT) {
      await cancelStep(chatId);
      return;
    }
    if (command === null || stepTakesCommand(step, command)) {
      if ((await continueAdd(message, step)) || (await continueEdit(message, step))) return;
    }
    // Any other command (or a step this code no longer knows) abandons the step.
    await clearStep(chatId);
  }

  switch (command) {
    case 'start':
      await api.sendMessage({
        chat_id: chatId,
        ...startReply({ isPrivate: message.chat.type === 'private', isAdmin }),
      });
      return;
    case 'add':
      if (isAdmin) await startAdd(chatId);
      return;
    case 'list':
    case 'delete':
      if (isAdmin) await startList(chatId);
      return;
    case 'users':
      if (isAdmin) await startUsers(chatId);
      return;
    case 'backup':
      if (isAdmin) await startBackup(chatId);
      return;
  }
}
