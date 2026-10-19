// Deletes every meme and user of a bot instance, so a backup can be restored over a
// library that went wrong (README "Backups and restore"). Never deployed:
// `npm run restore -- --clear` (scripts/restore.js) copies this file to
// tgcloud/endpoints/clear_library.js, runs it once as the admin with
//   { confirm: "delete memes and users" }
// then deletes the copy. Its imports are written for that location. Without that exact
// confirmation it deletes nothing; should a copy ever get deployed, it refuses everyone
// but the admin.

import { EndpointError } from 'sdk';
import { ADMIN_ID } from '../lib/config.js';
import { deleteMemesAndUsers } from '../lib/store.js';

/** The input that must be passed, word for word, to delete anything. */
export const CONFIRMATION = 'delete memes and users';

/**
 * @param {unknown} input `{ confirm: "delete memes and users" }`
 * @param {{ initData?: { user?: { id: number } } } | undefined} ctx the admin, passed by
 *   `npm run restore` as `--ctx`
 * @returns {Promise<{ memes: number, users: number }>} how many rows were deleted
 */
export default async function clearLibrary(input, ctx) {
  if (ctx?.initData?.user?.id !== ADMIN_ID) {
    throw new EndpointError('Only the admin may clear the library. Nothing was deleted.');
  }
  const confirm = /** @type {{ confirm?: unknown } | null | undefined} */ (input)?.confirm;
  if (confirm !== CONFIRMATION) {
    throw new EndpointError(
      `Pass { confirm: "${CONFIRMATION}" } to delete every meme and user. Nothing was deleted.`,
    );
  }
  return deleteMemesAndUsers();
}
