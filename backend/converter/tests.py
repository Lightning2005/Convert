import io
import os
import re
import zipfile
from unittest.mock import PropertyMock, patch
from urllib.parse import urlparse

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APITestCase

from . import services

TMP_DIR = os.path.join(settings.BASE_DIR, 'tmp_files')

# Celery выполняет задачи синхронно в тестах, без Redis
CELERY_TEST_SETTINGS = {
    'CELERY_TASK_ALWAYS_EAGER': True,
    'CELERY_TASK_EAGER_PROPAGATES': True,
    'CELERY_TASK_STORE_EAGER_RESULT': True,
    'CELERY_RESULT_BACKEND': 'cache+memory://',
    'CACHES': {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        }
    },
}


class ConverterAPITestBase(APITestCase):
    """Базовый класс с хелперами для async API (202 → status → download)."""

    def setUp(self):
        os.makedirs(TMP_DIR, exist_ok=True)

    def generate_test_image(self, filename, ext='JPEG', size=(100, 100), color='blue'):
        file_buf = io.BytesIO()
        image = Image.new('RGB', size, color=color)
        image.save(file_buf, format=ext)
        file_buf.name = filename
        file_buf.seek(0)
        return file_buf

    def make_upload(self, filename, ext='JPEG', **kwargs):
        buffer = self.generate_test_image(filename, ext=ext, **kwargs)
        mime_map = {
            'JPEG': 'image/jpeg',
            'PNG': 'image/png',
            'WEBP': 'image/webp',
            'TIFF': 'image/tiff',
        }
        return SimpleUploadedFile(
            filename,
            buffer.read(),
            content_type=mime_map.get(ext, 'application/octet-stream'),
        )

    def create_test_pdf_upload(self):
        img_path = os.path.join(TMP_DIR, f'test_page_{os.getpid()}.jpg')
        pdf_path = os.path.join(TMP_DIR, f'test_source_{os.getpid()}.pdf')

        img = Image.new('RGB', (100, 100), color='red')
        img.save(img_path, format='JPEG')
        services.convert_images_to_pdf([img_path], pdf_path)

        with open(pdf_path, 'rb') as pdf_file:
            return SimpleUploadedFile('test.pdf', pdf_file.read(), content_type='application/pdf')

    def submit_and_download(self, url, data):
        """POST → 202 + task_id → status SUCCESS → скачивание файла."""
        response = self.client.post(url, data, format='multipart')
        self.assertEqual(response.status_code, 202, response.data)
        self.assertIn('task_id', response.data)

        status_url = reverse('task_status', kwargs={'task_id': response.data['task_id']})
        status_response = self.client.get(status_url)

        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.data['status'], 'SUCCESS', status_response.data)
        self.assertIn('download_url', status_response.data)

        download_path = urlparse(status_response.data['download_url']).path
        download_response = self.client.get(download_path)

        self.assertEqual(download_response.status_code, 200)
        return download_response


@override_settings(**CELERY_TEST_SETTINGS)
class ImagesToPdfAPITestCase(ConverterAPITestBase):

    def test_successful_images_to_pdf_conversion(self):
        url = reverse('images_to_pdf')
        data = {
            'images': [
                self.make_upload('test1.jpg', 'JPEG'),
                self.make_upload('test2.png', 'PNG'),
            ]
        }

        download_response = self.submit_and_download(url, data)
        pdf_content = b''.join(download_response.streaming_content)

        self.assertTrue(len(pdf_content) > 0)
        self.assertEqual(pdf_content[:4], b'%PDF')

    def test_pdf_all_pages_use_portrait_a4(self):
        """Portrait и landscape изображения → все страницы portrait A4."""
        url = reverse('images_to_pdf')
        data = {
            'images': [
                self.make_upload('portrait.jpg', 'JPEG', size=(100, 200)),
                self.make_upload('landscape.png', 'PNG', size=(200, 100)),
            ]
        }

        download_response = self.submit_and_download(url, data)
        pdf_content = b''.join(download_response.streaming_content)

        mediaboxes = re.findall(rb'/MediaBox\s*\[([^\]]+)\]', pdf_content)
        self.assertEqual(len(mediaboxes), 2)

        for box in mediaboxes:
            parts = [float(value) for value in box.decode().split()]
            width = parts[2] - parts[0]
            height = parts[3] - parts[1]
            self.assertGreater(height, width, 'Каждая страница должна быть portrait A4')

    def test_conversion_fails_without_images(self):
        url = reverse('images_to_pdf')
        response = self.client.post(url, {}, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {'error': 'Файлы не переданы'})

    def test_images_to_pdf_files_too_large(self):
        url = reverse('images_to_pdf')
        data = {
            'images': [
                self.make_upload('test1.jpg', 'JPEG'),
                self.make_upload('test2.jpg', 'JPEG'),
            ]
        }

        with patch('django.core.files.uploadedfile.UploadedFile.size', new_callable=PropertyMock) as mock_size:
            mock_size.return_value = 26 * 1024 * 1024
            response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data,
            {'error': 'Превышен суммарный лимит размера файлов (макс. 50 МБ)'},
        )


