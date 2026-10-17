import { describe, expect, test, vi } from 'vitest';
import handleCallbackQuery from '../tgcloud/handlers/callback_query.js';
import handleMessage from '../tgcloud/handlers/message.js';
import { apiCalls, BotApiError, callsTo, stubApi } from './fakes/sdk.js';
import { tables } from './fakes/store.js';
import { ADMIN_ID, callbackQuery, HUB_MESSAGE_ID, textMessage, USER_ID } from './payloads.js';

/**
 * @param {Partial<import('../tgcloud/lib/store.js').Meme> & { name: string }} meme
 * @returns {number} the meme's ID
 */
function seedMeme(meme) {
  const id = tables.memes.length + 1;
  tables.memes.push({ id, fileId: `file-${id}`, mediaType: 'audio', emoji: '', count: 0, ...meme });
  return id;
}

/** @param {any} markup @returns {[string, string][]} each button's text and callback data */
const buttonsOf = (markup) =>
  markup.inline_keyboard.flat().map((/** @type {any} */ b) => [b.text, b.callback_data]);

/** The admin taps a hub button. @param {string} data */
const tap = (data) => handleCallbackQuery(callbackQuery(data));

/** The single edit of the hub message, checked to be in place. */
function editedHub() {
  const edits = callsTo('editMessageText');
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({ chat_id: ADMIN_ID, message_id: HUB_MESSAGE_ID });
  return edits[0];
}

/** The callback query's answer (exactly one). */
function answer() {
  const answers = callsTo('answerCallbackQuery');
  expect(answers).toHaveLength(1);
  expect(answers[0].callback_query_id).toBe(`cb-${ADMIN_ID}`);
  return answers[0];
}

describe('/list', () => {
  test('shows the admin one button per meme, most-sent first', async () => {
    const quiet = seedMeme({ name: 'Тишина', mediaType: 'video', count: 1 });
    const bruh = seedMeme({ name: 'Bruh', emoji: '😐', count: 5 });

    await handleMessage(textMessage('/list', { from: ADMIN_ID }));

    const [reply] = callsTo('sendMessage');
    expect(reply.chat_id).toBe(ADMIN_ID);
    expect(reply.text).toBe('📋 Мемы (нажми для управления):');
    expect(buttonsOf(reply.reply_markup)).toEqual([
      ['🎵 😐 Bruh', `meme:show:${bruh}`],
      ['🎬 Тишина', `meme:show:${quiet}`],
    ]);
  });

  test('/delete is an alias', async () => {
    seedMeme({ name: 'Bruh' });

    await handleMessage(textMessage('/delete', { from: ADMIN_ID }));

    expect(callsTo('sendMessage')[0].text).toBe('📋 Мемы (нажми для управления):');
  });

  test('says so when the library is empty', async () => {
    await handleMessage(textMessage('/list', { from: ADMIN_ID }));

    const [reply] = callsTo('sendMessage');
    expect(reply.text).toBe('Нет сохраненных мемов');
    expect(reply.reply_markup.inline_keyboard).toEqual([]);
  });

  test.each([
    ['a user', USER_ID, 'private'],
    ['the admin in a group', ADMIN_ID, 'group'],
  ])('ignores %s', async (_, from, chatType) => {
    seedMeme({ name: 'Bruh' });

    await handleMessage(
      textMessage('/list', { from, chatType: /** @type {'private' | 'group'} */ (chatType) }),
    );

    expect(apiCalls).toEqual([]);
  });
});

