import logging
import os
import subprocess
import sys
import tempfile
import threading
from collections import deque
from pathlib import Path

import telebot
from telebot import apihelper, types

from db import AudioMemeDB, Meme

# Configuration
TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID") or "0")
DB_PATH = os.environ.get("DB_PATH", "./db/audio_meme.db")
TG_API_URL = os.environ.get("TG_API_URL", "")
# Socket read timeout for Telegram API calls, incl. the getUpdates long-poll. Kept
# modest so a *stalled* poll is abandoned and retried on a fresh connection within
# seconds, rather than blocking update delivery for the whole window.
TG_API_TIMEOUT = int(os.environ.get("TG_API_TIMEOUT", "30"))
# Server-side long-poll hold for getUpdates. Must stay below TG_API_TIMEOUT so a
# normal empty long-poll isn't cut off by the socket read timeout.
TG_LONG_POLL_TIMEOUT = int(os.environ.get("TG_LONG_POLL_TIMEOUT", "25"))
# Root log level; default INFO. Set to DEBUG to see telebot's per-request logging.
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
# When true, only users with approved=true may use inline queries to send memes.
# When false, the approved column is ignored and everyone may use the bot.
REQUIRE_APPROVAL = os.environ.get("REQUIRE_APPROVAL") == "true"

# Update types the bot actually handles. Passed to getUpdates so Telegram neither
# queues nor makes us fetch update types we ignore (edited messages, polls, etc.).
ALLOWED_UPDATES = ["message", "callback_query", "inline_query", "chosen_inline_result"]

# Limits / sentinels for the admin conversation flows.
MAX_NAME_LENGTH = 100
MAX_EMOJI_LENGTH = 16
CANCEL_TEXT = "❌ Отмена"
SKIP_TEXT = "/skip"


# Validate the token only when one is actually provided, so the module stays
# importable (e.g. in tests) without a real BOT_TOKEN. main() enforces it at runtime.
bot = telebot.TeleBot(TOKEN, validate_token=bool(TOKEN))
db = AudioMemeDB(DB_PATH)


# --- Shared helpers --------------------------------------------------------


def _media_icon(media_type: str) -> str:
    """Emoji icon for a media type."""
    return "🎵" if media_type == "audio" else "🎬"


def _meme_title(meme: Meme) -> str:
    """Display title: '<emoji> <name>' when an emoji is set, else just the name."""
    return f"{meme.emoji} {meme.name}" if meme.emoji else meme.name


def _is_admin_private(message: types.Message, tag: str) -> bool:
    """Guard admin commands: must be the admin and a private chat.

    Sends the appropriate rejection and returns False when not allowed.
    """
    if message.from_user.id != ADMIN_ID:
        logging.warning("[%s] Non-admin user %s tried an admin action", tag, message.from_user.id)
        bot.send_message(message.chat.id, "❌ Доступно только админу")
        return False
    if message.chat.type != "private":
        logging.warning("[%s] Admin %s tried %s in group chat", tag, message.from_user.id, tag)
        bot.send_message(message.chat.id, "❌ Используй личные сообщения")
        return False
    return True


def _cancel_requested(message: types.Message) -> bool:
    """True when the message is a cancel command/button during a step flow."""
    return bool(message.text) and message.text.strip() in {"/cancel", CANCEL_TEXT}


def _send_cancelled(chat_id: int) -> None:
    """Acknowledge cancellation and drop the reply keyboard."""
    bot.send_message(chat_id, "Отменено", reply_markup=types.ReplyKeyboardRemove())


def _cancel_keyboard() -> types.ReplyKeyboardMarkup:
    """A one-button reply keyboard offering cancel."""
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add(CANCEL_TEXT)
    return markup


def _skip_cancel_keyboard() -> types.ReplyKeyboardMarkup:
    """A reply keyboard offering skip + cancel (used for the optional emoji step)."""
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add(SKIP_TEXT, CANCEL_TEXT)
    return markup


def _convert_video_for_note(src: str, dst: str) -> None:
    # Scale to <= 640 (input must already be square), H.264, trim to 60 s
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            src,
            "-t",
            "60",
            "-vf",
            "scale='min(640,iw)':-2",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            dst,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def _convert_audio_for_voice(src: str, dst: str) -> None:
    # Transcode to OGG/Opus, mono channel
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            src,
            "-c:a",
            "libopus",
            "-ac",
            "1",
            "-b:a",
            "64k",
            dst,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


