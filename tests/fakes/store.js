// In-memory stand-in for tgcloud/lib/store.js (wired in vitest.config.js). Keep its
// exports in step with the real store; tests seed and inspect `tables` directly.

/** @typedef {import('../../tgcloud/lib/store.js').Meme} Meme */
/** @typedef {import('../../tgcloud/lib/store.js').User} User */
/** @typedef {import('../../tgcloud/lib/store.js').ConversationStep} ConversationStep */

export const tables = {
  /** @type {Meme[]} */
  memes: [],
  /** @type {User[]} */
  users: [],
  /** @type {ConversationStep[]} */
  steps: [],
};

export function resetStore() {
  tables.memes = [];
  tables.users = [];
  tables.steps = [];
}

// --- Conversation steps and adding memes (/add, issue #14) ---

/**
 * @param {number} chatId
 * @returns {Promise<ConversationStep | null>}
 */
export async function getStep(chatId) {
  const step = tables.steps.find((s) => s.chatId === chatId);
  return step ? structuredClone(step) : null;
}

/**
 * @param {number} chatId
 * @param {string} name
 * @param {Record<string, unknown>} data
 */
export async function setStep(chatId, name, data) {
  await clearStep(chatId);
  tables.steps.push({ chatId, name, data: structuredClone(data) });
}

/** @param {number} chatId */
export async function clearStep(chatId) {
  tables.steps = tables.steps.filter((s) => s.chatId !== chatId);
}

/**
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function memeNameExists(name) {
  return tables.memes.some((m) => m.name === name);
}

/**
 * @param {Pick<Meme, 'name' | 'fileId' | 'mediaType' | 'emoji'>} meme
 * @returns {Promise<boolean>}
 */
export async function addMeme(meme) {
  if (await memeNameExists(meme.name)) return false;
  const id = Math.max(0, ...tables.memes.map((m) => m.id)) + 1;
  tables.memes.push({ id, ...meme, count: 0 });
  return true;
}

// --- Inline search (issue #15) ---

/**
 * Same contract as the real `searchMemes`: name/emoji substring, case-insensitive,
 * most-sent first, ties by meme name.
 * @param {string} query
 * @returns {Promise<Meme[]>}
 */
export async function searchMemes(query) {
  const needle = query.trim().toLowerCase();
  return tables.memes
    .filter(
      (m) =>
        !needle || m.name.toLowerCase().includes(needle) || m.emoji.toLowerCase().includes(needle),
    )
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((m) => ({ ...m }));
}

// --- Leaderboards (issue #17) ---

/** @returns {Promise<Meme[]>} */
export async function topMemes() {
  return (await searchMemes('')).filter((m) => m.count > 0).slice(0, 3);
}

/** @returns {Promise<User[]>} */
export async function topUsers() {
  return tables.users
    .filter((u) => u.count > 0)
    .sort((a, b) => b.count - a.count || a.userId - b.userId)
    .slice(0, 3)
    .map((u) => ({ ...u }));
}

// --- Meme hub (/list, issue #18) ---

/**
 * @param {number} id
 * @returns {Promise<Meme | null>}
 */
export async function getMeme(id) {
  const meme = tables.memes.find((m) => m.id === id);
  return meme ? { ...meme } : null;
}

/** @param {number} id */
export async function deleteMeme(id) {
  tables.memes = tables.memes.filter((m) => m.id !== id);
}

// --- Send counting (issue #16) ---

/**
 * Sent-message IDs already counted, with when they were seen (epoch ms). Kept apart
 * from `tables` so other features' resets don't need to know about it.
 * @type {Map<string, number>}
 */
export const sentMessages = new Map();

/** @param {number} memeId */
export async function incrementMemeCount(memeId) {
  const meme = tables.memes.find((m) => m.id === memeId);
  if (meme) meme.count += 1;
}

/**
 * @param {number} userId
 * @param {string} displayName
 */
export async function recordUserSend(userId, displayName) {
  const user = tables.users.find((u) => u.userId === userId);
  if (user) {
    user.displayName = displayName;
    user.count += 1;
  } else {
    tables.users.push({ userId, displayName, approved: false, count: 1 });
  }
}

/**
 * @param {string} id
 * @param {number} seenAt
 * @returns {Promise<boolean>}
 */
export async function recordSentMessage(id, seenAt) {
  if (sentMessages.has(id)) return false;
  sentMessages.set(id, seenAt);
  return true;
}

/** @param {number} before */
export async function pruneSentMessages(before) {
  for (const [id, seenAt] of sentMessages) {
    if (seenAt < before) sentMessages.delete(id);
  }
}

// --- Approval and /users (issue #20) ---

/**
 * @param {number} userId
 * @param {string} displayName
 */
export async function registerUser(userId, displayName) {
  const user = tables.users.find((u) => u.userId === userId);
  if (user) user.displayName = displayName;
  else tables.users.push({ userId, displayName, approved: false, count: 0 });
}

/**
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
export async function isUserApproved(userId) {
  return tables.users.find((u) => u.userId === userId)?.approved ?? false;
}

/**
 * Same order as the real `listUsers`: pending first, then by send count, then user ID.
 * @returns {Promise<User[]>}
 */
export async function listUsers() {
  return [...tables.users]
    .sort(
      (a, b) => Number(a.approved) - Number(b.approved) || b.count - a.count || a.userId - b.userId,
    )
    .map((u) => ({ ...u }));
}

/**
 * @param {number} userId
 * @param {boolean} approved
 * @returns {Promise<boolean>}
 */
export async function setUserApproved(userId, approved) {
  const user = tables.users.find((u) => u.userId === userId);
  if (user) user.approved = approved;
  return Boolean(user);
}

// --- Legacy import (issue #21) ---

/** @returns {Promise<{ memes: number, users: number }>} */
export async function countMemesAndUsers() {
  return { memes: tables.memes.length, users: tables.users.length };
}

/** @param {{ memes: import('../../tgcloud/lib/store.js').LegacyMeme[], users: User[] }} rows */
export async function insertLegacyRows(rows) {
  tables.memes.push(...structuredClone(rows.memes));
  tables.users.push(...structuredClone(rows.users));
}
