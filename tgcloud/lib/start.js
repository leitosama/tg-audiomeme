/** @typedef {import('@grammyjs/types').ReplyKeyboardMarkup} ReplyKeyboardMarkup */

const USAGE = '👋 Привет! Для получения мемов используй inline query: введи @ботname';

const ADMIN_COMMANDS = [
  'Команды админа:',
  '/add — добавить мем',
  '/list — список мемов: переименовать, сменить эмодзи, удалить (или /delete)',
  '/users — пользователи и разрешения',
  '/backup — резервная копия мемов и пользователей',
].join('\n');

/** @type {ReplyKeyboardMarkup} */
const ADMIN_KEYBOARD = { keyboard: [['/add', '/list', '/users']], resize_keyboard: true };

/**
 * The `/start` reply: usage help, plus the admin command list and keyboard for the
 * admin in private.
 * @param {{ isPrivate: boolean, isAdmin: boolean }} who
 * @returns {{ text: string, reply_markup?: ReplyKeyboardMarkup }}
 */
export function startReply({ isPrivate, isAdmin }) {
  if (!isPrivate) return { text: `${USAGE} в этом чате и выбери мем` };
  const usage = `${USAGE} в любом чате и выбери мем`;
  if (!isAdmin) return { text: usage };
  return { text: `${usage}\n\n${ADMIN_COMMANDS}`, reply_markup: ADMIN_KEYBOARD };
}
