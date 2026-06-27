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
