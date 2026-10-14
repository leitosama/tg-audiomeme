import { boolean, check, index, integer, json, sql, table, text } from 'sdk/db';

// Same columns and meaning as the Python bot's SQLite schema, so a bot instance's
// exported data imports as a straight copy. The platform forbids foreign keys.

export const memes = table(
  'memes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    fileId: text('file_id').notNull(),
    // 'audio' = voice message, 'video' = video note (ADR-0002).
    mediaType: text('media_type').notNull(),
    emoji: text('emoji').notNull().default(''),
    count: integer('count').notNull().default(0),
    createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    mediaTypeCheck: check('memes_media_type', sql`${t.mediaType} in ('audio', 'video')`),
  }),
);

export const users = table('users', {
  userId: integer('userid').primaryKey(),
  displayName: text('displayname'),
  approved: boolean('approved').notNull().default(false),
  count: integer('count').notNull().default(0),
});

// The admin's pending conversation step per chat (e.g. `/add` waiting for a name),
// saved between updates in place of the Python bot's next-step handlers. `data`
// holds what earlier steps collected.
export const conversationSteps = table('conversation_steps', {
  chatId: integer('chat_id').primaryKey(),
  name: text('name').notNull(),
  data: json('data').notNull(),
  updatedAt: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`),
});

// Recent sends, so a send Telegram delivers more than once is counted once. A send is
// keyed by its inline message ID, or `update:<update_id>` when Telegram leaves that
// out (it does unless the sent message has an inline keyboard). `seen_at` is in Unix
// seconds; rows older than seven days are pruned.
export const seenSends = table(
  'seen_sends',
  {
    sendKey: text('send_key').primaryKey(),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => ({
    seenAtIdx: index('idx_seen_sends_seen_at').on(t.seenAt),
  }),
);
