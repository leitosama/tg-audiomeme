// The only module that touches the database: thin queries over tgcloud/schema.js,
// no business logic. Tests swap it for the in-memory fake in tests/fakes/store.js,
// which must keep the same exports — add each new query to both.

import { db } from 'sdk';
import { asc, desc, eq, gt, sql } from 'sdk/db';
import { conversationSteps, memes, sentMessages, users } from '../schema.js';

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

// --- Leaderboards (issue #17) ---

/** Rows a leaderboard shows. */
const TOP_LIMIT = 3;

/**
 * The most-sent memes (never-sent ones left out), ties by meme name.
 * @returns {Promise<Meme[]>}
 */
export async function topMemes() {
  return await db
    .select()
    .from(memes)
    .where(gt(memes.count, 0))
    .orderBy(desc(memes.count), asc(memes.name))
    .limit(TOP_LIMIT)
    .all();
}

/**
 * The users with the most sends (those with none left out), ties by user ID.
 * @returns {Promise<User[]>}
 */
export async function topUsers() {
  return await db
    .select()
    .from(users)
    .where(gt(users.count, 0))
    .orderBy(desc(users.count), asc(users.userId))
    .limit(TOP_LIMIT)
    .all();
}

// --- Meme hub (/list, issue #18) ---

/**
 * @param {number} id
 * @returns {Promise<Meme | null>}
 */
export async function getMeme(id) {
  return (await db.select().from(memes).where(eq(memes.id, id)).get()) ?? null;
}

/** @param {number} id */
export async function deleteMeme(id) {
  await db.delete(memes).where(eq(memes.id, id)).run();
}

// --- Hub rename and emoji (issue #19) ---

/**
 * Renames a meme; false (nothing changed) when another meme has that name or the
 * meme is gone. OR IGNORE turns the unique-name clash into "no row updated".
 * @param {number} id
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function renameMeme(id, name) {
  const result = await db.run(sql`UPDATE OR IGNORE memes SET name = ${name} WHERE id = ${id}`);
  return result.rowsAffected > 0;
}

/**
 * Sets the meme's emoji; '' removes it.
 * @param {number} id
 * @param {string} emoji
 */
export async function setMemeEmoji(id, emoji) {
  await db.update(memes).set({ emoji }).where(eq(memes.id, id)).run();
}

// --- Send counting (issue #16) ---

/** @param {number} memeId */
export async function incrementMemeCount(memeId) {
  await db
    .update(memes)
    .set({ count: sql`${memes.count} + 1` })
    .where(eq(memes.id, memeId))
    .run();
}

/**
 * Counts one send for the user, registering them if new and refreshing their display name.
 * @param {number} userId
 * @param {string} displayName
 */
export async function recordUserSend(userId, displayName) {
  await db
    .insert(users)
    .values({ userId, displayName, count: 1 })
    .onConflictDoUpdate({
      target: users.userId,
      set: { displayName, count: sql`${users.count} + 1` },
    })
    .run();
}

/**
 * Records a sent message's ID; false when it was already recorded.
 * @param {string} id
 * @param {number} seenAt epoch milliseconds
 * @returns {Promise<boolean>}
 */
export async function recordSentMessage(id, seenAt) {
  const rows = await db
    .insert(sentMessages)
    .values({ id, seenAt })
    .onConflictDoNothing({ target: sentMessages.id })
    .returning({ id: sentMessages.id });
  return rows.length > 0;
}

/**
 * Drops sent-message IDs recorded before `before` (epoch milliseconds).
 * @param {number} before
 */
export async function pruneSentMessages(before) {
  await db.delete(sentMessages).where(sql`${sentMessages.seenAt} < ${before}`).run();
}

// --- Approval and /users (issue #20) ---

/**
 * Makes the user known (so the admin can approve them), refreshing their display
 * name; approval and send count are left as they are.
 * @param {number} userId
 * @param {string} displayName
 */
export async function registerUser(userId, displayName) {
  await db
    .insert(users)
    .values({ userId, displayName })
    .onConflictDoUpdate({ target: users.userId, set: { displayName } })
    .run();
}

/**
 * Whether the user is approved; unknown users aren't.
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
export async function isUserApproved(userId) {
  const row = await db
    .select({ approved: users.approved })
    .from(users)
    .where(eq(users.userId, userId))
    .get();
  return row?.approved ?? false;
}

/**
 * Every user: pending (unapproved) first, then most-sending, ties by user ID.
 * @returns {Promise<User[]>}
 */
export async function listUsers() {
  return db
    .select()
    .from(users)
    .orderBy(asc(users.approved), desc(users.count), asc(users.userId))
    .all();
}

/**
 * Sets the user's approval; false when there is no such user.
 * @param {number} userId
 * @param {boolean} approved
 * @returns {Promise<boolean>}
 */
export async function setUserApproved(userId, approved) {
  const rows = await db
    .update(users)
    .set({ approved })
    .where(eq(users.userId, userId))
    .returning({ userId: users.userId });
  return rows.length > 0;
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
