// Refuses to deploy while a copy of a never-deployed operator endpoint (restore,
// clear_library) sits in tgcloud/endpoints/: `tgcloud push` uploads every .js file there,
// gitignored or not. Run before every push (`npm run deploy`, CI).

import { existsSync } from 'node:fs';
import { copyOf, OPERATOR_ENDPOINTS } from './restore.js';

const strays = OPERATOR_ENDPOINTS.map(copyOf).filter((path) => existsSync(path));
if (strays.length > 0) {
  console.error(
    `Not deploying: ${strays.join(', ')} must never be deployed. Delete it; ` +
      '`npm run restore` copies it in only for one run.',
  );
  process.exit(1);
}
