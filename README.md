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

Напоминания шлёт второй сервис в том же проекте: `railway.worker.json`, команда `npm run worker`, cron `*/5 * * * *`. Он должен завершаться после каждого прогона — Railway ждёт этого от cron-сервиса, и `worker.ts` закрывает пул перед выходом. Минимальный шаг расписания на Railway — 5 минут. Сервису нужны те же `DATABASE_URL` и `TELEGRAM_BOT_TOKEN`; без токена прогон делает только уборку и никому не пишет.