# Admin commands
@bot.message_handler(commands=["start"])
def start(message: types.Message) -> None:
    """Start command."""
    if message.chat.type == "private":
        markup = types.ReplyKeyboardMarkup(resize_keyboard=True)
        if message.from_user.id == ADMIN_ID:
            markup.add("/add", "/list", "/users")
            bot.send_message(
                message.chat.id,
                "👋 Привет, админ! Выбери действие:",
                reply_markup=markup,
            )
        else:
            bot.send_message(
                message.chat.id,
                "👋 Привет! Для получения мемов используй inline query: "
                "введи @ботname в любом чате и выбери мем",
            )
    else:
        bot.send_message(
            message.chat.id,
            "👋 Привет! Для получения мемов используй inline query: "
            "введи @ботname в этом чате и выбери мем",
        )


# --- Admin: add a meme (media -> name -> emoji, cancelable at every step) ---


@bot.message_handler(commands=["add"])
def add_meme_start(message: types.Message) -> None:
    """Start adding a new meme (admin only). Asks for the media first."""
    logging.info(
        "[/add] User %s (%s) started adding meme",
        message.from_user.id,
        message.from_user.first_name,
    )
    if not _is_admin_private(message, "/add"):
        return

    msg = bot.send_message(
        message.chat.id,
        "Перешли или загрузи аудио или видео (/cancel — отмена):",
        reply_markup=_cancel_keyboard(),
    )
    bot.register_next_step_handler(msg, add_meme_get_media)


def add_meme_get_media(message: types.Message) -> None:
    """Receive the media, auto-detect its type, then ask for a name."""
    if _cancel_requested(message):
        _send_cancelled(message.chat.id)
        return

    file_id = None
    media_type = None

    # Voice messages — already OGG/Opus, grab file_id directly.
    if message.voice:
        file_id = message.voice.file_id
        media_type = "audio"

    # Audio files — download, convert to OGG/Opus, re-send as voice to cache a stable file_id.
    elif message.audio:
        logging.debug("Downloading and converting audio for a new meme")
        tmp_in_path = ""
        tmp_out_path = ""
        try:
            file_info = bot.get_file(message.audio.file_id)
            if not file_info.file_path:
                raise RuntimeError("Failed to get file path")

            downloaded_file = bot.download_file(file_info.file_path)
            suffix = Path(file_info.file_path).suffix or ".tmp"

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_in:
                tmp_in.write(downloaded_file)
                tmp_in_path = tmp_in.name

            tmp_out_path = tmp_in_path + ".ogg"
            _convert_audio_for_voice(tmp_in_path, tmp_out_path)

            with open(tmp_out_path, "rb") as audio_file:
                voice_msg = bot.send_voice(message.chat.id, types.InputFile(audio_file))

            if voice_msg and voice_msg.voice:
                file_id = voice_msg.voice.file_id
                media_type = "audio"
            else:
                raise RuntimeError("Failed to get voice from response")
        except Exception as e:
            logging.exception("Failed to convert audio: %s", e)
            msg = bot.send_message(
                message.chat.id,
                "❌ Ошибка при конвертации файла. Попробуй другой файл.",
                reply_markup=_cancel_keyboard(),
            )
            bot.register_next_step_handler(msg, add_meme_get_media)
            return
        finally:
            Path(tmp_in_path).unlink(missing_ok=True)
            Path(tmp_out_path).unlink(missing_ok=True)

    # Video notes (кружочки) — always square by Telegram's encoding; grab file_id directly.
    elif message.video_note:
        file_id = message.video_note.file_id
        media_type = "video"

    # Video files — must be square; download, convert to H.264 MP4, re-send as video note.
    elif message.video:
        if message.video.width != message.video.height:
            msg = bot.send_message(
                message.chat.id,
                "❌ Принимаются только видео формата 1:1",
                reply_markup=_cancel_keyboard(),
            )
            bot.register_next_step_handler(msg, add_meme_get_media)
            return

        logging.debug("Downloading and converting video for a new meme")
        tmp_in_path = ""
        tmp_out_path = ""
        try:
            file_info = bot.get_file(message.video.file_id)
            if not file_info.file_path:
                raise RuntimeError("Failed to get file path")

            downloaded_file = bot.download_file(file_info.file_path)
            suffix = Path(file_info.file_path).suffix or ".mp4"

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_in:
                tmp_in.write(downloaded_file)
                tmp_in_path = tmp_in.name

            tmp_out_path = tmp_in_path + ".mp4"
            _convert_video_for_note(tmp_in_path, tmp_out_path)

            with open(tmp_out_path, "rb") as video_file:
                video_note = bot.send_video_note(message.chat.id, types.InputFile(video_file))

            if video_note and video_note.video_note:
                file_id = video_note.video_note.file_id
                media_type = "video"
            else:
                raise RuntimeError("Failed to get video_note from response")
        except Exception as e:
            logging.exception("Failed to convert video: %s", e)
            msg = bot.send_message(
                message.chat.id,
                "❌ Ошибка при конвертации файла. Попробуй другой файл.",
                reply_markup=_cancel_keyboard(),
            )
            bot.register_next_step_handler(msg, add_meme_get_media)
            return
        finally:
            Path(tmp_in_path).unlink(missing_ok=True)
            Path(tmp_out_path).unlink(missing_ok=True)

    if not file_id or not media_type:
        msg = bot.send_message(
            message.chat.id,
            "❌ Это не аудио и не видео. Попробуй снова",
            reply_markup=_cancel_keyboard(),
        )
        bot.register_next_step_handler(msg, add_meme_get_media)
        return

    msg = bot.send_message(
        message.chat.id,
        "Теперь введи название мема (любой текст):",
        reply_markup=_cancel_keyboard(),
    )
    bot.register_next_step_handler(msg, add_meme_get_name, file_id, media_type)


