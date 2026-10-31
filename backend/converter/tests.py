import atexit
import io
import os
import re
import struct
import tempfile
import time
import uuid
import zipfile
import zlib
from unittest.mock import Mock, PropertyMock, patch
from urllib.parse import urlparse

from celery.schedules import crontab
from django.conf import settings
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings, SimpleTestCase
from django.urls import reverse
from PIL import Image, UnidentifiedImageError
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from . import services
from .checks import check_tmp_files_writable
from .errors import describe_failure, GENERIC_FAILURE

# Рабочие файлы тестов живут в отдельном каталоге, а не в backend/tmp_files:
# иначе прогон оставляет в рабочем каталоге фикстуры, которые приложение никогда
# не создавало, и проверка «каталог чист» перестаёт что-либо значить.
_TEST_TMP_DIR = tempfile.TemporaryDirectory(prefix='konvert-tests-', ignore_cleanup_errors=True)
atexit.register(_TEST_TMP_DIR.cleanup)


def tmp_dir():
    """Каталог, который в данный момент видит приложение (см. settings.TMP_FILES_DIR)."""
    return str(settings.TMP_FILES_DIR)


def fake_huge_png(width=10000, height=10000):
    """PNG, который весит десятки байт, но объявляет 10000x10000 пикселей.

    Ровно так выглядит картинка, способная распаковаться в ~300 МБ в воркере:
    заголовок читается Pillow без декодирования, поэтому проверка отрабатывает
    до очереди.
    """
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(b'\x00' * 10))
            + chunk(b'IEND', b''))

# Celery выполняет задачи синхронно в тестах, без Redis
CELERY_TEST_SETTINGS = {
    'CELERY_TASK_ALWAYS_EAGER': True,
    'CELERY_TASK_EAGER_PROPAGATES': True,
    'CELERY_TASK_STORE_EAGER_RESULT': True,
    'CELERY_RESULT_BACKEND': 'cache+memory://',
    'TMP_FILES_DIR': _TEST_TMP_DIR.name,
    'CACHES': {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        }
    },
}


class ConverterAPITestBase(APITestCase):
    """Базовый класс с хелперами для async API (202 → status → download)."""

    def setUp(self):
        os.makedirs(tmp_dir(), exist_ok=True)

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

    @staticmethod
    def remove_quietly(path):
        if os.path.exists(path):
            os.remove(path)

    def create_test_pdf_upload(self, pages=1):
        pdf_path = os.path.join(tmp_dir(), f'test_source_{os.getpid()}.pdf')
        img_paths = [
            os.path.join(tmp_dir(), f'test_page_{os.getpid()}_{index}.jpg')
            for index in range(pages)
        ]
        # Фикстуры удаляем сразу: каталог тестов переживает все прогоны одного
        # процесса, и оставшиеся в нём файлы ломают проверку «сервер ничего не
        # забыл в tmp_files».
        self.addCleanup(self.remove_quietly, pdf_path)

        for img_path in img_paths:
            self.addCleanup(self.remove_quietly, img_path)
            Image.new('RGB', (100, 100), color='red').save(img_path, format='JPEG')

        services.convert_images_to_pdf(img_paths, pdf_path)

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
        self.assertEqual(download_response['Content-Type'], 'application/pdf')

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

    def test_images_to_pdf_too_many_files(self):
        url = reverse('images_to_pdf')
        data = {'images': [self.make_upload(f'test{i}.jpg', 'JPEG') for i in range(51)]}

        response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data,
            {'error': 'Слишком много файлов в одном запросе: максимум 50'},
        )

    def test_giant_image_rejected_before_queueing(self):
        """За 300 МБ распакованных пикселей файл платит 300 КБ на диске."""
        before = set(os.listdir(tmp_dir()))
        url = reverse('images_to_pdf')
        data = {
            'images': [
                self.make_upload('ok.jpg', 'JPEG'),
                SimpleUploadedFile('giant.png', fake_huge_png(), content_type='image/png'),
            ]
        }

        with patch('converter.tasks.images_to_pdf_task.apply_async') as mock_delay:
            response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn('Мпикс', response.data['error'])
        mock_delay.assert_not_called()
        # Отклонённые загрузки не должны оставаться в tmp_files (beat вправе
        # чистить старые файлы, поэтому сравниваем только появившиеся).
        self.assertEqual(set(os.listdir(tmp_dir())).difference(before), set())

    def test_missing_source_image_fails_instead_of_short_pdf(self):
        """Исходник мог исчезнуть из tmp_files, пока задача ждала в очереди."""
        from .tasks import images_to_pdf_task

        source = os.path.join(tmp_dir(), f'present_{uuid.uuid4().hex}.jpg')
        vanished = os.path.join(tmp_dir(), f'vanished_{uuid.uuid4().hex}.jpg')
        output_filename = f'missing_source_{uuid.uuid4().hex}.pdf'
        self.addCleanup(self.remove_quietly, source)
        Image.new('RGB', (100, 100), 'blue').save(source, format='JPEG')

        result = images_to_pdf_task.apply(args=[[source, vanished], output_filename]).get()

        self.assertEqual(result['status'], 'FAILURE')
        self.assertIn('1 из 2', result['error'])
        # Укороченный PDF хуже ошибки: пользователь не заметит потерю страницы.
        self.assertFalse(os.path.exists(os.path.join(tmp_dir(), output_filename)))


