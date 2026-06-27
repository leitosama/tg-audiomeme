import logging
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

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
        # Migration: add the usage counter to already-deployed meme tables.
        cursor.execute("PRAGMA table_info(memes)")
        if "count" not in {row["name"] for row in cursor.fetchall()}:
            cursor.execute("ALTER TABLE memes ADD COLUMN count INTEGER NOT NULL DEFAULT 0")
        conn.commit()
        conn.close()

    def add_meme(self, name: str, file_id: str, media_type: str) -> bool:
        """Add a new meme. Returns True if successful."""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO memes (name, file_id, media_type) VALUES (?, ?, ?)",
                (name, file_id, media_type),
            )
            conn.commit()
            conn.close()
            return True
        except sqlite3.IntegrityError:
            logging.warning("Meme with name '%s' already exists", name)
            conn.close()
            return False

    def delete_meme(self, name: str) -> bool:
        """Delete a meme by name. Returns True if successful."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM memes WHERE name = ?", (name,))
        conn.commit()
        deleted = cursor.rowcount > 0
        conn.close()
        return deleted

    def get_all_memes(self) -> list[tuple[int, str, str, str]]:
        """Get all memes. Returns list of (id, name, file_id, media_type)."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, file_id, media_type FROM memes ORDER BY name")
        rows = cursor.fetchall()
        conn.close()
        return [(row[0], row[1], row[2], row[3]) for row in rows]

    def get_meme_by_name(self, name: str) -> tuple[int, str, str, str] | None:
        """Get meme by name. Returns (id, name, file_id, media_type) or None."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, file_id, media_type FROM memes WHERE name = ?", (name,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return (row[0], row[1], row[2], row[3])
        return None

    def get_memes_by_usage(self) -> list[tuple[int, str, str, str]]:
        """Get all memes ordered by usage. Returns (id, name, file_id, media_type)."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, file_id, media_type FROM memes ORDER BY count DESC, name ASC"
        )
        rows = cursor.fetchall()
        conn.close()
        return [(row[0], row[1], row[2], row[3]) for row in rows]

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


# Admin commands
@bot.message_handler(commands=["start"])
def start(message: types.Message) -> None:
    """Start command."""
    if message.chat.type == "private":
        markup = types.ReplyKeyboardMarkup(resize_keyboard=True)
        if message.from_user.id == ADMIN_ID:
            markup.add("/add", "/delete", "/list", "/users")
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


@bot.message_handler(commands=["add"])
def add_meme_start(message: types.Message) -> None:
    """Start adding a new meme (admin only)."""
    logging.info(
        "[/add] User %s (%s) started adding meme",
        message.from_user.id,
        message.from_user.first_name,
    )

    if message.from_user.id != ADMIN_ID:
        logging.warning("[/add] Non-admin user %s tried to add meme", message.from_user.id)
        bot.send_message(message.chat.id, "❌ Доступно только админу")
        return

    if message.chat.type != "private":
        logging.warning("[/add] Admin %s tried /add in group chat", message.from_user.id)
        bot.send_message(message.chat.id, "❌ Используй личные сообщения")
        return

    msg = bot.send_message(
        message.chat.id,
        "Введи название мема (латиница, цифры, подчеркивание):",
    )
    bot.register_next_step_handler(msg, add_meme_get_media)


def add_meme_get_media(message: types.Message) -> None:
    """Get meme name and wait for media."""
    # Check if message is text
    if not message.text:
        msg = bot.send_message(
            message.chat.id,
            "❌ Пожалуйста, пришли текстовое сообщение с названием мема:",
        )
        bot.register_next_step_handler(msg, add_meme_get_media)
        return

    name = message.text.strip()

    # Validate name
    if not name or len(name) > 50:
        msg = bot.send_message(
            message.chat.id,
            "❌ Название слишком длинное (максимум 50 символов). Попробуй снова:",
        )
        bot.register_next_step_handler(msg, add_meme_get_media)
        return

    if not all(c.isalnum() or c == "_" for c in name):
        msg = bot.send_message(
            message.chat.id,
            "❌ Используй только латиницу, цифры и подчеркивание. Попробуй снова:",
        )
        bot.register_next_step_handler(msg, add_meme_get_media)
        return

    bot.send_message(
        message.chat.id,
        "Теперь пришли аудио или видео (пересланное сообщение или загруженный файл)",
    )
    bot.register_next_step_handler(message, add_meme_save, name)


def add_meme_save(message: types.Message, name: str) -> None:
    """Save meme, auto-detecting media type."""
    file_id = None
    media_type = None

    # Check for voice messages and audio files
    if message.voice:
        file_id = message.voice.file_id
        media_type = "audio"
    elif message.audio:
        file_id = message.audio.file_id
        media_type = "audio"
    # Check for video notes (кружочки) and video files
    elif message.video_note:
        file_id = message.video_note.file_id
        media_type = "video"
    elif message.video:
        # Download video file and send via send_video_note to cache it
        logging.debug("Downloading and caching video for meme '%s'", name)
        try:
            # Download file
            file_info = bot.get_file(message.video.file_id)
            if not file_info.file_path:
                raise RuntimeError("Failed to get file path")

            downloaded_file = bot.download_file(file_info.file_path)

            # Create temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
                tmp.write(downloaded_file)
                tmp_path = tmp.name

            # Send as video note using InputFile
            with open(tmp_path, "rb") as video_file:
                video_note = bot.send_video_note(message.chat.id, types.InputFile(video_file))

            # Clean up temp file
            Path(tmp_path).unlink(missing_ok=True)

            if video_note and video_note.video_note:
                file_id = video_note.video_note.file_id
                media_type = "video"
            else:
                raise RuntimeError("Failed to get video_note from response")
        except Exception as e:
            logging.exception("Failed to cache video: %s", e)
            bot.send_message(message.chat.id, "❌ Ошибка при кэшировании видео. Попробуй снова")
            bot.register_next_step_handler(message, add_meme_save, name)
            return

    if not file_id or not media_type:
        msg = bot.send_message(message.chat.id, "❌ Это не аудио и не видео. Попробуй снова")
        bot.register_next_step_handler(msg, add_meme_save, name)
        return

    if db.add_meme(name, file_id, media_type):
        icon = "🎵" if media_type == "audio" else "🎬"
        if message.voice:
            source = "voice"
        elif message.audio:
            source = "audio_file"
        elif message.video_note:
            source = "video_note"
        else:
            source = "video_file"
        logging.info(
            "[/add] Admin %s added meme '%s' (type: %s, source: %s)",
            message.from_user.id,
            name,
            media_type,
            source,
        )
        bot.send_message(message.chat.id, f"✅ Мем '{icon} {name}' добавлен!")
    else:
        logging.warning(
            "[/add] Admin %s tried to add duplicate meme '%s'", message.from_user.id, name
        )
        bot.send_message(message.chat.id, f"❌ Мем с названием '{name}' уже существует")