def add_meme_get_name(message: types.Message, file_id: str, media_type: str) -> None:
    """Validate a free-form name (non-empty, unique), then ask for an emoji."""
    if _cancel_requested(message):
        _send_cancelled(message.chat.id)
        return

    if not message.text:
        msg = bot.send_message(
            message.chat.id,
            "❌ Пришли название текстом:",
            reply_markup=_cancel_keyboard(),
        )
        bot.register_next_step_handler(msg, add_meme_get_name, file_id, media_type)
        return

    name = message.text.strip()

    if not name or len(name) > MAX_NAME_LENGTH:
        msg = bot.send_message(
            message.chat.id,
            f"❌ Название должно быть от 1 до {MAX_NAME_LENGTH} символов. Попробуй снова:",
            reply_markup=_cancel_keyboard(),
        )
        bot.register_next_step_handler(msg, add_meme_get_name, file_id, media_type)
        return

    if db.get_meme_by_name(name) is not None:
        msg = bot.send_message(
            message.chat.id,
            f"❌ Мем с названием '{name}' уже существует. Введи другое название:",
            reply_markup=_cancel_keyboard(),
        )
        bot.register_next_step_handler(msg, add_meme_get_name, file_id, media_type)
        return

    msg = bot.send_message(
        message.chat.id,
        "Теперь пришли эмодзи для мема (/skip — без эмодзи):",
        reply_markup=_skip_cancel_keyboard(),
    )
    bot.register_next_step_handler(msg, add_meme_get_emoji, file_id, media_type, name)


def add_meme_get_emoji(message: types.Message, file_id: str, media_type: str, name: str) -> None:
    """Receive an optional emoji and save the meme."""
    if _cancel_requested(message):
        _send_cancelled(message.chat.id)
        return

    emoji = ""
    if message.text and message.text.strip() != SKIP_TEXT:
        emoji = message.text.strip()[:MAX_EMOJI_LENGTH]

    if db.add_meme(name, file_id, media_type, emoji):
        meme = Meme(0, name, file_id, media_type, emoji, 0)
        logging.info(
            "[/add] Admin %s added meme '%s' (type: %s, emoji: %s)",
            message.from_user.id,
            name,
            media_type,
            emoji or "-",
        )
        bot.send_message(
            message.chat.id,
            f"✅ Мем '{_media_icon(media_type)} {_meme_title(meme)}' добавлен!",
            reply_markup=types.ReplyKeyboardRemove(),
        )
    else:
        logging.warning(
            "[/add] Admin %s tried to add duplicate meme '%s'", message.from_user.id, name
        )
        bot.send_message(
            message.chat.id,
            f"❌ Мем с названием '{name}' уже существует",
            reply_markup=types.ReplyKeyboardRemove(),
        )


# --- Admin: list / manage memes (inline hub) -------------------------------


