import { beforeEach } from 'vitest';
import { resetApi } from './fakes/sdk.js';
import { resetStore, sentMessages } from './fakes/store.js';

beforeEach(() => {
  resetApi();
  resetStore();
  sentMessages.clear();
});
