// One-off import of a Python bot instance's SQLite data into its tgcloud database
// (issue #21). Never deployed: the operator copies this file to
// tgcloud/endpoints/import_legacy.js, runs it once with
//   npx tgcloud run endpoints/import_legacy "$(cat export.json)"
// where export.json is `{ "memes": [...], "users": [...] }` as `sqlite3 -json` prints the
// two tables, then deletes the copy. Its imports are written for that location.
//
// The whole export is checked before anything is written, and the import refuses to
// run unless both tables are empty, so a bad file or a second run changes nothing.

import { EndpointError } from 'sdk';
import { countMemesAndUsers, insertLegacyRows } from '../lib/store.js';

/** @typedef {import('../lib/store.js').LegacyMeme} LegacyMeme */
/** @typedef {import('../lib/store.js').User} User */
/** @typedef {Record<string, unknown>} Row */

/** @param {unknown} value @returns {value is Row} */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {string} message @returns {never} */
function reject(message) {
  throw new EndpointError(`Malformed export: ${message}. Nothing was imported.`);
}

/**
 * Reads one field of an exported row, rejecting the export unless `valid` accepts it.
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
 * The export's `key` array, each row converted by `convert`.
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
 * Rejects the export if two rows share a value of `field`.
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
 * @param {unknown} input `{ memes, users }` as `sqlite3 -json` prints the two tables
 * @param {unknown} _ctx
 * @returns {Promise<{ memes: number, users: number }>} how many rows were imported
 */
export default async function importLegacy(input, _ctx) {
  if (!isObject(input)) reject('the export must be an object { "memes": [...], "users": [...] }');

  /** @type {LegacyMeme[]} */
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
        `The ${table} table already holds ${existing[table]} row(s); the import only runs ` +
          'into empty tables. Nothing was imported.',
      );
    }
  }

  await insertLegacyRows({ memes, users });
  return { memes: memes.length, users: users.length };
}
