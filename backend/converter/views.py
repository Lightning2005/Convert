import os
import uuid
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser
from rest_framework import status
from django.core.cache import cache
from django.core.files.storage import FileSystemStorage
from django.conf import settings  # Добавили импорт настроек
from django.http import FileResponse, Http404
from django.urls import reverse
from celery.result import AsyncResult
from .strategies import ConverterFactory

from .tasks import images_to_pdf_task, pdf_to_images_task, generic_convert_task

MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_FILES_PER_REQUEST = 50
MAX_TASK_IDS_PER_QUERY = 100
SUPPORTED_IMAGE_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.webp',
    '.tiff', '.tif', '.ico', '.bmp', '.heic'
}

# Типы для готовых файлов: перечисляем явно, потому что встроенный в Python
# mimetypes не знает .webp, а системных mime-таблиц в образе нет — иначе
# FileResponse отдавал application/octet-stream и просмотрщик не понимал файл.
DOWNLOAD_CONTENT_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.ico': 'image/vnd.microsoft.icon',
    '.bmp': 'image/bmp',
    '.heic': 'image/heic',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
}

# Динамический путь для совместимости Linux (Docker) / Windows
TMP_DIR = os.path.join(settings.BASE_DIR, 'tmp_files')


def validate_extension(filename, allowed_extensions):
    _, ext = os.path.splitext(filename.lower())
    return ext in allowed_extensions


def get_text_field(data, name, default=None):
    """Нижний регистр текстового поля запроса.

    DRF подмешивает FILES в request.data, поэтому «target» может прилететь
    файловой частью. Такое поле не строка: возвращаем None, чтобы view ответил
    400, а не уронил запрос на .lower() об UploadedFile.
    """
    value = data.get(name)
    if value is None:
        return default
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    return value.strip().lower() if isinstance(value, str) else None


def save_uploaded_file(file_obj) -> str:
    """Сохраняет файл на диск и возвращает абсолютный путь к нему."""
    ext = os.path.splitext(file_obj.name)[1]
    unique_filename = f"{uuid.uuid4()}{ext}"
    fs = FileSystemStorage(location=TMP_DIR)
    saved_name = fs.save(unique_filename, file_obj)
    return fs.path(saved_name)


# Пока воркер не начал задачу, Celery отдаёт по её id состояние PENDING — точно
# такое же, как по несуществующему id. Метка в кэше различает их: «ждёт своей
# очереди» против «такой задачи мы никогда не принимали».
QUEUED_MARK_TTL = 2 * 3600


def mark_task_queued(task_id):
    cache.set(f'queued:{task_id}', 1, QUEUED_MARK_TTL)


def task_snapshot(task_id):
    """Состояние задачи в том виде, в котором его читает фронтенд."""
    result = AsyncResult(task_id)
    snapshot = {'task_id': task_id, 'status': result.status}

    if result.status == 'SUCCESS':
        payload = result.result or {}
        if payload.get('status') == 'SUCCESS':
            filename = payload.get('result_file')
            # Отдаём путь, а не absolute URI: адрес сборки ответа зависит от
            # заголовка Host, а фронтенд сам знает, откуда он качает.
            snapshot['download_url'] = reverse('file_download', kwargs={'filename': filename})
        else:
            snapshot['status'] = 'FAILURE'
            snapshot['error'] = payload.get('error', 'Unknown error during conversion')
    elif result.status == 'FAILURE':
        snapshot['error'] = str(result.info)
    elif not cache.get(f'queued:{task_id}'):
        snapshot['status'] = 'UNKNOWN'
        snapshot['error'] = 'Задача не найдена: возможно, её id устарел.'

    return snapshot


# ==========================================
# ОСНОВНЫЕ КОНВЕРТЕРЫ (ОЧЕРЕДЬ CELERY)
# ==========================================

