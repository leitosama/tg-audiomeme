# tg-audiomeme

[![CI](https://github.com/leitosama/tg-audiomeme/actions/workflows/ci.yml/badge.svg)](https://github.com/leitosama/tg-audiomeme/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/python-3.12%2B-blue)

Телеграм-бот — альтернатива Stickers, но для аудио- и видеосообщений.

## Возможности

### Для администратора

Один администратор (`ADMIN_ID`) управляет мемами в личных сообщениях с ботом:

- **`/add`** — добавить аудио или видео в базу:
  - переслать сообщение с аудио/видео или загрузить файл напрямую;
  - бот сохраняет Telegram `file_id` для последующего использования.
- **`/delete`** — удалить сохранённый мем (выбор из списка + подтверждение).
- **`/list`** — посмотреть все сохранённые мемы.

### Для всех пользователей

- **Inline-режим** — введи `@botname` в любом чате, выбери мем, и бот отправит
  сохранённое аудио или видео.

## Быстрый старт (Docker Compose)

По умолчанию `docker-compose.yml` тянет готовый образ из
`ghcr.io/leitosama/tg-audiomeme:latest`.

```bash
cp .env.example .env
# заполни BOT_TOKEN и ADMIN_ID в .env
docker compose up -d
```

Чтобы собрать образ локально вместо загрузки из реестра:

```bash
docker compose up -d --build
```

База данных хранится в томе `./db` на хосте.

## Переменные окружения

| Переменная   | Обязательна | По умолчанию           | Описание                                                        |
| ------------ | ----------- | ---------------------- | --------------------------------------------------------------- |
| `BOT_TOKEN`  | да          | —                      | Токен бота от [@BotFather](https://t.me/BotFather).             |
| `ADMIN_ID`   | да          | —                      | Telegram ID единственного администратора.                       |
| `DB_PATH`    | нет         | `./db/audio_meme.db`   | Путь к файлу SQLite.                                            |
| `TG_API_URL` | нет         | —                      | Кастомный endpoint Bot API (напр. локальный Bot API server).    |

Пример — см. [`.env.example`](.env.example).

## Локальная разработка

Требуется Python 3.12+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

Запуск бота (переменные можно передать инлайн):

```bash
BOT_TOKEN=... ADMIN_ID=... python main.py
```

Проверки качества (те же, что и в CI):

```bash
ruff check .            # линтер
ruff format --check .   # форматирование
mypy main.py            # типы (strict, конфиг в pyproject.toml)
pytest                  # тесты + покрытие
```

## CI/CD

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- **На каждый push и pull request** запускаются параллельные проверки:
  `ruff` (линт + формат), `mypy` (strict) и `pytest` (с покрытием).
- **При пуше в `main`**, после успешного прохождения всех проверок, собирается
  мультиплатформенный Docker-образ (`linux/amd64`, `linux/arm64`) и публикуется в
  `ghcr.io/leitosama/tg-audiomeme` с тегами `latest` и `sha-<commit>`.

`main` — это продакшен: нет отдельного staging-окружения и версионирования релизов,
рабочий код едет в `main` напрямую.

## База данных

Все мемы хранятся в SQLite (по умолчанию `./db/audio_meme.db`).

Таблица `memes`:

- `id` — уникальный идентификатор;
- `name` — название мема;
- `file_id` — Telegram `file_id` для кэширования;
- `media_type` — тип: `audio` или `video`;
- `created_at` — дата добавления.

## Лицензия

См. [LICENSE](LICENSE).
