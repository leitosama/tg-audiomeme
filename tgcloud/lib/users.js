// The admin's `/users` list: every user with their send count and approval, with an
// approve / revoke button each (callback data `user:<action>:<id>`, routed here by
// handlers/callback_query). A tap updates the list message in place.

import { api } from 'sdk';
import { admitAdmin, answerTap, editableMenu, showView } from './callbacks.js';
import { listUsers, setUserApproved } from './store.js';

/** @typedef {import('@grammyjs/types').CallbackQuery} CallbackQuery */
/** @typedef {import('@grammyjs/types').InlineKeyboardMarkup} InlineKeyboardMarkup */
/** @typedef {import('./callbacks.js').View} View */

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
  const answer = (text) => answerTap(query, text);

  if (!(await admitAdmin(query, 'user action'))) return;
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

  const list = editableMenu(query);
  if (list) await showView(list, usersView());
}
