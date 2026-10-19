import { describe, expect, test } from 'vitest';
import handleMessage from '../tgcloud/handlers/message.js';
import { apiCalls, callsTo } from './fakes/sdk.js';
import { tables } from './fakes/store.js';
import { ADMIN_ID, mediaMessage, textMessage, USER_ID } from './payloads.js';

/** @param {string} text */
const admin = (text) => textMessage(text, { from: ADMIN_ID });

/** The text of the last message the bot sent. */
function lastReply() {
  const replies = callsTo('sendMessage');
  return replies[replies.length - 1];
}

/** The admin's pending conversation step, or undefined. */
const pendingStep = () => tables.steps.find((s) => s.chatId === ADMIN_ID);

/** @param {{ fileId: string, mediaType: 'audio' | 'video', name: string }} meme */
function seedMeme({ fileId, mediaType, name }) {
  tables.memes.push({ id: tables.memes.length + 1, name, fileId, mediaType, emoji: '', count: 0 });
}

/** Runs /add and sends the voice message, leaving the admin on the name step. */
async function atNameStep() {
  await handleMessage(admin('/add'));
  await handleMessage(mediaMessage('voice'));
}

/** Runs /add, the voice message and a name, leaving the admin on the emoji step. */
async function atEmojiStep(name = 'Bruh') {
  await atNameStep();
  await handleMessage(admin(name));
}

