import { beforeEach } from 'vitest';
import { setConverterUrl, setRequireApproval } from './fakes/config.js';
import { resetApi } from './fakes/sdk.js';
import { resetStore } from './fakes/store.js';

// The tgcloud runtime has `Uint8Array.fromBase64`; Node gained it only in v25.
if (!Uint8Array.fromBase64) {
  Uint8Array.fromBase64 = (string) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(string) || string.length % 4 !== 0) {
      throw new SyntaxError('Invalid base64');
    }
    return new Uint8Array(Buffer.from(string, 'base64'));
  };
}

beforeEach(() => {
  resetApi();
  resetStore();
  setRequireApproval(false);
  setConverterUrl('');
});