def _render_meme_list() -> tuple[str, types.InlineKeyboardMarkup]:
    """Build the meme-management list: a header plus one button per meme."""
    memes = db.get_memes_by_usage()
    markup = types.InlineKeyboardMarkup()
    if not memes:
        return "Нет сохраненных мемов", markup
    for meme in memes:
        label = f"{_media_icon(meme.media_type)} {_meme_title(meme)} · {meme.usage}"
        markup.add(types.InlineKeyboardButton(label, callback_data=f"meme:show:{meme.id}"))
    return "📋 Мемы (нажми для управления):", markup


def _render_meme_detail(meme: Meme) -> tuple[str, types.InlineKeyboardMarkup]:
    """Build the per-meme detail view with edit/delete/back actions."""
    text = (
        f"{_media_icon(meme.media_type)} {_meme_title(meme)}\n"
        f"Тип: {meme.media_type}\n"
        f"Отправок: {meme.usage}"
    )
    markup = types.InlineKeyboardMarkup()
    markup.add(
        types.InlineKeyboardButton("✏️ Переименовать", callback_data=f"meme:rename:{meme.id}"),
        types.InlineKeyboardButton("😀 Эмодзи", callback_data=f"meme:emoji:{meme.id}"),
    )
    markup.add(types.InlineKeyboardButton("🗑 Удалить", callback_data=f"meme:del:{meme.id}"))
    markup.add(types.InlineKeyboardButton("◀️ Назад", callback_data="meme:list"))
    return text, markup


def _send_meme_preview(chat_id: int, meme: Meme) -> None:
    """Replay the actual media so the admin acts on the right meme."""
    try:
        if meme.media_type == "audio":
            bot.send_voice(chat_id, meme.file_id)
        else:
            bot.send_video_note(chat_id, meme.file_id)
    except Exception as e:
        logging.exception("Failed to send preview for meme %s: %s", meme.id, e)


@bot.message_handler(commands=["list", "delete"])
def list_memes(message: types.Message) -> None:
    """Open the meme-management hub (admin only). Also serves the /delete alias."""
    logging.info(
        "[/list] Admin %s (%s) opened the meme list",
        message.from_user.id,
        message.from_user.first_name,
    )
    if not _is_admin_private(message, "/list"):
        return

    text, markup = _render_meme_list()
    bot.send_message(message.chat.id, text, reply_markup=markup)


@bot.callback_query_handler(func=lambda call: bool(call.data) and call.data.startswith("meme:"))
def on_meme_action(call: types.CallbackQuery) -> None:
    """Handle the inline meme-management buttons (admin only)."""
    if call.from_user.id != ADMIN_ID:
        logging.warning("[meme] Non-admin user %s tried a meme action", call.from_user.id)
        bot.answer_callback_query(call.id, "❌ Доступно только админу")
        return

    parts = call.data.split(":")
    action = parts[1]
    chat_id = call.message.chat.id
    message_id = call.message.message_id

    # Back to the (refreshed) list.
    if action == "list":
        bot.answer_callback_query(call.id)
        text, markup = _render_meme_list()
        bot.edit_message_text(text, chat_id, message_id, reply_markup=markup)
        return

    meme_id = int(parts[2])
    meme = db.get_meme_by_id(meme_id)
    if meme is None:
        bot.answer_callback_query(call.id, "Мем не найден")
        text, markup = _render_meme_list()
        bot.edit_message_text(text, chat_id, message_id, reply_markup=markup)
        return

    if action == "show":
        bot.answer_callback_query(call.id)
        _send_meme_preview(chat_id, meme)
        text, markup = _render_meme_detail(meme)
        bot.edit_message_text(text, chat_id, message_id, reply_markup=markup)
    elif action == "del":
        bot.answer_callback_query(call.id)
        markup = types.InlineKeyboardMarkup()
        markup.add(
            types.InlineKeyboardButton("✅ Да", callback_data=f"meme:delok:{meme_id}"),
            types.InlineKeyboardButton("◀️ Нет", callback_data=f"meme:show:{meme_id}"),
        )
        bot.edit_message_text(
            f"Удалить мем '{_meme_title(meme)}'?", chat_id, message_id, reply_markup=markup
        )
    elif action == "delok":
        db.delete_meme_by_id(meme_id)
        logging.info("[meme] Admin %s deleted meme '%s'", call.from_user.id, meme.name)
        bot.answer_callback_query(call.id, "🗑 Удалён")
        text, markup = _render_meme_list()
        bot.edit_message_text(text, chat_id, message_id, reply_markup=markup)
    elif action == "rename":
        bot.answer_callback_query(call.id)
        msg = bot.send_message(
            chat_id,
            f"Введи новое название для '{_meme_title(meme)}' (/cancel — отмена):",
            reply_markup=_cancel_keyboard(),
        )
        bot.register_next_step_handler(msg, save_meme_name, meme_id)
    elif action == "emoji":
        bot.answer_callback_query(call.id)
        msg = bot.send_message(
            chat_id,
            f"Пришли новый эмодзи для '{_meme_title(meme)}' (/skip — убрать, /cancel — отмена):",
            reply_markup=_skip_cancel_keyboard(),
        )
        bot.register_next_step_handler(msg, save_meme_emoji, meme_id)


