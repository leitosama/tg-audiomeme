# tg-audiomeme

[![tgcloud](https://github.com/leitosama/tg-audiomeme/actions/workflows/tgcloud.yml/badge.svg)](https://github.com/leitosama/tg-audiomeme/actions/workflows/tgcloud.yml)

A Telegram bot — like Stickers, but for audio and video messages. It runs on Telegram's
serverless platform, [tgcloud](docs/tgcloud-sdk.md): there is no server to operate.

## Features

### For the admin

A single admin (`ADMIN_ID`) manages memes via direct messages to the bot:

- **`/add`** — add a meme:
  - send a voice message or a video note, or tap **Converter** to turn any audio or
    video file into one in the Mini App (see [The Converter](#the-converter)); then
    give it a **name** (any text) and an optional **emoji**;
  - the bot stores the Telegram `file_id` for later reuse;
  - send `/cancel` (or tap **❌ Отмена**) at any step to abort, and `/skip` to
    leave the emoji empty.
- **`/list`** — the management hub: tap a meme to **rename** it, change its
  **emoji**, or **delete** it (with an inline confirmation and a media preview).
  Each meme shows its all-time send count. (`/delete` opens the same hub.)
- **`/users`** — list users with their usage count and approve/revoke them via
  inline buttons (relevant when `REQUIRE_APPROVAL` is on).
- **`/backup`** — get a backup of the memes and users now (see
  [Backups and restore](#backups-and-restore)).

> **Admin's privacy settings.** To store a converted audio or video file, the bot
> sends it to the admin's chat as a voice message or video note. If the admin's
> account restricts voice messages (Settings → Privacy and Security → Voice
> Messages, a Telegram Premium option), add the bot under **Always Allow**.
> Otherwise adding a file fails with `VOICE_MESSAGES_FORBIDDEN`.

### For everyone

- **Inline mode** — type `@botname` in any chat, pick a meme, and the bot sends the
  saved audio or video. Type text after the mention to **search by name or emoji**;
  with no text, results are ordered by all-time popularity (most-sent first).
- **`@botname stats`** — show the Top-3 most-sent memes of all time.
- **`@botname userstats`** — show the Top-3 most active users of all time.

### Optional: user approval

Set `REQUIRE_APPROVAL=true` to gate inline usage behind admin approval. Unapproved
users see *"Ожидайте разрешение администратором"* instead of memes, and the admin
approves them with `/users`. When the flag is off (default), anyone may use the bot.

Per-user and per-meme send counts are tracked whenever a meme is sent (powering the
`stats`/`userstats` leaderboards). This relies on Telegram delivering
`chosen_inline_result` updates, so enable inline feedback for the bot in
[@BotFather](https://t.me/BotFather) (`/setinlinefeedback`).

### Media health

On activity the bot checks a few stored `file_id`s with `getFile`; a meme whose file
fails twice in a row is hidden from inline results, marked in `/list` and reported to the
admin ([ADR-0006](docs/adr/0006-keep-meme-media-alive.md)).

## Bot instances

The same code runs as several **bot instances**, each with its own token, admin and
library. Each one is a GitHub Environment holding:

| Key                | Kind     | Description                                                           |
| ------------------ | -------- | --------------------------------------------------------------------- |
| `TGCLOUD_TOKEN`    | secret   | The bot's tgcloud token, `app<id>:<secret>`. Also gives the Converter's URL, `https://app<id>.tgcloud.ai/`. |
| `ADMIN_ID`         | secret   | Telegram ID of the single admin.                                      |
| `REQUIRE_APPROVAL` | variable | `true` or `false` (default): gate inline usage behind approval.       |

tgcloud has no runtime environment variables, so `scripts/gen-config.js` bakes these into
the gitignored `tgcloud/lib/config.js` at deploy time
([ADR-0003](docs/adr/0003-per-bot-config-from-github-environments.md)).

| Environment             | Deployed by                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `prod-audiotinkoff_bot` | every push to `main`                                        |
| `prod-privatebot`       | every push to `main`, after `prod-audiotinkoff_bot` succeeds |
| `dev`                   | pushes to `claude/*` branches, and Actions → tgcloud → Run workflow on any branch |

To add a bot instance: create a `prod-<bot username>` Environment with the keys above, add
it to the `deploy` job's matrix in [`.github/workflows/tgcloud.yml`](.github/workflows/tgcloud.yml),
and in @BotFather turn on inline mode (`/setinline`) and inline feedback
(`/setinlinefeedback`).

## Local development

Requires Node.js 24.

```bash
npm ci
cp .env.example .env    # fill in ADMIN_ID (and TGCLOUD_TOKEN for the Converter button)
npm run config          # writes tgcloud/lib/config.js from .env
npm run check           # Biome, tsc, Vitest with coverage, the Converter build — what CI runs
```

`npx tgcloud login` links the project to a bot (use the dev bot), or set `TGCLOUD_TOKEN`
in the shell, which takes priority. Then:

```bash
npx tgcloud status                       # what changed locally vs the cloud
npx tgcloud run handlers/message '{ … }'  # run a module in the cloud without deploying
npm run deploy                           # build the Converter and push to the linked bot
```

Prefer deploying through CI: it regenerates the config from the Environment and applies
safe schema changes. Pushing by hand deploys whatever `tgcloud/lib/config.js` holds.

## CI/CD

GitHub Actions ([`.github/workflows/tgcloud.yml`](.github/workflows/tgcloud.yml)):

- **On every push and pull request**, the `check` job runs Biome, `tsc`, Vitest with
  coverage and the Converter build.
- **Deploys** (see [Bot instances](#bot-instances)) generate the config, build the
  Converter, `tgcloud push --force`, apply safe schema changes with `tgcloud migrate --safe`,
  and fail if anything non-safe is left for a human to apply.

`main` is production: there is no staging and no release versioning. Work in `claude/*`
branches (which deploy to the dev bot) and open PRs into `main`.

## The Converter

A Mini App, opened from `/add`, that turns any audio or video file into a voice message or
a video note in the admin's browser (WebCodecs via mediabunny,
[ADR-0004](docs/adr/0004-convert-in-the-admins-browser.md)). Its sources are in
`converter/`; `npm run build` writes it to `dist/`, which `tgcloud.jsonc` deploys next to
the bot at `https://app<id>.tgcloud.ai/`.

## Database

The `memes` table:

- `id` — unique identifier;
- `name` — meme name (any text, unique);
- `file_id` — Telegram `file_id` used for caching;
- `media_type` — type: `audio` or `video`;
- `emoji` — optional emoji shown in the inline results and the admin list;
- `count` — all-time number of times the meme has been sent;
- `created_at` — date added.

The `users` table:

- `userid` — Telegram user id (primary key);
- `displayname` — the user's first name, refreshed on each use;
- `approved` — whether the user may send memes (only enforced when
  `REQUIRE_APPROVAL` is on);
- `count` — number of memes the user has sent.

Schema changes go in `tgcloud/schema.js`; deploying never touches the database, the
migrate step does.

## Backups and restore

On tgcloud the database can't be reached directly, so the bot sends its admin backups:
JSON documents holding the `memes` and `users` tables (the rows described above, with
SQLite column names). Meme media isn't included: the stored `file_id`s keep working as
long as the bot (its token) is the same.

- **Automatically**, silently, after any update to the bot, at most once a day and only
  if the data changed since the last backup sent. A failed send is retried an hour later.
- **On demand** with `/backup`, which always sends one and restarts the daily timer.

Backups pile up in the chat; the newest one is the current state. Backups hold user IDs
and names: keep them off git, issues, CI and chats other than the admin's, and delete
local copies once they're restored.

To restore one, give each bot instance a local env file (gitignored, like every
`.env.*` but `.env.example`) holding its `TGCLOUD_TOKEN` and `ADMIN_ID`, for example
`.env.prod-privatebot`, and run:

```bash
npm run restore -- .env.prod-privatebot backup-2026-10-19-1530.json
# The library isn't empty? Delete every meme and user first, then restore:
npm run restore -- .env.prod-privatebot backup-2026-10-19-1530.json --clear
```

[`scripts/restore.js`](scripts/restore.js):

- takes the target bot only from the env file (never from your shell or `tgcloud login`)
  and asks you to type its app id before changing anything;
- copies the never-deployed endpoints in [`scripts/tgcloud/endpoints/`](scripts/tgcloud/endpoints)
  into `tgcloud/endpoints/` and runs them as the admin (`--ctx`) with `tgcloud run`, which
  executes local code in the cloud without deploying it;
- creates the gitignored `.tgcloud/` in this checkout if it's missing: the CLI works in the
  nearest folder holding one, so without it a fresh clone or a git worktree would run
  another checkout's code and fail with `Module not found`;
- leaves out the line where `tgcloud run` echoes its argument, the whole backup;
- always deletes the copies afterwards, and puts `tgcloud/lib/config.js` back as it was.

The bot instance must already be deployed: the deploy's migrate step creates the
tables the restore fills. A successful restore ends with `< {memes:N,users:M}`. The
restore checks the whole file first and refuses unless both tables are empty. It
isn't atomic: if it fails part-way, run it again with `--clear`. Should a copy of
`restore` or `clear_library` ever be left behind, it's gitignored, `npm run deploy` and
CI refuse to push it, and the endpoints refuse every caller but the admin.

To check a bot instance after a restore (both commands change nothing):

```bash
# The webhook matches the deployed handlers and no updates are pending.
node --env-file=.env.prod-privatebot node_modules/@tgcloud/cli/bin/tgcloud.js webhook
# The rows are there: a second restore must refuse with "already holds N row(s)".
npm run restore -- .env.prod-privatebot backup-2026-10-19-1530.json
```

Then, in Telegram:
- `@<bot>` with no text lists the memes, and text after it searches;
- one sent meme plays (its `file_id` still works) and its count grows in `/list`;
- `@<bot> stats` and `@<bot> userstats` show the restored leaderboards;
- `/users` lists the users, if approval is on.

`restore` also accepts a Python bot instance's tables exported with `sqlite3 -json`,
which is how an instance moved to tgcloud:
1. stop the Python bot and export its tables;
2. deploy the instance, by pushing to `main` with its Environment in the deploy matrix;
3. restore the export;
4. run the checks above.

The library is empty between steps 2 and 3. The export, on the old server with the bot
stopped:

```bash
memes=$(sqlite3 -json db/audio_meme.db 'SELECT * FROM memes')
users=$(sqlite3 -json db/audio_meme.db 'SELECT * FROM users')
# sqlite3 prints nothing for an empty table, hence the [] fallbacks.
printf '{ "memes": %s, "users": %s }\n' "${memes:-[]}" "${users:-[]}" > backup-python.json
chmod 600 backup-python.json   # then copy it to your machine with scp
```

The file travels as one command-line argument; macOS allows about 1 MB, enough for
thousands of memes. `backup*.json` is gitignored.

## Rolling back to the Python bot

The Python implementation (telebot, long-polling, Docker image on GHCR) is preserved on
the [`python`](https://github.com/leitosama/tg-audiomeme/tree/python) branch. For one bot
instance:

1. Delete the webhook tgcloud set, or long-polling can't start:
   `curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"`.
2. On the server, check out `python` and run `docker compose up -d` against the bot's
   old `db/audio_meme.db`.

Anything sent, added or changed on tgcloud since the move is lost, unless it's re-added
by hand.

## License

See [LICENSE](LICENSE).