class ImagesToPdfView(APIView):
    parser_classes = [MultiPartParser]
    throttle_scope = 'convert'

    def post(self, request, format=None):
        uploaded_images = request.FILES.getlist('images')

        if not uploaded_images:
            return Response({"error": "Файлы не переданы"}, status=status.HTTP_400_BAD_REQUEST)

        if len(uploaded_images) > MAX_FILES_PER_REQUEST:
            return Response(
                {"error": f"Слишком много файлов в одном запросе: максимум {MAX_FILES_PER_REQUEST}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        total_size = 0
        for img in uploaded_images:
            if not validate_extension(img.name, SUPPORTED_IMAGE_EXTENSIONS):
                return Response({"error": f"Неподдерживаемый формат файла: {img.name}"}, status=status.HTTP_400_BAD_REQUEST)
            total_size += img.size

        if total_size > MAX_FILE_SIZE_BYTES:
            return Response({"error": "Превышен суммарный лимит размера файлов (макс. 50 МБ)"}, status=status.HTTP_400_BAD_REQUEST)

        saved_paths = [save_uploaded_file(img) for img in uploaded_images]
        output_filename = f"converted_images_{uuid.uuid4()}.pdf"

        task = images_to_pdf_task.delay(saved_paths, output_filename)
        mark_task_queued(task.id)

        return Response({
            "message": "Изображения приняты в обработку.",
            "task_id": task.id
        }, status=status.HTTP_202_ACCEPTED)


class PdfToImagesView(APIView):
    parser_classes = [MultiPartParser]
    throttle_scope = 'convert'

    def post(self, request, format=None):
        uploaded_pdf = request.FILES.get('pdf')

        if not uploaded_pdf:
            return Response({"error": "Файл PDF не передан"}, status=status.HTTP_400_BAD_REQUEST)

        if not validate_extension(uploaded_pdf.name, {'.pdf'}):
            return Response({"error": "Неверный формат файла. Требуется PDF"}, status=status.HTTP_400_BAD_REQUEST)

        if uploaded_pdf.size > MAX_FILE_SIZE_BYTES:
            return Response({"error": "Размер файла превышает лимит 50 МБ"}, status=status.HTTP_400_BAD_REQUEST)

        target_format = get_text_field(request.data, 'target', 'jpg')
        if target_format not in ('jpg', 'jpeg', 'png', 'webp'):
            return Response({"error": "Поддерживаются только форматы JPG, PNG, WEBP"}, status=status.HTTP_400_BAD_REQUEST)

        pdf_path = save_uploaded_file(uploaded_pdf)
        output_filename = f"converted_pages_{uuid.uuid4()}.zip"

        task = pdf_to_images_task.delay(pdf_path, output_filename, target_format)
        mark_task_queued(task.id)

        return Response({
            "message": "PDF принят в обработку.",
            "task_id": task.id
        }, status=status.HTTP_202_ACCEPTED)


class GenericConvertView(APIView):
    parser_classes = [MultiPartParser]
    throttle_scope = 'convert'

    def post(self, request, *args, **kwargs):
        uploaded_file = request.FILES.get('file')
        target_format = get_text_field(request.data, 'target')

        if not uploaded_file:
            return Response({"error": "Файл не передан"}, status=status.HTTP_400_BAD_REQUEST)

        # Динамическое получение поддерживаемых форматов из фабрики стратегий
        supported_targets = ConverterFactory.get_supported_generic_targets()

        if target_format not in supported_targets:
            return Response({"error": "Целевой формат не поддерживается"}, status=status.HTTP_400_BAD_REQUEST)

        if not validate_extension(uploaded_file.name, SUPPORTED_IMAGE_EXTENSIONS):
            return Response({"error": "Исходный формат файла не поддерживается"}, status=status.HTTP_400_BAD_REQUEST)

        if uploaded_file.size > MAX_FILE_SIZE_BYTES:
            return Response({"error": "Размер файла превышает лимит 50 МБ"}, status=status.HTTP_400_BAD_REQUEST)

        input_path = save_uploaded_file(uploaded_file)
        output_filename = f"converted_file_{uuid.uuid4()}.{target_format}"

        task = generic_convert_task.delay(input_path, output_filename, target_format)
        mark_task_queued(task.id)

        return Response({
            "message": "Файл принят в обработку.",
            "task_id": task.id
        }, status=status.HTTP_202_ACCEPTED)


# ==========================================
# СИСТЕМНЫЕ ЭНДПОИНТЫ CELERY (СТАТУС И СКАЧИВАНИЕ)
# ==========================================

class TaskStatusView(APIView):
    throttle_scope = 'poll'

    def get(self, request, task_id, *args, **kwargs):
        return Response(task_snapshot(task_id), status=status.HTTP_200_OK)


class BatchTaskStatusView(APIView):
    """Один запрос вместо N: батч из 50 файлов опрашивал статус 50 раз за цикл."""

    throttle_scope = 'poll'

    def get(self, request, *args, **kwargs):
        raw = request.GET.get('ids', '')
        ids = list(dict.fromkeys(part for part in raw.split(',') if part))

        if not ids:
            return Response({"error": "Не передан ни один task_id"}, status=status.HTTP_400_BAD_REQUEST)

        if len(ids) > MAX_TASK_IDS_PER_QUERY:
            return Response(
                {"error": f"Слишком много task_id в одном запросе: максимум {MAX_TASK_IDS_PER_QUERY}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        return Response({"tasks": [task_snapshot(task_id) for task_id in ids]}, status=status.HTTP_200_OK)


class FileDownloadView(APIView):
    throttle_scope = 'download'

    def get(self, request, filename, *args, **kwargs):
        clean_filename = os.path.basename(filename)
        file_path = os.path.join(TMP_DIR, clean_filename)

        if not os.path.exists(file_path):
            raise Http404("Файл не найден или был удален по истечении времени.")

        extension = os.path.splitext(clean_filename)[1].lower()
        response = FileResponse(
            open(file_path, 'rb'),
            as_attachment=True,
            filename=clean_filename,
            content_type=DOWNLOAD_CONTENT_TYPES.get(extension),
        )
        return response