// What the Converter (converter/, a browser app) and its endpoint
// (endpoints/addConvertedMedia) agree on. No `sdk` imports: the Converter's bundle
// imports this module too.

/** @typedef {'voice' | 'videoNote'} ConvertedKind */

/**
 * The largest converted file the endpoint takes. The endpoint's request body is capped
 * at about 2 MiB of base64 (#25: 1.25 MB passed, 1.5 MB failed), so a file must stay
 * at or under 1.5 MB.
 */
export const MAX_UPLOAD_BYTES = 1_500_000;

export const TOO_HEAVY = 'Видео слишком «тяжёлое», попробуй короче';
const SEND_AGAIN = 'Не удалось отправить, попробуй ещё раз';

/**
 * Each way the endpoint refuses a hand-back, by the `code` parameter it refuses with:
 * what the admin is told, and whether retrying with the same file may help.
 * @satisfies {Record<string, { text: string, retry: boolean }>}
 */
export const REFUSALS = {
  /** The caller isn't the bot's admin. */
  NOT_ADMIN: { text: 'Добавлять мемы может только администратор', retry: false },
  /** The admin isn't at `/add`'s media step: a stale button, after `/cancel` or later. */
  NO_PENDING_ADD: { text: 'Эта кнопка устарела — начни /add заново', retry: false },
  /** `kind` or `data` is malformed. */
  BAD_INPUT: { text: SEND_AGAIN, retry: true },
  /** The decoded file is over MAX_UPLOAD_BYTES. */
  TOO_LARGE: { text: TOO_HEAVY, retry: false },
  /** The admin's privacy settings block voice messages and video notes from the bot. */
  VOICE_FORBIDDEN: {
    text: 'Разреши боту голосовые сообщения: Настройки → Конфиденциальность → Голосовые сообщения, и попробуй ещё раз',
    retry: true,
  },
  /** Telegram refused the upload for any other reason. */
  SEND_FAILED: { text: SEND_AGAIN, retry: true },
};

/** @typedef {keyof typeof REFUSALS} RefusalCode */
