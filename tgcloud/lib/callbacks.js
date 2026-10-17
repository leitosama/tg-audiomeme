// Plumbing shared by the admin's inline-button menus (the meme hub, the /users list):
// answering the tap, turning away non-admins and editing the menu message in place.

import { api } from 'sdk';
import { isNotModified } from './bot_api.js';
import { ADMIN_ID } from './config.js';

/** @typedef {import('@grammyjs/types').CallbackQuery} CallbackQuery */
/** @typedef {import('@grammyjs/types').InlineKeyboardMarkup} InlineKeyboardMarkup */
/** @typedef {import('@grammyjs/types').Message} Message */
/** A menu message's content. @typedef {{ text: string, reply_markup: InlineKeyboardMarkup }} View */

/**
 * Answers the tap (stopping the client's spinner), optionally with a toast. A failed
 * answer (e.g. a query too old) is only logged, so the menu still updates.
 * @param {CallbackQuery} query
 * @param {string} [text]
 */
export async function answerTap(query, text) {
  try {
    await api.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
  } catch (error) {
    console.error(`Failed to answer callback query from user ${query.from.id}`, error);
  }
}

/**
 * Turns a non-admin's tap away with a notice; true when the tapper is the admin.
 * @param {CallbackQuery} query
 * @param {string} what e.g. `meme action`, for the log line
 */
export async function admitAdmin(query, what) {
  if (query.from.id === ADMIN_ID) return true;
  console.warn(`Non-admin user ${query.from.id} tried a ${what}`);
  await answerTap(query, '❌ Доступно только админу');
  return false;
}

/**
 * The menu message the tap came from, or null when it can't be edited: messages older
 * than 48 hours come as inaccessible (date 0).
 * @param {CallbackQuery} query
 * @returns {Message | null}
 */
export function editableMenu(query) {
  const menu = query.message;
  return menu && menu.date !== 0 ? /** @type {Message} */ (menu) : null;
}

/**
 * Edits the menu message into the view. Re-rendering the same view (a double tap) is
 * refused by Telegram and ignored.
 * @param {Message} menu
 * @param {View | Promise<View>} view
 */
export async function showView(menu, view) {
  try {
    await api.editMessageText({
      chat_id: menu.chat.id,
      message_id: menu.message_id,
      ...(await view),
    });
  } catch (error) {
    if (!isNotModified(error)) throw error;
  }
}
