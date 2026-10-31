FROM python:3.12-slim

# Запрещаем Python писать файлы кэша .pyc и включаем буферизацию логов
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Устанавливаем системные зависимости (poppler-utils необходим для работы pdf2image на Linux)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Отдельный слой для установки зависимостей для эффективного кэширования Docker
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Непривилегированный пользователь. Веб и воркер читают и пишут только рабочие
# файлы и базу; права root им не нужны, а без них любой RCE в Pillow или
# reportlab становится записью в /app и в хост.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app

# Копируем исходный код сразу с владельцем app: иначе файлы, созданные на этапе
# сборки, процесс без прав не перезапишет (collectstatic, sqlite).
COPY --chown=app:app . /app/

# Папка для временных файлов: в проде это отдельный том, права задаём заранее
RUN mkdir -p /app/tmp_files && chown -R app:app /app

USER app

EXPOSE 8000

# Прод-запуск: gunicorn вместо runserver. Dev-файл docker-compose.yml переопределяет
# команду на runserver, чтобы работал автоперезапуск по изменению кода.
CMD ["gunicorn", "core.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120"]