def save_meme_name(message: types.Message, meme_id: int) -> None:
    """Apply a meme rename from the management hub."""
    if _cancel_requested(message):
        _send_cancelled(message.chat.id)
        return

    meme = db.get_meme_by_id(meme_id)
    if meme is None:
        bot.send_message(
            message.chat.id, "❌ Мем не найден", reply_markup=types.ReplyKeyboardRemove()
        )
        return

    name = message.text.strip() if message.text else ""
    if not name or len(name) > MAX_NAME_LENGTH:
        msg = bot.send_message(
            message.chat.id,
            f"❌ Название должно быть от 1 до {MAX_NAME_LENGTH} символов. Попробуй снова:",
            reply_markup=_cancel_keyboard(),
        )
        bot.register_next_step_handler(msg, save_meme_name, meme_id)
        return

    if not db.update_meme_name(meme_id, name):
        msg = bot.send_message(
            message.chat.id,
            f"❌ Мем с названием '{name}' уже существует. Введи другое название:",
            reply_markup=_cancel_keyboard(),
        )
        bot.register_next_step_handler(msg, save_meme_name, meme_id)
        return

    logging.info("[meme] Admin %s renamed meme %s to '%s'", message.from_user.id, meme_id, name)
    bot.send_message(
        message.chat.id,
        f"✅ Переименован в '{name}'",
        reply_markup=types.ReplyKeyboardRemove(),
    )


def save_meme_emoji(message: types.Message, meme_id: int) -> None:
    """Apply an emoji change (or removal) from the management hub."""
    if _cancel_requested(message):
        _send_cancelled(message.chat.id)
        return

    meme = db.get_meme_by_id(meme_id)
    if meme is None:
        bot.send_message(
            message.chat.id, "❌ Мем не найден", reply_markup=types.ReplyKeyboardRemove()
        )
        return

    emoji = ""
    if message.text and message.text.strip() != SKIP_TEXT:
        emoji = message.text.strip()[:MAX_EMOJI_LENGTH]

    db.update_meme_emoji(meme_id, emoji)
    updated = meme._replace(emoji=emoji)
    logging.info(
        "[meme] Admin %s set emoji for meme %s to '%s'",
        message.from_user.id,
        meme_id,
        emoji or "-",
    )
    bot.send_message(
        message.chat.id,
        f"✅ Обновлено: '{_meme_title(updated)}'",
        reply_markup=types.ReplyKeyboardRemove(),
    )


APPROVAL_PENDING_TEXT = "Ожидайте разрешение администратором"


