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
  /** @type {{ sendKey: string, seenAt: number }[]} */
  seenSends: [],
};

export function resetStore() {
  tables.memes = [];
  tables.users = [];
  tables.steps = [];
  tables.seenSends = [];
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

// --- Send counting (issue #16) ---

/**
 * @param {string} sendKey
 * @param {number} seenAt
 * @returns {Promise<boolean>}
 */
export async function markSendSeen(sendKey, seenAt) {
  if (tables.seenSends.some((s) => s.sendKey === sendKey)) return false;
  tables.seenSends.push({ sendKey, seenAt });
  return true;
}

/** @param {string} sendKey */
export async function unmarkSendSeen(sendKey) {
  tables.seenSends = tables.seenSends.filter((s) => s.sendKey !== sendKey);
}

/** @param {number} before */
export async function pruneSeenSends(before) {
  tables.seenSends = tables.seenSends.filter((s) => s.seenAt >= before);
}

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
