import { beforeEach } from 'vitest';
import { resetApi } from './fakes/sdk.js';
import { resetStore } from './fakes/store.js';

beforeEach(() => {
  resetApi();
  resetStore();
});
