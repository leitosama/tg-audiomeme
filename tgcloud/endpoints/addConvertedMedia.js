// endpoints/addConvertedMedia — the Converter's hand-back (ADR-0004). It sends the
// file the Converter made on the admin's device to the admin's chat as a voice message
// or video note and continues the pending `/add` at the name step with its `file_id`,
// exactly as a forwarded one would.

import { api, BotApiError, EndpointError, InputFile } from 'sdk';
import { acceptMedia, isAwaitingMedia } from '../lib/add.js';
import { ADMIN_ID } from '../lib/config.js';
import { MAX_UPLOAD_BYTES, REFUSALS } from '../lib/converted_media.js';

/** @typedef {import('../lib/converted_media.js').ConvertedKind} ConvertedKind */
/** @typedef {import('../lib/converted_media.js').RefusalCode} RefusalCode */
/** @typedef {import('../lib/store.js').Meme['mediaType']} MediaType */

/**
 * How each kind is sent, and the meme it makes; `send` returns the sent file's `file_id`.
 * @type {Record<ConvertedKind, { mediaType: MediaType, send: (chatId: number, bytes: Uint8Array) => Promise<string> }>}
 */
const KINDS = {
  voice: {
    mediaType: 'audio',
    send: async (chatId, bytes) => {
      const voice = new InputFile(bytes, 'meme.ogg', { type: 'audio/ogg' });
      return (await api.sendVoice({ chat_id: chatId, voice })).voice.file_id;
    },
  },
  videoNote: {
    mediaType: 'video',
    send: async (chatId, bytes) => {
      const videoNote = new InputFile(bytes, 'meme.mp4', { type: 'video/mp4' });
      return (await api.sendVideoNote({ chat_id: chatId, video_note: videoNote })).video_note
        .file_id;
    },
  },
};

/**
 * @param {{ kind?: unknown, data?: unknown }} input
 * @param {{ initData: { user?: { id: number } } }} ctx
 * @returns {Promise<{ ok: true }>}
 */
export default async function addConvertedMedia(input, ctx) {
  if (ctx.initData.user?.id !== ADMIN_ID) throw refusal('NOT_ADMIN');
  const chatId = ADMIN_ID; // the admin's private chat with the bot has their user ID
  if (!(await isAwaitingMedia(chatId))) throw refusal('NO_PENDING_ADD');
  const { kind, data } = input;
  if ((kind !== 'voice' && kind !== 'videoNote') || typeof data !== 'string') {
    throw refusal('BAD_INPUT');
  }
  const bytes = decodeBase64(data);
  if (!bytes?.length) throw refusal('BAD_INPUT');
  if (bytes.length > MAX_UPLOAD_BYTES) throw refusal('TOO_LARGE');
  const { mediaType, send } = KINDS[kind];
  let fileId;
  try {
    fileId = await send(chatId, bytes);
  } catch (error) {
    if (!(error instanceof BotApiError)) throw error;
    console.error('endpoints/addConvertedMedia: upload failed', error);
    throw refusal(
      /VOICE_MESSAGES_FORBIDDEN/.test(error.description) ? 'VOICE_FORBIDDEN' : 'SEND_FAILED',
    );
  }
  await acceptMedia(chatId, { fileId, mediaType });
  return { ok: true };
}

/** @param {RefusalCode} code */
const refusal = (code) => new EndpointError(REFUSALS[code].text, { code });

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
