"""Unit tests for the AudioMemeDB SQLite layer."""

from __future__ import annotations

from pathlib import Path

import main


def test_init_creates_parent_directory(tmp_path: Path) -> None:
    nested = tmp_path / "deep" / "nested" / "memes.db"
    main.AudioMemeDB(str(nested))
    assert nested.parent.is_dir()


def test_add_and_get_meme(db: main.AudioMemeDB) -> None:
    assert db.add_meme("alpha", "file-1", "audio") is True
    assert db.get_meme_by_name("alpha") == (1, "alpha", "file-1", "audio")


def test_add_duplicate_name_rejected(db: main.AudioMemeDB) -> None:
    assert db.add_meme("alpha", "file-1", "audio") is True
    # Same name, even with a different file_id, must be rejected.
    assert db.add_meme("alpha", "file-2", "video") is False
    # Original record is untouched.
    assert db.get_meme_by_name("alpha") == (1, "alpha", "file-1", "audio")


def test_get_meme_by_name_missing_returns_none(db: main.AudioMemeDB) -> None:
    assert db.get_meme_by_name("does-not-exist") is None


def test_get_all_memes_ordered_by_name(db: main.AudioMemeDB) -> None:
    db.add_meme("gamma", "f-g", "audio")
    db.add_meme("alpha", "f-a", "video")
    db.add_meme("beta", "f-b", "audio")

    names = [row[1] for row in db.get_all_memes()]
    assert names == ["alpha", "beta", "gamma"]


def test_get_all_memes_empty(db: main.AudioMemeDB) -> None:
    assert db.get_all_memes() == []


def test_delete_meme(db: main.AudioMemeDB) -> None:
    db.add_meme("alpha", "file-1", "audio")
    assert db.delete_meme("alpha") is True
    assert db.get_meme_by_name("alpha") is None


def test_delete_missing_meme_returns_false(db: main.AudioMemeDB) -> None:
    assert db.delete_meme("nope") is False


def test_persistence_across_instances(db_path: str) -> None:
    first = main.AudioMemeDB(db_path)
    first.add_meme("alpha", "file-1", "audio")

    # A new instance pointed at the same file must see the data.
    second = main.AudioMemeDB(db_path)
    assert second.get_meme_by_name("alpha") == (1, "alpha", "file-1", "audio")


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