@bot.message_handler(commands=["delete"])
def delete_meme_start(message: types.Message) -> None:
    """Start deleting a meme (admin only)."""
    logging.info(
        "[/delete] Admin %s (%s) started deleting meme",
        message.from_user.id,
        message.from_user.first_name,
    )

    if message.from_user.id != ADMIN_ID:
        logging.warning("[/delete] Non-admin user %s tried to delete meme", message.from_user.id)
        bot.send_message(message.chat.id, "❌ Доступно только админу")
        return

    if message.chat.type != "private":
        logging.warning("[/delete] Admin %s tried /delete in group chat", message.from_user.id)
        bot.send_message(message.chat.id, "❌ Используй личные сообщения")
        return

    memes = db.get_all_memes()
    if not memes:
        bot.send_message(message.chat.id, "❌ Нет сохраненных мемов")
        return

    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    for _, name, _, _ in memes:
        markup.add(name)

    msg = bot.send_message(
        message.chat.id,
        "Выбери мем для удаления:",
        reply_markup=markup,
    )
    bot.register_next_step_handler(msg, delete_meme_confirm)


def delete_meme_confirm(message: types.Message) -> None:
    """Confirm meme deletion."""
    if not message.text:
        bot.send_message(message.chat.id, "❌ Мем не найден")
        return

    name = message.text.strip()
    meme = db.get_meme_by_name(name)

    if not meme:
        bot.send_message(message.chat.id, "❌ Мем не найден")
        return

    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("✅ Да", "❌ Нет")
    msg = bot.send_message(
        message.chat.id,
        f"Удалить мем '{name}'?",
        reply_markup=markup,
    )
    bot.register_next_step_handler(msg, delete_meme_final, name)


def delete_meme_final(message: types.Message, name: str) -> None:
    """Final deletion."""
    if message.text and message.text.strip() == "✅ Да":
        if db.delete_meme(name):
            logging.info("[/delete] Admin %s deleted meme '%s'", message.from_user.id, name)
            bot.send_message(message.chat.id, f"✅ Мем '{name}' удален!")
        else:
            logging.error(
                "[/delete] Error deleting meme '%s' by admin %s",
                name,
                message.from_user.id,
            )
            bot.send_message(message.chat.id, "❌ Ошибка при удалении")
    else:
        logging.info(
            "[/delete] Admin %s cancelled deletion of meme '%s'", message.from_user.id, name
        )
        bot.send_message(message.chat.id, "❌ Отмено")


@bot.message_handler(commands=["list"])
def list_memes(message: types.Message) -> None:
    """List all memes (admin only)."""
    logging.info(
        "[/list] Admin %s (%s) requested meme list",
        message.from_user.id,
        message.from_user.first_name,
    )

    if message.from_user.id != ADMIN_ID:
        logging.warning("[/list] Non-admin user %s tried to list memes", message.from_user.id)
        bot.send_message(message.chat.id, "❌ Доступно только админу")
        return

    memes = db.get_all_memes()
    if not memes:
        logging.info("[/list] Admin %s requested list - no memes found", message.from_user.id)
        bot.send_message(message.chat.id, "Нет сохраненных мемов")
        return

    logging.info(
        "[/list] Admin %s requested list - %d memes total", message.from_user.id, len(memes)
    )

    text = "📋 Сохраненные мемы:\n"
    for i, (_, name, _, media_type) in enumerate(memes, 1):
        icon = "🎵" if media_type == "audio" else "🎬"
        text += f"{i}. {icon} {name}\n"

    bot.send_message(message.chat.id, text)


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
    command = inline_query.query.strip().lower()
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

    memes = db.get_memes_by_usage()
    results: list[types.InlineQueryResultBase] = []

    audio_count = 0
    video_count = 0

    for meme_id, name, file_id, media_type in memes:
        result: types.InlineQueryResultBase
        if media_type == "audio":
            result = types.InlineQueryResultCachedVoice(str(meme_id), file_id, name)
            audio_count += 1
        else:  # video
            result = types.InlineQueryResultCachedVideo(str(meme_id), file_id, name)
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

    if message.from_user.id != ADMIN_ID:
        logging.warning("[/users] Non-admin user %s tried to list users", message.from_user.id)
        bot.send_message(message.chat.id, "❌ Доступно только админу")
        return

    if message.chat.type != "private":
        logging.warning("[/users] Admin %s tried /users in group chat", message.from_user.id)
        bot.send_message(message.chat.id, "❌ Используй личные сообщения")
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
