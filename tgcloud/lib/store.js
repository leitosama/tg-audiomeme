// The only module that touches the database: thin queries over tgcloud/schema.js,
// no business logic. Tests swap it for the in-memory fake in tests/fakes/store.js,
// which must keep the same exports — add each new query to both.

import { db } from 'sdk';
import { asc, desc, eq, sql } from 'sdk/db';
import { conversationSteps, memes, users } from '../schema.js';

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

// --- Conversation steps and adding memes (/add, issue #14) ---

/**
 * A chat's pending conversation step: which step it is and what earlier steps collected.
 * @typedef {object} ConversationStep
 * @property {number} chatId
 * @property {string} name
 * @property {Record<string, unknown>} data
 */

/**
 * @param {number} chatId
 * @returns {Promise<ConversationStep | null>}
 */
export async function getStep(chatId) {
  const row = await db
    .select({
      chatId: conversationSteps.chatId,
      name: conversationSteps.name,
      data: conversationSteps.data,
    })
    .from(conversationSteps)
    .where(eq(conversationSteps.chatId, chatId))
    .get();
  return row ?? null;
}

/**
 * Saves the chat's pending step, replacing any previous one.
 * @param {number} chatId
 * @param {string} name
 * @param {Record<string, unknown>} data
 */
export async function setStep(chatId, name, data) {
  await db
    .insert(conversationSteps)
    .values({ chatId, name, data })
    .onConflictDoUpdate({
      target: conversationSteps.chatId,
      set: { name, data, updatedAt: sql`(CURRENT_TIMESTAMP)` },
    })
    .run();
}

/** @param {number} chatId */
export async function clearStep(chatId) {
  await db.delete(conversationSteps).where(eq(conversationSteps.chatId, chatId)).run();
}

/**
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function memeNameExists(name) {
  return (await db.$count(memes, eq(memes.name, name))) > 0;
}

/**
 * Inserts a meme; false (nothing stored) when its name is already taken.
 * @param {Pick<Meme, 'name' | 'fileId' | 'mediaType' | 'emoji'>} meme
 * @returns {Promise<boolean>}
 */
export async function addMeme(meme) {
  const rows = await db
    .insert(memes)
    .values(meme)
    .onConflictDoNothing({ target: memes.name })
    .returning({ id: memes.id });
  return rows.length > 0;
}

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

// --- Legacy import (issue #21) ---

/**
 * A meme as the Python bot stored it, with its creation date (SQLite `CURRENT_TIMESTAMP`
 * text, or null).
 * @typedef {Meme & { createdAt: string | null }} LegacyMeme
 */

/** Rows per INSERT, keeping each statement well under SQLite's bound-parameter limit. */
const IMPORT_CHUNK = 100;

/**
 * How many rows the memes and users tables hold.
 * @returns {Promise<{ memes: number, users: number }>}
 */
export async function countMemesAndUsers() {
  return { memes: await db.$count(memes), users: await db.$count(users) };
}

/**
 * Inserts memes and users exactly as given, ids included.
 * @param {{ memes: LegacyMeme[], users: User[] }} rows
 */
export async function insertLegacyRows(rows) {
  for (const [target, list] of [
    [memes, rows.memes],
    [users, rows.users],
  ]) {
    for (let i = 0; i < list.length; i += IMPORT_CHUNK) {
      await db
        .insert(target)
        .values(list.slice(i, i + IMPORT_CHUNK))
        .run();
    }
  }
}
