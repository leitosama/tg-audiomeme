import logging
import os
import sys
import sqlite3
import tempfile
from pathlib import Path
from typing import Optional, List, Tuple

import telebot
from telebot import types

# Configuration
TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", "0"))
DB_PATH = os.environ.get("DB_PATH", "audio_meme.db")

if not TOKEN:
    logging.error("No BOT_TOKEN env provided")
    sys.exit(1)

if not ADMIN_ID or ADMIN_ID == 0:
    logging.error("No ADMIN_ID env provided")
    sys.exit(1)

# Setup logging
logging.basicConfig(level=logging.DEBUG)

bot = telebot.TeleBot(TOKEN)


# Database functions
class AudioMemeDB:
    """SQLite database for audio/video memes."""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.init_db()
    
    def get_connection(self):
        """Get database connection."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def init_db(self):
        """Initialize database schema."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                file_id TEXT NOT NULL,
                media_type TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        conn.close()
    
    def add_meme(self, name: str, file_id: str, media_type: str) -> bool:
        """Add a new meme. Returns True if successful."""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO memes (name, file_id, media_type) VALUES (?, ?, ?)",
                (name, file_id, media_type)
            )
            conn.commit()
            conn.close()
            return True
        except sqlite3.IntegrityError:
            logging.warning(f"Meme with name '{name}' already exists")
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
    
    def get_all_memes(self) -> List[Tuple[int, str, str, str]]:
        """Get all memes. Returns list of (id, name, file_id, media_type)."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, file_id, media_type FROM memes ORDER BY name")
        rows = cursor.fetchall()
        conn.close()
        return [(row[0], row[1], row[2], row[3]) for row in rows]
    
    def get_meme_by_name(self, name: str) -> Optional[Tuple[int, str, str, str]]:
        """Get meme by name. Returns (id, name, file_id, media_type) or None."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, file_id, media_type FROM memes WHERE name = ?", (name,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return (row[0], row[1], row[2], row[3])
        return None


db = AudioMemeDB(DB_PATH)


# Admin commands
@bot.message_handler(commands=["start"])
def start(message):
    """Start command."""
    if message.chat.type == "private":
        markup = types.ReplyKeyboardMarkup(resize_keyboard=True)
        if message.from_user.id == ADMIN_ID:
            markup.add("/add", "/delete", "/list")
            bot.send_message(
                message.chat.id,
                "👋 Привет, админ! Выбери действие:",
                reply_markup=markup
            )
        else:
            bot.send_message(
                message.chat.id,
                "👋 Привет! Для получения мемов используй inline query: введи @ботname в любом чате и выбери мем"
            )
    else:
        bot.send_message(
            message.chat.id,
            "👋 Привет! Для получения мемов используй inline query: введи @ботname в этом чате и выбери мем"
        )


@bot.message_handler(commands=["add"])
def add_meme_start(message):
    """Start adding a new meme (admin only)."""
    logging.info("[/add] User %s (%s) started adding meme", message.from_user.id, message.from_user.first_name)
    
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
        "Введи название мема (латиница, цифры, подчеркивание):"
    )
    bot.register_next_step_handler(msg, add_meme_get_media)


def add_meme_get_media(message):
    """Get meme name and wait for media."""
    # Check if message is text
    if not message.text:
        msg = bot.send_message(message.chat.id, "❌ Пожалуйста, пришли текстовое сообщение с названием мема:")
        bot.register_next_step_handler(msg, add_meme_get_media)
        return
    
    name = message.text.strip()
    
    # Validate name
    if not name or len(name) > 50:
        msg = bot.send_message(message.chat.id, "❌ Название слишком длинное (максимум 50 символов). Попробуй снова:")
        bot.register_next_step_handler(msg, add_meme_get_media)
        return
    
    if not all(c.isalnum() or c == "_" for c in name):
        msg = bot.send_message(message.chat.id, "❌ Используй только латиницу, цифры и подчеркивание. Попробуй снова:")
        bot.register_next_step_handler(msg, add_meme_get_media)
        return
    
    bot.send_message(
        message.chat.id,
        "Теперь пришли аудио или видео (пересланное сообщение или загруженный файл)"
    )
    bot.register_next_step_handler(message, add_meme_save, name)


