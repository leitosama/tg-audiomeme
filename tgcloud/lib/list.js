// The admin's meme hub: `/list` (alias `/delete`) sends the library as inline buttons;
// taps (callback data `meme:<action>:<id>`, routed here by handlers/callback_query)
// open a meme's detail view, replay its media and delete it, editing the one hub
// message in place.

import { api, BotApiError } from 'sdk';
import { ADMIN_ID } from './config.js';
import { deleteMeme, getMeme, searchMemes } from './store.js';

/** @typedef {import('@grammyjs/types').CallbackQuery} CallbackQuery */
/** @typedef {import('@grammyjs/types').InlineKeyboardMarkup} InlineKeyboardMarkup */
/** @typedef {import('./store.js').Meme} Meme */
/** @typedef {{ text: string, reply_markup: InlineKeyboardMarkup }} View */

export const MEME_CALLBACK_PREFIX = 'meme:';

/** @param {Meme['mediaType']} mediaType */
const iconOf = (mediaType) => (mediaType === 'audio' ? '🎵' : '🎬');

/** @param {Meme} meme */
const titleOf = (meme) => (meme.emoji ? `${meme.emoji} ${meme.name}` : meme.name);

/**
 * @param {string} text
 * @param {string} action
 * @param {number} [id]
 */
const button = (text, action, id) => ({
  text,
  callback_data: `${MEME_CALLBACK_PREFIX}${action}${id === undefined ? '' : `:${id}`}`,
});

/** The library, most-sent first: one button per meme. @returns {Promise<View>} */
async function listView() {
  const memes = await searchMemes('');
  if (memes.length === 0) {
    return { text: 'Нет сохраненных мемов', reply_markup: { inline_keyboard: [] } };
  }
  return {
    text: '📋 Мемы (нажми для управления):',
    reply_markup: {
      inline_keyboard: memes.map((m) => [
        button(`${iconOf(m.mediaType)} ${titleOf(m)}`, 'show', m.id),
      ]),
    },
  };
}

/** @param {Meme} meme @returns {View} */
function detailView(meme) {
  return {
    text: `${iconOf(meme.mediaType)} ${titleOf(meme)}\nТип: ${meme.mediaType}\nОтправок: ${meme.count}`,
    reply_markup: {
      inline_keyboard: [
        [button('✏️ Переименовать', 'rename', meme.id), button('😀 Эмодзи', 'emoji', meme.id)],
        [button('🗑 Удалить', 'del', meme.id)],
        [button('◀️ Назад', 'list')],
      ],
    },
  };
}

/** @param {Meme} meme @returns {View} */
function confirmDeleteView(meme) {
  return {
    text: `Удалить мем '${titleOf(meme)}'?`,
    reply_markup: {
      inline_keyboard: [[button('✅ Да', 'delok', meme.id), button('◀️ Нет', 'detail', meme.id)]],
    },
  };
}

/** Sends the hub to the admin's chat. @param {number} chatId */
export async function startList(chatId) {
  await api.sendMessage({ chat_id: chatId, ...(await listView()) });
}

/**
 * Handles a tap on a hub button (callback data starting with `meme:`).
 * @param {CallbackQuery} query
 */
export async function handleMemeAction(query) {
  /** @param {string} [text] */
  const answer = (text) =>
    api.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });

  if (query.from.id !== ADMIN_ID) {
    console.warn(`Non-admin user ${query.from.id} tried a meme action`);
    await answer('❌ Доступно только админу');
    return;
  }
  const hub = query.message;
  // Messages older than 48 hours come as inaccessible (date 0) and can't be edited.
  if (!hub || hub.date === 0) {
    await answer();
    return;
  }
  /** @param {View | Promise<View>} view */
  const show = async (view) => {
    try {
      await api.editMessageText({
        chat_id: hub.chat.id,
        message_id: hub.message_id,
        ...(await view),
      });
    } catch (error) {
      // A double tap re-renders the same view; Telegram refuses it, nothing is lost.
      if (!(error instanceof BotApiError && /message is not modified/i.test(error.description))) {
        throw error;
      }
    }
  };

  const [, action, rawId] = (query.data ?? '').split(':');
  if (action === 'list') {
    await answer();
    await show(listView());
    return;
  }
  const meme = await getMeme(Number(rawId));
  if (!meme) {
    await answer('Мем не найден');
    await show(listView());
    return;
  }
  switch (action) {
    case 'show':
      await answer();
      await replay(hub.chat.id, meme);
      await show(detailView(meme));
      return;
    case 'detail': // back from the delete confirmation, without replaying again
      await answer();
      await show(detailView(meme));
      return;
    case 'del':
      await answer();
      await show(confirmDeleteView(meme));
      return;
    case 'delok':
      await deleteMeme(meme.id);
      console.log(`Admin ${query.from.id} deleted meme '${meme.name}'`);
      await answer('🗑 Удалён');
      await show(listView());
      return;
    default:
      // Rename and emoji are wired in issue #19.
      await answer();
  }
}

/**
 * Replays the meme's media so the admin acts on the right meme. A failed replay
 * (e.g. a stale file ID) doesn't stop the detail view from opening.
 * @param {number} chatId
 * @param {Meme} meme
 */
async function replay(chatId, meme) {
  try {
    if (meme.mediaType === 'audio') {
      await api.sendVoice({ chat_id: chatId, voice: meme.fileId });
    } else {
      await api.sendVideoNote({ chat_id: chatId, video_note: meme.fileId });
    }
  } catch (error) {
    console.error(`Failed to replay meme ${meme.id}`, error);
  }
}
