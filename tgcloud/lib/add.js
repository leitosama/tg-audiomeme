// The admin's `/add` conversation: media → meme name → optional emoji. Each step is
// saved with the store between updates; handlers/message routes the admin's messages
// here while a step is pending. Only voice messages and video notes are memes (ADR-0002).

import { MINI_APP_URL } from './config.js';
import {
  CANCEL_KEYBOARD,
  emojiOf,
  nameOf,
  REMOVE_KEYBOARD,
  SKIP_CANCEL_KEYBOARD,
  say,
  takenNameRefusal,
} from './meme_input.js';
import { labelOf } from './meme_title.js';
import { addMeme, clearStep, getStep, memeNameExists, setStep } from './store.js';

/** @typedef {import('@grammyjs/types').Message} Message */
/** @typedef {import('./store.js').ConversationStep} ConversationStep */
/** @typedef {import('./store.js').Meme} Meme */

const MEDIA_STEP = 'add:media';
const NAME_STEP = 'add:name';
const EMOJI_STEP = 'add:emoji'; // the `:emoji` suffix lets it take `/skip` (meme_input.js)

const MEDIA_PROMPT =
  'Перешли или запиши голосовое сообщение или видеосообщение-кружок (/cancel — отмена):';
const MEDIA_REFUSAL =
  '❌ Это не голосовое сообщение и не кружок. Перешли или запиши голосовое сообщение или видеосообщение-кружок:';
const CONVERTER_OFFER = '…или загрузи аудио/видео файл:';
const NAME_PROMPT = 'Теперь введи название мема (любой текст):';
const EMOJI_PROMPT = 'Теперь пришли эмодзи для мема (/skip — без эмодзи):';

/**
 * Starts `/add` in the admin's chat: asks for the media and, when this bot instance hosts
 * the Converter, offers it. The button must be inline: a Mini App opened from a reply
 * keyboard gets no user in its init data, so its endpoint call would be refused.
 * @param {number} chatId
 */
export async function startAdd(chatId) {
  await setStep(chatId, MEDIA_STEP, {});
  await say(chatId, MEDIA_PROMPT, CANCEL_KEYBOARD);
  if (!MINI_APP_URL) return;
  await say(chatId, CONVERTER_OFFER, {
    inline_keyboard: [[{ text: '📁 Загрузить файл', web_app: { url: MINI_APP_URL } }]],
  });
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
  await acceptMedia(chatId, media);
}

/** Whether `/add` is waiting for its media in this chat. @param {number} chatId */
export async function isAwaitingMedia(chatId) {
  return (await getStep(chatId))?.name === MEDIA_STEP;
}

/**
 * Moves `/add` from the media step to the name step with the meme's media: from a
 * forwarded voice message or video note, or from one the Converter uploaded.
 * @param {number} chatId
 * @param {MediaData} media
 */
export async function acceptMedia(chatId, media) {
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
  await say(chatId, `✅ Мем '${labelOf({ name, emoji, mediaType })}' добавлен!`, REMOVE_KEYBOARD);
}
