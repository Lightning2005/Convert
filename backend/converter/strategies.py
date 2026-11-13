import os
import io
import zipfile
import struct
from abc import ABC, abstractmethod
from PIL import Image, ImageOps
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from pdf2image import convert_from_path, pdfinfo_from_path
from pillow_heif import register_heif_opener
from reportlab import rl_config

# ASCII85-обёртка поверх Flate прирастает к потоку на ~25% и живёт в памяти до
# записи на диск: на Linux (VmHWM, docker-образ прод-стека) пик 50-мегапиксель
# картинки 1,59 ГиБ против 0,77 ГиБ без A85, на 24 Мп — 1,09 против 0,39.
# На машине 1 vCPU / 2 ГБ с тремя воркерами gunicorn это половина всей RAM.
rl_config.useA85 = 0

# Регистрация плагина для поддержки HEIC
register_heif_opener()

# Размеры слоёв внутри ICO. Один слой 256×256 приходилось уменьшать уже самому
# потребителю: Windows и браузер считают 16 px своими фильтрами, и тонкий штрих
# знака на таком размере пропадает. Готовые слои дают системе выбор без
# пересчёта — так же собран favicon самого сайта (scripts/build_icons.py).
ICO_SIZES = (16, 24, 32, 48, 64, 256)

# Страниц PDF в памяти одновременно. convert_from_path возвращает список всех
# отрендеренных страниц: 100 страниц A4 при 200 dpi это ~1,2 ГиБ, и пик на
# 100-страничном документе весом 45 КБ доходил до 3,2 ГиБ воркера.
PAGE_CHUNK = 10


def _save_as_ico(img: Image.Image, output_path: str) -> None:
    """
    ICO — это контейнер, как ZIP: заголовок, таблица записей и сами картинки.
    Каждый «слой» — не слой из редактора, а отдельный готовый растр своего
    размера; потребитель выбирает тот, что ему нужен, и не масштабирует сам.

    Картинка вписывается в каждый квадрат с сохранением пропорций, остаток
    заполняется прозрачностью — иначе логотип 4:1 превратился бы в пятно.
    Pillow умеет писать ICO только из одной картинки и уменьшает остальные
    размеры сам, поэтому контейнер собирается вручную.
    """
    rgba_img = img.convert('RGBA')
    layers = []
    for size in ICO_SIZES:
        ratio = min(size / rgba_img.width, size / rgba_img.height)
        resized_w = max(1, round(rgba_img.width * ratio))
        resized_h = max(1, round(rgba_img.height * ratio))
        resized = rgba_img.resize((resized_w, resized_h), Image.Resampling.LANCZOS)

        layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        layer.paste(resized, ((size - resized_w) // 2, (size - resized_h) // 2), resized)

        buffer = io.BytesIO()
        layer.save(buffer, format='PNG', optimize=True)
        layers.append((size, buffer.getvalue()))

    # 6 байт заголовка, по 16 байт на запись, дальше данные записей подряд.
    offset = 6 + 16 * len(layers)
    directory = b''
    payload = b''
    for size, data in layers:
        edge = 0 if size == 256 else size  # 0 в поле ширины означает 256
        directory += struct.pack('<BBBBHHII', edge, edge, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        payload += data

    with open(output_path, 'wb') as ico_file:
        ico_file.write(struct.pack('<HHH', 0, 1, len(layers)) + directory + payload)


class BaseConverter(ABC):
    """Базовый интерфейс для всех стратегий конвертации."""

    @abstractmethod
    def convert(self, input_path, output_path, **kwargs) -> None:
        pass


class ImagesToPdfConverter(BaseConverter):
    """Стратегия объединения изображений в PDF: все страницы portrait A4."""

    def convert(self, input_path: list, output_path: str, **kwargs) -> None:
        # Пропущенные файлы проверяем до создания канваса: иначе пользователь
        # получил бы укороченный PDF со статусом SUCCESS и без единого
        # предупреждения. Такое возможно, если задача простояла в очереди дольше
        # часа и очистка tmp_files успела съесть исходники.
        missing = [path for path in input_path if not os.path.exists(path)]
        if missing:
            raise FileNotFoundError(
                f"Не удалось найти {len(missing)} из {len(input_path)} исходных "
                "файлов. Отправьте изображения заново."
            )

        pdf_canvas = canvas.Canvas(output_path)
        # Без этого в /Title остаётся дефолт reportlab ('untitled'), и
        # просмотрщик показывает его вместо имени файла.
        pdf_canvas.setTitle(kwargs.get('document_title') or 'converted_images')
        page_width, page_height = A4

        for path in input_path:
            img = Image.open(path)
            img = ImageOps.exif_transpose(img)

            if img.mode in ('RGBA', 'LA'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            img_w, img_h = img.size
            pdf_canvas.setPageSize((page_width, page_height))

            ratio = min(page_width / img_w, page_height / img_h)
            new_w = img_w * ratio
            new_h = img_h * ratio

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

        page_count = pdfinfo_from_path(input_path, poppler_path=poppler_path)['Pages']
        if not page_count:
            raise ValueError('В документе нет страниц.')

        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for first_page in range(1, page_count + 1, PAGE_CHUNK):
                pages = convert_from_path(
                    input_path,
                    poppler_path=poppler_path,
                    first_page=first_page,
                    last_page=min(first_page + PAGE_CHUNK - 1, page_count),
                )

                for offset, page in enumerate(pages):
                    img_buffer = io.BytesIO()
                    if pil_format == 'JPEG':
                        page.save(img_buffer, format='JPEG', quality=90)
                    elif pil_format == 'WEBP':
                        page.save(img_buffer, format='WEBP')
                    else:
                        page.save(img_buffer, format='PNG')

                    index = first_page + offset
                    zip_file.writestr(f"page_{index}.{file_ext}", img_buffer.getvalue())
                    page.close()


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

        # Палитра с прозрачностью (PNG-8 с tRNS, старые редакторы) открывается
        # как mode='P', а не RGBA. Без этого перевода прозрачные пиксели при
        # сохранении в JPEG становились чёрными, хотя по обещанию страницы
        # фон должен заливаться белым.
        if img.mode == 'P' and 'transparency' in img.info:
            img = img.convert('RGBA')

        # CMYK (типографские JPEG и сканы), YCbCr, LAB и HSV Pillow пишет только
        # в JPEG и TIFF. В PNG, BMP, WebP и ICO такой режим валит задачу
        # OSError «cannot write mode CMYK as PNG», поэтому переводим в RGB.
        if img.mode in ('CMYK', 'YCbCr', 'LAB', 'HSV'):
            img = img.convert('RGB')

        if target_format in ['jpg', 'jpeg'] and img.mode in ('RGBA', 'LA'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            img = background
        elif img.mode != 'RGB' and target_format in ['jpg', 'jpeg']:
            img = img.convert('RGB')

        if target_format == 'ico':
            _save_as_ico(img, output_path)
        else:
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
        strategy_class = cls._registry.get(action_name)
        if not strategy_class:
            raise ValueError(f"Неизвестный тип конвертации: {action_name}")
        return strategy_class()

    @classmethod
    def get_supported_generic_targets(cls) -> set:
        return set(GenericImageConverter.SUPPORTED_FORMATS.keys())