// The only module that touches the database: thin queries over tgcloud/schema.js,
// no business logic. Tests swap it for the in-memory fake in tests/fakes/store.js,
// which must keep the same exports — add each new query to both.

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

export {};
