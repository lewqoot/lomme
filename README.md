# Lomme

Telegram Mini App для личного и семейного учёта финансов. Первая версия работает только с RUB и хранит суммы целыми копейками.

## Возможности

- расходы, доходы и переводы между кошельками;
- создание, выбор, переименование и удаление кошельков;
- совместные кошельки с приглашениями, ролями и указанием автора операций;
- поиск, категории и аналитика по периодам;
- быстрый ввод через iOS Shortcuts;
- Telegram `initData` HMAC-проверка, HttpOnly-сессии и версии сущностей.

## Локальный запуск

```bash
npm install
npm run dev
```

Без `DATABASE_URL` запускается изолированное демо-хранилище. С PostgreSQL нужно сначала применить миграции:

```bash
npm run db:migrate
npm run dev
```

Приложение: `http://127.0.0.1:4173`, API: `http://127.0.0.1:3000`, проверка: `/healthz`.

## Переменные

Список находится в `.env.example`. В production обязательны `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET`. `ALLOW_DEV_AUTH` нельзя включать в production.

## Проверки

```bash
npm run typecheck
npm test
npm run build
```

## Разработка несколькими агентами

GitHub — единственная точка координации: [roadmap и порядок работ](https://github.com/lewqoot/lomme/issues/8). Перед правкой нужно подтянуть актуальный `main`, выбрать один issue и работать в отдельной ветке `fix/<issue>-short-name`. Общие правила находятся в [`AGENTS.md`](./AGENTS.md).

## Railway

`railway.json` описывает сборку, pre-deploy миграции, запуск и `/healthz`.

Напоминания и сводки шлёт второй сервис в том же проекте — **lomme-worker**
(`6882d193-3691-43ca-8bb4-c6b21cacbda0`). Config as Code для него не используется:
Railway объявил `railway.json` устаревшим, поэтому сервис настроен через API и
его параметры живут только в Railway.

| Что | Значение |
| --- | --- |
| Build | `npm run build:server` |
| Start | `npm run worker` |
| Cron | `*/5 * * * *` (минимальный шаг на Railway — 5 минут) |
| Restart | `NEVER` |

Прогон обязан завершаться: Railway ждёт этого от cron-сервиса, и `worker.ts`
закрывает пул перед выходом. Переменные заданы ссылками на соседние сервисы
(`${{Postgres.DATABASE_URL}}`, `${{Lomme.TELEGRAM_BOT_TOKEN}}` и далее), так что
секреты не продублированы. Без токена прогон делает только уборку и никому не пишет.

Выкатывать нужно оба сервиса: `railway up --service Lomme` и
`railway up --service lomme-worker`. Автодеплоя из GitHub нет.
