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

/**
 * A media message (no text) in a private chat with the sender, carrying a file of the
 * given kind with `file_id` = `<kind>-file`.
 * @param {'voice' | 'video_note' | 'audio' | 'video' | 'sticker'} kind
 * @param {{ from?: number }} [opts]
 * @returns {Message}
 */
export function mediaMessage(kind, { from = ADMIN_ID } = {}) {
  const { text: _, ...message } = textMessage('', { from });
  const file = { file_id: `${kind}-file`, file_unique_id: `${kind}-unique` };
  return /** @type {Message} */ ({ ...message, [kind]: file });
}
