// The only module that touches the database: thin queries over tgcloud/schema.js,
// no business logic. Tests swap it for the in-memory fake in tests/fakes/store.js,
// which must keep the same exports — add each new query to both.

import { db } from 'sdk';
import { asc, desc } from 'sdk/db';
import { memes } from '../schema.js';

/**
 * @typedef {object} Meme
 * @property {number} id
 * @property {string} name
 * @property {string} fileId
 * @property {'audio' | 'video'} mediaType
 * @property {string} emoji
 * @property {number} count
 */

/**
 * @typedef {object} User
 * @property {number} userId
 * @property {string | null} displayName
 * @property {boolean} approved
 * @property {number} count
 */

// --- Inline search (issue #15) ---

/**
 * Memes whose meme name or emoji contains `query` (trimmed; case-insensitive), or
 * every meme for a blank query — most-sent first, ties by meme name. Matching runs
 * here rather than as SQL LIKE, which only folds ASCII case (names are mostly
 * Cyrillic) and would treat `%`/`_` as wildcards.
 * @param {string} query
 * @returns {Promise<Meme[]>}
 */
export async function searchMemes(query) {
  /** @type {Meme[]} */
  const rows = await db.select().from(memes).orderBy(desc(memes.count), asc(memes.name)).all();
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (m) => m.name.toLowerCase().includes(needle) || m.emoji.toLowerCase().includes(needle),
  );
}
