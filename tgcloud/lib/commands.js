import { ADMIN_ID } from './config.js';

/** @typedef {import('@grammyjs/types').Message} Message */

/**
 * The bot command a message starts with, lower-cased and without the slash or
 * `@botname` suffix (`/Start@my_bot x` → `start`), or null for any other message.
 * @param {Message} message
 * @returns {string | null}
 */
export function commandOf(message) {
  const match = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i.exec(message.text ?? '');
  return match ? match[1].toLowerCase() : null;
}

/**
 * True when the message comes from the admin in a private chat with the bot.
 * @param {Message} message
 */
export function isAdminPrivate(message) {
  return message.chat.type === 'private' && message.from?.id === ADMIN_ID;
}
