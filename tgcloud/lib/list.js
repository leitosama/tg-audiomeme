// The admin's meme hub: `/list` (alias `/delete`) sends the library as inline buttons;
// taps (callback data `meme:<action>:<id>`, routed here by handlers/callback_query)
// open a meme's detail view (previewing its media) and delete it, editing the one hub
// message in place. Rename and emoji start saved conversation steps (validated like
// `/add`); once saved, the updated detail view is sent as a fresh hub message.

import { api } from 'sdk';
import { admitAdmin, answerTap, editableMenu, showView } from './callbacks.js';
import {
  CANCEL_KEYBOARD,
  emojiOf,
  nameOf,
  REMOVE_KEYBOARD,
  SKIP_CANCEL_KEYBOARD,
  say,
  takenNameRefusal,
} from './meme_input.js';
import { labelOf, titleOf } from './meme_title.js';
import {
  clearStep,
  deleteMeme,
  getMeme,
  renameMeme,
  searchMemes,
  setMemeEmoji,
  setStep,
} from './store.js';

/** @typedef {import('@grammyjs/types').CallbackQuery} CallbackQuery */
/** @typedef {import('@grammyjs/types').Message} Message */
/** @typedef {import('./callbacks.js').View} View */
/** @typedef {import('./store.js').ConversationStep} ConversationStep */
/** @typedef {import('./store.js').Meme} Meme */

export const MEME_CALLBACK_PREFIX = 'meme:';

// Saved conversation steps for the detail view's rename and emoji buttons; their
// data is `{ memeId }`. handlers/message routes the admin's next message here.
const RENAME_STEP = 'edit:name';
const EMOJI_STEP = 'edit:emoji'; // the `:emoji` suffix lets it take `/skip` (meme_input.js)

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
      inline_keyboard: memes.map((m) => [button(labelOf(m), 'show', m.id)]),
    },
  };
}

/** @param {Meme} meme @returns {View} */
function detailView(meme) {
  return {
    text: `${labelOf(meme)}\nТип: ${meme.mediaType}\nОтправок: ${meme.count}`,
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
  const answer = (text) => answerTap(query, text);

  if (!(await admitAdmin(query, 'meme action'))) return;
  const hub = editableMenu(query);
  if (!hub) {
    await answer();
    return;
  }
  /** @param {View | Promise<View>} view */
  const show = (view) => showView(hub, view);

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
      await previewMeme(hub.chat.id, meme);
      await show(detailView(meme));
      return;
    case 'detail': // back from the delete confirmation, without previewing again
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
    case 'rename':
      await answer();
      await setStep(hub.chat.id, RENAME_STEP, { memeId: meme.id });
      await say(
        hub.chat.id,
        `Введи новое название для '${titleOf(meme)}' (/cancel — отмена):`,
        CANCEL_KEYBOARD,
      );
      return;
    case 'emoji':
      await answer();
      await setStep(hub.chat.id, EMOJI_STEP, { memeId: meme.id });
      await say(
        hub.chat.id,
        `Пришли новый эмодзи для '${titleOf(meme)}' (/skip — убрать, /cancel — отмена):`,
        SKIP_CANCEL_KEYBOARD,
      );
      return;
    default:
      await answer();
  }
}

/**
 * Sends the meme's media so the admin acts on the right meme. A failed preview
 * (e.g. a stale file ID) doesn't stop the detail view from opening.
 * @param {number} chatId
 * @param {Meme} meme
 */
async function previewMeme(chatId, meme) {
  try {
    if (meme.mediaType === 'audio') {
      await api.sendVoice({ chat_id: chatId, voice: meme.fileId });
    } else {
      await api.sendVideoNote({ chat_id: chatId, video_note: meme.fileId });
    }
  } catch (error) {
    console.error(`Failed to preview meme ${meme.id}`, error);
  }
}

/** @typedef {{ memeId: number }} EditData */

const MEME_GONE = '❌ Мем не найден';

/**
 * Feeds the admin's message to a pending hub edit step (rename or emoji). Returns
 * false when the step isn't one.
 * @param {Message} message
 * @param {ConversationStep} step
 * @returns {Promise<boolean>}
 */
export async function continueEdit(message, step) {
  if (step.name !== RENAME_STEP && step.name !== EMOJI_STEP) return false;
  const chatId = message.chat.id;
  const meme = await getMeme(/** @type {EditData} */ (step.data).memeId);
  if (!meme) {
    await clearStep(chatId);
    await say(chatId, MEME_GONE, REMOVE_KEYBOARD);
    return true;
  }
  if (step.name === RENAME_STEP) {
    await receiveNewName(message, meme);
  } else {
    await receiveNewEmoji(message, meme);
  }
  return true;
}

/**
 * @param {Message} message
 * @param {Meme} meme
 */
async function receiveNewName(message, meme) {
  const chatId = message.chat.id;
  const name = nameOf(message);
  if (typeof name !== 'string') {
    await say(chatId, name.refusal, CANCEL_KEYBOARD);
    return;
  }
  if (!(await renameMeme(meme.id, name))) {
    // Not renamed: the name is taken, or the meme was deleted since the step began.
    if (await getMeme(meme.id)) {
      await say(chatId, takenNameRefusal(name), CANCEL_KEYBOARD);
    } else {
      await clearStep(chatId);
      await say(chatId, MEME_GONE, REMOVE_KEYBOARD);
    }
    return;
  }
  await clearStep(chatId);
  console.log(`Admin ${chatId} renamed meme ${meme.id} to '${name}'`);
  await showSaved(chatId, `✅ Переименован в '${name}'`, { ...meme, name });
}

/**
 * @param {Message} message
 * @param {Meme} meme
 */
async function receiveNewEmoji(message, meme) {
  const chatId = message.chat.id;
  const emoji = emojiOf(message);
  if (typeof emoji !== 'string') {
    await say(chatId, emoji.refusal, SKIP_CANCEL_KEYBOARD);
    return;
  }
  await setMemeEmoji(meme.id, emoji);
  await clearStep(chatId);
  console.log(`Admin ${chatId} set the emoji of meme ${meme.id} to '${emoji || '-'}'`);
  const updated = { ...meme, emoji };
  await showSaved(chatId, `✅ Обновлено: '${titleOf(updated)}'`, updated);
}

/**
 * Confirms a saved edit, dropping the reply keyboard, then shows the updated meme's
 * detail view as a fresh hub message.
 * @param {number} chatId
 * @param {string} confirmation
 * @param {Meme} meme
 */
async function showSaved(chatId, confirmation, meme) {
  await say(chatId, confirmation, REMOVE_KEYBOARD);
  await api.sendMessage({ chat_id: chatId, ...detailView(meme) });
}
