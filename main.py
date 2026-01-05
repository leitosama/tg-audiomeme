import logging
import sys
from pathlib import Path
import os
import urllib.parse

import requests
import telebot
from telebot import types
import xml.etree.ElementTree as ET


S3_LINK = os.environ.get("S3_LINK", "")
TOKEN = os.environ.get("BOT_TOKEN", "")

if not TOKEN:
    logging.error("No BOT_TOKEN env provided")
    sys.exit(1)

bot = telebot.TeleBot(TOKEN)
telebot.logger.setLevel(logging.DEBUG)

def get_memes_s3() -> list:
    """Return list of tuples (key, url) from S3 index XML.

    If `S3_LINK` is not configured or the request fails, returns an empty list.
    """
    if not S3_LINK:
        logging.warning("S3_LINK is not set; no remote memes available")
        return []

    try:
        response = requests.get(S3_LINK, timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        logging.exception("Failed to fetch S3 index: %s", exc)
        return []

    result = []
    root = ET.fromstring(response.text)
    for mp3 in root.iter("{http://s3.amazonaws.com/doc/2006-03-01/}Key"):
        key = mp3.text
        if not key:
            continue
        url = urllib.parse.urljoin(S3_LINK, urllib.parse.quote(str(key)))
        result.append((key, url))
    return result

def get_memes() -> list:
    memes_path = Path("./memes")
    if not memes_path.exists():
        logging.warning("Local memes directory not found: %s", memes_path)
        return []

    return sorted(memes_path.glob("*.mp3"))

@bot.inline_handler(lambda query: True)
def query_meme(inline_query):
    memes = get_memes_s3()
    results = []
    for i, meme in enumerate(memes):
        # InlineQueryResultVoice expects string id
        results.append(types.InlineQueryResultVoice(str(i), meme[1], meme[0]))

    try:
        bot.answer_inline_query(inline_query.id, results, cache_time=1)
    except Exception:
        logging.exception("Failed to answer inline query")

@bot.message_handler(commands=["list"])
def list_memes(message):
    bot.send_message(message.chat.id, "Список мемов:")
    memes = get_memes()
    if not memes:
        bot.send_message(message.chat.id, "Мемы не найдены")
        return

    lines = [f"{i}. {item.name}" for i, item in enumerate(memes)]
    bot.send_message(message.chat.id, "\n".join(lines))


@bot.message_handler(commands=["meme"])
def send_meme(message):
    parts = message.text.split()
    if len(parts) < 2:
        bot.reply_to(message, "/meme <i>, где i - номер мема из /list")
        return

    try:
        index = int(parts[1])
    except ValueError:
        bot.reply_to(message, "Неверный номер мема")
        return

    memes = get_memes()
    if index < 0 or index >= len(memes):
        not_understand = Path("memes") / "не_понимаю.mp3"
        if not_understand.exists():
            with not_understand.open("rb") as f:
                bot.send_voice(message.chat.id, f)
        else:
            bot.reply_to(message, "Мем не найден")
        return

    meme_path = memes[index]
    try:
        with meme_path.open("rb") as f:
            bot.send_voice(message.chat.id, f)
    except Exception:
        logging.exception("Failed to send meme: %s", meme_path)
        bot.reply_to(message, "Не удалось отправить мем")

if __name__ == "__main__":
    bot.infinity_polling()
