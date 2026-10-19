// Deletes every meme and user of a bot instance, so a backup can be restored over a
// library that went wrong (README "Backups and restore"). Never deployed: the operator
// copies this file to tgcloud/endpoints/clear_library.js, runs it once with
//   npx tgcloud run endpoints/clear_library '{ confirm: "delete memes and users" }'
// then deletes the copy. Its imports are written for that location. Without that exact
// confirmation it deletes nothing.

import { EndpointError } from 'sdk';
import { deleteMemesAndUsers } from '../lib/store.js';

/** The input that must be passed, word for word, to delete anything. */
export const CONFIRMATION = 'delete memes and users';

/**
 * @param {unknown} input `{ confirm: "delete memes and users" }`
 * @param {unknown} _ctx
 * @returns {Promise<{ memes: number, users: number }>} how many rows were deleted
 */
export default async function clearLibrary(input, _ctx) {
  const confirm = /** @type {{ confirm?: unknown } | null | undefined} */ (input)?.confirm;
  if (confirm !== CONFIRMATION) {
    throw new EndpointError(
      `Pass { confirm: "${CONFIRMATION}" } to delete every meme and user. Nothing was deleted.`,
    );
  }
  return deleteMemesAndUsers();
}
