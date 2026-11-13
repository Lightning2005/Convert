# Архитектура и контракты

Документ для того, кто правит код. Он отвечает на три вопроса: как запрос проходит
сквозь систему, какие контракты между слоями нельзя нарушать и куда идти, чтобы
добавить инструмент. Про устройство проекта — [README.md](../README.md), команды проверок
и сборки — в `.github/workflows/ci.yml`, профиль локальной разработки —
`backend/docker-compose.yml` (примечания к нему в шапке файла).

## 1. Контур одного запроса

```
браузер
  │  POST /api/… (multipart)          GET /tool/…  (готовый HTML)
  ▼                                    ▼
nginx (deploy/nginx.conf)  ── статика из WEB_ROOT
  │  /api/ → proxy 127.0.0.1:8000
  ▼
gunicorn → Django (converter/views.py)
  │  1. проверить файл  2. сохранить в tmp_files  3. поставить задачу в redis
  ▼                                    │
celery worker (converter/tasks.py)     │  GET /api/status/… → redis (результат)
  │  стратегия из converter/strategies │  GET /api/download/… → файл с тома
  ▼
tmp_files (именованный том, общий у web/worker/beat)
```

Состояния в базе нет: `converter/models.py` пуст, миграций приложения тоже. Всё
живёт в трёх местах — файлы в `tmp_files`, результат задачи в redis (Celery
backend, база 0) и метка «задача принята» в redis же (Django cache, база 1).
`db.sqlite3` нужен только системным таблицам Django. Отсюда следует правило:
**всё, что касается пользователя, — файл или ключ в redis, и у обоих есть TTL.**

## 2. Backend

| Файл | Роль |
|---|---|
| `core/settings.py` | env-настройки, redis для Celery и кэша, лимиты throttling'а, `CELERY_BEAT_SCHEDULE` |
| `converter/urls.py` | шесть маршрутов API. Порядок важен: `api/status/batch/` обязан стоять раньше `api/status/<task_id>/` |
| `converter/views.py` | приём файла, все проверки до очереди, статус, скачивание |
| `converter/tasks.py` | Celery-задачи + периодическая очистка |
| `converter/strategies.py` | собственно конвертация, три стратегии за фабрикой |
| `converter/services.py` | тонкая прослойка «задача → стратегия», держит сигнатуры стабильными |
| `converter/errors.py` | превращает исключение библиотеки в понятную фразу без путей |
| `converter/exceptions.py` | 429 DRF приходит с `detail`, фронтенд читает `error` — правим здесь |
| `converter/checks.py` | системная проверка Django: если `tmp_files` недоступен на запись, старт падает с `converter.E001` |

### 2.1 Контракт Celery-задачи

Задача всегда возвращает словарь одного из двух видов, и фронтенд завязан на него:

```python
{"status": "SUCCESS", "result_file": "<имя файла в tmp_dir>"}
{"status": "FAILURE", "error": "<текст по-русски, без путей>"}
```

Три правила, без которых ломается идемпотентность:

1. **Пишем в `.part`, публикуем через `os.replace`.** Celery доставляет сообщение
   «не менее одного раза»: если воркер умер после записи, но до ack, задача
   выполнится повторно.
2. **`is_already_done(output_path)` — первая проверка.** Имя выходного файла содержит
   uuid конкретного запроса, поэтому его наличие означает «результат этого запроса
   уже на диске», и повтор обязан вернуть SUCCESS, а не затереть файл ошибкой.
3. **Исходники удаляются в `finally`.** Отсюда легитимный случай «файла нет»:
   задача простояла в очереди дольше TTL, и очистка съела исходники — он
   обрабатывается в `ImagesToPdfConverter.convert` через `FileNotFoundError` с
   русским текстом, а не падением.

`clear_old_tmp_files_task` запускается beat'ом раз в 5 минут и удаляет файлы старше
`TMP_FILE_TTL_SECONDS` (55 минут). Тот же интервал — у `CELERY_RESULT_EXPIRES` и у
метки `queued:<task_id>`. **Менять их по отдельности нельзя**: политика
конфиденциальности обещает «не более часа», а статус не должен ссылаться на
удалённый файл.

### 2.2 Метка очереди и почему она пишется до `delay()`

Celery отвечает `PENDING` и на «ждёт очереди», и на «такого id мы не видели» —
неразличимо. `mark_task_queued(task_id)` пишет ключ в кэш **до** `apply_async`:
между этими двумя строками воркер уже стартует, и клиент, успевший опросить
статус в этом зазоре, получал `UNKNOWN` на принятый файл. Использовать
`enqueue_task()` вместо ручного `delay()`.

### 2.3 Лимиты: кто какой держит

