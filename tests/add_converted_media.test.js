import { describe, expect, test } from 'vitest';
import addConvertedMedia from '../tgcloud/endpoints/addConvertedMedia.js';
import handleMessage from '../tgcloud/handlers/message.js';
import { setConverterUrl } from './fakes/config.js';
import { BotApiError, callsTo, stubApi } from './fakes/sdk.js';
import { tables } from './fakes/store.js';
import { ADMIN_ID, textMessage, USER_ID } from './payloads.js';

const URL = 'https://app42.tgcloud.ai/';
const BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]);
const DATA = Buffer.from(BYTES).toString('base64');

/** @param {string} text */
const admin = (text) => textMessage(text, { from: ADMIN_ID });

/** The endpoint's ctx for a Mini App opened by `userId`. @param {number} userId */
const ctxOf = (userId) => ({ initData: { user: { id: userId, first_name: 'U' } } });

/** The text of the last message the bot sent. */
const lastReply = () => callsTo('sendMessage').at(-1);

describe('a converted file handed back by the Converter', () => {
  test.each([
    [
      'voice',
      'sendVoice',
      'voice',
      'meme.ogg',
      'audio/ogg',
      'audio',
      "✅ Мем '🎵 😐 Bruh' добавлен!",
    ],
    [
      'videoNote',
      'sendVideoNote',
      'video_note',
      'meme.mp4',
      'video/mp4',
      'video',
      "✅ Мем '🎬 😐 Bruh' добавлен!",
    ],
  ])(
    'as a %s is sent to the admin and continues /add to a stored meme',
    async (kind, method, field, filename, type, mediaType, confirmation) => {
      stubApi(method, { message_id: 7, [field]: { file_id: 'uploaded', file_unique_id: 'u' } });
      await handleMessage(admin('/add'));

      expect(await addConvertedMedia({ kind, data: DATA }, ctxOf(ADMIN_ID))).toEqual({ ok: true });

      const [sent] = callsTo(method);
      expect(sent.chat_id).toBe(ADMIN_ID);
      expect(sent[field]).toEqual({ bytes: BYTES, filename, type });
      expect(lastReply()?.text).toBe('Теперь введи название мема (любой текст):');

      await handleMessage(admin('Bruh'));
      await handleMessage(admin('😐'));

      expect(tables.memes).toEqual([
        expect.objectContaining({ name: 'Bruh', fileId: 'uploaded', mediaType, emoji: '😐' }),
      ]);
      expect(lastReply()?.text).toBe(confirmation);
    },
  );
});

/**
 * Asserts the call is refused with `code`, sends nothing and leaves the step alone.
 * @param {Promise<unknown>} call
 * @param {string} code
 */
async function expectRefusal(call, code) {
  const before = structuredClone(tables.steps);
  const sentBefore = callsTo('sendMessage').length;
  await expect(call).rejects.toMatchObject({ parameters: { code } });
  expect(tables.steps).toEqual(before);
  expect(callsTo('sendMessage')).toHaveLength(sentBefore);
  expect(tables.memes).toEqual([]);
}