describe('/add', () => {
  test('asks for a voice message or video note, offering cancel, and saves the step', async () => {
    await handleMessage(admin('/add'));

    const reply = lastReply();
    expect(reply.chat_id).toBe(ADMIN_ID);
    expect(reply.text).toContain('голосовое');
    expect(reply.text).toContain('/cancel');
    expect(reply.reply_markup.keyboard.flat()).toEqual(['❌ Отмена']);
    expect(pendingStep()).toEqual({ chatId: ADMIN_ID, name: 'add:media', data: {} });
  });

  test('a voice message, a name and an emoji store an audio meme and confirm it', async () => {
    await handleMessage(admin('/add'));
    await handleMessage(mediaMessage('voice'));
    expect(lastReply().text).toBe('Теперь введи название мема (любой текст):');
    expect(pendingStep()).toEqual({
      chatId: ADMIN_ID,
      name: 'add:name',
      data: { fileId: 'voice-file', mediaType: 'audio' },
    });

    await handleMessage(admin('  Bruh moment  '));
    expect(lastReply().text).toBe('Теперь пришли эмодзи для мема (/skip — без эмодзи):');
    expect(lastReply().reply_markup.keyboard.flat()).toEqual(['/skip', '❌ Отмена']);

    await handleMessage(admin('😐'));

    expect(tables.memes).toEqual([
      expect.objectContaining({
        name: 'Bruh moment',
        fileId: 'voice-file',
        mediaType: 'audio',
        emoji: '😐',
      }),
    ]);
    expect(lastReply().text).toBe("✅ Мем '🎵 😐 Bruh moment' добавлен!");
    expect(lastReply().reply_markup).toEqual({ remove_keyboard: true });
    expect(pendingStep()).toBeUndefined();
  });

  test('a video note becomes a video meme; /skip leaves it without an emoji', async () => {
    await handleMessage(admin('/add'));
    await handleMessage(mediaMessage('video_note'));
    await handleMessage(admin('Cat'));
    await handleMessage(admin('/skip'));

    expect(tables.memes).toEqual([
      expect.objectContaining({ name: 'Cat', fileId: 'video_note-file', mediaType: 'video' }),
    ]);
    expect(tables.memes[0].emoji).toBe('');
    expect(lastReply().text).toBe("✅ Мем '🎬 Cat' добавлен!");
    expect(pendingStep()).toBeUndefined();
  });

  test('/skip addressed to the bot by username also skips the emoji', async () => {
    await atEmojiStep('Cat');
    await handleMessage(admin('/skip@audiomeme_bot'));

    expect(tables.memes[0]).toEqual(expect.objectContaining({ name: 'Cat', emoji: '' }));
  });

  test.each([
    ['an audio file', mediaMessage('audio')],
    ['a regular video', mediaMessage('video')],
    ['a sticker', mediaMessage('sticker')],
    ['text', admin('hello')],
  ])('refuses %s at the media step with the voice/video-note instruction', async (_, msg) => {
    await handleMessage(admin('/add'));
    await handleMessage(msg);

    expect(lastReply().text).toContain('❌');
    expect(lastReply().text).toContain('голосовое');
    expect(lastReply().text).toContain('кружок');
    expect(lastReply().reply_markup.keyboard.flat()).toEqual(['❌ Отмена']);
    expect(pendingStep()?.name).toBe('add:media');
    expect(tables.memes).toEqual([]);
  });

  describe('the name step refuses and stays put on', () => {
    test.each([
      ['an empty name', '   ', 'от 1 до 100 символов'],
      ['an over-long name', 'x'.repeat(101), 'от 1 до 100 символов'],
    ])('%s', async (_, name, reason) => {
      await atNameStep();
      await handleMessage(admin(name));

      expect(lastReply().text).toContain(reason);
      expect(pendingStep()?.name).toBe('add:name');
    });

    test('a duplicate name', async () => {
      seedMeme({ fileId: 'old', mediaType: 'audio', name: 'Bruh' });
      await atNameStep();
      await handleMessage(admin('Bruh'));

      expect(lastReply().text).toBe(
        "❌ Мем с названием 'Bruh' уже существует. Введи другое название:",
      );
      expect(pendingStep()?.name).toBe('add:name');
    });

    test('a non-text message', async () => {
      await atNameStep();
      await handleMessage(mediaMessage('voice'));

      expect(lastReply().text).toBe('❌ Пришли название текстом:');
      expect(pendingStep()?.name).toBe('add:name');
    });
  });

  test('accepts a name of exactly 100 characters, counting emoji as one each', async () => {
    const name = `${'😀'.repeat(50)}${'x'.repeat(50)}`;
    await atNameStep();
    await handleMessage(admin(name));

    expect(pendingStep()?.name).toBe('add:emoji');
    expect(pendingStep()?.data.name).toBe(name);
  });

  test('refuses an over-long emoji and stays on the emoji step', async () => {
    await atEmojiStep();
    await handleMessage(admin('x'.repeat(17)));

    expect(lastReply().text).toContain('16');
    expect(lastReply().reply_markup.keyboard.flat()).toEqual(['/skip', '❌ Отмена']);
    expect(pendingStep()?.name).toBe('add:emoji');
    expect(tables.memes).toEqual([]);
  });

  test('refuses a non-text emoji and stays on the emoji step', async () => {
    await atEmojiStep();
    await handleMessage(mediaMessage('sticker'));

    expect(lastReply().text).toContain('/skip');
    expect(pendingStep()?.name).toBe('add:emoji');
    expect(tables.memes).toEqual([]);
  });

  test('a name taken while the emoji was pending is refused and ends the flow', async () => {
    await atEmojiStep('Bruh');
    seedMeme({ fileId: 'other', mediaType: 'video', name: 'Bruh' });
    await handleMessage(admin('/skip'));

    expect(lastReply().text).toBe("❌ Мем с названием 'Bruh' уже существует");
    expect(lastReply().reply_markup).toEqual({ remove_keyboard: true });
    expect(tables.memes).toHaveLength(1);
    expect(pendingStep()).toBeUndefined();
  });

  describe.each([['/cancel'], ['❌ Отмена'], ['/cancel@audiomeme_bot']])(
    '%j ends the flow',
    (cancel) => {
      test.each([
        ['media', async () => handleMessage(admin('/add'))],
        ['name', atNameStep],
        ['emoji', () => atEmojiStep()],
      ])('at the %s step', async (_, reach) => {
        await reach();
        await handleMessage(admin(cancel));

        expect(lastReply().text).toBe('Отменено');
        expect(lastReply().reply_markup).toEqual({ remove_keyboard: true });
        expect(pendingStep()).toBeUndefined();
        expect(tables.memes).toEqual([]);
      });
    },
  );

  test('/cancel with no flow in progress is ignored', async () => {
    await handleMessage(admin('/cancel'));

    expect(apiCalls).toEqual([]);
  });

  test('a new command mid-flow clears the old step and runs', async () => {
    await atNameStep();
    await handleMessage(admin('/start'));

    expect(lastReply().text).toContain('inline query');
    expect(pendingStep()).toBeUndefined();

    await handleMessage(admin('Bruh'));
    expect(callsTo('sendMessage')).toHaveLength(3);
  });

  test('/add mid-flow restarts at the media step', async () => {
    await atEmojiStep();
    await handleMessage(admin('/add'));

    expect(pendingStep()).toEqual({ chatId: ADMIN_ID, name: 'add:media', data: {} });
  });

  test('/skip outside the emoji step is a command that ends the flow', async () => {
    await atNameStep();
    await handleMessage(admin('/skip'));

    expect(pendingStep()).toBeUndefined();
    expect(tables.memes).toEqual([]);
  });

  describe('is admin-only and private-only', () => {
    test('a user cannot start /add', async () => {
      await handleMessage(textMessage('/add', { from: USER_ID }));

      expect(apiCalls).toEqual([]);
      expect(tables.steps).toEqual([]);
    });

    test('the admin cannot start /add in a group', async () => {
      await handleMessage(textMessage('/add', { from: ADMIN_ID, chatType: 'group' }));

      expect(apiCalls).toEqual([]);
      expect(tables.steps).toEqual([]);
    });

    test('the admin cannot continue a flow from a group', async () => {
      await handleMessage(admin('/add'));
      await handleMessage(textMessage('/cancel', { from: ADMIN_ID, chatType: 'group' }));
      await handleMessage(textMessage('Bruh', { from: ADMIN_ID, chatType: 'group' }));

      expect(callsTo('sendMessage')).toHaveLength(1);
      expect(pendingStep()?.name).toBe('add:media');
    });

    test('a user cannot continue a step saved for their chat', async () => {
      tables.steps.push({
        chatId: USER_ID,
        name: 'add:emoji',
        data: { fileId: 'f', mediaType: 'audio', name: 'Bruh' },
      });
      await handleMessage(textMessage('😐', { from: USER_ID }));

      expect(apiCalls).toEqual([]);
      expect(tables.memes).toEqual([]);
    });
  });
});

test('a saved step this code does not know is dropped', async () => {
  tables.steps.push({ chatId: ADMIN_ID, name: 'gone:step', data: {} });
  await handleMessage(admin('hello'));

  expect(apiCalls).toEqual([]);
  expect(pendingStep()).toBeUndefined();
});
