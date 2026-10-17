# tg-audiomeme

A Telegram bot that works like the Stickers bot, but for short voice messages and
video notes: an admin curates a library of memes, and users send them into any chat
through inline mode.

## Language

**Bot instance**:
One deployed copy of the bot, with its own token, admin and library. Several
instances run the same code.
_Avoid_: deployment, tenant

### Library

**Meme**:
A named voice message or video note in the library, optionally tagged with an emoji.
_Avoid_: clip, sound, sticker

**Meme name**:
The free-form, unique label a meme is found and listed by.
_Avoid_: title, key

**Meme hub**:
The admin's `/list` menu: the library as inline buttons, opening a meme's detail
view to preview, rename, re-emoji or delete it, edited in place.
_Avoid_: list, menu, dashboard

**Admin**:
The single Telegram user who curates a bot instance's library and approves users.
_Avoid_: owner, moderator

### Usage

**User**:
Anyone who has used the bot through inline mode.
_Avoid_: member, client

**Send**:
One delivery of a meme into a chat by a user, chosen from the inline results.
_Avoid_: use, play, click

**Send count**:
The all-time number of sends, kept per meme and per user.
_Avoid_: usage, hits

**Approval**:
The admin's permission for a user to send memes. Only enforced when approval mode
is on.
_Avoid_: whitelist, access

**Leaderboard**:
The top three memes (`stats`) or top three users (`userstats`) by send count.
_Avoid_: stats page, ranking