# Inline query handler
@bot.inline_handler(lambda query: True)
def query_meme(inline_query: types.InlineQuery) -> None:
    """Handle inline queries to get memes."""
    user = inline_query.from_user

    # When approval is required, gate access per user. Register the user first so
    # they show up in the admin's /users list and can be approved.
    if REQUIRE_APPROVAL:
        db.register_user(user.id, user.first_name)
        if not db.is_user_approved(user.id):
            logging.info(
                "[inline] User %s (%s) not approved - showing pending message",
                user.id,
                user.first_name,
            )
            pending = types.InlineQueryResultArticle(
                "approval-required",
                APPROVAL_PENDING_TEXT,
                types.InputTextMessageContent(APPROVAL_PENDING_TEXT),
            )
            # cache_time=0 + is_personal so the user sees memes immediately once approved.
            _answer_inline_query(inline_query, [pending], cache_time=0, is_personal=True)
            return

    # Special leaderboard commands, e.g. "@botname stats" / "@botname userstats".
    query = inline_query.query.strip()
    command = query.lower()
    if command == "stats":
        article = _stats_article("stats", "🏆 Топ-3 мемов:", db.get_top_memes())
        logging.info("[inline] User %s (%s) requested meme stats", user.id, user.first_name)
        _answer_inline_query(inline_query, [article], cache_time=0, is_personal=REQUIRE_APPROVAL)
        return
    if command == "userstats":
        article = _stats_article("userstats", "🏆 Топ-3 пользователей:", db.get_top_users())
        logging.info("[inline] User %s (%s) requested user stats", user.id, user.first_name)
        _answer_inline_query(inline_query, [article], cache_time=0, is_personal=REQUIRE_APPROVAL)
        return

    # Filter by name/emoji when text is typed; otherwise show all by popularity.
    memes = db.search_memes(query) if query else db.get_memes_by_usage()
    results: list[types.InlineQueryResultBase] = []

    audio_count = 0
    video_count = 0

    for meme in memes:
        result: types.InlineQueryResultBase
        title = _meme_title(meme)
        if meme.media_type == "audio":
            result = types.InlineQueryResultCachedVoice(str(meme.id), meme.file_id, title)
            audio_count += 1
        else:  # video
            result = types.InlineQueryResultCachedVideo(str(meme.id), meme.file_id, title)
            video_count += 1

        results.append(result)

    logging.info(
        "[inline] User %s (%s) queried memes - %d audio, %d video (query: '%s')",
        user.id,
        user.first_name,
        audio_count,
        video_count,
        inline_query.query,
    )

    # When approval is on, answers are personal so per-user state never leaks
    # through Telegram's shared inline cache.
    _answer_inline_query(inline_query, results, cache_time=300, is_personal=REQUIRE_APPROVAL)


def _answer_inline_query(
    inline_query: types.InlineQuery,
    results: list[types.InlineQueryResultBase],
    *,
    cache_time: int,
    is_personal: bool,
) -> None:
    """Answer an inline query, logging (but swallowing) any Telegram error."""
    try:
        bot.answer_inline_query(
            inline_query.id, results, cache_time=cache_time, is_personal=is_personal
        )
    except Exception as e:
        logging.exception(
            "[inline] Failed to answer inline query from user %s: %s",
            inline_query.from_user.id,
            e,
        )


def _stats_article(
    result_id: str, header: str, rows: list[tuple[str, int]]
) -> types.InlineQueryResultArticle:
    """Build a non-sendable leaderboard article from (label, count) rows."""
    if rows:
        body = (
            header
            + "\n"
            + "\n".join(f"{i}. {label} — {count}" for i, (label, count) in enumerate(rows, 1))
        )
    else:
        body = "Пока нет статистики"
    return types.InlineQueryResultArticle(
        result_id,
        header,
        types.InputTextMessageContent(body),
        description=body,
    )


# Dedup guard for chosen_inline_result: keeps the last 2000 inline_message_ids
# so that replayed updates (polling reconnects, Telegram retries) are ignored.
_seen_inline_msg_ids: deque[str] = deque(maxlen=2000)
_seen_lock = threading.Lock()


@bot.chosen_inline_handler(func=lambda chosen: True)
def count_meme_send(chosen: types.ChosenInlineResult) -> None:
    """Count a meme send: refresh the sender's displayname and bump usage counters.

    Only numeric ``result_id``s map to memes; leaderboard articles (``stats`` /
    ``userstats``) and the approval notice are skipped so they don't inflate counts.

    Requires inline feedback to be enabled for the bot in BotFather
    (/setinlinefeedback) so Telegram delivers chosen_inline_result updates.
    """
    user = chosen.from_user

    # Deduplicate replayed updates using inline_message_id (present on every
    # meme send; absent only on non-message inline results, which we skip below).
    msg_id: str | None = getattr(chosen, "inline_message_id", None)
    if msg_id is not None:
        with _seen_lock:
            if msg_id in _seen_inline_msg_ids:
                logging.warning(
                    "[chosen] duplicate inline_message_id %s from user %s, skipping",
                    msg_id,
                    user.id,
                )
                return
            _seen_inline_msg_ids.append(msg_id)

    if not chosen.result_id.isdigit():
        logging.info(
            "[chosen] User %s (%s) chose non-meme result (result_id: %s)",
            user.id,
            user.first_name,
            chosen.result_id,
        )
        return

    db.record_user_send(user.id, user.first_name)
    db.increment_meme_count(int(chosen.result_id))
    logging.info(
        "[chosen] User %s (%s) sent meme (result_id: %s)",
        user.id,
        user.first_name,
        chosen.result_id,
    )