def add_meme_save(message, name):
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
                raise Exception("Failed to get file path")
            
            downloaded_file = bot.download_file(file_info.file_path)
            
            # Create temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
                tmp.write(downloaded_file)
                tmp_path = tmp.name
            
            # Send as video note using InputFile
            with open(tmp_path, 'rb') as video_file:
                video_note = bot.send_video_note(message.chat.id, types.InputFile(video_file))
            
            # Clean up temp file
            Path(tmp_path).unlink(missing_ok=True)
            
            if video_note and video_note.video_note:
                file_id = video_note.video_note.file_id
                media_type = "video"
            else:
                raise Exception("Failed to get video_note from response")
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
        source = "voice" if message.voice else ("audio_file" if message.audio else ("video_note" if message.video_note else "video_file"))
        logging.info("[/add] Admin %s added meme '%s' (type: %s, source: %s)", message.from_user.id, name, media_type, source)
        bot.send_message(message.chat.id, f"✅ Мем '{icon} {name}' добавлен!")
    else:
        logging.warning("[/add] Admin %s tried to add duplicate meme '%s'", message.from_user.id, name)
        bot.send_message(message.chat.id, f"❌ Мем с названием '{name}' уже существует")


@bot.message_handler(commands=["delete"])
def delete_meme_start(message):
    """Start deleting a meme (admin only)."""
    logging.info("[/delete] Admin %s (%s) started deleting meme", message.from_user.id, message.from_user.first_name)
    
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
        reply_markup=markup
    )
    bot.register_next_step_handler(msg, delete_meme_confirm)


def delete_meme_confirm(message):
    """Confirm meme deletion."""
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
        reply_markup=markup
    )
    bot.register_next_step_handler(msg, delete_meme_final, name)


def delete_meme_final(message, name):
    """Final deletion."""
    if message.text.strip() == "✅ Да":
        if db.delete_meme(name):
            logging.info("[/delete] Admin %s deleted meme '%s'", message.from_user.id, name)
            bot.send_message(message.chat.id, f"✅ Мем '{name}' удален!")
        else:
            logging.error("[/delete] Error deleting meme '%s' by admin %s", name, message.from_user.id)
            bot.send_message(message.chat.id, "❌ Ошибка при удалении")
    else:
        logging.info("[/delete] Admin %s cancelled deletion of meme '%s'", message.from_user.id, name)
        bot.send_message(message.chat.id, "❌ Отмено")


@bot.message_handler(commands=["list"])
def list_memes(message):
    """List all memes (admin only)."""
    logging.info("[/list] Admin %s (%s) requested meme list", message.from_user.id, message.from_user.first_name)
    
    if message.from_user.id != ADMIN_ID:
        logging.warning("[/list] Non-admin user %s tried to list memes", message.from_user.id)
        bot.send_message(message.chat.id, "❌ Доступно только админу")
        return
    
    memes = db.get_all_memes()
    if not memes:
        logging.info("[/list] Admin %s requested list - no memes found", message.from_user.id)
        bot.send_message(message.chat.id, "Нет сохраненных мемов")
        return
    
    logging.info("[/list] Admin %s requested list - %d memes total", message.from_user.id, len(memes))
    
    text = "📋 Сохраненные мемы:\n"
    for i, (_, name, _, media_type) in enumerate(memes, 1):
        icon = "🎵" if media_type == "audio" else "🎬"
        text += f"{i}. {icon} {name}\n"
    
    bot.send_message(message.chat.id, text)


# Inline query handler
@bot.inline_handler(lambda query: True)
def query_meme(inline_query):
    """Handle inline queries to get memes."""
    memes = db.get_all_memes()
    results = []
    
    audio_count = 0
    video_count = 0
    
    for meme_id, name, file_id, media_type in memes:
        if media_type == "audio":
            result = types.InlineQueryResultCachedVoice(
                str(meme_id),
                file_id,
                name
            )
            audio_count += 1
        else:  # video
            result = types.InlineQueryResultCachedVideo(
                str(meme_id),
                file_id,
                name
            )
            video_count += 1
        
        results.append(result)
    
    logging.info("[inline] User %s (%s) queried memes - %d audio, %d video (query: '%s')", 
                 inline_query.from_user.id, inline_query.from_user.first_name, 
                 audio_count, video_count, inline_query.query)
    
    try:
        bot.answer_inline_query(inline_query.id, results, cache_time=300)
    except Exception as e:
        logging.exception("[inline] Failed to answer inline query from user %s: %s", inline_query.from_user.id, e)


# Run bot
if __name__ == "__main__":
    logging.info("Starting bot...")
    bot.infinity_polling()
