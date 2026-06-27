"""Shared pytest fixtures for tg-audiomeme tests."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

import main

ADMIN_ID = 12345
USER_ID = 67890


@pytest.fixture
def db_path(tmp_path: Path) -> str:
    """A filesystem path for a throwaway SQLite database."""
    return str(tmp_path / "test_memes.db")


@pytest.fixture
def db(db_path: str) -> main.AudioMemeDB:
    """A fresh AudioMemeDB backed by a temp file."""
    return main.AudioMemeDB(db_path)


@pytest.fixture
def bot(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Replace the module-level bot with a mock and return it."""
    mock_bot = MagicMock(name="bot")
    monkeypatch.setattr(main, "bot", mock_bot)
    return mock_bot


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, bot: MagicMock, db: main.AudioMemeDB) -> SimpleNamespace:
    """Wire mocked bot + temp db + known ADMIN_ID into the main module."""
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "ADMIN_ID", ADMIN_ID)
    return SimpleNamespace(bot=bot, db=db, admin_id=ADMIN_ID)


@pytest.fixture
def make_message() -> Callable[..., SimpleNamespace]:
    """Factory building fake telebot Message objects.

    All media attributes default to None so handlers see "no media" unless set.
    """

    def _make(
        text: str | None = None,
        chat_type: str = "private",
        user_id: int = ADMIN_ID,
        first_name: str = "Tester",
        chat_id: int = 999,
        voice: Any = None,
        audio: Any = None,
        video_note: Any = None,
        video: Any = None,
    ) -> SimpleNamespace:
        return SimpleNamespace(
            text=text,
            chat=SimpleNamespace(id=chat_id, type=chat_type),
            from_user=SimpleNamespace(id=user_id, first_name=first_name),
            voice=voice,
            audio=audio,
            video_note=video_note,
            video=video,
        )

    return _make


@pytest.fixture
def make_inline_query() -> Callable[..., SimpleNamespace]:
    """Factory building fake telebot InlineQuery objects."""

    def _make(
        query: str = "",
        query_id: str = "iq-1",
        user_id: int = USER_ID,
        first_name: str = "Tester",
    ) -> SimpleNamespace:
        return SimpleNamespace(
            id=query_id,
            query=query,
            from_user=SimpleNamespace(id=user_id, first_name=first_name),
        )

    return _make


@pytest.fixture
def make_chosen_inline_result() -> Callable[..., SimpleNamespace]:
    """Factory building fake telebot ChosenInlineResult objects."""

    def _make(
        result_id: str = "1",
        user_id: int = USER_ID,
        first_name: str = "Tester",
        query: str = "",
    ) -> SimpleNamespace:
        return SimpleNamespace(
            result_id=result_id,
            query=query,
            from_user=SimpleNamespace(id=user_id, first_name=first_name),
        )

    return _make


@pytest.fixture
def make_callback_query() -> Callable[..., SimpleNamespace]:
    """Factory building fake telebot CallbackQuery objects."""

    def _make(
        data: str = "",
        call_id: str = "cb-1",
        user_id: int = ADMIN_ID,
        first_name: str = "Tester",
        chat_id: int = 999,
        message_id: int = 555,
    ) -> SimpleNamespace:
        return SimpleNamespace(
            id=call_id,
            data=data,
            from_user=SimpleNamespace(id=user_id, first_name=first_name),
            message=SimpleNamespace(
                message_id=message_id,
                chat=SimpleNamespace(id=chat_id, type="private"),
            ),
        )

    return _make
