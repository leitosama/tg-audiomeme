""" Telegram audiomeme bot """

import logging
import os
import urllib.parse
import xml.etree.ElementTree as ET

import requests
import telebot
from telebot import types

S3_LINK=os.environ.get("S3_LINK",'')
TOKEN=os.environ.get('BOT_TOKEN','')

if not TOKEN:
    logging.error('No BOT_TOKEN env provided...')
    exit()
bot=telebot.TeleBot(TOKEN)
telebot.logger.setLevel(logging.DEBUG)

def get_memes_s3() -> list:
    """Return memes list from S3 Bucket

    Returns:
        list: list of memes
    """
    result = []
    r = requests.get(S3_LINK, timeout=5).text
    root = ET.fromstring(r)
    for mp3 in root.iter("{http://s3.amazonaws.com/doc/2006-03-01/}Key"):
        result.append((mp3.text, urllib.parse.urljoin(S3_LINK,urllib.parse.quote(mp3.text))))
    return result

@bot.inline_handler(lambda query: True)
def query_meme(inline_query):
    """Send memes via inline query
    
    """
    memes: list = get_memes_s3()
    r = []
    for i, meme in enumerate(memes):
        r.append(types.InlineQueryResultVoice(i, meme[1], meme[0]))
    try:
        bot.answer_inline_query(inline_query.id, r, cache_time=1)
    except Exception as e:
        print(e)


def handler(event, context):
    """Handler for AWS Lambda
    """
    if event['httpMethod'] == "POST" and event['Content-Type'] == 'application/json':
        json_string =event['body'].decode('utf-8')
        update = telebot.types.Update.de_json(json_string)
        bot.process_new_updates([update])
        return {"statusCode": 200, "body": "OK"}
    else:
        return {"statusCode": 500, "body": "Smth is wrong"}

if __name__ == "__main__":
    bot.remove_webhook()
    bot.infinity_polling()
