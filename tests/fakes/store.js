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
