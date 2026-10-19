// Backups: the memes and users tables as a JSON document in the admin's private chat,
// in the shape scripts/tgcloud/endpoints/restore.js reads back. tgcloud has no
// scheduler, so automatic backups ride on incoming updates (ADR-0005): after every
// update, at most once a day and only when the data changed. /backup sends one now.

import { api, BotApiError, InputFile } from 'sdk';
import { ADMIN_ID } from './config.js';
import {
  claimBackupCheck,
  dumpMemesAndUsers,
  getBackupHash,
  setBackupHash,
  setBackupNextAt,
} from './store.js';

/** At most one automatic backup per this long. */
export const BACKUP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** After a failed automatic backup, the next update tries again after this long. */
export const BACKUP_RETRY_MS = 60 * 60 * 1000;

/**
 * @typedef {object} Backup
 * @property {string} json the restore script's input
 * @property {string} hash of `json`, to spot an unchanged library
 * @property {number} memes how many memes it holds
 * @property {number} users how many users it holds
 */

/**
 * Wraps a handler so every update ends with the automatic backup check, even one whose
 * handler threw (that error still propagates; the check itself never throws).
 * @template {unknown[]} A
 * @param {(...args: A) => Promise<void>} handler
 * @returns {(...args: A) => Promise<void>}
 */
export function checkingBackup(handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } finally {
      await backUpIfDue(Date.now());
    }
  };
}

/**
 * Sends a backup silently if the daily check is due and the data changed since the
 * last backup sent. A failure is logged and retried by an update an hour later.
 * @param {number} now epoch ms
 */
export async function backUpIfDue(now) {
  try {
    if (!(await claimBackupCheck(now, now + BACKUP_COOLDOWN_MS))) return;
    const backup = await buildBackup();
    if (backup.hash === (await getBackupHash())) return;
    await sendBackup(backup, now, { silent: true });
  } catch (error) {
    console.error('Automatic backup failed; an update after an hour retries it', error);
    try {
      await setBackupNextAt(now + BACKUP_RETRY_MS);
    } catch (retryError) {
      console.error('Could not schedule the backup retry', retryError);
    }
  }
}

/**
 * The admin's /backup: sends a backup now, changed or not, and restarts the daily
 * cooldown. A refused upload is reported back to the admin.
 * @param {number} chatId the admin's private chat
 */
export async function startBackup(chatId) {
  const now = Date.now();
  await setBackupNextAt(now + BACKUP_COOLDOWN_MS);
  try {
    await sendBackup(await buildBackup(), now, { silent: false });
  } catch (error) {
    if (!(error instanceof BotApiError)) throw error;
    console.error('/backup: sending the backup failed', error);
    await api.sendMessage({
      chat_id: chatId,
      text: `Не удалось отправить резервную копию: ${error.description}`,
    });
  }
}

/** @returns {Promise<Backup>} */
async function buildBackup() {
  const dump = await dumpMemesAndUsers();
  const json = JSON.stringify(dump, null, 2);
  return { json, hash: hashOf(json), memes: dump.memes.length, users: dump.users.length };
}

/**
 * Sends the backup to the admin and remembers it as the last one sent.
 * @param {Backup} backup
 * @param {number} now epoch ms, for the file name
 * @param {{ silent: boolean }} opts
 */
async function sendBackup(backup, now, { silent }) {
  await api.sendDocument({
    chat_id: ADMIN_ID,
    document: new InputFile(utf8(backup.json), fileName(now), { type: 'application/json' }),
    caption: `Резервная копия · мемов: ${backup.memes} · пользователей: ${backup.users}`,
    disable_notification: silent,
  });
  await setBackupHash(backup.hash);
}

/**
 * `backup-YYYY-MM-DD-HHMM.json`, in UTC.
 * @param {number} now epoch ms
 */
export function fileName(now) {
  const iso = new Date(now).toISOString();
  return `backup-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.json`;
}

/**
 * UTF-8 bytes of `text` from language built-ins only: the platform doesn't document
 * `TextEncoder` in its isolate.
 * @param {string} text
 */
export function utf8(text) {
  const binary = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * cyrb53: a fast 53-bit string hash, plenty to tell one backup from the next. Not
 * cryptographic, and needs no `crypto` in the isolate.
 * @param {string} text
 */
export function hashOf(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
