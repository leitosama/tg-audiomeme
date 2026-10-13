// handlers/message — runs on each `message` update: bot commands (and, later, the
// admin's conversation steps). The platform calls the default export with the Message.

import { api } from 'sdk';
import { commandOf, isAdminPrivate } from '../lib/commands.js';
import { startReply } from '../lib/start.js';

/** @typedef {import('@grammyjs/types').Message} Message */

/** @param {Message} message */
export default async function (message) {
  switch (commandOf(message)) {
    case 'start':
      await api.sendMessage({
        chat_id: message.chat.id,
        ...startReply({
          isPrivate: message.chat.type === 'private',
          isAdmin: isAdminPrivate(message),
        }),
      });
      return;
  }
}
