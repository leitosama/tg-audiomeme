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

import pytest

import main
from tests.conftest import ADMIN_ID, USER_ID

Message = Callable[..., SimpleNamespace]
InlineQuery = Callable[..., SimpleNamespace]
ChosenInlineResult = Callable[..., SimpleNamespace]
CallbackQuery = Callable[..., SimpleNamespace]


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


def edited_texts(bot: MagicMock) -> list[str]:
    """Collect the text argument of every bot.edit_message_text call."""
    texts: list[str] = []
    for call in bot.edit_message_text.call_args_list:
        args, kwargs = call
        if args:
            texts.append(args[0])
        elif "text" in kwargs:
            texts.append(kwargs["text"])
    return texts


def markup_of(call: Any) -> Any:
    """Return the reply_markup passed to a mock call (positional or kwarg)."""
    _, kwargs = call
    return kwargs.get("reply_markup")


def buttons(markup: Any) -> list[tuple[str, str | None]]:
    """Flatten an InlineKeyboardMarkup into (text, callback_data) pairs."""
    pairs: list[tuple[str, str | None]] = []
    for row in markup.keyboard:
        for button in row:
            pairs.append((button.text, button.callback_data))
    return pairs


def media(file_id: str = "fid") -> SimpleNamespace:
    return SimpleNamespace(file_id=file_id)


def add_meme(
    db: main.AudioMemeDB, name: str, file_id: str, media_type: str, emoji: str = ""
) -> int:
    """Add a meme and return its id."""
    db.add_meme(name, file_id, media_type, emoji)
    meme = db.get_meme_by_name(name)
    assert meme is not None
    return meme.id


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


