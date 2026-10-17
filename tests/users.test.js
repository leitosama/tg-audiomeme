import { describe, expect, test, vi } from 'vitest';
import handleCallbackQuery from '../tgcloud/handlers/callback_query.js';
import handleMessage from '../tgcloud/handlers/message.js';
import { apiCalls, BotApiError, callsTo, stubApi } from './fakes/sdk.js';
import { tables } from './fakes/store.js';
import { ADMIN_ID, callbackQuery, HUB_MESSAGE_ID, textMessage, USER_ID } from './payloads.js';

/** @param {Partial<import('../tgcloud/lib/store.js').User> & { userId: number }} user */
function seedUser(user) {
  tables.users.push({ displayName: `User ${user.userId}`, approved: false, count: 0, ...user });
}

/** @param {any} markup @returns {[string, string][]} each button's text and callback data */
const buttonsOf = (markup) =>
  markup.inline_keyboard.flat().map((/** @type {any} */ b) => [b.text, b.callback_data]);

/** The single message sent, checked to go to the admin's chat. */
function sent() {
  const messages = callsTo('sendMessage');
  expect(messages).toHaveLength(1);
  expect(messages[0].chat_id).toBe(ADMIN_ID);
  return messages[0];
}

/** The single edit of the list message, checked to be in place. */
function editedList() {
  const edits = callsTo('editMessageText');
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({ chat_id: ADMIN_ID, message_id: HUB_MESSAGE_ID });
  return edits[0];
}

/** The callback query's answer (exactly one). */
function answer() {
  const answers = callsTo('answerCallbackQuery');
  expect(answers).toHaveLength(1);
  return answers[0];
}

/** @param {string} data @param {{ from?: number }} [opts] */
const tap = (data, opts) => handleCallbackQuery(callbackQuery(data, opts));

describe('/users', () => {
  test('lists users pending first, then by send count, with send counts and approval', async () => {
    seedUser({ userId: 3, displayName: 'Аня', approved: true, count: 2 });
    seedUser({ userId: 4, displayName: 'Боб', approved: true, count: 9 });
    seedUser({ userId: 5, displayName: 'Вера', approved: false, count: 1 });

    await handleMessage(textMessage('/users', { from: ADMIN_ID }));

    const { text, reply_markup } = sent();
    expect(text).toBe(
      ['👥 Пользователи:', '⏳ Вера (id 5) — 1', '✅ Боб (id 4) — 9', '✅ Аня (id 3) — 2'].join(
        '\n',
      ),
    );
    expect(buttonsOf(reply_markup)).toEqual([
      ['✅ Одобрить Вера', 'user:approve:5'],
      ['🚫 Отозвать Боб', 'user:revoke:4'],
      ['🚫 Отозвать Аня', 'user:revoke:3'],
    ]);
  });

  test('puts each button on its own row', async () => {
    seedUser({ userId: 3 });
    seedUser({ userId: 4 });

    await handleMessage(textMessage('/users', { from: ADMIN_ID }));

    expect(
      sent().reply_markup.inline_keyboard.map((/** @type {any[]} */ row) => row.length),
    ).toEqual([1, 1]);
  });

  test('names a user without a display name by their ID', async () => {
    seedUser({ userId: 3, displayName: null });

    await handleMessage(textMessage('/users', { from: ADMIN_ID }));

    expect(sent().text).toContain('⏳ 3 (id 3) — 0');
  });

  test('says so when there are no users', async () => {
    await handleMessage(textMessage('/users', { from: ADMIN_ID }));

    expect(sent()).toMatchObject({ text: 'Нет пользователей' });
  });

  test('is ignored from a non-admin', async () => {
    seedUser({ userId: 3 });

    await handleMessage(textMessage('/users', { from: USER_ID }));

    expect(apiCalls).toEqual([]);
  });

  test('is ignored from the admin outside a private chat', async () => {
    seedUser({ userId: 3 });

    await handleMessage(textMessage('/users', { from: ADMIN_ID, chatType: 'group' }));

    expect(apiCalls).toEqual([]);
  });
});

describe('approve / revoke buttons', () => {
  test('approve approves the user and refreshes the list in place', async () => {
    seedUser({ userId: 5, displayName: 'Вера' });

    await tap('user:approve:5');

    expect(tables.users[0].approved).toBe(true);
    expect(answer()).toMatchObject({ callback_query_id: `cb-${ADMIN_ID}`, text: '✅ Одобрен' });
    const { text, reply_markup } = editedList();
    expect(text).toBe('👥 Пользователи:\n✅ Вера (id 5) — 0');
    expect(buttonsOf(reply_markup)).toEqual([['🚫 Отозвать Вера', 'user:revoke:5']]);
  });

  test('revoke revokes the user and refreshes the list in place', async () => {
    seedUser({ userId: 5, displayName: 'Вера', approved: true });

    await tap('user:revoke:5');

    expect(tables.users[0].approved).toBe(false);
    expect(answer()).toMatchObject({ text: '🚫 Отозван' });
    expect(buttonsOf(editedList().reply_markup)).toEqual([['✅ Одобрить Вера', 'user:approve:5']]);
  });

  test('a non-admin cannot approve anyone', async () => {
    seedUser({ userId: USER_ID });

    await tap(`user:approve:${USER_ID}`, { from: USER_ID });

    expect(tables.users[0].approved).toBe(false);
    expect(answer()).toMatchObject({ text: '❌ Доступно только админу' });
    expect(callsTo('editMessageText')).toEqual([]);
  });

  test('an unknown user is reported and the list refreshed', async () => {
    seedUser({ userId: 5, displayName: 'Вера' });

    await tap('user:approve:99');

    expect(answer()).toMatchObject({ text: 'Пользователь не найден' });
    expect(editedList().text).toBe('👥 Пользователи:\n⏳ Вера (id 5) — 0');
  });

  test('an unknown action changes nothing', async () => {
    seedUser({ userId: 5 });

    await tap('user:ban:5');

    expect(tables.users[0].approved).toBe(false);
    expect(answer()).not.toHaveProperty('text');
    expect(callsTo('editMessageText')).toEqual([]);
  });

  test('the last user gone leaves "no users" in place of the list', async () => {
    await tap('user:revoke:5');

    expect(editedList()).toMatchObject({ text: 'Нет пользователей' });
  });

  test('a double tap (message not modified) is not an error', async () => {
    seedUser({ userId: 5, approved: true });
    stubApi(
      'editMessageText',
      new BotApiError('editMessageText', 400, 'Bad Request: message is not modified'),
    );

    await expect(tap('user:approve:5')).resolves.toBeUndefined();
  });

  test('other edit failures are logged, not thrown', async () => {
    seedUser({ userId: 5 });
    const error = new BotApiError('editMessageText', 400, 'Bad Request: boom');
    stubApi('editMessageText', error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(tap('user:approve:5')).resolves.toBeUndefined();

    expect(tables.users[0].approved).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.any(String), error);
  });

  test('a list message too old to edit only stops the spinner', async () => {
    seedUser({ userId: 5 });
    const query = callbackQuery('user:approve:5');
    if (query.message) query.message.date = 0;

    await handleCallbackQuery(query);

    expect(tables.users[0].approved).toBe(true);
    expect(answer()).toMatchObject({ text: '✅ Одобрен' });
    expect(callsTo('editMessageText')).toEqual([]);
  });
});
