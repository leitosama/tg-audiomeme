"""Tests for the bot command and inline-query handlers.

The module-level ``bot`` is replaced with a mock (see the ``env`` fixture), so these
tests exercise handler *logic* — authorization, validation, branching, and DB writes —
without touching the Telegram API.
"""

from __future__ import annotations

from collections.abc import Callable
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import main
from tests.conftest import ADMIN_ID, USER_ID

Message = Callable[..., SimpleNamespace]
InlineQuery = Callable[..., SimpleNamespace]


def sent_texts(bot: MagicMock) -> list[str]:
    """Collect the text argument of every bot.send_message call."""
    texts: list[str] = []
    for call in bot.send_message.call_args_list:
        args, kwargs = call
        if len(args) >= 2:
            texts.append(args[1])
        elif "text" in kwargs:
            texts.append(kwargs["text"])
    return texts


def media(file_id: str = "fid") -> SimpleNamespace:
    return SimpleNamespace(file_id=file_id)


# --- /start ----------------------------------------------------------------


def test_start_admin_shows_keyboard(env: SimpleNamespace, make_message: Message) -> None:
    main.start(make_message(user_id=ADMIN_ID, chat_type="private"))

    _, kwargs = env.bot.send_message.call_args
    assert "админ" in sent_texts(env.bot)[0]
    assert kwargs.get("reply_markup") is not None


def test_start_non_admin_private_no_keyboard(env: SimpleNamespace, make_message: Message) -> None:
    main.start(make_message(user_id=USER_ID, chat_type="private"))

    _, kwargs = env.bot.send_message.call_args
    assert "inline query" in sent_texts(env.bot)[0]
    assert kwargs.get("reply_markup") is None


def test_start_group_chat(env: SimpleNamespace, make_message: Message) -> None:
    main.start(make_message(user_id=USER_ID, chat_type="group"))
    assert "этом чате" in sent_texts(env.bot)[0]


# --- /add ------------------------------------------------------------------


