import { beforeEach, describe, expect, test, vi } from 'vitest';
import handleCallbackQuery from '../tgcloud/handlers/callback_query.js';
import handleMessage from '../tgcloud/handlers/message.js';
import { callsTo } from './fakes/sdk.js';
import { tables } from './fakes/store.js';
import { ADMIN_ID, callbackQuery, mediaMessage, textMessage } from './payloads.js';

/**
 * @param {Partial<import('../tgcloud/lib/store.js').Meme> & { name: string }} meme
 * @returns {number} the meme's ID
 */
function seedMeme(meme) {
  const id = tables.memes.length + 1;
  tables.memes.push({ id, fileId: `file-${id}`, mediaType: 'audio', emoji: '', count: 0, ...meme });
  return id;
}

/** @param {string} text */
const admin = (text) => textMessage(text, { from: ADMIN_ID });

/** The admin taps a hub button. @param {string} data */
const tap = (data) => handleCallbackQuery(callbackQuery(data));

function lastReply() {
  const replies = callsTo('sendMessage');
  return replies[replies.length - 1];
}

const pendingStep = () => tables.steps.find((s) => s.chatId === ADMIN_ID);

/** @param {number} id */
const memeOf = (id) => tables.memes.find((m) => m.id === id);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('renaming a meme from the hub', () => {
  test('the rename button asks for the new meme name, offering cancel', async () => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐' });

    await tap(`meme:rename:${id}`);

    expect(callsTo('answerCallbackQuery')).toHaveLength(1);
    expect(lastReply().chat_id).toBe(ADMIN_ID);
    expect(lastReply().text).toBe("Введи новое название для '😐 Bruh' (/cancel — отмена):");
    expect(lastReply().reply_markup.keyboard.flat()).toEqual(['❌ Отмена']);
    expect(pendingStep()).toEqual({ chatId: ADMIN_ID, name: 'edit:name', data: { memeId: id } });
  });

  test('a new meme name is stored and the admin sees the updated meme', async () => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐', count: 3 });
    await tap(`meme:rename:${id}`);

    await handleMessage(admin('  Bruh moment  '));

    expect(memeOf(id)?.name).toBe('Bruh moment');
    expect(pendingStep()).toBeUndefined();
    const [, confirm, detail] = callsTo('sendMessage');
    expect(confirm.text).toBe("✅ Переименован в 'Bruh moment'");
    expect(confirm.reply_markup).toEqual({ remove_keyboard: true });
    expect(detail.chat_id).toBe(ADMIN_ID);
    expect(detail.text).toBe('🎵 😐 Bruh moment\nТип: audio\nОтправок: 3');
    expect(detail.reply_markup.inline_keyboard.flat()[0].callback_data).toBe(`meme:rename:${id}`);
  });

  test('a meme deleted while the rename was pending is reported and the step ends', async () => {
    const id = seedMeme({ name: 'Bruh' });
    await tap(`meme:rename:${id}`);
    tables.memes = [];

    await handleMessage(admin('Bruh moment'));

    expect(lastReply().text).toBe('❌ Мем не найден');
    expect(lastReply().reply_markup).toEqual({ remove_keyboard: true });
    expect(pendingStep()).toBeUndefined();
    expect(tables.memes).toEqual([]);
  });

  describe('refuses with a reason and stays on the step', () => {
    test.each([
      ['an empty name', '   ', '❌ Название должно быть от 1 до 100 символов. Попробуй снова:'],
      [
        'an over-long name',
        'x'.repeat(101),
        '❌ Название должно быть от 1 до 100 символов. Попробуй снова:',
      ],
      [
        'a name another meme has',
        'Тишина',
        "❌ Мем с названием 'Тишина' уже существует. Введи другое название:",
      ],
    ])('%s', async (_, name, reason) => {
      const id = seedMeme({ name: 'Bruh' });
      seedMeme({ name: 'Тишина' });
      await tap(`meme:rename:${id}`);

      await handleMessage(admin(name));

      expect(lastReply().text).toBe(reason);
      expect(lastReply().reply_markup.keyboard.flat()).toEqual(['❌ Отмена']);
      expect(pendingStep()?.name).toBe('edit:name');
      expect(memeOf(id)?.name).toBe('Bruh');
    });

    test('a non-text message', async () => {
      const id = seedMeme({ name: 'Bruh' });
      await tap(`meme:rename:${id}`);

      await handleMessage(mediaMessage('voice'));

      expect(lastReply().text).toBe('❌ Пришли название текстом:');
      expect(pendingStep()?.name).toBe('edit:name');
    });
  });

  test('keeping the meme its own name is not a clash', async () => {
    const id = seedMeme({ name: 'Bruh' });
    await tap(`meme:rename:${id}`);

    await handleMessage(admin('Bruh'));

    expect(callsTo('sendMessage')[1].text).toBe("✅ Переименован в 'Bruh'");
    expect(pendingStep()).toBeUndefined();
  });
});

