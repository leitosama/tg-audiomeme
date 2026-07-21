"""Tests for the main() entry point: config validation and startup."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

import main


def test_main_exits_without_token(monkeypatch: pytest.MonkeyPatch, bot: MagicMock) -> None:
    monkeypatch.setattr(main, "TOKEN", "")
    monkeypatch.setattr(main, "ADMIN_ID", 123)
    with pytest.raises(SystemExit) as exc:
        main.main()
    assert exc.value.code == 1
    bot.infinity_polling.assert_not_called()


def test_main_exits_without_admin(monkeypatch: pytest.MonkeyPatch, bot: MagicMock) -> None:
    monkeypatch.setattr(main, "TOKEN", "123:abc")
    monkeypatch.setattr(main, "ADMIN_ID", 0)
    with pytest.raises(SystemExit) as exc:
        main.main()
    assert exc.value.code == 1
    bot.infinity_polling.assert_not_called()


def test_main_starts_polling(monkeypatch: pytest.MonkeyPatch, bot: MagicMock) -> None:
    monkeypatch.setattr(main, "TOKEN", "123:abc")
    monkeypatch.setattr(main, "ADMIN_ID", 123)
    monkeypatch.setattr(main, "TG_API_URL", "")
    main.main()
    bot.infinity_polling.assert_called_once()
    kwargs = bot.infinity_polling.call_args.kwargs
    # Read timeout must exceed the long-poll hold so empty polls aren't cut off.
    assert kwargs["timeout"] > kwargs["long_polling_timeout"]
    assert kwargs["allowed_updates"] == main.ALLOWED_UPDATES
    assert kwargs["skip_pending"] is True


def test_main_read_timeout_kept_above_long_poll(
    monkeypatch: pytest.MonkeyPatch, bot: MagicMock
) -> None:
    """A read timeout <= the long-poll hold is bumped so empty polls aren't cut off."""
    monkeypatch.setattr(main, "TOKEN", "123:abc")
    monkeypatch.setattr(main, "ADMIN_ID", 123)
    monkeypatch.setattr(main, "TG_API_URL", "")
    monkeypatch.setattr(main, "TG_API_TIMEOUT", 25)
    monkeypatch.setattr(main, "TG_LONG_POLL_TIMEOUT", 25)
    main.main()
    kwargs = bot.infinity_polling.call_args.kwargs
    assert kwargs["long_polling_timeout"] == 25
    assert kwargs["timeout"] > 25


def test_main_sets_custom_api_url(monkeypatch: pytest.MonkeyPatch, bot: MagicMock) -> None:
    monkeypatch.setattr(main, "TOKEN", "123:abc")
    monkeypatch.setattr(main, "ADMIN_ID", 123)
    monkeypatch.setattr(main, "TG_API_URL", "https://example.test/bot")
    monkeypatch.setattr(main.apihelper, "API_URL", None)
    main.main()
    assert main.apihelper.API_URL == "https://example.test/bot"
    bot.infinity_polling.assert_called_once()
