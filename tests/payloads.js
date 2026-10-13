// Builders for realistic Telegram update payloads, as handlers receive them.

import { ADMIN_ID } from './fakes/config.js';

/** @typedef {import('@grammyjs/types').Message} Message */

export const USER_ID = 2000;
export { ADMIN_ID };

/**
 * A text message; private chat with the sender unless `chatType` says otherwise.
 * @param {string} text
 * @param {{ from?: number, chatType?: 'private' | 'group' | 'supergroup' }} [opts]
 * @returns {Message}
 */
export function textMessage(text, { from = USER_ID, chatType = 'private' } = {}) {
  const user = { id: from, is_bot: false, first_name: `User ${from}` };
  const chat =
    chatType === 'private'
      ? { id: from, type: chatType, first_name: user.first_name }
      : { id: -100, type: chatType, title: 'Chat' };
  return /** @type {Message} */ ({ message_id: 1, date: 0, chat, from: user, text });
}

// --- Inline queries (issue #15) ---

/** @typedef {import('@grammyjs/types').InlineQuery} InlineQuery */

/**
 * An inline query typed by a user (`@bot <query>`), as `handlers/inline_query` receives it.
 * @param {string} query
 * @param {{ from?: number, offset?: string }} [opts]
 * @returns {InlineQuery}
 */
export function inlineQuery(query, { from = USER_ID, offset = '' } = {}) {
  const user = { id: from, is_bot: false, first_name: `User ${from}` };
  return { id: `iq-${from}`, from: user, query, offset, chat_type: 'sender' };
}
