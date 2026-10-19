// Restores a bot instance's memes and users into its tgcloud database from a backup the
// bot sent to its admin, or from a Python bot instance's `sqlite3 -json` export of the
// two tables (issue #21): both are `{ "memes": [...], "users": [...] }` with SQLite column
// names. Never deployed: the operator copies this file to tgcloud/endpoints/restore.js,
// runs it once with
//   npx tgcloud run endpoints/restore "$(cat backup.json)"
// then deletes the copy. Its imports are written for that location. README "Backups and
// restore" has the whole runbook.
//
// The whole file is checked before anything is written, and the restore refuses to run
// unless both tables are empty, so a bad file or a second run changes nothing; empty
// them first with clear_library.js. The platform's db has no transactions, so the insert
// itself (memes, then users, in chunks of 100 rows) isn't atomic: if it fails part-way,
// the rows already written stay and every retry is refused. To recover, run
// clear_library.js and then the restore again.

import { EndpointError } from 'sdk';
import { countMemesAndUsers, insertRows } from '../lib/store.js';

/** @typedef {import('../lib/store.js').RestoredMeme} RestoredMeme */
/** @typedef {import('../lib/store.js').User} User */
/** @typedef {Record<string, unknown>} Row */

/** @param {unknown} value @returns {value is Row} */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {string} message @returns {never} */
function reject(message) {
  throw new EndpointError(`Malformed backup: ${message}. Nothing was restored.`);
}

/**
 * Reads one field of an exported row, rejecting the backup unless `valid` accepts it.
 * @template T
 * @param {Row} row
 * @param {string} where e.g. `memes[3]`
 * @param {string} field the SQLite column name
 * @param {(value: unknown) => value is T} valid
 * @param {string} expected what a valid value is, for the message
 * @returns {T}
 */
function field(row, where, field, valid, expected) {
  const value = row[field];
  if (!valid(value)) reject(`${where}.${field} must be ${expected}, got ${JSON.stringify(value)}`);
  return value;
}

/** @param {unknown} v @returns {v is number} */
const isCount = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0;
/** @param {unknown} v @returns {v is number} */
const isId = (v) => Number.isSafeInteger(v);
/** @param {unknown} v @returns {v is string} */
const isString = (v) => typeof v === 'string';
/** @param {unknown} v @returns {v is string} */
const isNonEmpty = (v) => typeof v === 'string' && v !== '';
/** @param {unknown} v @returns {v is string | null} */
const isStringOrNull = (v) => v === null || typeof v === 'string';
/** @param {unknown} v @returns {v is 'audio' | 'video'} */
const isMediaType = (v) => v === 'audio' || v === 'video';
/** @param {unknown} v @returns {v is 0 | 1} */
const isFlag = (v) => v === 0 || v === 1;

/**
 * The backup's `key` array, each row converted by `convert`.
 * @template T
 * @param {Row} data
 * @param {'memes' | 'users'} key
 * @param {(row: Row, where: string) => T} convert
 * @returns {T[]}
 */
function rows(data, key, convert) {
  const list = data[key];
  if (!Array.isArray(list)) reject(`"${key}" must be an array of ${key} table rows`);
  return list.map((row, i) => {
    const where = `${key}[${i}]`;
    if (!isObject(row)) reject(`${where} must be an object`);
    return convert(row, where);
  });
}

/**
 * Rejects the backup if two rows share a value of `field`.
 * @template {Row} T
 * @param {T[]} list
 * @param {'memes' | 'users'} key
 * @param {keyof T & string} prop
 * @param {string} column the SQLite column name, for the message
 */
function requireUnique(list, key, prop, column) {
  const seen = new Set();
  list.forEach((row, i) => {
    const value = row[prop];
    if (seen.has(value)) reject(`${key}[${i}].${column} ${JSON.stringify(value)} is repeated`);
    seen.add(value);
  });
}

/**
 * @param {unknown} input `{ memes, users }`: a backup or `sqlite3 -json` export of the two tables
 * @param {unknown} _ctx
 * @returns {Promise<{ memes: number, users: number }>} how many rows were restored
 */
export default async function restore(input, _ctx) {
  if (!isObject(input)) reject('the backup must be an object { "memes": [...], "users": [...] }');

  /** @type {RestoredMeme[]} */
  const memes = rows(input, 'memes', (row, where) => ({
    id: field(row, where, 'id', isId, 'an integer'),
    name: field(row, where, 'name', isNonEmpty, 'a non-empty string'),
    fileId: field(row, where, 'file_id', isNonEmpty, 'a non-empty string'),
    mediaType: field(row, where, 'media_type', isMediaType, '"audio" or "video"'),
    emoji: field(row, where, 'emoji', isString, 'a string'),
    count: field(row, where, 'count', isCount, 'a non-negative integer'),
    createdAt: field(row, where, 'created_at', isStringOrNull, 'a string or null'),
  }));
  /** @type {User[]} */
  const users = rows(input, 'users', (row, where) => ({
    userId: field(row, where, 'userid', isId, 'an integer'),
    displayName: field(row, where, 'displayname', isStringOrNull, 'a string or null'),
    approved: field(row, where, 'approved', isFlag, '0 or 1') === 1,
    count: field(row, where, 'count', isCount, 'a non-negative integer'),
  }));
  requireUnique(memes, 'memes', 'id', 'id');
  requireUnique(memes, 'memes', 'name', 'name');
  requireUnique(users, 'users', 'userId', 'userid');

  const existing = await countMemesAndUsers();
  for (const table of /** @type {const} */ (['memes', 'users'])) {
    if (existing[table] > 0) {
      throw new EndpointError(
        `The ${table} table already holds ${existing[table]} row(s); the restore only runs ` +
          'into empty tables (run clear_library first). Nothing was restored.',
      );
    }
  }

  await insertRows({ memes, users });
  return { memes: memes.length, users: users.length };
}
