// In-memory stand-in for tgcloud/lib/store.js (wired in vitest.config.js). Keep its
// exports in step with the real store; tests seed and inspect `tables` directly.

/** @typedef {import('../../tgcloud/lib/store.js').Meme} Meme */
/** @typedef {import('../../tgcloud/lib/store.js').User} User */

export const tables = {
  /** @type {Meme[]} */
  memes: [],
  /** @type {User[]} */
  users: [],
};

export function resetStore() {
  tables.memes = [];
  tables.users = [];
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
