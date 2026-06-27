"""Unit tests for the AudioMemeDB SQLite layer."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import main


def test_init_creates_parent_directory(tmp_path: Path) -> None:
    nested = tmp_path / "deep" / "nested" / "memes.db"
    main.AudioMemeDB(str(nested))
    assert nested.parent.is_dir()


def test_add_and_get_meme(db: main.AudioMemeDB) -> None:
    assert db.add_meme("alpha", "file-1", "audio") is True
    # A new meme has no emoji and a zero usage count by default.
    assert db.get_meme_by_name("alpha") == (1, "alpha", "file-1", "audio", "", 0)


def test_add_meme_with_emoji(db: main.AudioMemeDB) -> None:
    assert db.add_meme("alpha", "file-1", "audio", "😂") is True
    assert db.get_meme_by_name("alpha") == (1, "alpha", "file-1", "audio", "😂", 0)


def test_add_free_form_name(db: main.AudioMemeDB) -> None:
    # Spaces, Cyrillic and punctuation are all allowed now.
    assert db.add_meme("Смешной звук!", "file-1", "audio") is True
    assert db.get_meme_by_name("Смешной звук!") is not None


def test_add_duplicate_name_rejected(db: main.AudioMemeDB) -> None:
    assert db.add_meme("alpha", "file-1", "audio") is True
    # Same name, even with a different file_id, must be rejected.
    assert db.add_meme("alpha", "file-2", "video") is False
    # Original record is untouched.
    assert db.get_meme_by_name("alpha") == (1, "alpha", "file-1", "audio", "", 0)


def test_get_meme_by_name_missing_returns_none(db: main.AudioMemeDB) -> None:
    assert db.get_meme_by_name("does-not-exist") is None


def test_get_meme_by_id(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "file-1", "audio", "🎵")
    meme = db.get_meme_by_name("alpha")
    assert meme is not None
    assert db.get_meme_by_id(meme.id) == meme


def test_get_meme_by_id_missing_returns_none(db: main.AudioMemeDB) -> None:
    assert db.get_meme_by_id(404) is None


def test_get_all_memes_ordered_by_name(db: main.AudioMemeDB) -> None:
    db.add_meme("gamma", "f-g", "audio")
    db.add_meme("alpha", "f-a", "video")
    db.add_meme("beta", "f-b", "audio")

    names = [meme.name for meme in db.get_all_memes()]
    assert names == ["alpha", "beta", "gamma"]


def test_get_all_memes_empty(db: main.AudioMemeDB) -> None:
    assert db.get_all_memes() == []


def test_delete_meme_by_id(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "file-1", "audio")
    meme = db.get_meme_by_name("alpha")
    assert meme is not None
    assert db.delete_meme_by_id(meme.id) is True
    assert db.get_meme_by_name("alpha") is None


def test_delete_missing_meme_returns_false(db: main.AudioMemeDB) -> None:
    assert db.delete_meme_by_id(404) is False


def test_update_meme_name(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "file-1", "audio")
    meme = db.get_meme_by_name("alpha")
    assert meme is not None
    assert db.update_meme_name(meme.id, "renamed") is True
    assert db.get_meme_by_name("alpha") is None
    assert db.get_meme_by_name("renamed") is not None


def test_update_meme_name_collision_returns_false(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "f-a", "audio")
    db.add_meme("beta", "f-b", "audio")
    beta = db.get_meme_by_name("beta")
    assert beta is not None
    # Renaming beta to an existing name must fail and leave it unchanged.
    assert db.update_meme_name(beta.id, "alpha") is False
    assert db.get_meme_by_name("beta") is not None


def test_update_meme_emoji(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "file-1", "audio")
    meme = db.get_meme_by_name("alpha")
    assert meme is not None
    db.update_meme_emoji(meme.id, "🔥")
    assert db.get_meme_by_id(meme.id) == (meme.id, "alpha", "file-1", "audio", "🔥", 0)
    # An empty string clears the emoji.
    db.update_meme_emoji(meme.id, "")
    refreshed = db.get_meme_by_id(meme.id)
    assert refreshed is not None
    assert refreshed.emoji == ""


def test_persistence_across_instances(db_path: str) -> None:
    first = main.AudioMemeDB(db_path)
    first.add_meme("alpha", "file-1", "audio")

    # A new instance pointed at the same file must see the data.
    second = main.AudioMemeDB(db_path)
    assert second.get_meme_by_name("alpha") == (1, "alpha", "file-1", "audio", "", 0)


def test_migrates_legacy_memes_table(db_path: str) -> None:
    # Simulate a pre-existing DB created before the count/emoji columns existed.
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE memes ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, "
        "file_id TEXT NOT NULL, media_type TEXT NOT NULL, "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )
    conn.execute("INSERT INTO memes (name, file_id, media_type) VALUES ('old', 'f-old', 'audio')")
    conn.commit()
    conn.close()

    # Opening the DB runs init_db, which must add the missing count + emoji columns.
    db = main.AudioMemeDB(db_path)
    old = db.get_meme_by_name("old")
    assert old == (1, "old", "f-old", "audio", "", 0)
    db.increment_meme_count(old.id)  # type: ignore[union-attr]
    assert db.get_top_memes() == [("old", 1)]


# --- meme search -----------------------------------------------------------


def test_search_memes_by_name_case_insensitive(db: main.AudioMemeDB) -> None:
    db.add_meme("Смешной звук", "f-1", "audio")
    db.add_meme("Грустный", "f-2", "audio")
    names = [meme.name for meme in db.search_memes("смеш")]
    assert names == ["Смешной звук"]


def test_search_memes_by_emoji(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "f-1", "audio", "😂")
    db.add_meme("beta", "f-2", "audio", "😢")
    names = [meme.name for meme in db.search_memes("😂")]
    assert names == ["alpha"]


def test_search_memes_empty_query_returns_all_by_usage(db: main.AudioMemeDB) -> None:
    db.add_meme("rarely", "f-r", "audio")
    db.add_meme("often", "f-o", "audio")
    often = db.get_meme_by_name("often")
    db.increment_meme_count(often.id)  # type: ignore[union-attr]
    names = [meme.name for meme in db.search_memes("")]
    assert names == ["often", "rarely"]


def test_search_memes_no_match(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "f-1", "audio")
    assert db.search_memes("zzz") == []


# --- meme usage stats ------------------------------------------------------


def test_new_meme_starts_with_zero_count(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "file-1", "audio")
    # A brand new meme has no usage and so never appears in the leaderboard.
    assert db.get_top_memes() == []


def test_increment_meme_count(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "file-1", "audio")
    meme = db.get_meme_by_name("alpha")
    db.increment_meme_count(meme.id)  # type: ignore[union-attr]
    db.increment_meme_count(meme.id)  # type: ignore[union-attr]
    assert db.get_top_memes() == [("alpha", 2)]


def test_get_memes_by_usage_orders_by_count_then_name(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "f-a", "audio")
    db.add_meme("beta", "f-b", "video")
    db.add_meme("gamma", "f-g", "audio")
    beta = db.get_meme_by_name("beta")
    db.increment_meme_count(beta.id)  # type: ignore[union-attr]

    # beta (count 1) first; alpha/gamma (count 0) follow alphabetically.
    names = [meme.name for meme in db.get_memes_by_usage()]
    assert names == ["beta", "alpha", "gamma"]


def test_get_top_memes_limit_and_excludes_zero(db: main.AudioMemeDB) -> None:
    for name in ("a", "b", "c", "d"):
        db.add_meme(name, f"f-{name}", "audio")
    # a:3, b:2, c:1, d:0
    for name, hits in (("a", 3), ("b", 2), ("c", 1)):
        meme = db.get_meme_by_name(name)
        for _ in range(hits):
            db.increment_meme_count(meme.id)  # type: ignore[union-attr]

    assert db.get_top_memes() == [("a", 3), ("b", 2), ("c", 1)]
    assert db.get_top_memes(limit=2) == [("a", 3), ("b", 2)]


# --- users -----------------------------------------------------------------


def test_register_user_creates_unapproved(db: main.AudioMemeDB) -> None:
    db.register_user(42, "Alice")
    assert db.get_all_users() == [(42, "Alice", False, 0)]
    assert db.is_user_approved(42) is False


def test_register_user_refreshes_displayname(db: main.AudioMemeDB) -> None:
    db.register_user(42, "Alice")
    db.register_user(42, "Alice Renamed")
    assert db.get_all_users() == [(42, "Alice Renamed", False, 0)]


def test_register_user_preserves_count_and_approval(db: main.AudioMemeDB) -> None:
    db.record_user_send(42, "Alice")
    db.set_user_approved(42, True)
    # Re-registering must not reset count or approval.
    db.register_user(42, "Alice")
    assert db.get_all_users() == [(42, "Alice", True, 1)]


def test_record_user_send_inserts_with_count_one(db: main.AudioMemeDB) -> None:
    db.record_user_send(42, "Alice")
    assert db.get_all_users() == [(42, "Alice", False, 1)]


def test_record_user_send_increments_and_refreshes_name(db: main.AudioMemeDB) -> None:
    db.record_user_send(42, "Alice")
    db.record_user_send(42, "Alice2")
    db.record_user_send(42, "Alice3")
    assert db.get_all_users() == [(42, "Alice3", False, 3)]


def test_is_user_approved_unknown_is_false(db: main.AudioMemeDB) -> None:
    assert db.is_user_approved(999) is False


def test_set_user_approved_toggles(db: main.AudioMemeDB) -> None:
    db.register_user(42, "Alice")
    assert db.set_user_approved(42, True) is True
    assert db.is_user_approved(42) is True
    assert db.set_user_approved(42, False) is True
    assert db.is_user_approved(42) is False


def test_set_user_approved_missing_returns_false(db: main.AudioMemeDB) -> None:
    assert db.set_user_approved(404, True) is False


def test_get_all_users_orders_pending_first_then_count(db: main.AudioMemeDB) -> None:
    db.record_user_send(1, "low")  # approved, count 1
    db.set_user_approved(1, True)
    db.record_user_send(2, "highpending")  # pending, count 1
    db.record_user_send(2, "highpending")  # pending, count 2
    db.register_user(3, "zeropending")  # pending, count 0

    order = [row[0] for row in db.get_all_users()]
    # Pending users first (ordered by count desc), approved users last.
    assert order == [2, 3, 1]


def test_get_all_users_empty(db: main.AudioMemeDB) -> None:
    assert db.get_all_users() == []


def test_get_top_users_orders_by_count_excludes_zero_and_limits(db: main.AudioMemeDB) -> None:
    db.register_user(10, "idle")  # count 0 -> excluded
    for _ in range(3):
        db.record_user_send(1, "Alice")  # count 3
    db.record_user_send(2, "Bob")  # count 1
    for _ in range(2):
        db.record_user_send(3, "Carol")  # count 2

    assert db.get_top_users() == [("Alice", 3), ("Carol", 2), ("Bob", 1)]
    assert db.get_top_users(limit=2) == [("Alice", 3), ("Carol", 2)]
