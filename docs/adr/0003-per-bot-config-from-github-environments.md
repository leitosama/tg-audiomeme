# Per-bot config is generated at deploy time from GitHub Environments

tgcloud has no environment variables or secrets, and the same code runs as several
bots (each with its own token, admin and library). So `tgcloud/lib/config.js`
(`ADMIN_ID`, `REQUIRE_APPROVAL`) is gitignored and generated: in CI from one GitHub
Environment per bot (holding that bot's `TGCLOUD_TOKEN` secret and config
variables), locally by `npm run config` from `.env`. A per-bot settings table in the
database was rejected because it adds a read to every update and leaves a freshly
deployed bot inert until seeded.
