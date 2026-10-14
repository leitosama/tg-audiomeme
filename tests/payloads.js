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

// --- Chosen inline results (issue #16) ---

/** @typedef {import('@grammyjs/types').ChosenInlineResult} ChosenInlineResult */

/**
 * A user's pick from the inline results, as `handlers/chosen_inline_result` receives
 * it. Like a real meme send, it carries no `inline_message_id` unless one is given.
 * @param {string} resultId
 * @param {{ from?: number, firstName?: string, inlineMessageId?: string }} [opts]
 * @returns {ChosenInlineResult}
 */
export function chosenResult(
  resultId,
  { from = USER_ID, firstName = `User ${from}`, inlineMessageId } = {},
) {
  const user = { id: from, is_bot: false, first_name: firstName };
  return {
    result_id: resultId,
    from: user,
    query: '',
    ...(inlineMessageId === undefined ? {} : { inline_message_id: inlineMessageId }),
  };
}

/**
 * The handler context for the update with this ID.
 * @param {number} updateId
 */
export function updateContext(updateId) {
  return { update: { update_id: updateId } };
}
