import { boolean, check, integer, sql, table, text } from 'sdk/db';

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

// TEMPORARY: probes that CI refuses non-safe schema changes (#13). Remove after.
export const deployProbe = table('deploy_probe', {
  id: integer('id').primaryKey(),
}).deprecated('deploy check');
