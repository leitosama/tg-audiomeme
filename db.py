"""SQLite persistence layer for tg-audiomeme."""

import logging
import sqlite3
import threading
from pathlib import Path
from typing import NamedTuple


class Meme(NamedTuple):
    """A stored meme. Compares equal to a plain tuple of the same fields."""

    id: int
    name: str
    file_id: str
    media_type: str
    emoji: str
    usage: int


def _row_to_meme(row: sqlite3.Row) -> Meme:
    """Build a Meme from a memes-table row."""
    return Meme(
        id=row["id"],
        name=row["name"],
        file_id=row["file_id"],
        media_type=row["media_type"],
        emoji=row["emoji"],
        usage=row["count"],
    )


class AudioMemeDB:
    """SQLite database for audio/video memes.

    A single persistent connection is kept open for the lifetime of the
    instance.  All access is serialised via a threading.Lock so the
    connection can be shared safely across pyTelegramBotAPI's worker threads.
    WAL journal mode is enabled so reads never block writes.
    """

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._lock = threading.Lock()
        if db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self.init_db()

    def init_db(self) -> None:
        """Initialize database schema and run migrations."""
        with self._lock:
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS memes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    file_id TEXT NOT NULL,
                    media_type TEXT NOT NULL,
                    emoji TEXT NOT NULL DEFAULT '',
                    count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    userid INTEGER PRIMARY KEY,
                    displayname TEXT,
                    approved INTEGER NOT NULL DEFAULT 0,
                    count INTEGER NOT NULL DEFAULT 0
                )
            """)
            # Migrations: add columns to already-deployed meme tables.
            meme_columns = {
                row["name"] for row in self._conn.execute("PRAGMA table_info(memes)").fetchall()
            }
            if "count" not in meme_columns:
                self._conn.execute("ALTER TABLE memes ADD COLUMN count INTEGER NOT NULL DEFAULT 0")
            if "emoji" not in meme_columns:
                self._conn.execute("ALTER TABLE memes ADD COLUMN emoji TEXT NOT NULL DEFAULT ''")
            self._conn.commit()

    def add_meme(self, name: str, file_id: str, media_type: str, emoji: str = "") -> bool:
        """Add a new meme. Returns True if successful, False on a duplicate name."""
        with self._lock:
            try:
                self._conn.execute(
                    "INSERT INTO memes (name, file_id, media_type, emoji) VALUES (?, ?, ?, ?)",
                    (name, file_id, media_type, emoji),
                )
                self._conn.commit()
                return True
            except sqlite3.IntegrityError:
                logging.warning("Meme with name '%s' already exists", name)
                return False

    def delete_meme_by_id(self, meme_id: int) -> bool:
        """Delete a meme by id. Returns True if a row was removed."""
        with self._lock:
            cursor = self._conn.execute("DELETE FROM memes WHERE id = ?", (meme_id,))
            self._conn.commit()
            return cursor.rowcount > 0

    def update_meme_name(self, meme_id: int, name: str) -> bool:
        """Rename a meme. Returns False on a unique-name collision or missing id."""
        with self._lock:
            try:
                cursor = self._conn.execute(
                    "UPDATE memes SET name = ? WHERE id = ?", (name, meme_id)
                )
                self._conn.commit()
                return cursor.rowcount > 0
            except sqlite3.IntegrityError:
                logging.warning("Cannot rename meme %s: name '%s' already exists", meme_id, name)
                return False

    def update_meme_emoji(self, meme_id: int, emoji: str) -> None:
        """Set (or clear) a meme's emoji."""
        with self._lock:
            self._conn.execute("UPDATE memes SET emoji = ? WHERE id = ?", (emoji, meme_id))
            self._conn.commit()

    def get_all_memes(self) -> list[Meme]:
        """Get all memes ordered by name."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, name, file_id, media_type, emoji, count FROM memes ORDER BY name"
            ).fetchall()
        return [_row_to_meme(row) for row in rows]

    def get_meme_by_name(self, name: str) -> Meme | None:
        """Get a meme by its (unique) name, or None."""
        with self._lock:
            row = self._conn.execute(
                "SELECT id, name, file_id, media_type, emoji, count FROM memes WHERE name = ?",
                (name,),
            ).fetchone()
        return _row_to_meme(row) if row else None

    def get_meme_by_id(self, meme_id: int) -> Meme | None:
        """Get a meme by its id, or None."""
        with self._lock:
            row = self._conn.execute(
                "SELECT id, name, file_id, media_type, emoji, count FROM memes WHERE id = ?",
                (meme_id,),
            ).fetchone()
        return _row_to_meme(row) if row else None

    def get_memes_by_usage(self) -> list[Meme]:
        """Get all memes ordered by all-time usage (most-sent first), then name."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, name, file_id, media_type, emoji, count FROM memes "
                "ORDER BY count DESC, name ASC"
            ).fetchall()
        return [_row_to_meme(row) for row in rows]

    def search_memes(self, query: str) -> list[Meme]:
        """Find memes whose name or emoji contains the query (case-insensitive).

        Ordered like get_memes_by_usage. Matching is done in Python so Unicode
        (e.g. Cyrillic) case-folding works, which SQLite's LIKE does not provide.
        """
        needle = query.strip().lower()
        if not needle:
            return self.get_memes_by_usage()
        return [
            meme
            for meme in self.get_memes_by_usage()
            if needle in meme.name.lower() or needle in meme.emoji.lower()
        ]

    def increment_meme_count(self, meme_id: int) -> None:
        """Increment a meme's all-time usage counter."""
        with self._lock:
            self._conn.execute("UPDATE memes SET count = count + 1 WHERE id = ?", (meme_id,))
            self._conn.commit()

    def get_top_memes(self, limit: int = 3) -> list[tuple[str, int]]:
        """Get the most-used memes as (name, count), excluding never-used ones."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT name, count FROM memes WHERE count > 0 "
                "ORDER BY count DESC, name ASC LIMIT ?",
                (limit,),
            ).fetchall()
        return [(row[0], row[1]) for row in rows]

    # --- Users ---------------------------------------------------------------

    def register_user(self, userid: int, displayname: str) -> None:
        """Make a user known (e.g. so the admin can approve them).

        Inserts the user if missing and refreshes their displayname, without
        touching the ``approved`` or ``count`` columns.
        """
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO users (userid, displayname) VALUES (?, ?)
                ON CONFLICT(userid) DO UPDATE SET displayname = excluded.displayname
                """,
                (userid, displayname),
            )
            self._conn.commit()

    def record_user_send(self, userid: int, displayname: str) -> None:
        """Register a meme send: refresh displayname and increment count."""
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO users (userid, displayname, count) VALUES (?, ?, 1)
                ON CONFLICT(userid) DO UPDATE SET
                    count = count + 1,
                    displayname = excluded.displayname
                """,
                (userid, displayname),
            )
            self._conn.commit()

    def is_user_approved(self, userid: int) -> bool:
        """Return whether the user is approved. Unknown users are not approved."""
        with self._lock:
            row = self._conn.execute(
                "SELECT approved FROM users WHERE userid = ?", (userid,)
            ).fetchone()
        return bool(row[0]) if row else False

    def get_all_users(self) -> list[tuple[int, str, bool, int]]:
        """Get all users as (userid, displayname, approved, count).

        Pending (unapproved) users come first, then by descending usage count.
        """
        with self._lock:
            rows = self._conn.execute(
                "SELECT userid, displayname, approved, count FROM users "
                "ORDER BY approved ASC, count DESC, userid ASC"
            ).fetchall()
        return [(row[0], row[1], bool(row[2]), row[3]) for row in rows]

    def get_top_users(self, limit: int = 3) -> list[tuple[str, int]]:
        """Get the most active users as (displayname, count), excluding inactive ones."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT displayname, count FROM users WHERE count > 0 "
                "ORDER BY count DESC, userid ASC LIMIT ?",
                (limit,),
            ).fetchall()
        return [(row[0], row[1]) for row in rows]

    def set_user_approved(self, userid: int, approved: bool) -> bool:
        """Set a user's approved flag. Returns True if a user row was updated."""
        with self._lock:
            cursor = self._conn.execute(
                "UPDATE users SET approved = ? WHERE userid = ?",
                (1 if approved else 0, userid),
            )
            self._conn.commit()
            return cursor.rowcount > 0
