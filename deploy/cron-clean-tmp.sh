#!/bin/sh
# Резервная очистка временных файлов Convefy на случай аварийной остановки Celery Beat.
# Установка в cron хоста:
#   sudo cp deploy/cron-clean-tmp.sh /etc/cron.hourly/clean-tmp
#   sudo chmod +x /etc/cron.hourly/clean-tmp
#
# Celery Beat удаляет файлы старше 55 минут каждые 5 минут.
# Этот скрипт удаляет любые файлы старше 120 минут на уровне хоста.
find /var/www/convert/tmp_files -type f -mmin +120 -delete 2>/dev/null || true
