# Run the bot on Telegram's serverless platform (tgcloud) in JavaScript

The bot is rewritten from Python (telebot, long-polling, Docker image on GHCR) to
JavaScript modules deployed with the `tgcloud` CLI, so there is no server, container
or volume to operate. The Python implementation is preserved on the `python` branch;
rolling back means restoring it and switching the bot from the platform's webhook
back to polling. Every bot instance keeps its own token, so its stored `file_id`s and
existing data carry over into its tgcloud database.

Code is plain `.js` with JSDoc types checked by `tsc --checkJs --strict` rather than
TypeScript, because the platform deploys the `tgcloud/` sources as-is and a build
step would put a second copy of the code between what we write and what runs.