| Где | Что | Значение |
|---|---|---|
| `deploy/nginx.conf` | `client_max_body_size` | 51 МБ — запас 1 МБ на multipart-обвязку, чтобы отказ приходил от Django с текстом, а не «голым» 413 |
| `converter/views.py` | `MAX_FILE_SIZE_BYTES` | 50 МиБ; для `images-to-pdf` считается **суммарно** по всем файлам, для остальных — на файл |
| `converter/views.py` | `MAX_FILES_PER_REQUEST` | 50 |
| `converter/views.py` | `MAX_IMAGE_PIXELS` | 50 Мпикс — проверяется по заголовку Pillow **до** постановки в очередь: плоский PNG 10000×10000 весит 300 КБ, но распаковывается в ~300 МБ памяти воркера |
| `settings.py` | `FILE_UPLOAD_MAX_MEMORY_SIZE` | 2 МБ — дальше Django пишет тело запроса на диск, а не в память |
| `strategies.py` | `PAGE_CHUNK` | 10 страниц PDF в памяти одновременно (иначе пик на 100-страничном документе доходил до 3.2 ГиБ) |
| `settings.py` | `DEFAULT_THROTTLE_RATES` | `convert` 300/час, `poll` 200/мин, `download` 1000/час |

Лимитер считает адрес клиента по `REMOTE_ADDR`, пока `DJANGO_NUM_PROXIES=0`. За
nginx обязана стоять `DJANGO_NUM_PROXIES=1` (в `docker-compose.prod.yml` — по
умолчанию), иначе все посетители попадут в один бакет и получат 429 все вместе.

### 2.4 Тексты ошибок

`describe_failure()` отдаёт сообщение как есть, только если оно короткое, без `/` и
`\` и содержит кириллицу. Библиотечные тексты («cannot identify image file
'/app/tmp_files/<uuid>.png'», stderr poppler) заменяются на `GENERIC_FAILURE` —
иначе пользователь получает и пути внутренней структуры, и английскую терминологию.
Новые сообщения стратегий поэтому пишем по-русски и без путей.

## 3. HTTP API

Формат ответа об ошибкам везде один: `{"error": "<текст по-русски>"}`. Успешный
приём файла — всегда **202** и `task_id`.

### `POST /api/images-to-pdf/`

`multipart/form-data`: `images` — одно или несколько изображений (повторяемое поле).
→ `202 {"message": "Изображения приняты в обработку.", "task_id": "…"}`

### `POST /api/pdf-to-images/`

`pdf` — один файл, `target` — `jpg` (по умолчанию) | `jpeg` | `png` | `webp`.
→ `202`, результат всегда ZIP с `page_N.<ext>` внутри.

### `POST /api/convert/`

`file` — одно изображение, `target` — один из `jpg jpeg png webp tiff ico bmp heic`
(`GenericImageConverter.SUPPORTED_FORMATS`).

Текстовые поля читаются через `get_text_field()`: DRF подмешивает FILES в
`request.data`, поэтому «target» может прилететь файловой частью — такое поле должно
дать 400, а не уронить view на `.lower()`.

### `GET /api/status/<task_id>/` и `GET /api/status/batch/?ids=a,b,c`

```json
{ "task_id": "…", "status": "PENDING|STARTED|RETRY|SUCCESS|FAILURE|UNKNOWN",
  "download_url": "/api/download/<имя>/",   // только при SUCCESS
  "error": "…" }                            // при FAILURE и UNKNOWN
