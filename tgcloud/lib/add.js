// The admin's `/add` conversation: media → meme name → optional emoji. Each step is
// saved with the store between updates; handlers/message routes the admin's messages
// here while a step is pending. Only voice messages and video notes are memes (ADR-0002).

import { api } from 'sdk';
import { addMeme, clearStep, memeNameExists, setStep } from './store.js';

/** @typedef {import('@grammyjs/types').Message} Message */
/** @typedef {import('@grammyjs/types').ReplyKeyboardMarkup} ReplyKeyboardMarkup */
/** @typedef {import('@grammyjs/types').ReplyKeyboardRemove} ReplyKeyboardRemove */
/** @typedef {import('./store.js').ConversationStep} ConversationStep */
/** @typedef {import('./store.js').Meme} Meme */

export const CANCEL_TEXT = '❌ Отмена';
const MAX_NAME_LENGTH = 100;
const MAX_EMOJI_LENGTH = 16;

const MEDIA_STEP = 'add:media';
const NAME_STEP = 'add:name';
const EMOJI_STEP = 'add:emoji';

/** @type {ReplyKeyboardMarkup} */
export const CANCEL_KEYBOARD = {
  keyboard: [[CANCEL_TEXT]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
/** @type {ReplyKeyboardMarkup} */
export const SKIP_CANCEL_KEYBOARD = {
  keyboard: [['/skip', CANCEL_TEXT]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
/** @type {ReplyKeyboardRemove} */
export const REMOVE_KEYBOARD = { remove_keyboard: true };

const MEDIA_PROMPT =
  'Перешли или запиши голосовое сообщение или видеосообщение-кружок (/cancel — отмена):';
const MEDIA_REFUSAL =
  '❌ Это не голосовое сообщение и не кружок. Перешли или запиши голосовое сообщение или видеосообщение-кружок:';
const NAME_PROMPT = 'Теперь введи название мема (любой текст):';
const EMOJI_PROMPT = 'Теперь пришли эмодзи для мема (/skip — без эмодзи):';

/**
 * @param {number} chatId
 * @param {string} text
 * @param {ReplyKeyboardMarkup | ReplyKeyboardRemove} replyMarkup
 */
export async function say(chatId, text, replyMarkup) {
  await api.sendMessage({ chat_id: chatId, text, reply_markup: replyMarkup });
}

/** Length in code points, as the Python bot counted it. @param {string} s */
const lengthOf = (s) => [...s].length;

/**
 * The meme name a message gives (trimmed), or why it's refused: not text, empty or
 * too long. Uniqueness is the caller's check. Shared with the hub's rename.
 * @param {Message} message
 * @returns {string | { refusal: string }}
 */
export function nameOf(message) {
  if (message.text === undefined) return { refusal: '❌ Пришли название текстом:' };
  const name = message.text.trim();
  if (!name || lengthOf(name) > MAX_NAME_LENGTH) {
    return {
      refusal: `❌ Название должно быть от 1 до ${MAX_NAME_LENGTH} символов. Попробуй снова:`,
    };
  }
  return name;
}

/** @param {string} name */
export const takenNameRefusal = (name) =>
  `❌ Мем с названием '${name}' уже существует. Введи другое название:`;

/**
 * The emoji a message gives ('' for `/skip`), or why it's refused. Shared with the
 * hub's emoji edit.
 * @param {Message} message
 * @returns {string | { refusal: string }}
 */
export function emojiOf(message) {
  if (message.text === undefined) {
    return { refusal: '❌ Пришли эмодзи текстом (/skip — без эмодзи):' };
  }
  const text = message.text.trim();
  const emoji = /^\/skip(?:@\w+)?$/i.test(text) ? '' : text;
  if (lengthOf(emoji) > MAX_EMOJI_LENGTH) {
    return {
      refusal: `❌ Эмодзи должно быть не длиннее ${MAX_EMOJI_LENGTH} символов. Попробуй снова:`,
    };
  }
  return emoji;
}

/** Starts `/add` in the admin's chat: asks for the media. @param {number} chatId */
export async function startAdd(chatId) {
  await setStep(chatId, MEDIA_STEP, {});
  await say(chatId, MEDIA_PROMPT, CANCEL_KEYBOARD);
}

/**
 * Whether the pending step takes a message starting with this bot command as its
 * input; any other command abandons the step. Only `/skip` on the emoji step does.
 * @param {ConversationStep} step
 * @param {string} command
 */
export function stepTakesCommand(step, command) {
  return step.name === EMOJI_STEP && command === 'skip';
}

/**
 * Abandons the pending step and acknowledges it.
 * @param {number} chatId
 */
export async function cancelStep(chatId) {
  await clearStep(chatId);
  await say(chatId, 'Отменено', REMOVE_KEYBOARD);
}

/**
 * Feeds the admin's message to the pending step. Returns false when the step isn't
 * an `/add` step.
 * @param {Message} message
 * @param {ConversationStep} step
 * @returns {Promise<boolean>}
 */
export async function continueAdd(message, step) {
  switch (step.name) {
    case MEDIA_STEP:
      await receiveMedia(message);
      return true;
    case NAME_STEP:
      await receiveName(message, /** @type {MediaData} */ (step.data));
      return true;
    case EMOJI_STEP:
      await receiveEmoji(message, /** @type {NamedData} */ (step.data));
      return true;
  }
  return false;
}

/** @typedef {{ fileId: string, mediaType: Meme['mediaType'] }} MediaData */
/** @typedef {MediaData & { name: string }} NamedData */

/** @param {Message} message */
async function receiveMedia(message) {
  const chatId = message.chat.id;
  /** @type {MediaData | null} */
  const media = message.voice
    ? { fileId: message.voice.file_id, mediaType: 'audio' }
    : message.video_note
      ? { fileId: message.video_note.file_id, mediaType: 'video' }
      : null;
  if (!media) {
    await say(chatId, MEDIA_REFUSAL, CANCEL_KEYBOARD);
    return;
  }
  await setStep(chatId, NAME_STEP, media);
  await say(chatId, NAME_PROMPT, CANCEL_KEYBOARD);
}

/**
 * @param {Message} message
 * @param {MediaData} data
 */
async function receiveName(message, data) {
  const chatId = message.chat.id;
  const name = nameOf(message);
  if (typeof name !== 'string') {
    await say(chatId, name.refusal, CANCEL_KEYBOARD);
    return;
  }
  if (await memeNameExists(name)) {
    await say(chatId, takenNameRefusal(name), CANCEL_KEYBOARD);
    return;
  }
  await setStep(chatId, EMOJI_STEP, { ...data, name });
  await say(chatId, EMOJI_PROMPT, SKIP_CANCEL_KEYBOARD);
}

/**
 * @param {Message} message
 * @param {NamedData} data
 */
async function receiveEmoji(message, data) {
  const chatId = message.chat.id;
  const emoji = emojiOf(message);
  if (typeof emoji !== 'string') {
    await say(chatId, emoji.refusal, SKIP_CANCEL_KEYBOARD);
    return;
  }
  await clearStep(chatId);
  const { fileId, mediaType, name } = data;
  if (!(await addMeme({ name, fileId, mediaType, emoji }))) {
    await say(chatId, `❌ Мем с названием '${name}' уже существует`, REMOVE_KEYBOARD);
    return;
  }
  const icon = mediaType === 'audio' ? '🎵' : '🎬';
  const title = emoji ? `${emoji} ${name}` : name;
  await say(chatId, `✅ Мем '${icon} ${title}' добавлен!`, REMOVE_KEYBOARD);
}
