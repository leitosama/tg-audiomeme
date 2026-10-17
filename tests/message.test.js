import { describe, expect, test, vi } from 'vitest';
import handleMessage from '../tgcloud/handlers/message.js';
import { apiCalls, BotApiError, callsTo, stubApi } from './fakes/sdk.js';
import { ADMIN_ID, textMessage, USER_ID } from './payloads.js';

describe('/start', () => {
  test('a user in private gets usage help and no admin commands', async () => {
    await handleMessage(textMessage('/start', { from: USER_ID }));

    const [reply] = callsTo('sendMessage');
    expect(reply.chat_id).toBe(USER_ID);
    expect(reply.text).toContain('inline query');
    expect(reply.text).toContain('в любом чате');
    expect(reply.text).not.toContain('/add');
    expect(reply.reply_markup).toBeUndefined();
  });

  test('the admin in private also gets the admin commands and keyboard', async () => {
    await handleMessage(textMessage('/start', { from: ADMIN_ID }));

    const [reply] = callsTo('sendMessage');
    expect(reply.text).toContain('inline query');
    for (const command of ['/add', '/list', '/delete', '/users']) {
      expect(reply.text).toContain(command);
    }
    expect(reply.reply_markup.keyboard.flat()).toEqual(['/add', '/list', '/users']);
  });

  test('in a group, even the admin gets only usage help for that chat', async () => {
    await handleMessage(textMessage('/start', { from: ADMIN_ID, chatType: 'group' }));

    const [reply] = callsTo('sendMessage');
    expect(reply.chat_id).toBe(-100);
    expect(reply.text).toContain('в этом чате');
    expect(reply.text).not.toContain('/add');
    expect(reply.reply_markup).toBeUndefined();
  });

  test('answers /start addressed to the bot by username', async () => {
    await handleMessage(textMessage('/start@audiomeme_bot', { from: USER_ID }));

    expect(callsTo('sendMessage')).toHaveLength(1);
  });
});

test.each(['hello', '/startle', '', 'start'])('ignores a non-command message %j', async (text) => {
  await handleMessage(textMessage(text));

  expect(apiCalls).toEqual([]);
});

test('a failed reply is logged and does not throw', async () => {
  const error = new BotApiError('sendMessage', 403, 'Forbidden: bot was blocked by the user');
  stubApi('sendMessage', error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});

  await expect(handleMessage(textMessage('/start'))).resolves.toBeUndefined();

  expect(log).toHaveBeenCalledWith(expect.stringContaining(String(USER_ID)), error);
});
