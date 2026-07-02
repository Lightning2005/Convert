FROM python:3.11-slim

# Запрещаем Python писать файлы кэша .pyc и включаем буферизацию логов
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Устанавливаем системные зависимости (poppler-utils необходим для работы pdf2image на Linux)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Отдельный слой для установки зависимостей для эффективного кэширования Docker
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Копируем исходный код
COPY . /app/

# Создаем папку для временных файлов внутри контейнера
RUN mkdir -p /app/tmp_files