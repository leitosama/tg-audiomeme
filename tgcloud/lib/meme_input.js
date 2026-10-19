// What the admin's meme conversations (`/add`, the hub's rename and emoji edits) share:
// the reply keyboards, validating a typed meme name or emoji, and cancelling a step.

import { api } from 'sdk';
import { clearStep } from './store.js';

/** @typedef {import('@grammyjs/types').Message} Message */
/** @typedef {import('@grammyjs/types').ReplyKeyboardMarkup} ReplyKeyboardMarkup */
/** @typedef {import('@grammyjs/types').ReplyKeyboardRemove} ReplyKeyboardRemove */
/** @typedef {import('@grammyjs/types').InlineKeyboardMarkup} InlineKeyboardMarkup */
/** @typedef {import('./store.js').ConversationStep} ConversationStep */

export const CANCEL_TEXT = '❌ Отмена';
const MAX_NAME_LENGTH = 100;
const MAX_EMOJI_LENGTH = 16;

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

/**
 * @param {number} chatId
 * @param {string} text
 * @param {ReplyKeyboardMarkup | ReplyKeyboardRemove | InlineKeyboardMarkup} replyMarkup
 */
export async function say(chatId, text, replyMarkup) {
  await api.sendMessage({ chat_id: chatId, text, reply_markup: replyMarkup });
}

/** Length in code points, as the Python bot counted it. @param {string} s */
const lengthOf = (s) => [...s].length;

/**
 * The meme name a message gives (trimmed), or why it's refused: not text, empty or
 * too long. Uniqueness is the caller's check.
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
 * The emoji a message gives ('' for `/skip`), or why it's refused.
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

/**
 * Whether the pending step takes a message starting with this bot command as its
 * input; any other command abandons the step. Only `/skip` does, on an emoji step
 * (`add:emoji`, `edit:emoji`), where it means "no emoji".
 * @param {ConversationStep} step
 * @param {string} command
 */
export function stepTakesCommand(step, command) {
  return command === 'skip' && step.name.endsWith(':emoji');
}

/**
 * Abandons the pending step and acknowledges it.
 * @param {number} chatId
 */
export async function cancelStep(chatId) {
  await clearStep(chatId);
  await say(chatId, 'Отменено', REMOVE_KEYBOARD);
}
