# tg-audiomeme

[![CI](https://github.com/leitosama/tg-audiomeme/actions/workflows/ci.yml/badge.svg)](https://github.com/leitosama/tg-audiomeme/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/python-3.12%2B-blue)

A Telegram bot — like Stickers, but for audio and video messages.

## Features

### For the admin

A single admin (`ADMIN_ID`) manages memes via direct messages to the bot:

- **`/add`** — add an audio or video to the database:
  - forward a message with audio/video, or upload a file directly;
  - the bot stores the Telegram `file_id` for later reuse.
- **`/delete`** — delete a saved meme (pick from a list + confirmation).
- **`/list`** — view all saved memes.
- **`/users`** — list users with their usage count and approve/revoke them via
  inline buttons (relevant when `REQUIRE_APPROVAL` is on).

### For everyone

- **Inline mode** — type `@botname` in any chat, pick a meme, and the bot sends the
  saved audio or video.

### Optional: user approval

Set `REQUIRE_APPROVAL=true` to gate inline usage behind admin approval. Unapproved
users see *"Ожидайте разрешение администратором"* instead of memes, and the admin
approves them with `/users`. When the flag is off (default), anyone may use the bot.

Per-user send counts are tracked whenever a meme is sent. This relies on Telegram
delivering `chosen_inline_result` updates, so enable inline feedback for the bot in
[@BotFather](https://t.me/BotFather) (`/setinlinefeedback`).

## Quick start (Docker Compose)

By default, `docker-compose.yml` pulls the prebuilt image from
`ghcr.io/leitosama/tg-audiomeme:latest`.

```bash
cp .env.example .env
# fill in BOT_TOKEN and ADMIN_ID in .env
docker compose up -d
```

To build the image locally instead of pulling it from the registry:

```bash
docker compose up -d --build
```

The database is stored in the `./db` volume on the host.

## Environment variables

| Variable     | Required | Default                | Description                                                     |
| ------------ | -------- | ---------------------- | --------------------------------------------------------------- |
| `BOT_TOKEN`  | yes      | —                      | Bot token from [@BotFather](https://t.me/BotFather).            |
| `ADMIN_ID`   | yes      | —                      | Telegram ID of the single admin.                                |
| `DB_PATH`    | no       | `./db/audio_meme.db`   | Path to the SQLite file.                                        |
| `TG_API_URL` | no       | —                      | Custom Bot API endpoint (e.g. a self-hosted Bot API server).    |
| `REQUIRE_APPROVAL` | no | `false`                | Gate inline usage behind admin approval (see above).            |

See [`.env.example`](.env.example) for a template.

## Local development

Requires Python 3.12+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

Run the bot (variables can be passed inline):

```bash
BOT_TOKEN=... ADMIN_ID=... python main.py
```

Quality checks (the same ones CI runs):

```bash
ruff check .            # linter
ruff format --check .   # formatting
mypy main.py            # types (strict, configured in pyproject.toml)
pytest                  # tests + coverage
```

## CI/CD

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- **On every push and pull request**, a single `check` job runs `ruff` (lint + format),
  `mypy` (strict), and `pytest` (with coverage).
- **On push to `main`**, after all checks pass, a multi-platform Docker image
  (`linux/amd64`, `linux/arm64`) is built and published to
  `ghcr.io/leitosama/tg-audiomeme` with the tags `latest` and `sha-<commit>`.

`main` is production: there is no separate staging environment and no release
versioning — working code ships straight to `main`.

## Database

All memes are stored in SQLite (`./db/audio_meme.db` by default).

The `memes` table:

- `id` — unique identifier;
- `name` — meme name;
- `file_id` — Telegram `file_id` used for caching;
- `media_type` — type: `audio` or `video`;
- `created_at` — date added.

The `users` table:

- `userid` — Telegram user id (primary key);
- `displayname` — the user's first name, refreshed on each use;
- `approved` — whether the user may send memes (only enforced when
  `REQUIRE_APPROVAL` is on);
- `count` — number of memes the user has sent.

## License

See [LICENSE](LICENSE).
