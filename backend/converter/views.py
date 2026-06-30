from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser
from django.http import FileResponse
import os
from .services import convert_images_to_pdf, convert_pdf_to_images, convert_image

MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
SUPPORTED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.tiff', '.ico'}

def validate_extension(filename, allowed_extensions):
    _, ext = os.path.splitext(filename.lower())
    return ext in allowed_extensions

class ImagesToPdfView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, format=None):
        uploaded_images = request.FILES.getlist('images')

        if not uploaded_images:
            return Response({"error": "Файлы не переданы"}, status=400)

        total_size = 0
        for img in uploaded_images:
            if not validate_extension(img.name, SUPPORTED_IMAGE_EXTENSIONS):
                return Response({"error": f"Неподдерживаемый формат файла: {img.name}"}, status=400)
            total_size += img.size

        if total_size > MAX_FILE_SIZE_BYTES:
            return Response({"error": "Превышен суммарный лимит размера файлов (макс. 50 МБ)"}, status=400)

        try:
            pdf_file = convert_images_to_pdf(uploaded_images)
            return FileResponse(
                pdf_file,
                as_attachment=True,
                filename="converted_images.pdf",
                content_type='application/pdf'
            )
        except Exception as e:
            return Response({"error": f"Ошибка конвертации: {str(e)}"}, status=500)


class PdfToImagesView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, format=None):
        uploaded_pdf = request.FILES.get('pdf')

        if not uploaded_pdf:
            return Response({"error": "Файл PDF не передан"}, status=400)

        if not validate_extension(uploaded_pdf.name, {'.pdf'}):
            return Response({"error": "Неверный формат файла. Требуется PDF"}, status=400)

        if uploaded_pdf.size > MAX_FILE_SIZE_BYTES:
            return Response({"error": "Размер файла превышает лимит 50 МБ"}, status=400)

        target_format = request.data.get('target', 'jpg').lower()
        if target_format not in ('jpg', 'jpeg', 'png'):
            return Response({"error": "Поддерживаются только форматы JPG и PNG"}, status=400)

        try:
            zip_file = convert_pdf_to_images(uploaded_pdf, target_format)
            return FileResponse(
                zip_file,
                as_attachment=True,
                filename="converted_pages.zip",
                content_type='application/zip'
            )
        except Exception as e:
            return Response({"error": f"Ошибка конвертации PDF: {str(e)}"}, status=500)


class GenericConvertView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, *args, **kwargs):
        uploaded_file = request.FILES.get('file')
        target_format = request.data.get('target', '').lower()

        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'webp': 'image/webp',
            'tiff': 'image/tiff',
            'ico': 'image/x-icon',
        }

        if not uploaded_file:
            return Response({"error": "Файл не передан"}, status=400)

        if target_format not in content_types:
            return Response({"error": "Целевой формат не поддерживается"}, status=400)

        if not validate_extension(uploaded_file.name, SUPPORTED_IMAGE_EXTENSIONS):
            return Response({"error": "Исходный формат файла не поддерживается"}, status=400)

        if uploaded_file.size > MAX_FILE_SIZE_BYTES:
            return Response({"error": "Размер файла превышает лимит 50 МБ"}, status=400)

        try:
            result_file = convert_image(uploaded_file, target_format)
            return FileResponse(
                result_file,
                as_attachment=True,
                filename=f"converted_file.{target_format}",
                content_type=content_types[target_format]
            )
        except Exception as e:
            return Response({"error": f"Ошибка: {str(e)}"}, status=500)