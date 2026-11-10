#!/usr/bin/env bash
# Выкатка бэкенда на сервере. Запускается либо из GitHub Actions (deploy.yml
# передаёт этот файл по stdin), либо руками после `git pull`:
#
#   REPO_PATH=/var/www/convert bash backend/deploy.sh
#
# REPO_PATH — каталог репозитория на сервере. Нужен именно он, а не каталог
# скрипта: при передаче по stdin bash не знает, откуда его читают.
#
# Фронтенд этот скрипт не трогает — его rsync'ит workflow в WEB_ROOT, а раздаёт
# nginx из deploy/nginx.conf. Проверка ниже идёт по 127.0.0.1:8000, то есть
# смотрит на Django, а не на конфиг отдающей стороны: 502 снаружи при живом
# внутреннем ответе — это nginx, а не выкатка.
set -euo pipefail

REPO_PATH="${REPO_PATH:-/var/www/convert}"
COMPOSE_FILE="docker-compose.prod.yml"

cd "$REPO_PATH"

# Молчаливый reset съел бы чужую работу: если на сервере правят файлы в обход
# git, пусть деплой упадёт и покажет, что именно не закоммичено.
if [ -n "$(git status --porcelain)" ]; then
  echo "Рабочее дерево $REPO_PATH грязное:"
  git status --porcelain
  exit 1
fi

git fetch --quiet origin
git checkout --quiet main
# --ff-only: ветка на сервере обязана быть частью origin/main. Если история
# разошлась, это не тот код, который прогнали через CI.
git merge --ff-only --quiet origin/main

echo "Сервер на $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

cd backend
docker compose -f "$COMPOSE_FILE" pull --quiet redis || true
docker compose -f "$COMPOSE_FILE" build web
docker compose -f "$COMPOSE_FILE" up -d --build

# Миграции применяются внутри контейнера web (см. его command); ждём, пока он
# поднимется, и проверяем, что API отвечает. /api/status/<id>/ — самый дешёвый
# признак живости: он трогает и Django, и redis (result backend), и отдаёт 200
# на любом id. Фиксированный sleep проигрывал гонку: контейнер «Started», но
# migrate+collectstatic ещё идут и воркеры поднимаются через 10–20 секунд,
# поэтому опрашиваем циклом до 60 секунд.
docker compose -f "$COMPOSE_FILE" ps
api_ok=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/status/deploy-check/ >/dev/null 2>&1; then
    api_ok=1
    break
  fi
  sleep 2
done
if [ "$api_ok" -ne 1 ]; then
  echo "API не отвечает на /api/status/deploy-check/ за 60 с — последние строки логов web:"
  docker compose -f "$COMPOSE_FILE" logs --tail 40 web
  exit 1
fi

echo "Готово."
