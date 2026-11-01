# «Конверт» — онлайн-конвертер картинок и PDF

22 инструмента на сайте (25 индексируемых страниц): jpg→pdf, png→jpg, сжатие, конвертация в
webp, упаковка в zip и другие. Файл загружается на сервер, там собирается задача Celery, статус
опрашивает фронтенд, готовый результат отдаётся на скачивание. Рабочие файлы живут 55 минут
(`TMP_FILE_TTL_SECONDS`) и удаляются планировщиком.

## Как устроено

- **backend/** — Django 6 + DRF + Celery + redis. API: загрузка → задача → статус → скачивание.
- **frontend/** — React 19 + Vite 8 + Tailwind v4. Собственный prerender-пайплайн: каждая
  страница (инструменты, юридические, 404) собирается в готовый HTML при сборке, поэтому
  контент виден без JavaScript.
- **deploy/nginx.conf** — раздача собранного фронтенда и прокси на бэкенд.
- **.github/workflows/** — `ci.yml` на каждый push/PR, `deploy.yml` с ручным запуском.

## Локальный запуск

Нужны Docker (с запущенным Docker Desktop) и Node 22+.

```bash
# 1. Бэкенд: web + celery worker + beat + redis
cp backend/.env.example backend/.env
docker compose -f backend/docker-compose.yml up -d --build
# API поднимется на http://127.0.0.1:8000, миграции применяются при старте

# 2. Фронтенд
cd frontend
npm ci
npm run dev
```

Во время разработки запросы на `/api` проксирует Vite, отдельной настройки CORS не нужно.

Без Docker бэкенд поднимается так же, но тогда для PDF-тестов и poppler-вызовов нужен путь
к бинарникам: `POPPLER_PATH` в `backend/.env` (в образе `poppler-utils` уже стоит).

## Проверки

То же самое выполняет CI, так что падение здесь означает падение и на GitHub.

```bash
# backend
python manage.py check
python manage.py makemigrations --check --noinput
python manage.py test converter          # redis для тестов не нужен: включён ALWAYS_EAGER + LocMemCache

# frontend — обязательно с VITE_SITE_URL, иначе canonical/sitemap не генерируются
VITE_SITE_URL=https://example.ru npm run lint
VITE_SITE_URL=https://example.ru npm run build
VITE_SITE_URL=https://example.ru npm run verify:dist   # состав dist, canonical, отсутствие рекламы
```

## Переменные окружения

Полные комментарии — в `backend/.env.example` и `frontend/.env.example`.

| Переменная | Где | Зачем |
|---|---|---|
| `DJANGO_DEBUG` | backend | в проде обязана быть `0` |
| `DJANGO_SECRET_KEY` | backend | без неё прод отказывается стартовать |
| `DJANGO_ALLOWED_HOSTS` | backend | публичный домен; локальные хосты разрешены всегда и дописывать их не нужно |
| `DJANGO_NUM_PROXIES` | backend | `1` под nginx, иначе все посетители попадут в один бакет лимитера |
| `CORS_ALLOWED_ORIGINS` | backend | только если фронтенд живёт на отдельном домене |
| `VITE_SITE_URL` | frontend | адрес сайта без завершающего слеша: canonical, og:url, robots.txt, sitemap.xml |
| `VITE_ADS_TXT`, `VITE_ADS_CLIENT` | frontend | реклама, заполняется только после одобрения площадки |

## Лимиты загрузок

`MAX_FILE_SIZE_BYTES` = 50 МиБ, `MAX_FILES_PER_REQUEST` = 50, `MAX_IMAGE_PIXELS` = 50 Мпикс
(`backend/converter/views.py`). nginx держит `client_max_body_size 51m` — с запасом на
multipart-обвязку, чтобы отказ приходил от Django с русским текстом, а не «голым» 413.

Из-за потолка по пикселям одна задача может развернуть в память до ~200 МБ растра: серверу
нужно 2 ГБ RAM плюс swap, иначе батч уходит в OOM-kill.

## Продакшен

Бэкенд: `backend/docker-compose.prod.yml` — gunicorn в 3 воркера, celery worker и beat,
redis (256 МБ лимит). Порт проброшен только на `127.0.0.1:8000`, то есть снаружи Django
доступен лишь через nginx.

```bash
# на сервере, после клона репозитория и настройки .env
REPO_PATH=/var/www/convert bash backend/deploy.sh
```

Скрипт делает `git fetch` + `merge --ff-only`, пересобирает образы и проверяет, что API
отвечает на `/api/status/deploy-check/`. На грязном рабочем дереве он падает, а не чинит
его молча. Фронтенд скрипт не трогает.

Фронтенд выкладывает GitHub Actions: workflow **Deploy** (`workflow_dispatch`, то есть
только руками) собирает dist и rsync'ит его в `WEB_ROOT` с `--delete`, после чего
перезапускает бэкенд и прогоняет smoke-тест.

Секреты для workflow:

| Secret | Значение |
|---|---|
| `DEPLOY_HOST` | адрес сервера |
| `DEPLOY_USER` | пользователь SSH |
| `DEPLOY_SSH_KEY` | приватный ключ (публичный — в `authorized_keys`) |
| `DEPLOY_KNOWN_HOSTS` | вывод `ssh-keyscan -t ed25519 <хост>`, без него шаг виснет |
| `REPO_PATH` | `/var/www/convert` |
| `WEB_ROOT` | `/var/www/convert/dist` — обязан совпадать с `root` в nginx.conf |
| `VITE_SITE_URL` | `https://домен` без завершающего слеша |

Одноразовая настройка сервера (пакеты, swap, пользователь, клон, `.env`, nginx, certbot)
описана в шапках `.github/workflows/deploy.yml` и `deploy/nginx.conf`.

## Почему на сайте не видно рекламы

Рекламные места включаются только при заданном `VITE_ADS_CLIENT`
(`frontend/src/config/ads.js`), а `ads.txt` собирается из `VITE_ADS_TXT`. До одобрения
площадки в кабинете Яндекса обе переменные не заполняют: иначе модератор видит обещание
показа, которого нет, а пользователь — серые пустые рамки. SDK рекламы сознательно не
подключён.
