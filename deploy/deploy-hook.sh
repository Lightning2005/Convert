#!/bin/sh
# Единственная точка входа для CI-ключа GitHub Actions (command= в
# authorized_keys). Пропускает ровно те команды, которые шлёт deploy.yml:
# mkdir под WEB_ROOT, rsync --server и bash -s со deploy.sh по stdin. Всё
# остальное — включая интерактивный шелл — отрезается.
case "$SSH_ORIGINAL_COMMAND" in
  "mkdir -p '/var/www/convert/dist'")
    exec /bin/sh -c "$SSH_ORIGINAL_COMMAND"
    ;;
  rsync\ --server*)
    exec /bin/sh -c "$SSH_ORIGINAL_COMMAND"
    ;;
  "REPO_PATH='/var/www/convert' bash -s")
    exec /bin/bash -s
    ;;
  "")
    echo "deploy-hook: interactive shells are not allowed" >&2
    exit 1
    ;;
  *)
    echo "deploy-hook: denied command: $SSH_ORIGINAL_COMMAND" >&2
    exit 1
    ;;
esac
