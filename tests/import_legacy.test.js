import { describe, expect, test } from 'vitest';
import importLegacy from '../scripts/tgcloud/endpoints/import_legacy.js';
import { addMeme, tables } from './fakes/store.js';

/** A Python bot instance's data as `sqlite3 -json` prints its memes and users tables. */
function legacyExport() {
  return {
    memes: [
      {
        id: 3,
        name: 'Bruh',
        file_id: 'voice-3',
        media_type: 'audio',
        emoji: '😐',
        count: 41,
        created_at: '2024-02-01 10:00:00',
      },
      {
        id: 7,
        name: 'Кот',
        file_id: 'note-7',
        media_type: 'video',
        emoji: '',
        count: 0,
        created_at: '2025-06-30 23:59:59',
      },
    ],
    users: [
      { userid: 2000, displayname: 'Аня', approved: 1, count: 12 },
      { userid: 2001, displayname: null, approved: 0, count: 0 },
    ],
  };
}

/** Runs the import the way `tgcloud run endpoints/import_legacy "$(cat export.json)"` does. */
const run = (/** @type {unknown} */ input) => importLegacy(input, {});

describe('legacy import', () => {
  test('copies every meme and user field, keeping ids, counts and dates', async () => {
    const result = await run(legacyExport());

    expect(result).toEqual({ memes: 2, users: 2 });
    expect(tables.memes).toEqual([
      {
        id: 3,
        name: 'Bruh',
        fileId: 'voice-3',
        mediaType: 'audio',
        emoji: '😐',
        count: 41,
        createdAt: '2024-02-01 10:00:00',
      },
      {
        id: 7,
        name: 'Кот',
        fileId: 'note-7',
        mediaType: 'video',
        emoji: '',
        count: 0,
        createdAt: '2025-06-30 23:59:59',
      },
    ]);
    expect(tables.users).toEqual([
      { userId: 2000, displayName: 'Аня', approved: true, count: 12 },
      { userId: 2001, displayName: null, approved: false, count: 0 },
    ]);
  });

  test('a later /add continues numbering after the highest imported id', async () => {
    await run(legacyExport());
    await addMeme({ name: 'Новый', fileId: 'voice-new', mediaType: 'audio', emoji: '' });

    expect(tables.memes.find((m) => m.name === 'Новый')?.id).toBe(8);
  });

  test('an instance with no users yet imports its memes', async () => {
    expect(await run({ ...legacyExport(), users: [] })).toEqual({ memes: 2, users: 0 });
  });

  test.each([
    ['memes', () => tables.memes.push({ ...existingMeme })],
    ['users', () => tables.users.push({ ...existingUser })],
  ])('refuses, changing nothing, when %s already holds rows', async (table, seed) => {
    seed();
    const before = structuredClone(tables);

    await expect(run(legacyExport())).rejects.toThrow(
      new RegExp(`${table} table already holds 1 row`),
    );
    expect(tables).toEqual(before);
  });

  /** The export with one field of the first meme or user replaced. */
  const withMeme = (/** @type {Record<string, unknown>} */ patch) => {
    const data = legacyExport();
    return { ...data, memes: [{ ...data.memes[0], ...patch }, data.memes[1]] };
  };
  const withUser = (/** @type {Record<string, unknown>} */ patch) => {
    const data = legacyExport();
    return { ...data, users: [{ ...data.users[0], ...patch }, data.users[1]] };
  };

  test.each([
    ['nothing', undefined, /export must be an object/],
    ['an array', [], /export must be an object/],
    ['no users', { memes: [] }, /"users" must be an array/],
    ['memes as an object', { memes: {}, users: [] }, /"memes" must be an array/],
    ['a meme that is not an object', { memes: [7], users: [] }, /memes\[0\] must be an object/],
    ['a meme without a file_id', withMeme({ file_id: undefined }), /memes\[0\]\.file_id/],
    ['an empty meme name', withMeme({ name: '' }), /memes\[0\]\.name/],
    ['an unknown media type', withMeme({ media_type: 'voice' }), /memes\[0\]\.media_type/],
    ['a null emoji', withMeme({ emoji: null }), /memes\[0\]\.emoji/],
    ['a negative send count', withMeme({ count: -1 }), /memes\[0\]\.count/],
    ['a fractional id', withMeme({ id: 1.5 }), /memes\[0\]\.id/],
    ['a numeric created_at', withMeme({ created_at: 5 }), /memes\[0\]\.created_at/],
    ['a repeated meme id', withMeme({ id: 7 }), /memes\[1\]\.id 7 is repeated/],
    ['a repeated meme name', withMeme({ name: 'Кот' }), /memes\[1\]\.name "Кот" is repeated/],
    ['a string user id', withUser({ userid: '2000' }), /users\[0\]\.userid/],
    ['an approval other than 0/1', withUser({ approved: 2 }), /users\[0\]\.approved/],
    ['a numeric display name', withUser({ displayname: 5 }), /users\[0\]\.displayname/],
    ['a missing user send count', withUser({ count: undefined }), /users\[0\]\.count/],
    ['a repeated user id', withUser({ userid: 2001 }), /users\[1\]\.userid 2001 is repeated/],
  ])('rejects an export with %s, importing nothing', async (_, input, message) => {
    await expect(run(input)).rejects.toThrow(message);
    expect(tables.memes).toEqual([]);
    expect(tables.users).toEqual([]);
  });
});

const existingMeme = /** @type {const} */ ({
  id: 1,
  name: 'Уже есть',
  fileId: 'voice-1',
  mediaType: 'audio',
  emoji: '',
  count: 5,
});
const existingUser = { userId: 1, displayName: 'Old', approved: true, count: 1 };
