import { describe, expect, test } from 'vitest';
import { appIdOf, runCommands, withoutEcho } from '../scripts/restore.js';

describe('runCommands', () => {
  test('runs the restore as the admin', () => {
    expect(runCommands({ backupJson: '{"memes":[]}', adminId: 42, clear: false })).toEqual([
      ['run', 'endpoints/restore', '{"memes":[]}', '--ctx', '{"initData":{"user":{"id":42}}}'],
    ]);
  });

  test('with --clear, empties the library first, with the exact confirmation', () => {
    const [clear, restore] = runCommands({ backupJson: '{}', adminId: 42, clear: true });

    expect(clear).toEqual([
      'run',
      'endpoints/clear_library',
      '{"confirm":"delete memes and users"}',
      '--ctx',
      '{"initData":{"user":{"id":42}}}',
    ]);
    expect(restore[1]).toBe('endpoints/restore');
  });
});

test('withoutEcho drops the echoed call, colored or not, and keeps logs and the result', () => {
  const output = [
    '\x1b[36m> \x1b[39mrestore({memes:[{name:"secret"}]})',
    '> restore({users:[]})',
    '  a log line',
    '\x1b[36m< \x1b[39m{memes:2,users:1}  40ms',
    '',
  ].join('\n');

  expect(withoutEcho(output)).toBe(
    ['  a log line', '\x1b[36m< \x1b[39m{memes:2,users:1}  40ms', ''].join('\n'),
  );
});

describe('appIdOf', () => {
  test('reads the app id from a tgcloud token', () => {
    expect(appIdOf('app8757896246:s3cr3t')).toBe('8757896246');
  });

  test.each([undefined, '', 'app:x', '123:abc'])('refuses %j, never echoing it', (token) => {
    expect(() => appIdOf(token)).toThrow(/^TGCLOUD_TOKEN must be set in the env file/);
  });
});
