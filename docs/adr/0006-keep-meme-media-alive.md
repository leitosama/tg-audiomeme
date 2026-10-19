# Meme media is kept alive by checking it on incoming updates

The bot keeps no meme media of its own: memes are sent only by `file_id`, and Telegram
keeps the files. Telegram promises nothing about how long it keeps a file nobody uses,
and a `file_id` can stop working without notice: the meme still shows up in inline
results and fails when sent. So the bot uses every meme's file now and then and notices
when Telegram stops serving one. Like backups (ADR-0005), the media check rides on
incoming updates: after an update, at most every 15 minutes, it calls `getFile` on the
three memes checked longest ago. A meme whose file can't be found two checks in a row
is broken: left out of inline results, flagged in `/list`, and reported to the admin,
who deletes it and adds it again. A later check that finds the file heals it.

## Considered Options

- **Re-sending each meme to the admin's chat** and storing the new `file_id`: the
  strongest way to keep a file in use, but it floods the admin's chat with every meme
  over and over.
- **Copying the media out of Telegram** to re-upload it when it dies: ADR-0005 already
  rejected storing media anywhere but Telegram, and the media check needs only a
  `getFile` call, with no download.
- **Calling a meme broken on its first failed check**: Telegram answers a missing file
  with "wrong file_id or the file is temporarily unavailable", so a single miss can be
  a hiccup. Two misses in a row, a whole rotation of the library apart, are not.
- **Detecting broken memes from failed `/list` previews**: sending a voice message to
  the admin can also fail because of their privacy settings, which says nothing about
  the file.

## Consequences

- A quiet bot checks nothing, as with backups. Memes people send are in use anyway.
- How often each meme is checked depends on traffic and library size: three memes per
  15 minutes of activity.
- It's unconfirmed whether a `getFile` call counts as using a file for Telegram's
  housekeeping. Even if it doesn't, the check still spots broken memes before people
  run into them.
- A file too big for bots to download (over 20 MB) still counts as found.
- A rate limit or outage stops the check for an hour and records nothing against the
  memes.