def test_add_admin_prompts_for_media(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_start(make_message(user_id=ADMIN_ID, chat_type="private"))
    assert "аудио или видео" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_media


def test_add_get_media_cancel_aborts(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(text="/cancel"))
    assert "Отменено" in sent_texts(env.bot)[0]
    env.bot.register_next_step_handler.assert_not_called()


def test_add_get_media_voice_asks_name(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(voice=media("voice-id")))
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_name
    assert args[2] == "voice-id"
    assert args[3] == "audio"


def test_add_get_media_audio(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(audio=media("audio-id")))
    args, _ = env.bot.register_next_step_handler.call_args
    assert (args[2], args[3]) == ("audio-id", "audio")


def test_add_get_media_video_note(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(video_note=media("vn-id")))
    args, _ = env.bot.register_next_step_handler.call_args
    assert (args[2], args[3]) == ("vn-id", "video")


def test_add_get_media_no_media_reprompts(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_media(make_message(text="not media"))
    assert "не аудио и не видео" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_media


def test_add_get_name_cancel_aborts(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_name(make_message(text=main.CANCEL_TEXT), "fid", "audio")
    assert "Отменено" in sent_texts(env.bot)[0]
    env.bot.register_next_step_handler.assert_not_called()


def test_add_get_name_rejects_non_text(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_name(make_message(text=None), "fid", "audio")
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_name


def test_add_get_name_rejects_too_long(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_name(make_message(text="x" * 101), "fid", "audio")
    assert "от 1 до" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_name


def test_add_get_name_accepts_free_form_name(env: SimpleNamespace, make_message: Message) -> None:
    # Spaces, Cyrillic and punctuation are now allowed (the old restriction is gone).
    main.add_meme_get_name(make_message(text="  Смешной звук!  "), "fid", "audio")
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_emoji
    assert args[2] == "fid"
    assert args[3] == "audio"
    assert args[4] == "Смешной звук!"  # trimmed


def test_add_get_name_rejects_duplicate(env: SimpleNamespace, make_message: Message) -> None:
    env.db.add_meme("dup", "old", "audio")
    main.add_meme_get_name(make_message(text="dup"), "fid", "audio")
    assert "уже существует" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.add_meme_get_name


def test_add_get_emoji_cancel_aborts(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_emoji(make_message(text="/cancel"), "fid", "audio", "name")
    assert "Отменено" in sent_texts(env.bot)[0]
    assert env.db.get_meme_by_name("name") is None


def test_add_get_emoji_saves_with_emoji(env: SimpleNamespace, make_message: Message) -> None:
    main.add_meme_get_emoji(make_message(text="😂"), "voice-id", "audio", "mymeme")
    assert env.db.get_meme_by_name("mymeme") == (1, "mymeme", "voice-id", "audio", "😂", 0)
    assert "добавлен" in sent_texts(env.bot)[0]


def test_add_get_emoji_skip_saves_without_emoji(
    env: SimpleNamespace, make_message: Message
) -> None:
    main.add_meme_get_emoji(make_message(text="/skip"), "voice-id", "audio", "mymeme")
    saved = env.db.get_meme_by_name("mymeme")
    assert saved is not None
    assert saved.emoji == ""


def test_add_get_emoji_duplicate_race(env: SimpleNamespace, make_message: Message) -> None:
    env.db.add_meme("dup", "old", "audio")
    main.add_meme_get_emoji(make_message(text="/skip"), "new", "audio", "dup")
    assert "уже существует" in sent_texts(env.bot)[0]
    # Original record unchanged.
    assert env.db.get_meme_by_name("dup") == (1, "dup", "old", "audio", "", 0)


# --- /list (management hub) ------------------------------------------------


def test_list_rejects_non_admin(env: SimpleNamespace, make_message: Message) -> None:
    main.list_memes(make_message(user_id=USER_ID))
    assert "Доступно только админу" in sent_texts(env.bot)[0]


def test_list_rejects_group_chat(env: SimpleNamespace, make_message: Message) -> None:
    main.list_memes(make_message(user_id=ADMIN_ID, chat_type="group"))
    assert "личные сообщения" in sent_texts(env.bot)[0]


def test_list_empty(env: SimpleNamespace, make_message: Message) -> None:
    main.list_memes(make_message(user_id=ADMIN_ID))
    assert "Нет сохраненных мемов" in sent_texts(env.bot)[0]


def test_list_with_memes_shows_buttons(env: SimpleNamespace, make_message: Message) -> None:
    add_meme(env.db, "alpha", "f1", "audio", "🎵")
    add_meme(env.db, "beta", "f2", "video")

    main.list_memes(make_message(user_id=ADMIN_ID))

    markup = markup_of(env.bot.send_message.call_args)
    labels = [text for text, _ in buttons(markup)]
    callbacks = [data for _, data in buttons(markup)]
    assert any("alpha" in label for label in labels)
    assert any("🎵" in label for label in labels)
    assert all(data is not None and data.startswith("meme:show:") for data in callbacks)


# --- meme management callbacks ---------------------------------------------


def test_meme_action_rejects_non_admin(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    add_meme(env.db, "alpha", "f1", "audio")
    main.on_meme_action(make_callback_query(user_id=USER_ID, data="meme:show:1"))
    env.bot.answer_callback_query.assert_called_once()
    env.bot.edit_message_text.assert_not_called()


def test_meme_show_sends_audio_preview_and_detail(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    meme_id = add_meme(env.db, "alpha", "voice-fid", "audio", "🎵")
    main.on_meme_action(make_callback_query(user_id=ADMIN_ID, data=f"meme:show:{meme_id}"))

    env.bot.send_voice.assert_called_once()
    args, _ = env.bot.send_voice.call_args
    assert args[1] == "voice-fid"
    # The list message is edited into the detail view with action buttons.
    markup = markup_of(env.bot.edit_message_text.call_args)
    callbacks = [data for _, data in buttons(markup)]
    assert f"meme:rename:{meme_id}" in callbacks
    assert f"meme:emoji:{meme_id}" in callbacks
    assert f"meme:del:{meme_id}" in callbacks
    assert "meme:list" in callbacks


def test_meme_show_sends_video_preview(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    meme_id = add_meme(env.db, "vid", "vn-fid", "video")
    main.on_meme_action(make_callback_query(user_id=ADMIN_ID, data=f"meme:show:{meme_id}"))
    env.bot.send_video_note.assert_called_once()
    args, _ = env.bot.send_video_note.call_args
    assert args[1] == "vn-fid"


def test_meme_show_missing_returns_to_list(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    main.on_meme_action(make_callback_query(user_id=ADMIN_ID, data="meme:show:999"))
    env.bot.answer_callback_query.assert_called_once()
    env.bot.edit_message_text.assert_called_once()


def test_meme_del_shows_confirmation(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio")
    main.on_meme_action(make_callback_query(user_id=ADMIN_ID, data=f"meme:del:{meme_id}"))

    assert "Удалить" in edited_texts(env.bot)[0]
    callbacks = [data for _, data in buttons(markup_of(env.bot.edit_message_text.call_args))]
    assert f"meme:delok:{meme_id}" in callbacks
    assert f"meme:show:{meme_id}" in callbacks  # the "Нет" path
    # Nothing deleted yet.
    assert env.db.get_meme_by_id(meme_id) is not None


def test_meme_delok_deletes(env: SimpleNamespace, make_callback_query: CallbackQuery) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio")
    main.on_meme_action(make_callback_query(user_id=ADMIN_ID, data=f"meme:delok:{meme_id}"))
    assert env.db.get_meme_by_id(meme_id) is None
    env.bot.edit_message_text.assert_called_once()  # back to list


def test_meme_rename_prompts_and_registers(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio")
    main.on_meme_action(make_callback_query(user_id=ADMIN_ID, data=f"meme:rename:{meme_id}"))
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.save_meme_name
    assert args[2] == meme_id


def test_meme_emoji_prompts_and_registers(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio")
    main.on_meme_action(make_callback_query(user_id=ADMIN_ID, data=f"meme:emoji:{meme_id}"))
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.save_meme_emoji
    assert args[2] == meme_id


def test_meme_list_back_renders_list(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    add_meme(env.db, "alpha", "f1", "audio")
    main.on_meme_action(make_callback_query(user_id=ADMIN_ID, data="meme:list"))
    env.bot.edit_message_text.assert_called_once()


# --- rename / emoji step handlers ------------------------------------------


def test_save_meme_name_cancel(env: SimpleNamespace, make_message: Message) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio")
    main.save_meme_name(make_message(text="/cancel"), meme_id)
    assert "Отменено" in sent_texts(env.bot)[0]
    assert env.db.get_meme_by_name("alpha") is not None


def test_save_meme_name_missing(env: SimpleNamespace, make_message: Message) -> None:
    main.save_meme_name(make_message(text="whatever"), 999)
    assert "не найден" in sent_texts(env.bot)[0]


def test_save_meme_name_rejects_empty(env: SimpleNamespace, make_message: Message) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio")
    main.save_meme_name(make_message(text="   "), meme_id)
    assert "от 1 до" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.save_meme_name


def test_save_meme_name_collision_reprompts(env: SimpleNamespace, make_message: Message) -> None:
    add_meme(env.db, "alpha", "f-a", "audio")
    beta_id = add_meme(env.db, "beta", "f-b", "audio")
    main.save_meme_name(make_message(text="alpha"), beta_id)
    assert "уже существует" in sent_texts(env.bot)[0]
    args, _ = env.bot.register_next_step_handler.call_args
    assert args[1] is main.save_meme_name


def test_save_meme_name_success(env: SimpleNamespace, make_message: Message) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio")
    main.save_meme_name(make_message(text="renamed"), meme_id)
    assert env.db.get_meme_by_name("alpha") is None
    assert env.db.get_meme_by_name("renamed") is not None
    assert "Переименован" in sent_texts(env.bot)[0]


def test_save_meme_emoji_cancel(env: SimpleNamespace, make_message: Message) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio", "🎵")
    main.save_meme_emoji(make_message(text="/cancel"), meme_id)
    assert "Отменено" in sent_texts(env.bot)[0]
    assert env.db.get_meme_by_id(meme_id).emoji == "🎵"  # type: ignore[union-attr]


def test_save_meme_emoji_missing(env: SimpleNamespace, make_message: Message) -> None:
    main.save_meme_emoji(make_message(text="😂"), 999)
    assert "не найден" in sent_texts(env.bot)[0]


def test_save_meme_emoji_sets(env: SimpleNamespace, make_message: Message) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio")
    main.save_meme_emoji(make_message(text="🔥"), meme_id)
    assert env.db.get_meme_by_id(meme_id).emoji == "🔥"  # type: ignore[union-attr]
    assert "Обновлено" in sent_texts(env.bot)[0]


def test_save_meme_emoji_skip_clears(env: SimpleNamespace, make_message: Message) -> None:
    meme_id = add_meme(env.db, "alpha", "f1", "audio", "🎵")
    main.save_meme_emoji(make_message(text="/skip"), meme_id)
    assert env.db.get_meme_by_id(meme_id).emoji == ""  # type: ignore[union-attr]


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


def test_query_meme_title_includes_emoji(
    env: SimpleNamespace, make_inline_query: InlineQuery
) -> None:
    env.db.add_meme("voicey", "voice-fid", "audio", "😂")
    main.query_meme(make_inline_query(query=""))
    args, _ = env.bot.answer_inline_query.call_args
    assert args[1][0].title == "😂 voicey"


def test_query_meme_search_filters_by_name(
    env: SimpleNamespace, make_inline_query: InlineQuery
) -> None:
    env.db.add_meme("alpha", "f-a", "audio")
    env.db.add_meme("beta", "f-b", "audio")
    main.query_meme(make_inline_query(query="alph"))
    args, _ = env.bot.answer_inline_query.call_args
    titles = [r.title for r in args[1]]
    assert titles == ["alpha"]


def test_query_meme_search_by_emoji(env: SimpleNamespace, make_inline_query: InlineQuery) -> None:
    env.db.add_meme("alpha", "f-a", "audio", "😂")
    env.db.add_meme("beta", "f-b", "audio", "😢")
    main.query_meme(make_inline_query(query="😂"))
    args, _ = env.bot.answer_inline_query.call_args
    titles = [r.title for r in args[1]]
    assert titles == ["😂 alpha"]


def test_query_meme_swallows_answer_failure(
    env: SimpleNamespace, make_inline_query: InlineQuery
) -> None:
    env.bot.answer_inline_query.side_effect = RuntimeError("telegram down")
    # The handler must log and not propagate the error.
    main.query_meme(make_inline_query())
    env.bot.answer_inline_query.assert_called_once()


def test_query_meme_not_personal_when_approval_off(
    env: SimpleNamespace, make_inline_query: InlineQuery
) -> None:
    env.db.add_meme("voicey", "voice-fid", "audio")
    main.query_meme(make_inline_query(query=""))
    _, kwargs = env.bot.answer_inline_query.call_args
    assert kwargs.get("is_personal") is False


def test_query_meme_orders_results_by_usage(
    env: SimpleNamespace, make_inline_query: InlineQuery
) -> None:
    env.db.add_meme("rarely", "f-rare", "audio")
    env.db.add_meme("often", "f-often", "audio")
    often_id = add_meme(env.db, "often2", "f-often2", "audio")
    env.db.increment_meme_count(often_id)

    main.query_meme(make_inline_query(query=""))

    args, _ = env.bot.answer_inline_query.call_args
    titles = [r.title for r in args[1]]
    # Most-used meme comes first.
    assert titles[0] == "often2"


# --- inline query: stats commands ------------------------------------------


def _article_text(result: Any) -> str:
    return str(result.input_message_content.message_text)


def test_query_meme_stats_lists_top_memes(
    env: SimpleNamespace, make_inline_query: InlineQuery
) -> None:
    a_id = add_meme(env.db, "a", "f-a", "audio")
    b_id = add_meme(env.db, "b", "f-b", "audio")
    env.db.increment_meme_count(a_id)
    env.db.increment_meme_count(a_id)
    env.db.increment_meme_count(b_id)

    main.query_meme(make_inline_query(query="stats"))

    args, kwargs = env.bot.answer_inline_query.call_args
    results = args[1]
    assert len(results) == 1
    assert type(results[0]).__name__ == "InlineQueryResultArticle"
    text = _article_text(results[0])
    assert "1. a — 2" in text
    assert "2. b — 1" in text
    assert kwargs.get("cache_time") == 0


def test_query_meme_stats_empty(env: SimpleNamespace, make_inline_query: InlineQuery) -> None:
    main.query_meme(make_inline_query(query="STATS"))  # case-insensitive
    args, _ = env.bot.answer_inline_query.call_args
    assert len(args[1]) == 1
    assert "Пока нет статистики" in _article_text(args[1][0])


def test_query_meme_userstats_lists_top_users(
    env: SimpleNamespace, make_inline_query: InlineQuery
) -> None:
    env.db.record_user_send(1, "Alice")
    env.db.record_user_send(1, "Alice")
    env.db.record_user_send(2, "Bob")

    main.query_meme(make_inline_query(query="  userstats  "))  # trimmed

    args, _ = env.bot.answer_inline_query.call_args
    results = args[1]
    assert len(results) == 1
    text = _article_text(results[0])
    assert "1. Alice — 2" in text
    assert "2. Bob — 1" in text


# --- inline query: approval gate -------------------------------------------


def test_query_meme_unapproved_shows_pending_message(
    env: SimpleNamespace, make_inline_query: InlineQuery, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "REQUIRE_APPROVAL", True)
    env.db.add_meme("voicey", "voice-fid", "audio")

    main.query_meme(make_inline_query(user_id=USER_ID, first_name="Pending"))

    args, kwargs = env.bot.answer_inline_query.call_args
    results = args[1]
    assert len(results) == 1
    assert type(results[0]).__name__ == "InlineQueryResultArticle"
    assert results[0].title == main.APPROVAL_PENDING_TEXT
    assert kwargs.get("is_personal") is True
    assert kwargs.get("cache_time") == 0
    # The user is registered (pending) so the admin can approve them.
    assert env.db.get_all_users() == [(USER_ID, "Pending", False, 0)]


def test_query_meme_approved_user_gets_memes(
    env: SimpleNamespace, make_inline_query: InlineQuery, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "REQUIRE_APPROVAL", True)
    env.db.add_meme("voicey", "voice-fid", "audio")
    env.db.register_user(USER_ID, "Approved")
    env.db.set_user_approved(USER_ID, True)

    main.query_meme(make_inline_query(user_id=USER_ID))

    args, kwargs = env.bot.answer_inline_query.call_args
    assert len(args[1]) == 1
    assert type(args[1][0]).__name__ == "InlineQueryResultCachedVoice"
    assert kwargs.get("is_personal") is True
    assert kwargs.get("cache_time") == 300


# --- chosen inline result (send counting) ----------------------------------


def test_count_meme_send_records_usage(
    env: SimpleNamespace, make_chosen_inline_result: ChosenInlineResult
) -> None:
    main.count_meme_send(make_chosen_inline_result(user_id=USER_ID, first_name="Sender"))
    assert env.db.get_all_users() == [(USER_ID, "Sender", False, 1)]


def test_count_meme_send_increments(
    env: SimpleNamespace, make_chosen_inline_result: ChosenInlineResult
) -> None:
    main.count_meme_send(make_chosen_inline_result(user_id=USER_ID, first_name="Sender"))
    main.count_meme_send(make_chosen_inline_result(user_id=USER_ID, first_name="Renamed"))
    assert env.db.get_all_users() == [(USER_ID, "Renamed", False, 2)]


def test_count_meme_send_increments_meme_count(
    env: SimpleNamespace, make_chosen_inline_result: ChosenInlineResult
) -> None:
    meme_id = add_meme(env.db, "alpha", "f-a", "audio")

    main.count_meme_send(
        make_chosen_inline_result(result_id=str(meme_id), user_id=USER_ID, first_name="Sender")
    )

    assert env.db.get_top_memes() == [("alpha", 1)]
    assert env.db.get_all_users() == [(USER_ID, "Sender", False, 1)]


def test_count_meme_send_ignores_non_meme_result(
    env: SimpleNamespace, make_chosen_inline_result: ChosenInlineResult
) -> None:
    # Choosing a leaderboard article must not count as a meme send.
    main.count_meme_send(
        make_chosen_inline_result(result_id="stats", user_id=USER_ID, first_name="Sender")
    )
    assert env.db.get_all_users() == []
    assert env.db.get_top_memes() == []


# --- /users -----------------------------------------------------------------


def test_users_rejects_non_admin(env: SimpleNamespace, make_message: Message) -> None:
    main.list_users(make_message(user_id=USER_ID))
    assert "Доступно только админу" in sent_texts(env.bot)[0]


def test_users_rejects_group_chat(env: SimpleNamespace, make_message: Message) -> None:
    main.list_users(make_message(user_id=ADMIN_ID, chat_type="group"))
    assert "личные сообщения" in sent_texts(env.bot)[0]


def test_users_empty(env: SimpleNamespace, make_message: Message) -> None:
    main.list_users(make_message(user_id=ADMIN_ID))
    assert "Нет пользователей" in sent_texts(env.bot)[0]


def test_users_lists_with_buttons(env: SimpleNamespace, make_message: Message) -> None:
    env.db.register_user(111, "Alice")
    env.db.record_user_send(222, "Bob")
    env.db.set_user_approved(222, True)

    main.list_users(make_message(user_id=ADMIN_ID))

    _, kwargs = env.bot.send_message.call_args
    text = sent_texts(env.bot)[0]
    assert "Alice" in text and "Bob" in text
    assert kwargs.get("reply_markup") is not None


# --- approve/revoke callbacks ----------------------------------------------


def test_on_user_action_rejects_non_admin(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    env.db.register_user(111, "Alice")
    main.on_user_action(make_callback_query(user_id=USER_ID, data="user:approve:111"))
    assert env.db.is_user_approved(111) is False
    env.bot.answer_callback_query.assert_called_once()


def test_on_user_action_approves_and_refreshes(
    env: SimpleNamespace, make_callback_query: CallbackQuery
) -> None:
    env.db.register_user(111, "Alice")
    main.on_user_action(make_callback_query(user_id=ADMIN_ID, data="user:approve:111"))

    assert env.db.is_user_approved(111) is True
    env.bot.answer_callback_query.assert_called_once()
    env.bot.edit_message_text.assert_called_once()


def test_on_user_action_revokes(env: SimpleNamespace, make_callback_query: CallbackQuery) -> None:
    env.db.register_user(111, "Alice")
    env.db.set_user_approved(111, True)
    main.on_user_action(make_callback_query(user_id=ADMIN_ID, data="user:revoke:111"))
    assert env.db.is_user_approved(111) is False
