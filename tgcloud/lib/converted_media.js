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

/** The `code` parameter of each way the endpoint refuses a hand-back. */
export const REFUSAL = /** @type {const} */ ({
  /** The caller isn't the bot's admin. */
  NOT_ADMIN: 'NOT_ADMIN',
  /** The admin isn't at `/add`'s media step: a stale button, after `/cancel` or later. */
  NO_PENDING_ADD: 'NO_PENDING_ADD',
  /** `kind` or `data` is malformed. */
  BAD_INPUT: 'BAD_INPUT',
  /** The decoded file is over MAX_UPLOAD_BYTES. */
  TOO_LARGE: 'TOO_LARGE',
  /** The admin's privacy settings block voice messages and video notes from the bot. */
  VOICE_FORBIDDEN: 'VOICE_FORBIDDEN',
  /** Telegram refused the upload for any other reason; retrying may help. */
  SEND_FAILED: 'SEND_FAILED',
});
