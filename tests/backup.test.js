import { afterEach, describe, expect, test, vi } from 'vitest';
import handleInlineQuery from '../tgcloud/handlers/inline_query.js';
import handleMessage from '../tgcloud/handlers/message.js';
import {
  BACKUP_COOLDOWN_MS,
  BACKUP_RETRY_MS,
  backUpIfDue,
  checkingBackup,
  fileName,
  hashOf,
  utf8,
} from '../tgcloud/lib/backup.js';
import { BotApiError, callsTo, InputFile, stubApi } from './fakes/sdk.js';
import { backupState, tables } from './fakes/store.js';
import { ADMIN_ID, inlineQuery, textMessage, USER_ID } from './payloads.js';

const NOW = Date.UTC(2026, 9, 19, 15, 30);

/** One meme and one approved user, so a backup has something in it. */
function seedLibrary() {
  tables.memes.push({
    id: 4,
    name: 'Кот',
    fileId: 'note-4',
    mediaType: 'video',
    emoji: '🐱',
    count: 3,
  });
  tables.users.push({ userId: USER_ID, displayName: 'Аня', approved: true, count: 3 });
}

/** The document a sendDocument call carried, decoded. */
function sentFile(/** @type {Record<string, any>} */ params) {
  const file = /** @type {InputFile} */ (params.document);
  expect(file).toBeInstanceOf(InputFile);
  return {
    filename: file.filename,
    type: file.type,
    data: JSON.parse(new TextDecoder().decode(/** @type {Uint8Array} */ (file.bytes))),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('automatic backup', () => {
  test('when due, silently sends the admin the tables in the restore format', async () => {
    seedLibrary();
    backupState.nextAt = 0;

    await backUpIfDue(NOW);

    const [sent] = callsTo('sendDocument');
    expect(sent.chat_id).toBe(ADMIN_ID);
    expect(sent.disable_notification).toBe(true);
    expect(sent.caption).toBe('Резервная копия · мемов: 1 · пользователей: 1');
    expect(sentFile(sent)).toEqual({
      filename: 'backup-2026-10-19-1530.json',
      type: 'application/json',
      data: {
        memes: [
          {
            id: 4,
            name: 'Кот',
            file_id: 'note-4',
            media_type: 'video',
            emoji: '🐱',
            count: 3,
            created_at: null,
          },
        ],
        users: [{ userid: USER_ID, displayname: 'Аня', approved: 1, count: 3 }],
      },
    });
    expect(backupState.nextAt).toBe(NOW + BACKUP_COOLDOWN_MS);
  });

  test('sends nothing before the cooldown ends', async () => {
    backupState.nextAt = NOW + 1;

    await backUpIfDue(NOW);

    expect(callsTo('sendDocument')).toEqual([]);
    expect(backupState.nextAt).toBe(NOW + 1);
  });

  test('only the first of two checks in a cooldown sends', async () => {
    backupState.nextAt = 0;

    await Promise.all([backUpIfDue(NOW), backUpIfDue(NOW + 1)]);

    expect(callsTo('sendDocument')).toHaveLength(1);
  });

  test('skips an unchanged library but still waits a full cooldown', async () => {
    seedLibrary();
    backupState.nextAt = 0;
    await backUpIfDue(NOW);

    await backUpIfDue(NOW + BACKUP_COOLDOWN_MS);

    expect(callsTo('sendDocument')).toHaveLength(1);
    expect(backupState.nextAt).toBe(NOW + 2 * BACKUP_COOLDOWN_MS);
  });

  test('sends again once the library changed', async () => {
    seedLibrary();
    backupState.nextAt = 0;
    await backUpIfDue(NOW);
    tables.memes[0].count += 1;

    await backUpIfDue(NOW + BACKUP_COOLDOWN_MS);

    expect(callsTo('sendDocument')).toHaveLength(2);
  });

  test('a failed send is logged and retried an hour later, never thrown', async () => {
    backupState.nextAt = 0;
    const error = new BotApiError('sendDocument', 403, 'Forbidden: bot was blocked by the user');
    stubApi('sendDocument', error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(backUpIfDue(NOW)).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('backup failed'), error);
    expect(backupState.nextAt).toBe(NOW + BACKUP_RETRY_MS);
    expect(backupState.hash).toBeNull();
  });
});

describe('checkingBackup', () => {
  test('every handler checks for a due backup after the update', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    backupState.nextAt = 0;

    await handleInlineQuery(inlineQuery(''));

    expect(callsTo('answerInlineQuery')).toHaveLength(1);
    expect(callsTo('sendDocument')).toHaveLength(1);
  });

  test("checks even when the handler throws, and rethrows the handler's error", async () => {
    backupState.nextAt = 0;
    const error = new Error('db is down');
    const handler = checkingBackup(async () => {
      throw error;
    });

    await expect(handler()).rejects.toBe(error);
    expect(callsTo('sendDocument')).toHaveLength(1);
  });
});

describe('/backup', () => {
  test('sends the admin a backup now, with sound, and restarts the cooldown', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    seedLibrary();

    await handleMessage(textMessage('/backup', { from: ADMIN_ID }));

    const [sent] = callsTo('sendDocument');
    expect(sent.chat_id).toBe(ADMIN_ID);
    expect(sent.disable_notification).toBe(false);
    expect(sentFile(sent).data.memes).toHaveLength(1);
    expect(backupState.nextAt).toBe(NOW + BACKUP_COOLDOWN_MS);
  });

  test('sends even when nothing changed since the last backup', async () => {
    await handleMessage(textMessage('/backup', { from: ADMIN_ID }));
    await handleMessage(textMessage('/backup', { from: ADMIN_ID }));

    expect(callsTo('sendDocument')).toHaveLength(2);
  });

  test('tells the admin when Telegram refuses the file', async () => {
    stubApi('sendDocument', new BotApiError('sendDocument', 400, 'Bad Request: file too big'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleMessage(textMessage('/backup', { from: ADMIN_ID }));

    const [reply] = callsTo('sendMessage');
    expect(reply.chat_id).toBe(ADMIN_ID);
    expect(reply.text).toBe('Не удалось отправить резервную копию: Bad Request: file too big');
  });

  test.each([
    ['a user in private', textMessage('/backup', { from: USER_ID })],
    ['the admin in a group', textMessage('/backup', { from: ADMIN_ID, chatType: 'group' })],
  ])('is ignored from %s', async (_, message) => {
    await handleMessage(message);

    expect(callsTo('sendDocument')).toEqual([]);
  });
});

describe('helpers', () => {
  test('utf8 encodes like TextEncoder, Cyrillic and emoji included', () => {
    const text = '{"name":"Кот 🐱 ok"}';
    expect(utf8(text)).toEqual(new TextEncoder().encode(text));
  });

  test('hashOf tells different texts apart and repeats for the same one', () => {
    expect(hashOf('{"memes":[]}')).toBe(hashOf('{"memes":[]}'));
    expect(hashOf('{"memes":[]}')).not.toBe(hashOf('{"memes":[1]}'));
  });

  test('fileName is the UTC date and time', () => {
    expect(fileName(Date.UTC(2026, 0, 2, 3, 4))).toBe('backup-2026-01-02-0304.json');
  });
});