@override_settings(**CELERY_TEST_SETTINGS)
class PdfToImagesAPITestCase(ConverterAPITestBase):

    def test_successful_pdf_to_jpg_conversion(self):
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload(), 'target': 'jpg'}

        download_response = self.submit_and_download(url, data)
        zip_content = b''.join(download_response.streaming_content)

        self.assertTrue(len(zip_content) > 0)
        self.assertEqual(download_response['Content-Type'], 'application/zip')
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

    def test_chunked_rendering_keeps_page_numbering(self):
        """Рендер чанками не должен сдвинуть или потерять нумерацию страниц."""
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload(pages=5), 'target': 'png'}

        with patch('converter.strategies.PAGE_CHUNK', 2):
            download_response = self.submit_and_download(url, data)

        zip_content = b''.join(download_response.streaming_content)
        with zipfile.ZipFile(io.BytesIO(zip_content)) as archive:
            numbers = sorted(int(name.split('_')[1].split('.')[0]) for name in archive.namelist())

        self.assertEqual(numbers, [1, 2, 3, 4, 5])

    def test_pdf_without_pages_fails_instead_of_empty_zip(self):
        """0 страниц → внятная ошибка, а не SUCCESS с пустым архивом."""
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload(), 'target': 'jpg'}

        with patch('converter.strategies.pdfinfo_from_path', return_value={'Pages': 0}):
            post_response = self.client.post(url, data, format='multipart')
            status_response = self.client.get(
                reverse('task_status', kwargs={'task_id': post_response.data['task_id']})
            )

        self.assertEqual(status_response.data['status'], 'FAILURE', status_response.data)
        self.assertEqual(status_response.data['error'], 'В документе нет страниц.')

    def test_pdf_to_images_invalid_target(self):
        url = reverse('pdf_to_images')
        data = {'pdf': self.create_test_pdf_upload(), 'target': 'tiff'}

        response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)

    def test_pdf_to_images_target_as_file_part_is_rejected(self):
        """DRF смешивает FILES в request.data: target-файл — это 400, а не 500."""
        url = reverse('pdf_to_images')
        data = {
            'pdf': self.create_test_pdf_upload(),
            'target': SimpleUploadedFile('target', b'jpg', content_type='text/plain'),
        }

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

    def test_ico_keeps_source_aspect_ratio(self):
        """Не квадратная картинка не растягивается: 400x100 → 256x64 по центру."""
        url = reverse('generic_convert')
        data = {
            'file': self.make_upload('wide.png', 'PNG', size=(400, 100)),
            'target': 'ico',
        }

        download_response = self.submit_and_download(url, data)
        content = b''.join(download_response.streaming_content)

        with Image.open(io.BytesIO(content)) as ico:
            alpha = ico.convert('RGBA').getchannel('A')
            left, top, right, bottom = alpha.getbbox()

        self.assertEqual((left, top, right - left, bottom - top), (0, 96, 256, 64))

    def test_invalid_target_format(self):
        data = {
            'file': self.make_upload('test.png', 'PNG'),
            'target': 'pdf',
        }
        response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)

    def test_target_as_file_part_is_rejected(self):
        """target прилетевший файлом раньше доходил до .lower() и давал 500."""
        data = {
            'file': self.make_upload('test.png', 'PNG'),
            'target': SimpleUploadedFile('target', b'png', content_type='text/plain'),
        }

        response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)

    def test_giant_image_rejected_before_queueing(self):
        giant = SimpleUploadedFile('giant.png', fake_huge_png(), content_type='image/png')

        with patch('converter.tasks.generic_convert_task.apply_async') as mock_delay:
            response = self.client.post(self.url, {'file': giant, 'target': 'png'}, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn('10000', response.data['error'])
        mock_delay.assert_not_called()

    def test_missing_file(self):
        response = self.client.post(self.url, {}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {'error': 'Файл не передан'})

    def test_downloaded_files_have_explicit_content_type(self):
        """Без явного типа .webp доезжает как application/octet-stream."""
        expected = {
            'webp': 'image/webp',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'ico': 'image/vnd.microsoft.icon',
            'heic': 'image/heic',
        }

        for target, content_type in expected.items():
            with self.subTest(target=target):
                data = {'file': self.make_upload('test.png', 'PNG'), 'target': target}
                download_response = self.submit_and_download(self.url, data)

                self.assertEqual(download_response['Content-Type'], content_type)
                self.assertIn('attachment', download_response['Content-Disposition'])

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
        # Фронтенд клеит этот путь к своему API_BASE_URL, поэтому схема и хост
        # здесь лишние.
        self.assertTrue(status_response.data['download_url'].startswith('/api/download/'),
                        status_response.data['download_url'])

    def test_status_of_a_purged_result_says_so(self):
        """Пока результат Celery жив, а файл уже съеден очисткой, ссылка была бы битой."""
        task_id = self.submit_conversion(file=self.make_upload('test.png', 'PNG'), target='jpg')
        first = self.client.get(reverse('task_status', kwargs={'task_id': task_id}))
        filename = first.data['download_url'].rstrip('/').rsplit('/', 1)[-1]
        self.remove_quietly(os.path.join(tmp_dir(), filename))

        response = self.client.get(reverse('task_status', kwargs={'task_id': task_id}))

        self.assertEqual(response.data['status'], 'FAILURE', response.data)
        self.assertNotIn('download_url', response.data)
        self.assertIn('удалён', response.data['error'])

    def test_failure_message_hides_internal_paths(self):
        """Pillow пишет «cannot identify image file '/app/tmp_files/<uuid>.png'»."""
        broken = SimpleUploadedFile('broken.png', b'not an image at all', content_type='image/png')
        task_id = self.submit_conversion(file=broken, target='jpg')

        response = self.client.get(reverse('task_status', kwargs={'task_id': task_id}))

        self.assertEqual(response.data['status'], 'FAILURE', response.data)
        self.assertNotIn('tmp_files', response.data['error'])
        self.assertNotIn('/', response.data['error'])
        self.assertIn('не удалось обработать', response.data['error'].lower())

    def test_download_nonexistent_file_returns_404(self):
        url = reverse('file_download', kwargs={'filename': 'nonexistent_file.pdf'})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)

    def test_download_directory_returns_404_not_500(self):
        """open() на каталоге бросал IsADirectoryError."""
        folder = os.path.join(tmp_dir(), f'directory_{uuid.uuid4().hex}')
        os.makedirs(folder, exist_ok=True)
        self.addCleanup(os.rmdir, folder)

        response = self.client.get(reverse('file_download', kwargs={'filename': os.path.basename(folder)}))

        self.assertEqual(response.status_code, 404)

    def submit_conversion(self, **data):
        response = self.client.post(reverse('generic_convert'), data, format='multipart')
        self.assertEqual(response.status_code, 202, response.data)
        return response.data['task_id']

    def test_unknown_task_id_is_not_pending(self):
        """Celery отвечает PENDING и на задачу в очереди, и на выдуманный id."""
        response = self.client.get(reverse('task_status', kwargs={'task_id': 'no-such-task'}))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'UNKNOWN')
        self.assertIn('error', response.data)

    def test_queued_task_stays_pending(self):
        from .views import mark_task_queued

        mark_task_queued('still-in-queue')
        response = self.client.get(reverse('task_status', kwargs={'task_id': 'still-in-queue'}))

        self.assertEqual(response.data['status'], 'PENDING')

    def test_queue_mark_is_written_before_the_task_is_sent(self):
        """Зазор между отправкой в очередь и меткой — это UNKNOWN на принятый файл."""
        from . import views

        calls = []
        real_mark = views.mark_task_queued

        def mark(task_id):
            calls.append('mark')
            real_mark(task_id)

        def apply_async(*args, **kwargs):
            calls.append('enqueue')
            self.assertTrue(cache.get(f'queued:{kwargs["task_id"]}'),
                            'к моменту отправки задачи её метки ещё нет в кэше')
            return Mock(id=kwargs['task_id'])

        with patch('converter.views.mark_task_queued', side_effect=mark), \
                patch.object(views.generic_convert_task, 'apply_async', side_effect=apply_async):
            response = self.client.post(
                reverse('generic_convert'),
                {'file': self.make_upload('test.png', 'PNG'), 'target': 'jpg'},
                format='multipart',
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(calls, ['mark', 'enqueue'])

    def test_redelivered_task_keeps_the_finished_result(self):
        """Celery отдаёт сообщение как минимум один раз, а исходник уже удалён."""
        from .tasks import generic_convert_task

        source = os.path.join(tmp_dir(), f'source_{uuid.uuid4().hex}.png')
        output_filename = f'redelivered_{uuid.uuid4().hex}.jpg'
        output_path = os.path.join(tmp_dir(), output_filename)
        self.addCleanup(self.remove_quietly, source)
        self.addCleanup(self.remove_quietly, output_path)
        Image.new('RGB', (10, 10), 'red').save(source, format='PNG')

        first = generic_convert_task.apply(args=[source, output_filename, 'jpg']).get()
        self.assertEqual(first['status'], 'SUCCESS', first)
        self.assertFalse(os.path.exists(source), 'исходники чистятся после обработки')

        # Повторная доставка: воркер умер до ack. Задача уже не может
        # конвертировать — исходников нет, — но обязана вернуть тот же успех.
        again = generic_convert_task.apply(args=[source, output_filename, 'jpg']).get()

        self.assertEqual(again['status'], 'SUCCESS', again)
        self.assertEqual(again['result_file'], output_filename)
        self.assertTrue(os.path.isfile(output_path))

    def test_partial_output_is_never_published(self):
        """Недописанный файл нельзя принять за готовый результат."""
        from .tasks import generic_convert_task

        source = os.path.join(tmp_dir(), f'source_{uuid.uuid4().hex}.png')
        output_filename = f'partial_{uuid.uuid4().hex}.jpg'
        self.addCleanup(self.remove_quietly, source)
        Image.new('RGB', (10, 10), 'red').save(source, format='PNG')

        with patch('converter.services.convert_image', side_effect=RuntimeError('упал в середине')):
            result = generic_convert_task.apply(args=[source, output_filename, 'jpg']).get()

        self.assertEqual(result['status'], 'FAILURE')
        self.assertFalse(os.path.exists(os.path.join(tmp_dir(), output_filename)))
        self.assertFalse(os.path.exists(os.path.join(tmp_dir(), output_filename) + '.part'))

    def test_batch_status_returns_snapshot_per_id(self):
        done_id = self.submit_conversion(file=self.make_upload('test.png', 'PNG'), target='jpg')

        response = self.client.get(reverse('task_status_batch'), {'ids': f'{done_id},missing-id'})
        self.assertEqual(response.status_code, 200)

        by_id = {task['task_id']: task for task in response.data['tasks']}
        self.assertEqual(set(by_id), {done_id, 'missing-id'})
        self.assertEqual(by_id[done_id]['status'], 'SUCCESS')
        self.assertTrue(by_id[done_id]['download_url'].startswith('/api/download/'))
        self.assertEqual(by_id['missing-id']['status'], 'UNKNOWN')

    def test_batch_status_deduplicates_ids(self):
        task_id = self.submit_conversion(file=self.make_upload('test.png', 'PNG'), target='jpg')

        response = self.client.get(reverse('task_status_batch'), {'ids': f'{task_id},{task_id}'})

        self.assertEqual(len(response.data['tasks']), 1)

    def test_batch_status_requires_ids(self):
        response = self.client.get(reverse('task_status_batch'), {'ids': ''})

        self.assertEqual(response.status_code, 400)

    def test_batch_status_limits_number_of_ids(self):
        ids = ','.join(f'task-{i}' for i in range(101))

        response = self.client.get(reverse('task_status_batch'), {'ids': ids})

        self.assertEqual(response.status_code, 400)
        self.assertIn('максимум 100', response.data['error'])


@override_settings(**CELERY_TEST_SETTINGS)
class ThrottlingTestCase(ConverterAPITestBase):
    """Скрипт не должен бесконечно ставить задачи в Celery с одного адреса."""

    def setUp(self):
        super().setUp()
        cache.clear()

    def submit_conversion(self, remote_addr='10.0.0.1'):
        return self.client.post(
            reverse('generic_convert'),
            {'file': self.make_upload('test.jpg', 'JPEG'), 'target': 'png'},
            format='multipart',
            REMOTE_ADDR=remote_addr,
        )

    @patch.dict(SimpleRateThrottle.THROTTLE_RATES, {'convert': '3/hour'})
    def test_convert_endpoint_answers_429_after_the_limit(self):
        for _ in range(3):
            self.assertEqual(self.submit_conversion().status_code, 202)

        response = self.submit_conversion()

        self.assertEqual(response.status_code, 429)
        self.assertIn('Слишком много запросов', response.data['error'])
        self.assertTrue(response.has_header('Retry-After'))

    @patch.dict(SimpleRateThrottle.THROTTLE_RATES, {'convert': '3/hour'})
    def test_limit_counts_requests_per_client_address(self):
        for _ in range(3):
            self.assertEqual(self.submit_conversion('10.0.0.1').status_code, 202)

        self.assertEqual(self.submit_conversion('10.0.0.2').status_code, 202)
        self.assertEqual(self.submit_conversion('10.0.0.1').status_code, 429)

    @patch.dict(SimpleRateThrottle.THROTTLE_RATES, {'convert': '2/hour'})
    def test_polling_has_its_own_bucket(self):
        """Опрос статуса идёт своим лимитом: иначе батч задохнулся бы в poll-квоте."""
        task_ids = [self.submit_conversion().data['task_id'] for _ in range(2)]

        for _ in range(10):
            response = self.client.get(reverse('task_status_batch'), {'ids': ','.join(task_ids)})
            self.assertEqual(response.status_code, 200)

        self.assertEqual(self.submit_conversion().status_code, 429)

    def test_forwarded_header_is_not_trusted_by_default(self):
        """NUM_PROXIES=0: X-Forwarded-For не покупает клиенту чистый бакет."""
        url = reverse('task_status', kwargs={'task_id': 'probe'})

        with patch.dict(SimpleRateThrottle.THROTTLE_RATES, {'poll': '3/min'}):
            for index in range(3):
                allowed = self.client.get(url, HTTP_X_FORWARDED_FOR=f'10.0.0.{index}')
                self.assertEqual(allowed.status_code, 200)

            blocked = self.client.get(url, HTTP_X_FORWARDED_FOR='10.0.0.99')

        self.assertEqual(blocked.status_code, 429)

    def test_num_proxies_defaults_to_zero(self):
        self.assertEqual(settings.REST_FRAMEWORK['NUM_PROXIES'], 0)


@override_settings(**CELERY_TEST_SETTINGS)
class TmpFileRetentionTestCase(ConverterAPITestBase):
    """Срок жизни файла, результата и метки «задачи» считается из одного числа."""

    def aged_file(self, name, age_seconds):
        path = os.path.join(tmp_dir(), name)
        with open(path, 'wb') as handle:
            handle.write(b'x')
        stamp = time.time() - age_seconds
        os.utime(path, (stamp, stamp))
        self.addCleanup(self.remove_quietly, path)
        return path

    def test_cleanup_removes_only_files_past_the_ttl(self):
        from .tasks import clear_old_tmp_files_task

        with override_settings(TMP_FILE_TTL_SECONDS=60):
            old = self.aged_file(f'old_{uuid.uuid4().hex}.jpg', 61)
            fresh = self.aged_file(f'fresh_{uuid.uuid4().hex}.jpg', 1)

            clear_old_tmp_files_task.apply().get()

        self.assertFalse(os.path.exists(old), 'файл старше TTL обязан удалиться')
        self.assertTrue(os.path.exists(fresh), 'свежий файл удалять нельзя')

    def test_ttl_stays_inside_the_hour_promise(self):
        """Политика обещает «не более часа»: TTL плюс интервал очистки не должны его превышать."""
        schedule = settings.CELERY_BEAT_SCHEDULE['clear-tmp-files-every-5-mins']['schedule']

        self.assertEqual(schedule, crontab(minute='*/5'))
        self.assertLessEqual(settings.TMP_FILE_TTL_SECONDS + 5 * 60, 3600)
        self.assertEqual(settings.CELERY_RESULT_EXPIRES, settings.TMP_FILE_TTL_SECONDS)


@override_settings(**CELERY_TEST_SETTINGS)
class TmpFilesWritableCheckTestCase(SimpleTestCase):
    """Каталог, который контейнер не может писать, раньше было видно только по 500."""

    def test_writable_directory_passes(self):
        self.assertEqual(check_tmp_files_writable(None), [])

    def test_directory_that_cannot_be_created_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            blocker = os.path.join(tmp, 'not-a-dir')
            with open(blocker, 'w') as handle:
                handle.write('x')

            with override_settings(TMP_FILES_DIR=os.path.join(blocker, 'files')):
                errors = check_tmp_files_writable(None)

        self.assertEqual([error.id for error in errors], ['converter.E001'])
        self.assertIn('chown', errors[0].hint)


class DescribeFailureTestCase(SimpleTestCase):
    """Собственные сообщения стратегий доходят до клиента, библиотечные — нет."""

    def test_keeps_our_own_russian_message(self):
        error = FileNotFoundError('Не удалось найти 1 из 2 исходных файлов. Отправьте изображения заново.')

        self.assertEqual(
            describe_failure(error),
            'Не удалось найти 1 из 2 исходных файлов. Отправьте изображения заново.',
        )

    def test_replaces_english_library_message(self):
        error = UnidentifiedImageError("cannot identify image file '/app/tmp_files/9e5a.png'")

        message = describe_failure(error)

        self.assertNotIn('tmp_files', message)
        self.assertEqual(message, GENERIC_FAILURE)

    def test_collapses_multiline_poppler_stderr(self):
        error = RuntimeError('Unable to get page count.\nSyntax Error: Invalid page count 0\n')

        self.assertEqual(describe_failure(error), GENERIC_FAILURE)
