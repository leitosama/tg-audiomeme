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
  sentMessages.clear();
  backupState.nextAt = Number.MAX_SAFE_INTEGER;
  backupState.hash = null;
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

// --- Hub rename and emoji (issue #19) ---

/**
 * @param {number} id
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function renameMeme(id, name) {
  const meme = tables.memes.find((m) => m.id === id);
  if (!meme || tables.memes.some((m) => m.id !== id && m.name === name)) return false;
  meme.name = name;
  return true;
}

/**
 * @param {number} id
 * @param {string} emoji
 */
export async function setMemeEmoji(id, emoji) {
  const meme = tables.memes.find((m) => m.id === id);
  if (meme) meme.emoji = emoji;
}

// --- Send counting (issue #16) ---

/**
 * Sent-message IDs already counted, with when they were seen (epoch ms); `resetStore`
 * clears it too.
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

// --- Backup and restore (issues #21, backups) ---

/** @returns {Promise<{ memes: number, users: number }>} */
export async function countMemesAndUsers() {
  return { memes: tables.memes.length, users: tables.users.length };
}

/** @param {{ memes: import('../../tgcloud/lib/store.js').RestoredMeme[], users: User[] }} rows */
export async function insertRows(rows) {
  tables.memes.push(...structuredClone(rows.memes));
  tables.users.push(...structuredClone(rows.users));
}

/** @returns {Promise<{ memes: number, users: number }>} */
export async function deleteMemesAndUsers() {
  const deleted = await countMemesAndUsers();
  tables.memes = [];
  tables.users = [];
  return deleted;
}

/**
 * Same rows as the real dump: SQLite column names, approval as 0/1, id order. A meme
 * added by the fake `addMeme` has no creation date, so it dumps as null.
 * @returns {Promise<import('../../tgcloud/lib/store.js').TableDump>}
 */
export async function dumpMemesAndUsers() {
  return {
    memes: [...tables.memes]
      .sort((a, b) => a.id - b.id)
      .map((m) => ({
        id: m.id,
        name: m.name,
        file_id: m.fileId,
        media_type: m.mediaType,
        emoji: m.emoji,
        count: m.count,
        created_at: /** @type {{ createdAt?: string | null }} */ (m).createdAt ?? null,
      })),
    users: [...tables.users]
      .sort((a, b) => a.userId - b.userId)
      .map((u) => ({
        userid: u.userId,
        displayname: u.displayName,
        approved: u.approved ? 1 : 0,
        count: u.count,
      })),
  };
}

/**
 * The backup_state row. `resetStore` makes the automatic check not due, so handler tests
 * see no backup; backup tests set `nextAt` themselves.
 */
export const backupState = {
  nextAt: Number.MAX_SAFE_INTEGER,
  hash: /** @type {string | null} */ (null),
};

/**
 * @param {number} now
 * @param {number} nextAt
 * @returns {Promise<boolean>}
 */
export async function claimBackupCheck(now, nextAt) {
  if (backupState.nextAt > now) return false;
  backupState.nextAt = nextAt;
  return true;
}

/** @param {number} nextAt */
export async function setBackupNextAt(nextAt) {
  backupState.nextAt = nextAt;
}

/** @returns {Promise<string | null>} */
export async function getBackupHash() {
  return backupState.hash;
}

/** @param {string} hash */
export async function setBackupHash(hash) {
  backupState.hash = hash;
}