describe('the Converter hand-back is refused', () => {
  test('for anyone but the admin, even during /add', async () => {
    await handleMessage(admin('/add'));

    await expectRefusal(
      addConvertedMedia({ kind: 'voice', data: DATA }, ctxOf(USER_ID)),
      'NOT_ADMIN',
    );
    await expectRefusal(
      addConvertedMedia({ kind: 'voice', data: DATA }, { initData: {} }),
      'NOT_ADMIN',
    );
    expect(callsTo('sendVoice')).toEqual([]);
  });

  test.each([
    ['with no /add in progress', async () => {}],
    [
      'after /cancel',
      async () => {
        await handleMessage(admin('/add'));
        await handleMessage(admin('/cancel'));
      },
    ],
    [
      'once /add is past the media step',
      async () => {
        await handleMessage(admin('/add'));
        await addConvertedMedia({ kind: 'voice', data: DATA }, ctxOf(ADMIN_ID));
      },
    ],
  ])('%s, so an old button never adds a meme', async (_, reach) => {
    stubApi('sendVoice', { message_id: 7, voice: { file_id: 'uploaded', file_unique_id: 'u' } });
    await reach();
    const uploads = callsTo('sendVoice').length;

    await expectRefusal(
      addConvertedMedia({ kind: 'voice', data: DATA }, ctxOf(ADMIN_ID)),
      'NO_PENDING_ADD',
    );
    expect(callsTo('sendVoice')).toHaveLength(uploads);
  });

  test.each([
    ['an unknown kind', { kind: 'video', data: DATA }],
    ['no data', { kind: 'voice' }],
    ['data that is not a string', { kind: 'voice', data: 42 }],
    ['data that is not base64', { kind: 'voice', data: 'not base64!' }],
    ['an empty file', { kind: 'voice', data: '' }],
  ])('for %s', async (_, input) => {
    await handleMessage(admin('/add'));

    await expectRefusal(addConvertedMedia(input, ctxOf(ADMIN_ID)), 'BAD_INPUT');
    expect(callsTo('sendVoice')).toEqual([]);
  });

  test('for a file over 1.5 MB, which one at the cap passes', async () => {
    stubApi('sendVideoNote', { message_id: 7, video_note: { file_id: 'f', file_unique_id: 'u' } });
    await handleMessage(admin('/add'));
    const ofSize = (/** @type {number} */ n) => Buffer.alloc(n).toString('base64');

    await expectRefusal(
      addConvertedMedia({ kind: 'videoNote', data: ofSize(1_500_001) }, ctxOf(ADMIN_ID)),
      'TOO_LARGE',
    );
    expect(callsTo('sendVideoNote')).toEqual([]);

    await addConvertedMedia({ kind: 'videoNote', data: ofSize(1_500_000) }, ctxOf(ADMIN_ID));
    expect(callsTo('sendVideoNote')).toHaveLength(1);
  });

  test.each([
    ['voice', 'sendVoice'],
    ['videoNote', 'sendVideoNote'],
  ])("when the admin's privacy settings block a %s from the bot", async (kind, method) => {
    stubApi(method, new BotApiError(method, 400, 'Bad Request: VOICE_MESSAGES_FORBIDDEN'));
    await handleMessage(admin('/add'));

    await expectRefusal(
      addConvertedMedia({ kind, data: DATA }, ctxOf(ADMIN_ID)),
      'VOICE_FORBIDDEN',
    );
  });

  test('when Telegram refuses the upload otherwise, leaving /add ready for a retry', async () => {
    stubApi('sendVoice', new BotApiError('sendVoice', 500, 'Internal Server Error'));
    await handleMessage(admin('/add'));

    await expectRefusal(
      addConvertedMedia({ kind: 'voice', data: DATA }, ctxOf(ADMIN_ID)),
      'SEND_FAILED',
    );

    stubApi('sendVoice', { message_id: 7, voice: { file_id: 'uploaded', file_unique_id: 'u' } });
    await addConvertedMedia({ kind: 'voice', data: DATA }, ctxOf(ADMIN_ID));
    expect(tables.steps).toEqual([
      { chatId: ADMIN_ID, name: 'add:name', data: { fileId: 'uploaded', mediaType: 'audio' } },
    ]);
  });
});

describe("/add's media step offers the Converter", () => {
  test('as an inline web_app button after the prompt, when the Converter URL is set', async () => {
    setConverterUrl(URL);
    await handleMessage(admin('/add'));

    const [prompt, offer] = callsTo('sendMessage');
    expect(prompt.reply_markup.keyboard.flat()).toEqual(['❌ Отмена']);
    expect(offer).toEqual({
      chat_id: ADMIN_ID,
      text: '…или загрузи аудио/видео файл:',
      reply_markup: { inline_keyboard: [[{ text: '📁 Загрузить файл', web_app: { url: URL } }]] },
    });
  });

  test('not at all when the Converter URL is empty', async () => {
    await handleMessage(admin('/add'));

    expect(callsTo('sendMessage')).toHaveLength(1);
  });
});