describe('meme detail view', () => {
  test('opening a voice meme replays it and edits the hub into its detail view', async () => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐', fileId: 'voice-fid', count: 7 });

    await tap(`meme:show:${id}`);

    expect(answer().text).toBeUndefined();
    expect(callsTo('sendVoice')).toEqual([{ chat_id: ADMIN_ID, voice: 'voice-fid' }]);
    const edit = editedHub();
    expect(edit.text).toBe('🎵 😐 Bruh\nТип: audio\nОтправок: 7');
    expect(buttonsOf(edit.reply_markup)).toEqual([
      ['✏️ Переименовать', `meme:rename:${id}`],
      ['😀 Эмодзи', `meme:emoji:${id}`],
      ['🗑 Удалить', `meme:del:${id}`],
      ['◀️ Назад', 'meme:list'],
    ]);
  });

  test('opening a video note meme replays it as a video note', async () => {
    const id = seedMeme({ name: 'Тишина', mediaType: 'video', fileId: 'vn-fid' });

    await tap(`meme:show:${id}`);

    expect(callsTo('sendVideoNote')).toEqual([{ chat_id: ADMIN_ID, video_note: 'vn-fid' }]);
    expect(callsTo('sendVoice')).toEqual([]);
    expect(editedHub().text).toBe('🎬 Тишина\nТип: video\nОтправок: 0');
  });

  test('a failed replay still opens the detail view', async () => {
    const id = seedMeme({ name: 'Bruh' });
    stubApi('sendVoice', new BotApiError('sendVoice', 400, 'Bad Request: wrong file identifier'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await tap(`meme:show:${id}`);

    expect(editedHub().text).toContain('Bruh');
  });

  test('back returns to the refreshed list', async () => {
    const id = seedMeme({ name: 'Bruh' });

    await tap('meme:list');

    answer();
    const edit = editedHub();
    expect(edit.text).toBe('📋 Мемы (нажми для управления):');
    expect(buttonsOf(edit.reply_markup)).toEqual([['🎵 Bruh', `meme:show:${id}`]]);
  });

  test('rename and emoji buttons are answered (wired in #19)', async () => {
    const id = seedMeme({ name: 'Bruh' });

    await tap(`meme:rename:${id}`);

    expect(apiCalls.map((c) => c.method)).toEqual(['answerCallbackQuery']);
  });
});

describe('deleting a meme', () => {
  test('asks for confirmation without deleting', async () => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐' });

    await tap(`meme:del:${id}`);

    answer();
    const edit = editedHub();
    expect(edit.text).toBe("Удалить мем '😐 Bruh'?");
    expect(buttonsOf(edit.reply_markup)).toEqual([
      ['✅ Да', `meme:delok:${id}`],
      ['◀️ Нет', `meme:detail:${id}`],
    ]);
    expect(tables.memes).toHaveLength(1);
  });

  test('"yes" deletes the meme and returns to the list', async () => {
    const id = seedMeme({ name: 'Bruh' });
    const other = seedMeme({ name: 'Тишина' });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await tap(`meme:delok:${id}`);

    expect(tables.memes.map((m) => m.id)).toEqual([other]);
    expect(answer().text).toBe('🗑 Удалён');
    expect(buttonsOf(editedHub().reply_markup)).toEqual([['🎵 Тишина', `meme:show:${other}`]]);
  });

  test('"no" returns to the detail view without replaying the media', async () => {
    const id = seedMeme({ name: 'Bruh' });

    await tap(`meme:detail:${id}`);

    answer();
    expect(editedHub().text).toBe('🎵 Bruh\nТип: audio\nОтправок: 0');
    expect(callsTo('sendVoice')).toEqual([]);
    expect(tables.memes).toHaveLength(1);
  });
});

describe('stale and foreign taps', () => {
  test.each(['show', 'del', 'delok', 'detail', 'rename'])(
    '%s on a meme that no longer exists says so and shows the list',
    async (action) => {
      seedMeme({ name: 'Bruh' });

      await tap(`meme:${action}:999`);

      expect(answer().text).toBe('Мем не найден');
      expect(editedHub().text).toBe('📋 Мемы (нажми для управления):');
      expect(tables.memes).toHaveLength(1);
    },
  );

  test('a non-admin is turned away and nothing changes', async () => {
    const id = seedMeme({ name: 'Bruh' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleCallbackQuery(callbackQuery(`meme:delok:${id}`, { from: USER_ID }));

    expect(apiCalls).toEqual([
      {
        method: 'answerCallbackQuery',
        params: { callback_query_id: `cb-${USER_ID}`, text: '❌ Доступно только админу' },
      },
    ]);
    expect(tables.memes).toHaveLength(1);
  });

  test('a double tap that re-renders the same view is not an error', async () => {
    seedMeme({ name: 'Bruh' });
    stubApi(
      'editMessageText',
      new BotApiError('editMessageText', 400, 'Bad Request: message is not modified'),
    );

    await expect(tap('meme:list')).resolves.toBeUndefined();
  });

  test('other edit failures propagate', async () => {
    seedMeme({ name: 'Bruh' });
    stubApi(
      'editMessageText',
      new BotApiError('editMessageText', 400, 'Bad Request: chat not found'),
    );

    await expect(tap('meme:list')).rejects.toThrow('chat not found');
  });

  test('a tap on a hub message too old to edit is only answered', async () => {
    const query = callbackQuery('meme:list');
    query.message = {
      message_id: HUB_MESSAGE_ID,
      date: 0,
      chat: query.message?.chat ?? /** @type {any} */ ({}),
    };

    await handleCallbackQuery(query);

    answer();
    expect(callsTo('editMessageText')).toEqual([]);
  });

  test('a button outside the hub is just answered', async () => {
    await handleCallbackQuery(callbackQuery('user:approve:5'));

    expect(apiCalls.map((c) => c.method)).toEqual(['answerCallbackQuery']);
  });
});