@override_settings(**CELERY_TEST_SETTINGS)
class PdfToImagesAPITestCase(ConverterAPITestBase):

    def test_successful_pdf_to_jpg_conversion(self):
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload(), 'target': 'jpg'}

        download_response = self.submit_and_download(url, data)
        zip_content = b''.join(download_response.streaming_content)

        self.assertTrue(len(zip_content) > 0)
        with zipfile.ZipFile(io.BytesIO(zip_content)) as archive:
            self.assertTrue(any(name.endswith('.jpg') for name in archive.namelist()))

    def test_pdf_to_png_conversion(self):
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload(), 'target': 'png'}

        download_response = self.submit_and_download(url, data)
        zip_content = b''.join(download_response.streaming_content)

        with zipfile.ZipFile(io.BytesIO(zip_content)) as archive:
            names = archive.namelist()
            self.assertTrue(any(name.endswith('.png') for name in names))
            self.assertFalse(any(name.endswith('.jpg') for name in names))

    def test_pdf_to_webp_conversion(self):
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload(), 'target': 'webp'}

        download_response = self.submit_and_download(url, data)
        zip_content = b''.join(download_response.streaming_content)

        with zipfile.ZipFile(io.BytesIO(zip_content)) as archive:
            self.assertTrue(any(name.endswith('.webp') for name in archive.namelist()))

    def test_pdf_to_images_invalid_target(self):
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload(), 'target': 'tiff'}

        response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)

    def test_pdf_to_images_file_too_large(self):
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload()}

        with patch('django.core.files.uploadedfile.UploadedFile.size', new_callable=PropertyMock) as mock_size:
            mock_size.return_value = 51 * 1024 * 1024
            response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {'error': 'Размер файла превышает лимит 50 МБ'})


@override_settings(**CELERY_TEST_SETTINGS)
class GenericConvertAPITestCase(ConverterAPITestBase):

    def setUp(self):
        super().setUp()
        self.url = reverse('generic_convert')

    def _convert_and_get_content(self, source_ext, target, filename=None):
        filename = filename or f'test.{source_ext.lower()}'
        ext_map = {'JPG': 'JPEG', 'JPEG': 'JPEG', 'PNG': 'PNG', 'WEBP': 'WEBP', 'TIFF': 'TIFF'}
        pil_ext = ext_map.get(source_ext.upper(), source_ext.upper())

        data = {
            'file': self.make_upload(filename, pil_ext),
            'target': target,
        }
        download_response = self.submit_and_download(self.url, data)
        return b''.join(download_response.streaming_content)

    def test_convert_png_to_webp(self):
        content = self._convert_and_get_content('PNG', 'webp')
        self.assertTrue(len(content) > 0)
        self.assertEqual(content[:4], b'RIFF')
        self.assertIn(b'WEBP', content[8:16])

    def test_convert_png_to_jpg(self):
        content = self._convert_and_get_content('PNG', 'jpg')
        self.assertTrue(len(content) > 0)
        self.assertEqual(content[:2], b'\xff\xd8')

    def test_convert_jpg_to_png(self):
        content = self._convert_and_get_content('JPG', 'png', 'test.jpg')
        self.assertTrue(len(content) > 0)
        self.assertEqual(content[:4], b'\x89PNG')

    def test_convert_webp_to_jpg(self):
        content = self._convert_and_get_content('WEBP', 'jpg', 'test.webp')
        self.assertTrue(len(content) > 0)
        self.assertEqual(content[:2], b'\xff\xd8')

    def test_convert_tiff_to_jpg(self):
        content = self._convert_and_get_content('TIFF', 'jpg', 'test.tiff')
        self.assertTrue(len(content) > 0)
        self.assertEqual(content[:2], b'\xff\xd8')

    def test_convert_jpg_to_ico(self):
        """Проверяет, что иконка успешно создается и имеет правильный размер слоя."""
        content = self._convert_and_get_content('JPG', 'ico', 'test.jpg')
        self.assertTrue(len(content) > 0)

        with Image.open(io.BytesIO(content)) as ico:
            # Pillow считывает размер первого (и в нашем случае единственного) слоя
            self.assertEqual(ico.size, (256, 256))

    def test_ico_file_is_valid_single_frame(self):
        """Проверяет структуру ICO: заголовок и наличие ровно 1 кадра."""
        content = self._convert_and_get_content('PNG', 'ico', 'test.png')

        # Минимальная валидация сигнатуры ICO (0, 1, count)
        # Первые 2 байта: Reserved (0x0000)
        self.assertEqual(content[0:2], b'\x00\x00')
        # Следующие 2 байта: Type (0x0001 для ICO)
        self.assertEqual(content[2:4], b'\x01\x00')

        # Следующие 2 байта: Количество изображений в контейнере (должно быть 1)
        count = int.from_bytes(content[4:6], 'little')
        self.assertEqual(count, 1)

    def test_invalid_target_format(self):
        data = {
            'file': self.make_upload('test.png', 'PNG'),
            'target': 'pdf',
        }
        response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)

    def test_missing_file(self):
        response = self.client.post(self.url, {}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {'error': 'Файл не передан'})

    def test_generic_convert_file_too_large(self):
        data = {
            'file': self.make_upload('test.png', 'PNG'),
            'target': 'webp',
        }

        with patch('django.core.files.uploadedfile.UploadedFile.size', new_callable=PropertyMock) as mock_size:
            mock_size.return_value = 51 * 1024 * 1024
            response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {'error': 'Размер файла превышает лимит 50 МБ'})


@override_settings(**CELERY_TEST_SETTINGS)
class TaskSystemAPITestCase(ConverterAPITestBase):

    def test_task_status_returns_download_url_on_success(self):
        url = reverse('generic_convert')
        data = {
            'file': self.make_upload('test.png', 'PNG'),
            'target': 'jpg',
        }

        post_response = self.client.post(url, data, format='multipart')
        task_id = post_response.data['task_id']

        status_response = self.client.get(reverse('task_status', kwargs={'task_id': task_id}))

        self.assertEqual(status_response.data['status'], 'SUCCESS')
        self.assertIn('download_url', status_response.data)

    def test_download_nonexistent_file_returns_404(self):
        url = reverse('file_download', kwargs={'filename': 'nonexistent_file.pdf'})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)
