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

Backups pile up in the chat; the newest one is the current state. To restore one,
copy the never-deployed scripts in [`scripts/tgcloud/endpoints/`](scripts/tgcloud/endpoints)
next to the bot's code, run them against the bot instance, then delete the copies.
`tgcloud run` executes the local code in the cloud without deploying it, so nothing
needs pushing:

```bash
export TGCLOUD_TOKEN='app<id>:<secret>'   # the target bot instance's token
cp scripts/tgcloud/endpoints/{clear_library,restore}.js tgcloud/endpoints/
# Only if the library isn't empty: delete every meme and user (needs this exact text).
npx tgcloud run endpoints/clear_library '{ confirm: "delete memes and users" }'
# Restore: checks the whole file first, then refuses unless both tables are empty.
npx tgcloud run endpoints/restore "$(cat backup-2026-10-19-1530.json)"
rm tgcloud/endpoints/{clear_library,restore}.js
```

`restore` also accepts a Python bot instance's tables exported with `sqlite3 -json`,
which is how an instance moved to tgcloud:

```bash
memes=$(sqlite3 -json db/audio_meme.db 'SELECT * FROM memes')
users=$(sqlite3 -json db/audio_meme.db 'SELECT * FROM users')
# sqlite3 prints nothing for an empty table, hence the [] fallbacks.
printf '{ "memes": %s, "users": %s }\n' "${memes:-[]}" "${users:-[]}" > backup-python.json
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