```

Батч принимает до 100 id и отдаёт `{"tasks": [ … ]}` — он существует потому, что
батч из 50 файлов иначе опрашивал статус 50 запросов за цикл. `download_url` —
**путь, а не абсолютный URI**: адрес зависит от заголовка `Host`, а фронтенд сам
знает, откуда качает.

Между удалением файла очисткой и истечением результата Celery есть окно, в котором
ссылка была бы уже битой — `task_snapshot()` проверяет `os.path.isfile` и
возвращает FAILURE с внятным текстом.

### `GET /api/download/<filename>/`

`FileResponse` с `as_attachment`, имя файла и `content_type` из
`DOWNLOAD_CONTENT_TYPES` (в Python `mimetypes` не знает `.webp`, системных mime-таблиц
в образе нет). Файл открывается сразу: проверка «существует → открыть» на каталоге
Windows даёт `PermissionError`, а не `IsADirectoryError`, и честная гонка с очисткой
превращалась в 500 вместо 404.

### `GET /api/status/deploy-check/`

Зарезервированного эндпоинта нет: это обычный `TaskStatusView` на выдуманном id, и он
отвечает 200 с `UNKNOWN`. Именно этим его и использует `backend/deploy.sh` — ответ
доказывает, что живы Django, redis (result backend) и redis (кэш).

## 4. Frontend

| Файл | Роль |
|---|---|
| `src/config/tools.js` | 23 инструмента: и поведение формы, и весь SEO-текст |
| `src/services/api.js` | контракт с бэкендом: отправка, опрос, скачивание, склейка батча |
| `src/AppRoutes.jsx` | дерево маршрутов без роутера — его используют и браузер, и сборщик |
| `src/entry-server.jsx` | `renderRoute(url)` → `renderToString` + `StaticRouter` |
| `src/seo.js` | `getSeo(path)`, `getSitemapEntries()`, `absoluteUrl()` |
| `scripts/prerender.mjs` | сборка статических страниц, `404.html`, sitemap, robots, ads.txt |
| `scripts/verify-dist.mjs` | проверка состава dist |
| `src/config/ads.js` | `ADS_ENABLED` — только при заданном `VITE_ADS_CLIENT` |

### 4.1 Конфиг инструмента = контракт

```js
'jpg-to-pdf': {
  source: 'jpg', target: 'pdf',        // направление; определяет, какой вызов API
  sourceName, targetName,              // подстановка в title/description
  accept: '.jpg,.jpeg',                // <input accept>
  maxFiles: 20,                        // потолок UI, обязан быть ≤ MAX_FILES_PER_REQUEST
  category: 'pdf' | 'image',           // группировка на главной
  description, steps[], about[], faq[] // контент страницы
}
```

`runConversion(config, files, signal)` (`api.js:289`) выбирает вызов по трём веткам:
`target === 'pdf'` → один запрос на все файлы; `source === 'pdf'` → по запросу на
документ; `category === 'image'` → по запросу на файл. Всё остальное — «направление
временно не поддерживается сервером».

### 4.2 Опрос и частичный результат

`pollTasks()` — цикл 1.5 с × 60 попыток (≈90 с), батч-запросом, терминальные статусы
`SUCCESS|FAILURE|UNKNOWN`. `runBatch()` использует `Promise.allSettled` на трёх
этапах (отправка, скачивание) и возвращает `notice` про то, что «готово не всё»,
вместо общей ошибки. Несколько результатов склеиваются JSZip'ом, имена уникализируются
`uniqueName()` — иначе два файла с одинаковым именем затирают друг друга в архиве
молча.

### 4.3 Prerender-пайплайн

Сборка страниц — конвейер из трёх шагов: обычный `vite build`, затем SSR-сборка,
затем `scripts/prerender.mjs`.
Для каждого маршрута из `getSitemapEntries()` скрипт подставляет head-теги в
`dist/index.html` (блок `<!-- seo:start -->`) и кладёт разметку в `<div id="root">`.

Каждый маршрут пишется **в двух видах**: `dist/tool/<slug>/index.html` (для nginx
`try_files $uri $uri/index.html`) и `dist/tool/<slug>.html` (плоский файл — Netlify,
Vercel, S3 и ветка `$uri.html`). Плюс `dist/404.html` с `noindex,follow`, `sitemap.xml`,
`robots.txt` и `ads.txt`.

Отсюда два правила. **Никакого SPA-fallback:** несуществующий адрес обязан давать 404,
а не оболочку приложения с кодом 200 — мягкие 404 индексируются и читаются модератором
как сломанный сайт. **`VITE_SITE_URL` обязателен при сборке:** без него canonical,
og:image, robots и sitemap намеренно не генерируются, и проверка состава dist на этом
падает.

## 5. Как добавить инструмент

1. Ключ в `SUPPORTED_TOOLS` (`src/config/tools.js`): направление, `accept`,
   `maxFiles`, `category` и тексты. Маршрут `/tool/<slug>`, пункт sitemap, карточка
   на главной и prerender подхватятся сами — отдельного реестра маршрутов нет.
2. Если направление новое — проверить, что его покрывает `runConversion` (§4.1).
3. Если нужен новый формат на выходе: `GenericImageConverter.SUPPORTED_FORMATS`
   (стратегия), `DOWNLOAD_CONTENT_TYPES` (`views.py`), при необходимости
   `SUPPORTED_IMAGE_EXTENSIONS` для исходников.
4. Если формат тяжёлый — вспомнить про `MAX_IMAGE_PIXELS` и `PAGE_CHUNK`.
5. Тест в `converter/tests.py` на успех и на отказ формата.
6. Пересобрать dist и прогнать проверку состава — она сверяет число страниц с числом
   маршрутов, поэтому несогласованность видна сразу. Команды сборки — в `ci.yml`.

## 6. Тесты

Тесты живут в `converter/tests.py`, их 64, redis для прогона не нужен: `tests.py:59-66`
включает `CELERY_TASK_ALWAYS_EAGER`, LocMemCache и отдельный каталог через
`override_settings(TMP_FILES_DIR=…)`. Прогон зашит в `ci.yml` и выполняется на каждый
push. Обязательное следствие: после прогона в
`backend/tmp_files` не должно оставаться файлов — это отдельный шаг CI (`ci.yml:54-66`).
На Windows для PDF-тестов нужен `POPPLER_PATH` (в `settings.py` есть дефолт под эту
машину), в Docker и CI poppler ставится пакетом.

## 7. Что намеренно не сделано

- **Реклама не подключена.** `ADS_ENABLED` ложный, пока не задан `VITE_ADS_CLIENT`, а
  сниппет `context.js` не wired: до одобрения площадки рекламные рамки — обещание
  показа, которого нет.
- **БД нет осознанно.** Задача живёт ровно столько, сколько файл; реестра
  пользователей, истории и статистики нет, и добавлять их нужно с мыслью о
  соответствии политике конфиденциальности.
- **Админка выключена в проде** (`DJANGO_ENABLE_ADMIN`), поэтому `/static/` в nginx
  закомментирован.
- **Автодеплой выключен:** `deploy.yml` запускается только руками.
