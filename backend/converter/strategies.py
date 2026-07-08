import os
import io
import zipfile
from abc import ABC, abstractmethod
from PIL import Image, ImageOps
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from pdf2image import convert_from_path
from pillow_heif import register_heif_opener

# Регистрация плагина для поддержки HEIC
register_heif_opener()


class BaseConverter(ABC):
    """Базовый интерфейс для всех стратегий конвертации."""

    @abstractmethod
    def convert(self, input_path, output_path, **kwargs) -> None:
        """
        Выполняет конвертацию файла(ов).
        input_path может быть строкой (путь к файлу) или списком строк.
        """
        pass


class ImagesToPdfConverter(BaseConverter):
    """Стратегия объединения изображений в PDF А4 с сохранением пропорций и центрированием."""

    def convert(self, input_path: list, output_path: str, **kwargs) -> None:
        pdf_canvas = canvas.Canvas(output_path)

        for path in input_path:
            if not os.path.exists(path):
                continue

            img = Image.open(path)
            img = ImageOps.exif_transpose(img)

            # Обработка прозрачности
            if img.mode in ('RGBA', 'LA'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            img_w, img_h = img.size

            # 1. Определяем ориентацию страницы А4 по пропорциям исходника
            if img_w > img_h:
                page_width, page_height = landscape(A4)
            else:
                page_width, page_height = A4

            pdf_canvas.setPageSize((page_width, page_height))

            # 2. Расчет масштабирования без искусственных отступов (margin = 0)
            # Картинка займет максимум пространства по одной из осей
            ratio = min(page_width / img_w, page_height / img_h)
            new_w = img_w * ratio
            new_h = img_h * ratio

            # 3. Центрируем картинку на листе А4
            # Белые полосы останутся только там, где пропорции не совпали с А4
            x = (page_width - new_w) / 2
            y = (page_height - new_h) / 2

            img_reader = ImageReader(img)
            pdf_canvas.drawImage(img_reader, x, y, width=new_w, height=new_h)
            pdf_canvas.showPage()

        pdf_canvas.save()


class PdfToImagesConverter(BaseConverter):
    """Стратегия конвертации страниц PDF-документа в изображения внутри ZIP-архива."""

    def convert(self, input_path: str, output_path: str, **kwargs) -> None:
        target_format = kwargs.get('target_format', 'jpg').lower()
        poppler_path = kwargs.get('poppler_path', None)

        if target_format in ('jpg', 'jpeg'):
            pil_format = 'JPEG'
            file_ext = 'jpg'
        elif target_format == 'png':
            pil_format = 'PNG'
            file_ext = 'png'
        elif target_format == 'webp':
            pil_format = 'WEBP'
            file_ext = 'webp'
        else:
            raise ValueError(f"Формат {target_format} не поддерживается для PDF.")

        pages = convert_from_path(input_path, poppler_path=poppler_path)

        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for index, page in enumerate(pages):
                img_buffer = io.BytesIO()
                if pil_format == 'JPEG':
                    page.save(img_buffer, format='JPEG', quality=90)
                elif pil_format == 'WEBP':
                    page.save(img_buffer, format='WEBP')
                else:
                    page.save(img_buffer, format='PNG')

                zip_file.writestr(f"page_{index + 1}.{file_ext}", img_buffer.getvalue())


class GenericImageConverter(BaseConverter):
    """Универсальная стратегия взаимной конвертации одиночных изображений."""

    SUPPORTED_FORMATS = {
        'jpg': 'JPEG',
        'jpeg': 'JPEG',
        'png': 'PNG',
        'webp': 'WEBP',
        'tiff': 'TIFF',
        'ico': 'ICO',
        'bmp': 'BMP',
        'heic': 'HEIF',
    }

    def convert(self, input_path: str, output_path: str, **kwargs) -> None:
        target_format = kwargs.get('target_format', '').lower()
        if target_format not in self.SUPPORTED_FORMATS:
            raise ValueError(f"Формат {target_format} не поддерживается.")

        img = Image.open(input_path)
        img = ImageOps.exif_transpose(img)

        if target_format in ['jpg', 'jpeg'] and img.mode in ('RGBA', 'LA'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            img = background
        elif img.mode != 'RGB' and target_format in ['jpg', 'jpeg']:
            img = img.convert('RGB')

        img.save(output_path, format=self.SUPPORTED_FORMATS[target_format])


class ConverterFactory:
    """Фабрика для управления и динамического получения стратегий конвертации."""

    _registry = {
        'images_to_pdf': ImagesToPdfConverter,
        'pdf_to_images': PdfToImagesConverter,
        'generic_image': GenericImageConverter,
    }

    @classmethod
    def get_by_action(cls, action_name: str) -> BaseConverter:
        """Получение инстанса стратегии по её строковому идентификатору."""
        strategy_class = cls._registry.get(action_name)
        if not strategy_class:
            raise ValueError(f"Неизвестный тип конвертации: {action_name}")
        return strategy_class()

    @classmethod
    def get_supported_generic_targets(cls) -> set:
        """Возвращает форматы, поддерживаемые универсальным конвертером изображений."""
        return set(GenericImageConverter.SUPPORTED_FORMATS.keys())