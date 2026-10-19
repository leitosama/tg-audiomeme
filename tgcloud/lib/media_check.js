// The media check: keeps each meme's file in use inside Telegram and spots files Telegram
// no longer serves (ADR-0006). Memes are only ever sent by file ID, and Telegram doesn't
// promise how long it keeps a file nobody uses. Like backups it rides on incoming updates:
// after an update, at most every MEDIA_CHECK_INTERVAL_MS, it calls getFile on the few
// memes checked longest ago. A meme whose file can't be found MEDIA_BROKEN_AFTER checks
// in a row is broken: left out of inline results and reported to the admin. A later
// successful check heals it.

import { api, BotApiError } from 'sdk';
import { ADMIN_ID } from './config.js';
import { titleOf } from './meme_title.js';
import { claimMediaCheck, memesDueForCheck, setMediaCheckNextAt, setMemeCheck } from './store.js';

/** @typedef {import('./store.js').Meme} Meme */

/** At most one media check per this long. */
export const MEDIA_CHECK_INTERVAL_MS = 15 * 60 * 1000;
/** Memes one check looks at; small, as the platform documents no per-update call budget. */
export const MEDIA_CHECK_BATCH = 3;
/** After a check failed for another reason (rate limit, outage), the next one waits this long. */
export const MEDIA_CHECK_RETRY_MS = 60 * 60 * 1000;
/**
 * Failed checks in a row that make a meme broken. Telegram answers a missing file with
 * "wrong file_id or the file is temporarily unavailable", so one miss proves nothing.
 */
export const MEDIA_BROKEN_AFTER = 2;

/** @param {Meme} meme */
export const isBroken = (meme) => (meme.failedChecks ?? 0) >= MEDIA_BROKEN_AFTER;

/**
 * Wraps a handler so every update ends with the media check, even one whose handler
 * threw (that error still propagates; the check itself never throws).
 * @template {unknown[]} A
 * @param {(...args: A) => Promise<void>} handler
 * @returns {(...args: A) => Promise<void>}
 */
export function checkingMedia(handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } finally {
      await checkMediaIfDue(Date.now());
    }
  };
}

/**
 * Checks the memes checked longest ago if the check is due. A failure other than a
 * missing file stops it; an update after MEDIA_CHECK_RETRY_MS tries again.
 * @param {number} now epoch ms
 */
export async function checkMediaIfDue(now) {
  try {
    if (!(await claimMediaCheck(now, now + MEDIA_CHECK_INTERVAL_MS))) return;
    for (const meme of await memesDueForCheck(MEDIA_CHECK_BATCH)) {
      await checkMeme(meme, now);
    }
  } catch (error) {
    console.error('Media check failed; an update after an hour retries it', error);
    try {
      await setMediaCheckNextAt(now + MEDIA_CHECK_RETRY_MS);
    } catch (retryError) {
      console.error('Could not schedule the media check retry', retryError);
    }
  }
}

/**
 * Asks Telegram for the meme's file and records the outcome, telling the admin when
 * the meme turns broken or heals.
 * @param {Meme} meme
 * @param {number} now epoch ms
 */
async function checkMeme(meme, now) {
  const found = await fileFound(meme.fileId);
  const failedChecks = found ? 0 : (meme.failedChecks ?? 0) + 1;
  await setMemeCheck(meme.id, now, failedChecks);
  const checked = { ...meme, failedChecks };
  if (!found) console.error(`Media check: Telegram can't find the file of meme ${meme.id}`);
  if (isBroken(checked) === isBroken(meme)) return;
  const text = isBroken(checked)
    ? `⚠️ Telegram больше не отдаёт файл мема '${titleOf(meme)}'. Мем скрыт из inline-поиска: ` +
      'удали его в /list и добавь заново через /add.'
    : `✅ Файл мема '${titleOf(meme)}' снова доступен, мем вернулся в inline-поиск.`;
  await api.sendMessage({ chat_id: ADMIN_ID, text });
}

/**
 * Whether Telegram still serves the file. A file too big for bots to download still
 * exists; any error but a 400 isn't about the file and propagates.
 * @param {string} fileId
 */
async function fileFound(fileId) {
  try {
    await api.getFile({ file_id: fileId });
    return true;
  } catch (error) {
    if (!(error instanceof BotApiError) || error.code !== 400) throw error;
    return /too big/i.test(error.description ?? '');
  }
}
