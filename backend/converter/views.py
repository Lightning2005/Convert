import os
import uuid
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser
from rest_framework import status
from django.core.files.storage import FileSystemStorage
from django.conf import settings  # Добавили импорт настроек
from django.http import FileResponse, Http404
from django.urls import reverse
from celery.result import AsyncResult
from .strategies import ConverterFactory

from .tasks import images_to_pdf_task, pdf_to_images_task, generic_convert_task

MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
SUPPORTED_IMAGE_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.webp',
    '.tiff', '.tif', '.ico', '.bmp', '.heic'
}

# Динамический путь для совместимости Linux (Docker) / Windows
TMP_DIR = os.path.join(settings.BASE_DIR, 'tmp_files')


def validate_extension(filename, allowed_extensions):
    _, ext = os.path.splitext(filename.lower())
    return ext in allowed_extensions


def save_uploaded_file(file_obj) -> str:
    """Сохраняет файл на диск и возвращает абсолютный путь к нему."""
    ext = os.path.splitext(file_obj.name)[1]
    unique_filename = f"{uuid.uuid4()}{ext}"
    fs = FileSystemStorage(location=TMP_DIR)
    saved_name = fs.save(unique_filename, file_obj)
    return fs.path(saved_name)


# ==========================================
# ОСНОВНЫЕ КОНВЕРТЕРЫ (ОЧЕРЕДЬ CELERY)
# ==========================================

class ImagesToPdfView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, format=None):
        uploaded_images = request.FILES.getlist('images')

        if not uploaded_images:
            return Response({"error": "Файлы не переданы"}, status=status.HTTP_400_BAD_REQUEST)

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

        return Response({
            "message": "Изображения приняты в обработку.",
            "task_id": task.id
        }, status=status.HTTP_202_ACCEPTED)


class PdfToImagesView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, format=None):
        uploaded_pdf = request.FILES.get('pdf')

        if not uploaded_pdf:
            return Response({"error": "Файл PDF не передан"}, status=status.HTTP_400_BAD_REQUEST)

        if not validate_extension(uploaded_pdf.name, {'.pdf'}):
            return Response({"error": "Неверный формат файла. Требуется PDF"}, status=status.HTTP_400_BAD_REQUEST)

        if uploaded_pdf.size > MAX_FILE_SIZE_BYTES:
            return Response({"error": "Размер файла превышает лимит 50 МБ"}, status=status.HTTP_400_BAD_REQUEST)

        target_format = request.data.get('target', 'jpg').lower()
        if target_format not in ('jpg', 'jpeg', 'png'):
            return Response({"error": "Поддерживаются только форматы JPG и PNG"}, status=status.HTTP_400_BAD_REQUEST)

        pdf_path = save_uploaded_file(uploaded_pdf)
        output_filename = f"converted_pages_{uuid.uuid4()}.zip"

        task = pdf_to_images_task.delay(pdf_path, output_filename, target_format)

        return Response({
            "message": "PDF принят в обработку.",
            "task_id": task.id
        }, status=status.HTTP_202_ACCEPTED)


class GenericConvertView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, *args, **kwargs):
        uploaded_file = request.FILES.get('file')
        target_format = request.data.get('target', '').lower()

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

        return Response({
            "message": "Файл принят в обработку.",
            "task_id": task.id
        }, status=status.HTTP_202_ACCEPTED)


# ==========================================
# СИСТЕМНЫЕ ЭНДПОИНТЫ CELERY (СТАТУС И СКАЧИВАНИЕ)
# ==========================================

class TaskStatusView(APIView):
    def get(self, request, task_id, *args, **kwargs):
        task_result = AsyncResult(task_id)
        response_data = {
            "task_id": task_id,
            "status": task_result.status
        }

        if task_result.status == 'SUCCESS':
            result_data = task_result.result
            if result_data and result_data.get("status") == "SUCCESS":
                filename = result_data.get("result_file")
                download_url = request.build_absolute_uri(
                    reverse('file_download', kwargs={'filename': filename})
                )
                response_data["download_url"] = download_url
            else:
                response_data["status"] = "FAILURE"
                response_data["error"] = result_data.get("error", "Unknown error during conversion")

        elif task_result.status == 'FAILURE':
            response_data["error"] = str(task_result.info)

        return Response(response_data, status=status.HTTP_200_OK)


class FileDownloadView(APIView):
    def get(self, request, filename, *args, **kwargs):
        clean_filename = os.path.basename(filename)
        file_path = os.path.join(TMP_DIR, clean_filename)

        if not os.path.exists(file_path):
            raise Http404("Файл не найден или был удален по истечении времени.")

        response = FileResponse(open(file_path, 'rb'), as_attachment=True, filename=clean_filename)
        return response