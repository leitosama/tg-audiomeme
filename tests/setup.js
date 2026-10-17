import { beforeEach } from 'vitest';
import { setRequireApproval } from './fakes/config.js';
import { resetApi } from './fakes/sdk.js';
import { resetStore } from './fakes/store.js';

beforeEach(() => {
  resetApi();
  resetStore();
  setRequireApproval(false);
});
