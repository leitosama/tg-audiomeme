// The Converter's decisions, kept apart from the DOM and mediabunny so they can be
// tested: which files it refuses up front, and how it converts the rest (ADR-0004).

import { MAX_UPLOAD_BYTES, REFUSAL } from '../tgcloud/lib/converted_media.js';

/** @typedef {import('../tgcloud/lib/converted_media.js').ConvertedKind} ConvertedKind */

/**
 * What the Converter knows about the picked file before converting it.
 * @typedef {object} FileFacts
 * @property {ConvertedKind} requested what the admin chose; ignored for audio-only files
 * @property {number} size in bytes
 * @property {number} duration in seconds
 * @property {{ width: number, height: number, decodable: boolean } | null} video the
 *   primary video track, if any
 * @property {boolean[]} audioDecodable whether this device can decode each audio track
 */

/**
 * @typedef {{ kind: 'voice', audioBitrate: number }} VoicePlan
 * @typedef {{ kind: 'videoNote', side: number, videoBitrate: number, audioBitrate: number,
 *   cropWarning: boolean }} VideoNotePlan
 * @typedef {VoicePlan | VideoNotePlan} Plan
 */

// Bigger inputs can freeze or crash a phone mid-conversion.
const MAX_INPUT_BYTES = 100_000_000;
const NOTE_MAX_SECONDS = 15;
const VOICE_MAX_SECONDS = 20;
const NOTE_SIDE = 640;
// 650k keeps close-up text legible; 15 s of it came out at 1.37 MB on an iPhone (#25).
const NOTE_VIDEO_BITRATE = 650_000;
const RETRY_VIDEO_BITRATE = 500_000;
const NOTE_AUDIO_BITRATE = 48_000;

// There's no ffmpeg.wasm fallback (ADR-0004): what WebCodecs can't decode is refused.
const UNSUPPORTED = { refusal: 'Этот файл не поддерживается на этом устройстве' };
const TOO_HEAVY = 'Видео слишком «тяжёлое», попробуй короче';

/**
 * How to convert the file, or why it's refused.
 * @param {FileFacts} facts
 * @returns {Plan | { refusal: string }}
 */
export function planConversion(facts) {
  const { video } = facts;
  if (facts.size > MAX_INPUT_BYTES) {
    return { refusal: 'Файл больше 100 МБ — выбери файл поменьше' };
  }
  // A clip that's "15 seconds" in the gallery passes even if it's really 15.9 s.
  const seconds = Math.floor(facts.duration);
  // Any one decodable audio track will do: iPhone videos carry an extra spatial-audio
  // track that can't be decoded next to the AAC one the conversion uses.
  const audioDecodable = facts.audioDecodable.some(Boolean);
  // Audio → video note is out of scope: an audio-only file is always voice.
  if (!video || facts.requested === 'voice') {
    if (!audioDecodable) return UNSUPPORTED;
    if (seconds > VOICE_MAX_SECONDS) {
      return { refusal: 'Голосовое может быть не длиннее 20 секунд — выбери клип покороче' };
    }
    return { kind: 'voice', audioBitrate: 64_000 };
  }
  // A silent video makes a silent video note, but sound we can't decode isn't dropped.
  if (!video.decodable || (facts.audioDecodable.length > 0 && !audioDecodable)) {
    return UNSUPPORTED;
  }
  if (seconds > NOTE_MAX_SECONDS) {
    return { refusal: 'Кружок может быть не длиннее 15 секунд — выбери клип покороче' };
  }
  const { width, height } = video;
  return {
    kind: 'videoNote',
    // H.264 needs even dimensions.
    side: Math.min(NOTE_SIDE, Math.floor(Math.min(width, height) / 2) * 2),
    videoBitrate: NOTE_VIDEO_BITRATE,
    audioBitrate: NOTE_AUDIO_BITRATE,
    cropWarning: width !== height,
  };
}

/**
 * Runs the plan, retrying a video note once at a lower bitrate if the output is over the
 * endpoint's cap: WebCodecs overshoots the requested bitrate by ~22% (#25), more on busy
 * footage. Returns the output, or why it can't be used.
 * @param {Plan} plan
 * @param {(plan: Plan) => Promise<Uint8Array>} encode
 * @returns {Promise<{ bytes: Uint8Array } | { refusal: string }>}
 */
export async function convertWithinBudget(plan, encode) {
  const bytes = await encode(plan);
  if (bytes.length <= MAX_UPLOAD_BYTES) return { bytes };
  if (plan.kind === 'videoNote') {
    const retried = await encode({ ...plan, videoBitrate: RETRY_VIDEO_BITRATE });
    if (retried.length <= MAX_UPLOAD_BYTES) return { bytes: retried };
  }
  return { refusal: TOO_HEAVY };
}

/** @type {Record<string, { text: string, retry: boolean }>} */
const FAILURES = {
  [REFUSAL.VOICE_FORBIDDEN]: {
    text: 'Разреши боту голосовые сообщения: Настройки → Конфиденциальность → Голосовые сообщения, и попробуй ещё раз',
    retry: true,
  },
  [REFUSAL.NO_PENDING_ADD]: { text: 'Эта кнопка устарела — начни /add заново', retry: false },
  [REFUSAL.NOT_ADMIN]: { text: 'Добавлять мемы может только администратор', retry: false },
  [REFUSAL.TOO_LARGE]: { text: TOO_HEAVY, retry: false },
};

/**
 * What to tell the admin when the hand-back (`Telegram.WebApp.Serverless.call`) fails,
 * and whether retrying with the same file may help. Anything but a known refusal (a
 * send failure, a server or network error) is worth a retry.
 * @param {unknown} error
 * @returns {{ text: string, retry: boolean }}
 */
export function sendFailure(error) {
  const { type, parameters } = /** @type {{ type?: unknown, parameters?: { code?: unknown } }} */ (
    error ?? {}
  );
  const code = type === 'ENDPOINT_ERROR' ? String(parameters?.code) : '';
  return FAILURES[code] ?? { text: 'Не удалось отправить, попробуй ещё раз', retry: true };
}
