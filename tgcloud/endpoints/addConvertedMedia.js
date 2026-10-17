// endpoints/addConvertedMedia — the Converter's hand-back (ADR-0004). It sends the
// file the Converter made on the admin's device to the admin's chat as a voice message
// or video note and continues the pending `/add` at the name step with its `file_id`,
// exactly as a forwarded one would.

import { api, BotApiError, EndpointError, InputFile } from 'sdk';
import { acceptMedia, isAwaitingMedia } from '../lib/add.js';
import { ADMIN_ID } from '../lib/config.js';
import { MAX_UPLOAD_BYTES, REFUSAL } from '../lib/converted_media.js';

/** @typedef {import('../lib/converted_media.js').ConvertedKind} ConvertedKind */

/**
 * @param {{ kind?: unknown, data?: unknown }} input
 * @param {{ initData: { user?: { id: number } } }} ctx
 * @returns {Promise<{ ok: true }>}
 */
export default async function addConvertedMedia(input, ctx) {
  if (ctx.initData.user?.id !== ADMIN_ID) {
    throw refusal('Добавлять мемы может только администратор', REFUSAL.NOT_ADMIN);
  }
  const chatId = ADMIN_ID; // the admin's private chat with the bot has their user ID
  if (!(await isAwaitingMedia(chatId))) {
    throw refusal('Эта кнопка устарела — начни /add заново', REFUSAL.NO_PENDING_ADD);
  }
  const { kind, data } = input;
  if ((kind !== 'voice' && kind !== 'videoNote') || typeof data !== 'string') {
    throw refusal('Неверный запрос', REFUSAL.BAD_INPUT);
  }
  const bytes = decodeBase64(data);
  if (!bytes?.length) throw refusal('Неверный запрос', REFUSAL.BAD_INPUT);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw refusal('Видео слишком «тяжёлое», попробуй короче', REFUSAL.TOO_LARGE);
  }
  let fileId;
  try {
    fileId = await send(chatId, kind, bytes);
  } catch (error) {
    if (!(error instanceof BotApiError)) throw error;
    console.error('endpoints/addConvertedMedia: upload failed', error);
    if (/VOICE_MESSAGES_FORBIDDEN/.test(error.description)) {
      throw refusal(
        'Разреши боту голосовые сообщения: Настройки → Конфиденциальность → Голосовые сообщения',
        REFUSAL.VOICE_FORBIDDEN,
      );
    }
    throw refusal('Не удалось отправить, попробуй ещё раз', REFUSAL.SEND_FAILED);
  }
  await acceptMedia(chatId, { fileId, mediaType: kind === 'voice' ? 'audio' : 'video' });
  return { ok: true };
}

/**
 * @param {string} description shown by the Converter when it has no text of its own
 * @param {string} code one of REFUSAL
 */
const refusal = (description, code) => new EndpointError(description, { code });

/**
 * The bytes the base64 text encodes (the runtime has no `atob`), or null if it isn't
 * base64.
 * @param {string} data
 */
function decodeBase64(data) {
  try {
    return Uint8Array.fromBase64(data);
  } catch {
    return null;
  }
}

/**
 * Sends the file as a voice message or video note; returns the sent file's `file_id`.
 * @param {number} chatId
 * @param {ConvertedKind} kind
 * @param {Uint8Array} bytes
 */
async function send(chatId, kind, bytes) {
  if (kind === 'voice') {
    const message = await api.sendVoice({
      chat_id: chatId,
      voice: new InputFile(bytes, 'meme.ogg', { type: 'audio/ogg' }),
    });
    return message.voice.file_id;
  }
  const message = await api.sendVideoNote({
    chat_id: chatId,
    video_note: new InputFile(bytes, 'meme.mp4', { type: 'video/mp4' }),
  });
  return message.video_note.file_id;
}
