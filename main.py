import telebot
from pathlib import Path
import logging
import os
from telebot import types
import requests
import xml.etree.ElementTree as ET
import urllib.parse

S3_LINK=os.environ.get("S3_LINK",'')
TOKEN=os.environ.get('BOT_TOKEN','')

if not TOKEN:
  logging.error('No BOT_TOKEN env provided...')
  exit()
bot=telebot.TeleBot(TOKEN)
telebot.logger.setLevel(logging.DEBUG)

def get_memes_s3() -> list:
  result = []
  r = requests.get(S3_LINK).text
  root = ET.fromstring(r)
  for mp3 in root.iter("{http://s3.amazonaws.com/doc/2006-03-01/}Key"):
    result.append((mp3.text, urllib.parse.urljoin(S3_LINK,urllib.parse.quote(mp3.text))))
  return result

def get_memes() -> list:
  memes_path = Path('./memes')
  return list(memes_path.glob('*.mp3'))

@bot.inline_handler(lambda query: True)
def query_meme(inline_query):
    memes = get_memes_s3()
    r = []
    for i, meme in enumerate(memes):
       r.append(types.InlineQueryResultVoice(i, meme[1], meme[0]))
    try:
        bot.answer_inline_query(inline_query.id, r, cache_time=1)
    except Exception as e:
        print(e)

@bot.message_handler(commands=['list'])
def start_message(message):
    bot.send_message(message.chat.id,"Список мемов:")
    memes_str=""
    for (i, item) in enumerate(get_memes()):
        memes_str += f"{i}. {item}\n"
    bot.send_message(message.chat.id, memes_str)


@bot.message_handler(commands=['meme'])
def start_message(message):
    if ' ' not in message.text:
        bot.reply_to(message, '/meme <i>, где i - номер мема из /list')
    i = int(message.text.split()[1])
    if i<=0:
        with open('memes\\не_понимаю.mp3', 'rb') as f:
            bot.send_voice(message.chat.id, f)
    with open(get_memes()[i], 'rb') as f:
        bot.send_voice(message.chat.id, f)

if __name__ == "__main__":
    bot.infinity_polling()