# tg-audiomeme — Architecture Spec

## Overview
Telegram bot for audiomemes/videomemes with one deployment targets:
- **Local**: Docker Compose + SQLite (for development and testing)

## Stack
- Python 3.12+
- pyTelegramBotAPI (telebot)
- python-dotenv
- Standard logging module
- Type hints everywhere — mypy strict mode is mandatory

## Bot Logic
Inspiration - Stickers bot using inline query feature.

### Admin mode
Admin (just one, `ADMIN_ID` env) can manage memes using messages directly to bot.

#### Adding memes (`/add`)
* Media-first flow: forward/upload audio or video, then enter a name, then an
  optional emoji
* Bot saves `file_id` in sqlite
* Name is free-form (any text), required and unique; emoji is optional
* Cancelable at every step (`/cancel` or the ❌ Отмена button); `/skip` leaves
  the emoji empty

#### Managing memes (`/list`, alias `/delete`)
* Inline-button hub: tap a meme to open its detail view (with a media preview
  and all-time send count)
* Rename, change/remove emoji, or delete (delete asks for inline confirmation)
* Built with inline keyboards + callback queries, editing the message in place

#### Managing users
* `/users` lists users with their usage `count` and approves/revokes them via
  inline buttons (only meaningful when `REQUIRE_APPROVAL` is on)

### User mode
* Inlinequery: user writes @botname in chat and choose meme or search by name/emoji
* Save meme usage using simple counter
* Provide stats using special inlinequery stats. Stats returns Top-3 memes by all time

#### Optional user approval (`REQUIRE_APPROVAL` env)
* `users` table: `userid`, `displayname`, `approved` (default false), `count`
* When true, only `approved=true` users may use inline queries to send memes;
  others see "Ожидайте разрешение администратором"
* When false, the `approved` column is ignored
* Every meme send updates the sender's `displayname` and increments `count`
  (via `chosen_inline_result`; requires BotFather `/setinlinefeedback`)

## Deployment Modes
- SQLite for persistence, DB file `bot.db` in named volume at `/app/data/`
- Settings via `.env` + python-dotenv, including `BOT_TOKEN`
- Logs → stdout → `docker compose logs`
- Bot runs in **polling** mode: `bot.infinity_polling()`
- `docker-compose.yml`: default policy is `image: ghcr.io/...` (pull). Build by `--build` key in docker-compose
- Special optional env `TG_API_URL` for `telebot.apihelper.API_URL = TG_API_URL` to bypass restrictions 

## Code Quality
- **ruff** — linter and formatter, configured in `pyproject.toml`
- **mypy** — strict mode (`--strict`), configured in `pyproject.toml`
- **pytest** — unit and integration tests, mocking Workers environment
  - Unit tests: bot logic, handlers, storage implementations
  - Integration tests: webhook entry point with mocked `WorkerEntrypoint` and `env.DB`
  - No real `workerd` or Telegram API calls in tests
- pre-commit hooks (ruff + mypy): setup instructions in `CONTRIBUTING.md`,
  not enforced by default

## CI/CD (GitHub Actions)

Two separate workflows:

**On every push and PR** (all branches):
lint:      ruff check + ruff format --check
typecheck: mypy --strict src/
test:      pytest tests/

**On push/merge to `main` only:**
build:
docker buildx build --platform linux/amd64,linux/arm64 → ghcr.io/<owner>/<repo>:latest

- Build runs only if lint + typecheck + test all pass
- Claude Code works in `claude/*` branches, PRs into `main`

## README
- Local quickstart (Docker Compose, `.env.example`)

## Constraints
- No staging environment — `main` is production
- No release versioning — working code ships directly to `main`
