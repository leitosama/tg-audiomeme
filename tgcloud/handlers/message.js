// handlers/message — runs on each `message` update: bot commands (/start, /add,
// /list and its /delete alias) and the admin's pending conversation step (/add, or
// a hub rename/emoji edit). The platform calls the default export with the Message.

import { api } from 'sdk';
import { CANCEL_TEXT, cancelStep, continueAdd, startAdd, stepTakesCommand } from '../lib/add.js';
import { commandOf, isAdminPrivate } from '../lib/commands.js';
import { continueEdit, editStepTakesCommand, startList } from '../lib/list.js';
import { startReply } from '../lib/start.js';
import { clearStep, getStep } from '../lib/store.js';

/** @typedef {import('@grammyjs/types').Message} Message */

/** @param {Message} message */
export default async function (message) {
  const command = commandOf(message);
  const isAdmin = isAdminPrivate(message);
  const chatId = message.chat.id;

  const step = isAdmin ? await getStep(chatId) : null;
  if (step) {
    if (command === 'cancel' || message.text?.trim() === CANCEL_TEXT) {
      await cancelStep(chatId);
      return;
    }
    if (
      command === null ||
      stepTakesCommand(step, command) ||
      editStepTakesCommand(step, command)
    ) {
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
  }
}
