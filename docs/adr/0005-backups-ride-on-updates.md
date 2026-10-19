# Backups ride on incoming updates and go to the admin's chat

On tgcloud nobody can reach a bot instance's database, so the bot backs itself up: after
every update it handles, at most once a day and only if the data changed, it sends its
admin the `memes` and `users` tables as a JSON document; `/backup` sends one on demand.
The file has the `{ memes, users }` shape the #21 import already read, so restoring is
that import (now `restore`). The backups guard against the platform losing data and
against the operator's own mistakes, not against losing the bot. So they hold rows
only: the stored `file_id`s stay valid for the same bot, and meme media isn't copied.

## Considered Options

- **A scheduler**: tgcloud has none. Its handlers run only for Telegram updates and
  endpoints only for Mini App calls, and the Bot API can't wake a bot up.
- **A scheduled GitHub Actions workflow running `tgcloud run`**: scheduled workflows run
  only from the default branch (still the Python bot), and GitHub disables them in a
  public repository after 60 days without activity. Keeping one alive means either
  leaning on unrelated commits or a self-re-enabling trick, for little gain: the data
  changes only when updates arrive, and those trigger the backup anyway.
- **Storing backups in GitHub artifacts or external object storage**: artifacts expire
  within 90 days and would put user IDs and names in GitHub; a bucket means credentials
  and a new setting per bot instance. The admin's chat keeps every backup for as long as
  the chat exists.

## Consequences

- A quiet bot sends nothing: nothing changed. If changes stop right after a backup,
  they wait for the next update, up to a day later, to be backed up.
- Each update costs one conditional `UPDATE` of `backup_state`; that single statement
  also stops racing updates from both sending, since the platform has no transactions.
- Backups live with Telegram, the same provider as the platform; an admin who wants an
  independent copy downloads the files.
