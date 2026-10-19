# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other coding agents when
working with code in this repository.

## Overview
Telegram bot for audio/video memes, modelled on the Stickers bot's inline-query UX. It
runs on Telegram's serverless platform, **tgcloud**: plain JavaScript modules (JSDoc-typed,
checked by `tsc`, nothing emitted) executed in a V8 isolate, plus a Mini App (the
Converter). User-facing bot strings are in Russian — keep new ones in Russian. Spec:
issue #12; decisions: `docs/adr/`; vocabulary: `CONTEXT.md`. The previous Python bot is
preserved on the `python` branch (ADR-0001).

## Commands
```bash
npm ci
npm run config          # writes the gitignored tgcloud/lib/config.js from .env
npm run check           # biome ci, tsc (bot + converter/), vitest --coverage, vite build
npm run format          # biome check --write
npx vitest run tests/list.test.js        # one file; -t '<name>' for one test
npx tgcloud status      # local vs cloud
npx tgcloud run <module> '<json5 args>' [--ctx '<json5>']   # run local code in the cloud, no deploy
npm run deploy          # vite build && tgcloud push, to the bot linked locally
```
`tgcloud login` links the project to a bot; `TGCLOUD_TOKEN` in the environment takes
priority over it. Coverage thresholds are 80% (`vitest.config.js`).

## Layout
| Path                   | What it is |
|------------------------|------------|
| `tgcloud/schema.js`    | Database schema — tables as **named exports**. One file. |
| `tgcloud/handlers/`    | Update handlers, **one level only**, named after Bot API update types: `message`, `callback_query`, `inline_query`, `chosen_inline_result`. The webhook's allowed updates come from this set. |
| `tgcloud/lib/`         | Shared modules (subdirectories allowed). `store.js` is all DB access; `config.js` is generated. |
| `tgcloud/endpoints/`   | Functions the Mini App calls (`POST /api/<name>`), one level only. Only `addConvertedMedia`. |
| `converter/`           | The Converter Mini App (Vite + mediabunny, ADR-0004); pure decisions in `converter/plan.js`. Built to `dist/`, which `tgcloud.jsonc` deploys. |
| `scripts/gen-config.js`| Generates `tgcloud/lib/config.js` (`ADMIN_ID`, `REQUIRE_APPROVAL`, `CONVERTER_URL` derived from `TGCLOUD_TOKEN`). |
| `scripts/tgcloud/`     | Never-deployed modules mirroring `tgcloud/` (`endpoints/restore.js`, `endpoints/clear_library.js`); the operator copies them into `tgcloud/endpoints/` for one `tgcloud run`. |
| `tests/`, `types/`     | Vitest tests with fakes; ambient types for the SDK and runtime. |
| `docs/tgcloud-sdk.md`  | Full SDK reference (db, Bot API, fetch, endpoints). |
| `.tgcloud/`            | CLI state. **Never edit or read from here**; gitignored. |

Only `.js` files under `tgcloud/` are deployed as code, plus the `dist/` build as the Mini
App's static files. A module's name is its path inside `tgcloud/` without `.js`
(`handlers/message`).

## Architecture
- **Handlers** get the update's payload (`Message`, `CallbackQuery`, …) as the first
  argument and `ctx.update` as the second. Each is wrapped by `checkingBackup`
  (`lib/backup.js`, ADR-0005: a daily backup to the admin rides on updates) and
  `checkingMedia` (`lib/media_check.js`, ADR-0006: `getFile` on a few memes; two misses
  mark a meme broken, hidden from inline results). There is no scheduler.
- **Admin conversations** (`/add`, rename, change emoji) save their pending step in the
  DB between updates (see `schema.js`), since there is no process memory between updates.
  Every step honours `/cancel` / `❌ Отмена`. Admin = single `ADMIN_ID`, private chat only.
- **Media**: only voice messages and video notes are memes (ADR-0002); anything else goes
  through the Converter in the admin's browser, which posts to `addConvertedMedia`. Only
  stored `file_id`s are ever sent (cached inline results).
- **Inline UI** (`/list`, `/users`) edits the message in place via callback data
  (`lib/callbacks.js`).
- **Inline queries**: `stats` / `userstats` are reserved leaderboard queries (non-numeric
  result ids); other results are memes with `result_id = String(meme.id)`. With
  `REQUIRE_APPROVAL`, unapproved users get a pending article and answers are personal.
- **Counting** happens in `chosen_inline_result` (needs BotFather `/setinlinefeedback`):
  numeric result ids only, deduped by `inline_message_id`.
- **Config** is baked in at deploy time from the bot instance's GitHub Environment
  (ADR-0003); tgcloud has no runtime env vars or secrets.

## tgcloud rules that bite
- **Imports**: project modules by relative path **with `.js`** (`'../lib/store.js'`); the
  SDK by name (`import { db, api, fetch, EndpointError } from 'sdk'`,
  `import { eq, sql } from 'sdk/db'`). Nothing outside `tgcloud/` is reachable; **no
  filesystem, no npm packages** at runtime.
- **`api.<method>({...})`** returns the unwrapped result and throws `BotApiError`
  (`.code`/`.description`/`.parameters`).
- **Endpoints**: `export default async function (input, ctx)`; `ctx.initData` is verified
  by the platform (`ctx.initData.user` is the caller; invalid → 401). Refuse with
  `throw new EndpointError(msg, { code })` → 400; any other exception is a generic 500.
  The front-end calls `Telegram.WebApp.Serverless.call(name, input, cb)`.
- **Database**: every call is async — always `await`. **No foreign keys** (`.references()`
  throws): enforce integrity in code. Drops happen only via `.deprecated('reason')`;
  deleting a declaration drops nothing. Type changes are manual `db.run(...)`.
- **Deploying never touches the database.** `push` only reports schema changes;
  `migrate` applies them (CI applies safe ones and fails on the rest).
- The platform manages the webhook from the deployed handlers; `npx tgcloud webhook`
  shows drift and `npx tgcloud webhook sync` repairs it.
- The Mini App is served from the host root; never add `X-Frame-Options` or a restrictive
  `frame-ancestors` (Telegram Web opens it in an iframe).

## Tests
Vitest swaps `sdk`, `lib/store.js` and `lib/config.js` for fakes in `tests/fakes/`
(`vitest.config.js`); `scripts/tgcloud/` imports resolve as if they sat in `tgcloud/`.
Handlers are called as plain functions with payloads from `tests/payloads.js`; assert on
the fake Bot API's calls. No real Telegram or tgcloud calls.

## Conventions & constraints
- Biome (2-space, single quotes, line width 100) and `tsc --strict` on JSDoc are mandatory.
- When adding a config key: `scripts/gen-config.js` (+ its test), `lib/config.d.ts`,
  `tests/fakes/config.js`, `.env.example`, every GitHub Environment, the workflow's `env`,
  and the README's "Bot instances" table.
- **`main` is production**: every push deploys each `prod-<bot username>` Environment in
  turn (`.github/workflows/tgcloud.yml`). Work in `claude/*` branches — pushes to them
  deploy the `dev` bot — and open PRs into `main`. A new bot instance needs its
  Environment added to the deploy matrix.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (leitosama/tg-audiomeme), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` + `docs/adr/` (created lazily). See `docs/agents/domain.md`.
