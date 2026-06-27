import logging
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import NamedTuple

import telebot
from telebot import apihelper, types

# Configuration
TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID") or "0")
DB_PATH = os.environ.get("DB_PATH", "./db/audio_meme.db")
TG_API_URL = os.environ.get("TG_API_URL", "")
# When true, only users with approved=true may use inline queries to send memes.
# When false, the approved column is ignored and everyone may use the bot.
REQUIRE_APPROVAL = os.environ.get("REQUIRE_APPROVAL") == "true"

# Limits / sentinels for the admin conversation flows.
MAX_NAME_LENGTH = 100
MAX_EMOJI_LENGTH = 16
CANCEL_TEXT = "❌ Отмена"
SKIP_TEXT = "/skip"


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


# Database functions
class AudioMemeDB:
    """SQLite database for audio/video memes."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.init_db()

    def get_connection(self) -> sqlite3.Connection:
        """Get database connection."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self) -> None:
        """Initialize database schema."""
        # Ensure the parent directory exists so the DB file can be created.
        if self.db_path != ":memory:":
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
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
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                userid INTEGER PRIMARY KEY,
                displayname TEXT,
                approved INTEGER NOT NULL DEFAULT 0,
                count INTEGER NOT NULL DEFAULT 0
            )
        """)
        # Migrations: add columns to already-deployed meme tables.
        cursor.execute("PRAGMA table_info(memes)")
        meme_columns = {row["name"] for row in cursor.fetchall()}
        if "count" not in meme_columns:
            cursor.execute("ALTER TABLE memes ADD COLUMN count INTEGER NOT NULL DEFAULT 0")
        if "emoji" not in meme_columns:
            cursor.execute("ALTER TABLE memes ADD COLUMN emoji TEXT NOT NULL DEFAULT ''")
        conn.commit()
        conn.close()

    def add_meme(self, name: str, file_id: str, media_type: str, emoji: str = "") -> bool:
        """Add a new meme. Returns True if successful, False on a duplicate name."""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO memes (name, file_id, media_type, emoji) VALUES (?, ?, ?, ?)",
                (name, file_id, media_type, emoji),
            )
            conn.commit()
            conn.close()
            return True
        except sqlite3.IntegrityError:
            logging.warning("Meme with name '%s' already exists", name)
            conn.close()
            return False

    def delete_meme_by_id(self, meme_id: int) -> bool:
        """Delete a meme by id. Returns True if a row was removed."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM memes WHERE id = ?", (meme_id,))
        conn.commit()
        deleted = cursor.rowcount > 0
        conn.close()
        return deleted

    def update_meme_name(self, meme_id: int, name: str) -> bool:
        """Rename a meme. Returns False on a unique-name collision or missing id."""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("UPDATE memes SET name = ? WHERE id = ?", (name, meme_id))
            conn.commit()
            updated = cursor.rowcount > 0
            conn.close()
            return updated
        except sqlite3.IntegrityError:
            logging.warning("Cannot rename meme %s: name '%s' already exists", meme_id, name)
            conn.close()
            return False

    def update_meme_emoji(self, meme_id: int, emoji: str) -> None:
        """Set (or clear) a meme's emoji."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE memes SET emoji = ? WHERE id = ?", (emoji, meme_id))
        conn.commit()
        conn.close()

    def get_all_memes(self) -> list[Meme]:
        """Get all memes ordered by name."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, file_id, media_type, emoji, count FROM memes ORDER BY name"
        )
        rows = cursor.fetchall()
        conn.close()
        return [_row_to_meme(row) for row in rows]

    def get_meme_by_name(self, name: str) -> Meme | None:
        """Get a meme by its (unique) name, or None."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, file_id, media_type, emoji, count FROM memes WHERE name = ?",
            (name,),
        )
        row = cursor.fetchone()
        conn.close()
        return _row_to_meme(row) if row else None

    def get_meme_by_id(self, meme_id: int) -> Meme | None:
        """Get a meme by its id, or None."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, file_id, media_type, emoji, count FROM memes WHERE id = ?",
            (meme_id,),
        )
        row = cursor.fetchone()
        conn.close()
        return _row_to_meme(row) if row else None

    def get_memes_by_usage(self) -> list[Meme]:
        """Get all memes ordered by all-time usage (most-sent first), then name."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, file_id, media_type, emoji, count FROM memes "
            "ORDER BY count DESC, name ASC"
        )
        rows = cursor.fetchall()
        conn.close()
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
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE memes SET count = count + 1 WHERE id = ?", (meme_id,))
        conn.commit()
        conn.close()

    def get_top_memes(self, limit: int = 3) -> list[tuple[str, int]]:
        """Get the most-used memes as (name, count), excluding never-used ones."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, count FROM memes WHERE count > 0 ORDER BY count DESC, name ASC LIMIT ?",
            (limit,),
        )
        rows = cursor.fetchall()
        conn.close()
        return [(row[0], row[1]) for row in rows]

    # --- Users ---------------------------------------------------------------

    def register_user(self, userid: int, displayname: str) -> None:
        """Make a user known (e.g. so the admin can approve them).

        Inserts the user if missing and refreshes their displayname, without
        touching the ``approved`` or ``count`` columns.
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO users (userid, displayname) VALUES (?, ?)
            ON CONFLICT(userid) DO UPDATE SET displayname = excluded.displayname
            """,
            (userid, displayname),
        )
        conn.commit()
        conn.close()

    def record_user_send(self, userid: int, displayname: str) -> None:
        """Register a meme send: refresh displayname and increment count."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO users (userid, displayname, count) VALUES (?, ?, 1)
            ON CONFLICT(userid) DO UPDATE SET
                count = count + 1,
                displayname = excluded.displayname
            """,
            (userid, displayname),
        )
        conn.commit()
        conn.close()

    def is_user_approved(self, userid: int) -> bool:
        """Return whether the user is approved. Unknown users are not approved."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT approved FROM users WHERE userid = ?", (userid,))
        row = cursor.fetchone()
        conn.close()
        return bool(row[0]) if row else False

    def get_all_users(self) -> list[tuple[int, str, bool, int]]:
        """Get all users as (userid, displayname, approved, count).

        Pending (unapproved) users come first, then by descending usage count.
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT userid, displayname, approved, count FROM users "
            "ORDER BY approved ASC, count DESC, userid ASC"
        )
        rows = cursor.fetchall()
        conn.close()
        return [(row[0], row[1], bool(row[2]), row[3]) for row in rows]

    def get_top_users(self, limit: int = 3) -> list[tuple[str, int]]:
        """Get the most active users as (displayname, count), excluding inactive ones."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT displayname, count FROM users WHERE count > 0 "
            "ORDER BY count DESC, userid ASC LIMIT ?",
            (limit,),
        )
        rows = cursor.fetchall()
        conn.close()
        return [(row[0], row[1]) for row in rows]

    def set_user_approved(self, userid: int, approved: bool) -> bool:
        """Set a user's approved flag. Returns True if a user row was updated."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET approved = ? WHERE userid = ?",
            (1 if approved else 0, userid),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        return updated


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

    # Voice messages and audio files.
    if message.voice:
        file_id = message.voice.file_id
        media_type = "audio"
    elif message.audio:
        file_id = message.audio.file_id
        media_type = "audio"
    # Video notes (кружочки) and video files.
    elif message.video_note:
        file_id = message.video_note.file_id
        media_type = "video"
    elif message.video:
        # Download the video and re-send it as a video note to cache a usable file_id.
        logging.debug("Downloading and caching video for a new meme")
        try:
            file_info = bot.get_file(message.video.file_id)
            if not file_info.file_path:
                raise RuntimeError("Failed to get file path")

            downloaded_file = bot.download_file(file_info.file_path)

            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
                tmp.write(downloaded_file)
                tmp_path = tmp.name

            with open(tmp_path, "rb") as video_file:
                video_note = bot.send_video_note(message.chat.id, types.InputFile(video_file))

            Path(tmp_path).unlink(missing_ok=True)

            if video_note and video_note.video_note:
                file_id = video_note.video_note.file_id
                media_type = "video"
            else:
                raise RuntimeError("Failed to get video_note from response")
        except Exception as e:
            logging.exception("Failed to cache video: %s", e)
            msg = bot.send_message(
                message.chat.id,
                "❌ Ошибка при кэшировании видео. Попробуй снова",
                reply_markup=_cancel_keyboard(),
            )
            bot.register_next_step_handler(msg, add_meme_get_media)
            return

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