describe("changing a meme's emoji from the hub", () => {
  test('the emoji button asks for the new emoji, offering skip and cancel', async () => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐' });

    await tap(`meme:emoji:${id}`);

    expect(callsTo('answerCallbackQuery')).toHaveLength(1);
    expect(lastReply().text).toBe(
      "Пришли новый эмодзи для '😐 Bruh' (/skip — убрать, /cancel — отмена):",
    );
    expect(lastReply().reply_markup.keyboard.flat()).toEqual(['/skip', '❌ Отмена']);
    expect(pendingStep()).toEqual({ chatId: ADMIN_ID, name: 'edit:emoji', data: { memeId: id } });
  });

  test('a new emoji is stored and the admin sees the updated meme', async () => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐', mediaType: 'video' });
    await tap(`meme:emoji:${id}`);

    await handleMessage(admin(' 🔥 '));

    expect(memeOf(id)?.emoji).toBe('🔥');
    expect(pendingStep()).toBeUndefined();
    const [, confirm, detail] = callsTo('sendMessage');
    expect(confirm.text).toBe("✅ Обновлено: '🔥 Bruh'");
    expect(confirm.reply_markup).toEqual({ remove_keyboard: true });
    expect(detail.text).toBe('🎬 🔥 Bruh\nТип: video\nОтправок: 0');
  });

  test.each([['/skip'], ['/skip@audiomeme_bot']])('%s removes the emoji', async (skip) => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐' });
    await tap(`meme:emoji:${id}`);

    await handleMessage(admin(skip));

    expect(memeOf(id)?.emoji).toBe('');
    expect(callsTo('sendMessage')[1].text).toBe("✅ Обновлено: 'Bruh'");
    expect(pendingStep()).toBeUndefined();
  });

  test('an over-long emoji is refused and the step stays', async () => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐' });
    await tap(`meme:emoji:${id}`);

    await handleMessage(admin('x'.repeat(17)));

    expect(lastReply().text).toBe('❌ Эмодзи должно быть не длиннее 16 символов. Попробуй снова:');
    expect(lastReply().reply_markup.keyboard.flat()).toEqual(['/skip', '❌ Отмена']);
    expect(pendingStep()?.name).toBe('edit:emoji');
    expect(memeOf(id)?.emoji).toBe('😐');
  });

  test('a meme deleted while the emoji was pending is reported and the step ends', async () => {
    const id = seedMeme({ name: 'Bruh' });
    await tap(`meme:emoji:${id}`);
    tables.memes = [];

    await handleMessage(admin('🔥'));

    expect(lastReply().text).toBe('❌ Мем не найден');
    expect(pendingStep()).toBeUndefined();
  });
});

describe.each([
  ['rename', 'Новое имя'],
  ['emoji', '🔥'],
])('the %s edit is abandoned without changes by', (action, input) => {
  test.each([['/cancel'], ['❌ Отмена']])('%j', async (cancel) => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐' });
    await tap(`meme:${action}:${id}`);

    await handleMessage(admin(cancel));

    expect(lastReply().text).toBe('Отменено');
    expect(lastReply().reply_markup).toEqual({ remove_keyboard: true });
    expect(pendingStep()).toBeUndefined();
    await handleMessage(admin(input));
    expect(memeOf(id)).toEqual(expect.objectContaining({ name: 'Bruh', emoji: '😐' }));
  });

  test('a new command, which then runs', async () => {
    const id = seedMeme({ name: 'Bruh', emoji: '😐' });
    await tap(`meme:${action}:${id}`);

    await handleMessage(admin('/list'));

    expect(lastReply().text).toBe('📋 Мемы (нажми для управления):');
    expect(pendingStep()).toBeUndefined();
    await handleMessage(admin(input));
    expect(memeOf(id)).toEqual(expect.objectContaining({ name: 'Bruh', emoji: '😐' }));
  });
});

test('/skip during a rename is a command that abandons it', async () => {
  const id = seedMeme({ name: 'Bruh' });
  await tap(`meme:rename:${id}`);

  await handleMessage(admin('/skip'));

  expect(pendingStep()).toBeUndefined();
  expect(memeOf(id)?.name).toBe('Bruh');
});
