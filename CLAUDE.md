# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview
Telegram bot for audio/video memes, modelled on the Stickers bot's inline-query UX.
Python 3.12+, pyTelegramBotAPI (`telebot`), SQLite, long-polling. Deployed only via
Docker Compose. User-facing bot strings are in Russian — keep new ones in Russian.

## Commands
```bash
pip install -r requirements-dev.txt     # into a 3.12+ venv

ruff check . && ruff format --check .   # lint + format (ruff format . to fix)
mypy main.py                            # strict; follows the import into db.py
pytest                                  # all tests + coverage (fails under 80% on main.py)
pytest tests/test_handlers.py::test_name   # single test
pytest -k inline --no-cov               # filter; --no-cov skips the coverage gate

BOT_TOKEN=... ADMIN_ID=... python main.py   # run locally (needs ffmpeg on PATH)
docker compose up -d [--build]          # pulls ghcr.io image by default; --build builds locally
```
CI (`.github/workflows/ci.yml`) runs exactly the lint/mypy/pytest commands above in one
`check` job on every push/PR; on push to `main` it then builds and pushes a multi-arch
(amd64/arm64) image to `ghcr.io/leitosama/tg-audiomeme` (`latest` + `sha-*`).

## Architecture
Two modules, no package:

- **`main.py`** — config (env vars read at import time into module globals), the
  module-level `bot = telebot.TeleBot(...)` and `db = AudioMemeDB(DB_PATH)` singletons,
  every handler (registered via `@bot.*_handler` decorators at import), and `main()`.
  `main()` validates `BOT_TOKEN`/`ADMIN_ID`, applies `TG_API_URL` (overrides both
  `apihelper.API_URL` and `FILE_URL`), installs SIGTERM/SIGINT handlers, and calls
  `bot.infinity_polling(skip_pending=True, allowed_updates=ALLOWED_UPDATES)`. The read
  timeout is forced above the long-poll timeout. New update types must be added to
  `ALLOWED_UPDATES` or Telegram won't deliver them.
- **`db.py`** — `AudioMemeDB`: one shared `sqlite3` connection (`check_same_thread=False`)
  guarded by a `threading.Lock`, WAL mode, because telebot runs handlers on worker
  threads. Schema is created in `init_db()`; migrations are ad-hoc `PRAGMA table_info`
  checks + `ALTER TABLE ADD COLUMN` there — add new columns the same way. Methods return
  `Meme` NamedTuples / plain tuples.

Key flows in `main.py`:
- **Admin conversations** (`/add`, rename, change emoji) are multi-step via
  `bot.register_next_step_handler(msg, next_fn, *args)`; state is passed as extra args,
  not stored. Every step must honour cancel (`_cancel_requested` → `/cancel` or
  `CANCEL_TEXT`). Admin gating is `_is_admin_private(message, tag)` (single `ADMIN_ID`,
  private chat only).
- **Media ingest**: voice/video_note `file_id`s are stored directly; plain audio/video files
  are downloaded, transcoded with `ffmpeg` (OGG/Opus voice, ≤640px H.264 video note),
  re-sent to the admin chat, and *that* message's `file_id` is stored — inline results use
  `InlineQueryResultCachedVoice`/`CachedVideo`, so only stored `file_id`s are ever sent.
- **Inline UI** (`/list`, `/users`) uses callback data `meme:<action>:<id>` and
  `user:<action>:<id>`, editing the message in place.
- **Inline queries**: `stats` / `userstats` are reserved queries returning leaderboard
  articles (non-numeric result ids); otherwise results are memes with `result_id = str(meme.id)`.
  With `REQUIRE_APPROVAL=true` (literal string `true`), unapproved users get a pending
  article and answers are `is_personal`.
- **Counting** happens in the `chosen_inline_result` handler (requires BotFather
  `/setinlinefeedback`): only numeric result ids count, deduped by `inline_message_id`
  in a bounded in-memory deque.

## Tests
Tests import `main` directly (the module stays importable without a real token). Fixtures
in `tests/conftest.py`: `bot` monkeypatches `main.bot` with a `MagicMock`; `env` also
swaps `main.db` for a temp-file `AudioMemeDB` and sets `ADMIN_ID`; `make_message` /
`make_inline_query` etc. build `SimpleNamespace` fakes of telebot objects. Handlers are
called as plain functions; assert on the mock bot's calls. No real Telegram API calls.

## Conventions & constraints
- mypy `--strict` is mandatory (telebot is treated as untyped; see `pyproject.toml`).
  ruff line length 100.
- Logs go to stdout via `logging`; level from `LOG_LEVEL`.
- DB defaults to `./db/audio_meme.db`; Compose mounts `./db` at `/app/db`. The Dockerfile
  copies only `main.py` and `db.py` — update it if you add a module.
- When adding an env var, update `.env.example`, `docker-compose.yml`, and the README table.
- `main` is production (no staging, no versioning). Work in `claude/*` branches and open
  PRs into `main`.
- On the `claude/tgcloud-rewrite` branch, a JavaScript rewrite for Telegram's serverless
  platform (tgcloud) is growing beside the Python bot (spec: issue #12). Platform rules
  are in `AGENTS.md` and `docs/tgcloud-sdk.md`. `npm run check` runs Biome, `tsc` (bot and
  `converter/`), Vitest with coverage and the build; `npm run config` generates the
  gitignored `tgcloud/lib/config.js` from `.env`. The Converter (`converter/`, Vite +
  mediabunny; decisions in the pure `converter/plan.js`) is the Mini App: `npm run build`
  writes it to `dist/`, which `tgcloud.jsonc` deploys; its endpoint is
  `tgcloud/endpoints/addConvertedMedia.js`, and its URL is derived from `TGCLOUD_TOKEN`.
  Its CI (`.github/workflows/tgcloud.yml`) deploys pushes to the rewrite branch to the
  `dev` GitHub Environment. Feature PRs target `claude/tgcloud-rewrite`. Backups
  (`tgcloud/lib/backup.js`, ADR-0005) ride on every update via the `checkingBackup`
  handler wrapper, and so does the media check (`tgcloud/lib/media_check.js`, ADR-0006,
  `checkingMedia`), which calls `getFile` on a few memes per update and hides broken ones
  from inline results; restoring uses the never-deployed `scripts/tgcloud/endpoints/`
  (`restore.js`, `clear_library.js`), which the operator copies into `tgcloud/endpoints/`
  for one `tgcloud run`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (leitosama/tg-audiomeme), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` + `docs/adr/` (created lazily). See `docs/agents/domain.md`.