@bot.chosen_inline_handler(func=lambda chosen: True)
def count_meme_send(chosen: types.ChosenInlineResult) -> None:
    """Count a meme send: refresh the sender's displayname and bump usage counters.

    Only numeric ``result_id``s map to memes; leaderboard articles (``stats`` /
    ``userstats``) and the approval notice are skipped so they don't inflate counts.

    Requires inline feedback to be enabled for the bot in BotFather
    (/setinlinefeedback) so Telegram delivers chosen_inline_result updates.
    """
    user = chosen.from_user
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
    logging.basicConfig(level=logging.DEBUG)

    if not TOKEN:
        logging.error("No BOT_TOKEN env provided")
        sys.exit(1)

    if not ADMIN_ID or ADMIN_ID == 0:
        logging.error("No ADMIN_ID env provided")
        sys.exit(1)

    # Optionally route requests through a custom Telegram Bot API endpoint
    # (e.g. a local Bot API server) to bypass restrictions.
    if TG_API_URL:
        logging.info("Using custom Telegram API URL")
        apihelper.API_URL = TG_API_URL
        # Route file downloads through the same server; default FILE_URL points
        # to api.telegram.org directly, bypassing TG_API_URL entirely.
        apihelper.FILE_URL = TG_API_URL.replace("/bot{0}/{1}", "/file/bot{0}/{1}")

    logging.info("Starting bot...")
    bot.infinity_polling()


# Run bot
if __name__ == "__main__":
    main()
