// The admin's `/users` list: every user with their send count and approval, with an
// approve / revoke button each (callback data `user:<action>:<id>`, routed here by
// handlers/callback_query). A tap updates the list message in place.

import { api, BotApiError } from 'sdk';
import { ADMIN_ID } from './config.js';
import { listUsers, setUserApproved } from './store.js';

/** @typedef {import('@grammyjs/types').CallbackQuery} CallbackQuery */
/** @typedef {import('@grammyjs/types').InlineKeyboardMarkup} InlineKeyboardMarkup */
/** @typedef {{ text: string, reply_markup: InlineKeyboardMarkup }} View */

export const USER_CALLBACK_PREFIX = 'user:';

/** Pending users first, then most-sending. @returns {Promise<View>} */
async function usersView() {
  const users = await listUsers();
  if (users.length === 0) {
    return { text: 'Нет пользователей', reply_markup: { inline_keyboard: [] } };
  }
  const lines = ['👥 Пользователи:'];
  /** @type {InlineKeyboardMarkup['inline_keyboard']} */
  const rows = [];
  for (const { userId, displayName, approved, count } of users) {
    const name = displayName || String(userId);
    lines.push(`${approved ? '✅' : '⏳'} ${name} (id ${userId}) — ${count}`);
    rows.push([
      approved
        ? { text: `🚫 Отозвать ${name}`, callback_data: `${USER_CALLBACK_PREFIX}revoke:${userId}` }
        : {
            text: `✅ Одобрить ${name}`,
            callback_data: `${USER_CALLBACK_PREFIX}approve:${userId}`,
          },
    ]);
  }
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: rows } };
}

/** Sends the user list to the admin's chat. @param {number} chatId */
export async function startUsers(chatId) {
  await api.sendMessage({ chat_id: chatId, ...(await usersView()) });
}

/**
 * Handles a tap on an approve / revoke button (callback data starting with `user:`).
 * @param {CallbackQuery} query
 */
export async function handleUserAction(query) {
  /** @param {string} [text] */
  const answer = (text) =>
    api.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });

  if (query.from.id !== ADMIN_ID) {
    console.warn(`Non-admin user ${query.from.id} tried a user action`);
    await answer('❌ Доступно только админу');
    return;
  }
  const [, action, rawId] = (query.data ?? '').split(':');
  if (action !== 'approve' && action !== 'revoke') {
    await answer();
    return;
  }
  const userId = Number(rawId);
  const approved = action === 'approve';
  if (await setUserApproved(userId, approved)) {
    console.log(`Admin ${query.from.id} set user ${userId} approved=${approved}`);
    await answer(approved ? '✅ Одобрен' : '🚫 Отозван');
  } else {
    await answer('Пользователь не найден');
  }

  const list = query.message;
  // Messages older than 48 hours come as inaccessible (date 0) and can't be edited.
  if (!list || list.date === 0) return;
  try {
    await api.editMessageText({
      chat_id: list.chat.id,
      message_id: list.message_id,
      ...(await usersView()),
    });
  } catch (error) {
    // A double tap re-renders the same list; Telegram refuses it, nothing is lost.
    if (!(error instanceof BotApiError && /message is not modified/i.test(error.description))) {
      throw error;
    }
  }
}
