import io
import zipfile
from django.urls import reverse
from rest_framework.test import APITestCase
from PIL import Image
from .services import convert_images_to_pdf, convert_pdf_to_images
from unittest.mock import patch, PropertyMock

class ImagesToPdfAPITestCase(APITestCase):

    def generate_test_image(self, filename, ext='JPEG', size=(100, 100), color='blue'):
        """Вспомогательный метод для генерации картинки в памяти"""
        file_buf = io.BytesIO()
        image = Image.new('RGB', size, color=color)
        image.save(file_buf, format=ext)
        file_buf.name = filename
        file_buf.seek(0)
        return file_buf

    def test_successful_images_to_pdf_conversion(self):
        """Тест успешной конвертации нескольких изображений в один PDF"""
        # 1. Берем наш именованный URL-адрес
        url = reverse('images_to_pdf')

        # 2. Генерируем две тестовые картинки (JPG и PNG)
        img1 = self.generate_test_image('test1.jpg', ext='JPEG', color='red')
        img2 = self.generate_test_image('test2.png', ext='PNG', color='green')

        # 3. Формируем multipart/form-data тело запроса
        data = {
            'images': [img1, img2]
        }

        # 4. Отправляем POST-запрос на эндпоинт
        response = self.client.post(url, data, format='multipart')

        #print("\n--- ДЕТАЛИ ОШИБКИ БЭКЕНДА: ---", response.data)

        # 5. Проверяем утверждения (Asserts)
        # Ожидаем статус-код 200 OK
        self.assertEqual(response.status_code, 200)

        # Проверяем, что возвращается именно PDF-файл
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertIn('attachment; filename="converted_images.pdf"', response['Content-Disposition'])

        # Проверяем, что бинарный поток ответа не пустой
        pdf_content = b"".join(response.streaming_content)
        self.assertTrue(len(pdf_content) > 0)

        # Сигнатура (первых 4 байта) любого валидного PDF файла должна быть %PDF
        self.assertEqual(pdf_content[:4], b'%PDF')

    def test_conversion_fails_without_images(self):
        """Тест обработки ошибки, если файлы не были переданы"""
        url = reverse('images_to_pdf')

        # Отправляем пустой запрос
        response = self.client.post(url, {}, format='multipart')

        # Ожидаем ошибку 400 Bad Request
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"error": "Файлы не переданы"})

    def test_successful_pdf_to_images_conversion(self):
        """Тест успешной конвертации PDF обратно в архив с картинками"""
        url = reverse('pdf_to_images')

        # 1. Сначала генерируем валидный PDF в памяти, используя наш старый сервис
        img = self.generate_test_image('source.jpg', ext='JPEG')
        valid_pdf_buffer = convert_images_to_pdf([img])
        valid_pdf_buffer.name = 'test.pdf'

        # 2. Отправляем этот PDF на новый эндпоинт
        data = {'pdf': valid_pdf_buffer}
        response = self.client.post(url, data, format='multipart')

        # 3. Проверяем результат
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/zip')
        self.assertIn('filename="converted_pages.zip"', response['Content-Disposition'])

        # Проверяем, что архив не пустой
        zip_content = b"".join(response.streaming_content)
        self.assertTrue(len(zip_content) > 0)

    def test_pdf_to_png_conversion(self):
        """Тест конвертации PDF в PNG через параметр target"""
        url = reverse('pdf_to_images')

        img = self.generate_test_image('source.jpg', ext='JPEG')
        valid_pdf_buffer = convert_images_to_pdf([img])
        valid_pdf_buffer.name = 'test.pdf'

        data = {'pdf': valid_pdf_buffer, 'target': 'png'}
        response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/zip')

        zip_content = b"".join(response.streaming_content)
        self.assertTrue(len(zip_content) > 0)

        with zipfile.ZipFile(io.BytesIO(zip_content)) as archive:
            names = archive.namelist()
            self.assertTrue(any(name.endswith('.png') for name in names))
            self.assertFalse(any(name.endswith('.jpg') for name in names))

    def test_pdf_to_images_invalid_target(self):
        """Тест ошибки при неподдерживаемом формате для PDF"""
        url = reverse('pdf_to_images')

        img = self.generate_test_image('source.jpg', ext='JPEG')
        valid_pdf_buffer = convert_images_to_pdf([img])
        valid_pdf_buffer.name = 'test.pdf'

        data = {'pdf': valid_pdf_buffer, 'target': 'webp'}
        response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)

    def test_images_to_pdf_files_too_large(self):
        """Тест ошибки 400, если суммарный вес изображений превышает 50 МБ"""
        url = reverse('images_to_pdf')
        img1 = self.generate_test_image('test1.jpg', ext='JPEG')
        img2 = self.generate_test_image('test2.jpg', ext='JPEG')
        data = {'images': [img1, img2]}

        # Подменяем размер каждого файла на 26 МБ (в сумме 52 МБ)
        with patch('django.core.files.uploadedfile.UploadedFile.size', new_callable=PropertyMock) as mock_size:
            mock_size.return_value = 26 * 1024 * 1024
            response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"error": "Превышен суммарный лимит размера файлов (макс. 50 МБ)"})

    def test_pdf_to_images_file_too_large(self):
        """Тест ошибки 400, если PDF файл превышает лимит 50 МБ"""
        url = reverse('pdf_to_images')
        img = self.generate_test_image('source.jpg', ext='JPEG')
        valid_pdf_buffer = convert_images_to_pdf([img])
        valid_pdf_buffer.name = 'test.pdf'
        data = {'pdf': valid_pdf_buffer}

        # Имитируем файл размером 51 МБ
        with patch('django.core.files.uploadedfile.UploadedFile.size', new_callable=PropertyMock) as mock_size:
            mock_size.return_value = 51 * 1024 * 1024
            response = self.client.post(url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"error": "Размер файла превышает лимит 50 МБ"})


class GenericConvertAPITestCase(APITestCase):
    def setUp(self):
        self.url = reverse('generic_convert')

    def generate_test_image(self, ext='JPEG'):
        file_buf = io.BytesIO()
        image = Image.new('RGB', (100, 100), color='red')
        image.save(file_buf, format=ext)
        file_buf.name = f'test.{ext.lower()}'
        file_buf.seek(0)
        return file_buf

    def test_convert_png_to_webp(self):
        """Тест успешной конвертации PNG в WebP"""
        img = self.generate_test_image(ext='PNG')
        data = {'file': img, 'target': 'webp'}

        response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'image/webp')
        content = b"".join(response.streaming_content)
        self.assertTrue(len(content) > 0)

    def test_invalid_format(self):
        """Тест ошибки при запросе неподдерживаемого формата"""
        img = self.generate_test_image(ext='PNG')
        data = {'file': img, 'target': 'pdf'}  # PDF не входит в список в views.py

        response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.data)

    def test_missing_data(self):
        """Тест ошибки при отсутствии файла или target"""
        response = self.client.post(self.url, {}, format='multipart')
        self.assertEqual(response.status_code, 400)

    def test_generic_convert_file_too_large(self):
        """Тест ошибки 400, если одиночный файл в generic-конвертере превышает 50 МБ"""
        img = self.generate_test_image(ext='PNG')
        data = {'file': img, 'target': 'webp'}

        # Имитируем файл размером 51 МБ
        with patch('django.core.files.uploadedfile.UploadedFile.size', new_callable=PropertyMock) as mock_size:
            mock_size.return_value = 51 * 1024 * 1024
            response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"error": "Размер файла превышает лимит 50 МБ"})