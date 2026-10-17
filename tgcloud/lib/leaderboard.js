// Leaderboard articles for the reserved inline queries `stats` and `userstats`.

/** @typedef {import('@grammyjs/types').InlineQueryResult} InlineQueryResult */

const EMPTY_TEXT = 'Пока нет статистики';

/**
 * A leaderboard as one article whose text ranks each row's label with its send count.
 * Its result ID is non-numeric (the query itself), so choosing it never counts as a send.
 * @param {string} id
 * @param {string} header
 * @param {{ label: string, count: number }[]} rows
 * @returns {InlineQueryResult}
 */
export function leaderboardArticle(id, header, rows) {
  const text = rows.length
    ? [header, ...rows.map((row, i) => `${i + 1}. ${row.label} — ${row.count}`)].join('\n')
    : EMPTY_TEXT;
  return {
    type: 'article',
    id,
    title: header,
    description: text,
    input_message_content: { message_text: text },
  };
}