# --- Admin: user management ------------------------------------------------


def _render_users(
    users: list[tuple[int, str, bool, int]],
) -> tuple[str, types.InlineKeyboardMarkup]:
    """Build the /users message text and an approve/revoke inline keyboard."""
    text = "👥 Пользователи:\n"
    markup = types.InlineKeyboardMarkup()
    for userid, displayname, approved, count in users:
        name = displayname or str(userid)
        status = "✅" if approved else "⏳"
        text += f"{status} {name} (id {userid}) — {count}\n"
        if approved:
            button = types.InlineKeyboardButton(
                f"🚫 Отозвать {name}", callback_data=f"user:revoke:{userid}"
            )
        else:
            button = types.InlineKeyboardButton(
                f"✅ Одобрить {name}", callback_data=f"user:approve:{userid}"
            )
        markup.add(button)
    return text, markup


@bot.message_handler(commands=["users"])
def list_users(message: types.Message) -> None:
    """List users with approve/revoke buttons (admin only)."""
    logging.info(
        "[/users] User %s (%s) requested user list",
        message.from_user.id,
        message.from_user.first_name,
    )
    if not _is_admin_private(message, "/users"):
        return

    users = db.get_all_users()
    if not users:
        bot.send_message(message.chat.id, "Нет пользователей")
        return

    text, markup = _render_users(users)
    bot.send_message(message.chat.id, text, reply_markup=markup)


@bot.callback_query_handler(func=lambda call: bool(call.data) and call.data.startswith("user:"))
def on_user_action(call: types.CallbackQuery) -> None:
    """Handle approve/revoke button presses on the /users list (admin only)."""
    if call.from_user.id != ADMIN_ID:
        logging.warning("[users] Non-admin user %s tried a user action", call.from_user.id)
        bot.answer_callback_query(call.id, "❌ Доступно только админу")
        return

    _, action, userid_str = call.data.split(":")
    userid = int(userid_str)
    approved = action == "approve"
    db.set_user_approved(userid, approved)
    logging.info("[users] Admin %s set user %s approved=%s", call.from_user.id, userid, approved)
    bot.answer_callback_query(call.id, "✅ Одобрен" if approved else "🚫 Отозван")

    text, markup = _render_users(db.get_all_users())
    bot.edit_message_text(
        text,
        call.message.chat.id,
        call.message.message_id,
        reply_markup=markup,
    )


def main() -> None:
    """Validate configuration and start the bot in polling mode."""
    logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))

    if not TOKEN:
        logging.error("No BOT_TOKEN env provided")
        sys.exit(1)

    if not ADMIN_ID or ADMIN_ID == 0:
        logging.error("No ADMIN_ID env provided")
        sys.exit(1)

    # The read timeout must exceed the long-poll hold, else a normal empty poll is
    # cut off; enforce that invariant defensively regardless of how the envs are set.
    long_poll_timeout = TG_LONG_POLL_TIMEOUT if TG_LONG_POLL_TIMEOUT > 0 else 25
    read_timeout = TG_API_TIMEOUT if TG_API_TIMEOUT else 30
    if read_timeout <= long_poll_timeout:
        read_timeout = long_poll_timeout + 5

    # Optionally route requests through a custom Telegram Bot API endpoint
    # (e.g. a local Bot API server) to bypass restrictions.
    if TG_API_URL:
        logging.info("Using custom Telegram API URL")
        apihelper.API_URL = TG_API_URL
        # Route file downloads through the same server; default FILE_URL points
        # to api.telegram.org directly, bypassing TG_API_URL entirely.
        apihelper.FILE_URL = TG_API_URL.replace("/bot{0}/{1}", "/file/bot{0}/{1}")

    logging.info("Starting bot...")
    # skip_pending drops the backlog on restart so stale inline queries (which
    # expire and can't be answered late anyway) aren't replayed; allowed_updates
    # limits fetches to the types we handle.
    bot.infinity_polling(
        timeout=read_timeout,
        long_polling_timeout=long_poll_timeout,
        allowed_updates=ALLOWED_UPDATES,
        skip_pending=True,
    )


# Run bot
if __name__ == "__main__":
    main()