def test_add_rejects_non_admin(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_start(make_message(user_id=USER_ID))
    assert "Доступно только админу" in sent_texts(env.bot)[0]
    env.bot.register_next_step_handler.assert_not_called()


def test_add_rejects_group_chat(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_start(make_message(user_id=ADMIN_ID, chat_type="group"))
    assert "личные сообщения" in sent_texts(env.bot)[0]
    env.bot.register_next_step_handler.assert_not_called()


def test_add_admin_prompts_for_name(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_start(make_message(user_id=ADMIN_ID, chat_type="private"))
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_media


def test_add_get_media_rejects_non_text(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(text=None))
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_media  # re-prompts for the name


def test_add_get_media_rejects_long_name(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(text="x" * 51))
    assert "максимум 50" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_media


def test_add_get_media_rejects_invalid_chars(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(text="bad name!"))
    assert "латиницу" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_media


def test_add_get_media_accepts_valid_name(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(text="  good_name  "))
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_save
    assert args[2] == "good_name"  # trimmed


def test_add_save_voice(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_save(make_message(voice=media("voice-id")), "mymeme")
    assert env.db.get_meme_by_name("mymeme") == (1, "mymeme", "voice-id", "audio")
    assert "добавлен" in sent_texts(env.bot)[0]


def test_add_save_audio(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_save(make_message(audio=media("audio-id")), "song")
    assert env.db.get_meme_by_name("song") == (1, "song", "audio-id", "audio")


def test_add_save_video_note(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_save(make_message(video_note=media("vn-id")), "circle")
    assert env.db.get_meme_by_name("circle") == (1, "circle", "vn-id", "video")


def test_add_save_no_media_reprompts(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_save(make_message(text="not media"), "x")
    assert "не аудио и не видео" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_save


def test_add_save_duplicate(env: SimpleNamespace, make_message: Message) -> None:
    env.db.add_meme("dup", "old", "audio")
    main.add_meme_save(make_message(voice=media("new")), "dup")
    assert "уже существует" in sent_texts(env.bot)[0]
    # Original record unchanged.
    assert env.db.get_meme_by_name("dup") == (1, "dup", "old", "audio")


# --- /list -----------------------------------------------------------------


def test_list_rejects_non_admin(env: SimpleNamespace, make_message: Message) -> None:
    main.list_memes(make_message(user_id=USER_ID))
    assert "Доступно только админу" in sent_texts(env.bot)[0]


def test_list_empty(env: SimpleNamespace, make_message: Message) -> None:
    main.list_memes(make_message(user_id=ADMIN_ID))
    assert "Нет сохраненных мемов" in sent_texts(env.bot)[0]


def test_list_with_memes(env: SimpleNamespace, make_message: Message) -> None:
    env.db.add_meme("alpha", "f1", "audio")
    env.db.add_meme("beta", "f2", "video")
    main.list_memes(make_message(user_id=ADMIN_ID))

    text = sent_texts(env.bot)[0]
    assert "alpha" in text and "beta" in text
    assert "🎵" in text and "🎬" in text


# --- /delete ---------------------------------------------------------------


def test_delete_rejects_non_admin(env: SimpleNamespace, make_message: Message) -> None:
    main.delete_meme_start(make_message(user_id=USER_ID))
    assert "Доступно только админу" in sent_texts(env.bot)[0]


def test_delete_start_empty(env: SimpleNamespace, make_message: Message) -> None:
    main.delete_meme_start(make_message(user_id=ADMIN_ID))
    assert "Нет сохраненных мемов" in sent_texts(env.bot)[0]
    env.bot.register_next_step_handler.assert_not_called()


def test_delete_start_with_memes(env: SimpleNamespace, make_message: Message) -> None:
    env.db.add_meme("alpha", "f1", "audio")
    main.delete_meme_start(make_message(user_id=ADMIN_ID))
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.delete_meme_confirm


def test_delete_confirm_existing(env: SimpleNamespace, make_message: Message) -> None:
    env.db.add_meme("alpha", "f1", "audio")
    main.delete_meme_confirm(make_message(text="alpha"))
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.delete_meme_final
    assert args[2] == "alpha"


def test_delete_confirm_missing(env: SimpleNamespace, make_message: Message) -> None:
    main.delete_meme_confirm(make_message(text="ghost"))
    assert "Мем не найден" in sent_texts(env.bot)[0]
    env.bot.register_next_step_handler.assert_not_called()


def test_delete_confirm_non_text(env: SimpleNamespace, make_message: Message) -> None:
    main.delete_meme_confirm(make_message(text=None))
    assert "Мем не найден" in sent_texts(env.bot)[0]


def test_delete_final_confirmed(env: SimpleNamespace, make_message: Message) -> None:
    env.db.add_meme("alpha", "f1", "audio")
    main.delete_meme_final(make_message(text="✅ Да"), "alpha")
    assert env.db.get_meme_by_name("alpha") is None
    assert "удален" in sent_texts(env.bot)[0]


def test_delete_final_cancelled(env: SimpleNamespace, make_message: Message) -> None:
    env.db.add_meme("alpha", "f1", "audio")
    main.delete_meme_final(make_message(text="❌ Нет"), "alpha")
    assert env.db.get_meme_by_name("alpha") is not None
    assert "Отмено" in sent_texts(env.bot)[0]


# --- inline query ----------------------------------------------------------


def test_query_meme_builds_results(env: SimpleNamespace, make_inline_query: InlineQuery) -> None:
    env.db.add_meme("voicey", "voice-fid", "audio")
    env.db.add_meme("videoy", "video-fid", "video")

    main.query_meme(make_inline_query(query=""))

    env.bot.answer_inline_query.assert_called_once()
    args, kwargs = env.bot.answer_inline_query.call_args
    assert args[0] == "iq-1"  # inline_query id
    results: list[Any] = args[1]
    assert len(results) == 2
    type_names = {type(r).__name__ for r in results}
    assert type_names == {
        "InlineQueryResultCachedVoice",
        "InlineQueryResultCachedVideo",
    }
    assert kwargs.get("cache_time") == 300


def test_query_meme_empty_db(env: SimpleNamespace, make_inline_query: InlineQuery) -> None:
    main.query_meme(make_inline_query())
    args, _ = env.bot.answer_inline_query.call_args
    assert args[1] == []


def test_query_meme_swallows_answer_failure(
    env: SimpleNamespace, make_inline_query: InlineQuery
) -> None:
    env.bot.answer_inline_query.side_effect = RuntimeError("telegram down")
    # The handler must log and not propagate the error.
    main.query_meme(make_inline_query())
    env.bot.answer_inline_query.assert_called_once()
