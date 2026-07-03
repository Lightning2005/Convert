import os
import zipfile
import io
from PIL import Image, ImageOps
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from pdf2image import convert_from_path


# 1. Сборка нескольких изображений в один PDF
def convert_images_to_pdf(image_paths: list, output_path: str):
    page_width, page_height = A4
    # ReportLab умеет писать напрямую в файл по его пути
    pdf_canvas = canvas.Canvas(output_path, pagesize=A4)

    for path in image_paths:
        if not os.path.exists(path):
            continue

        img = Image.open(path)
        img = ImageOps.exif_transpose(img)

        # Обработка прозрачности
        if img.mode in ('RGBA', 'LA'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')

        margin = 7
        usable_w = page_width - (2 * margin)
        usable_h = page_height - (2 * margin)

        img_w, img_h = img.size
        ratio = min(usable_w / img_w, usable_h / img_h)
        new_w = img_w * ratio
        new_h = img_h * ratio

        x = (page_width - new_w) / 2
        y = (page_height - new_h) / 2

        img_reader = ImageReader(img)
        pdf_canvas.drawImage(img_reader, x, y, width=new_w, height=new_h)
        pdf_canvas.showPage()

    pdf_canvas.save()


# 2. Нарезка PDF на отдельные изображения (в ZIP)
def convert_pdf_to_images(pdf_path: str, output_path: str, target_format='jpg', poppler_path=None):
    target_format = target_format.lower()

    if target_format in ('jpg', 'jpeg'):
        pil_format = 'JPEG'
        file_ext = 'jpg'
    elif target_format == 'png':
        pil_format = 'PNG'
        file_ext = 'png'
    else:
        raise ValueError(f"Формат {target_format} не поддерживается для PDF.")

    # Используем convert_from_path вместо convert_from_bytes для экономии RAM
    pages = convert_from_path(pdf_path, poppler_path=poppler_path)

    # Пишем ZIP сразу на диск
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for index, page in enumerate(pages):
            # Временный буфер нужен только для сжатия ОДНОЙ страницы, а не всего архива
            img_buffer = io.BytesIO()
            if pil_format == 'JPEG':
                page.save(img_buffer, format='JPEG', quality=90)
            else:
                page.save(img_buffer, format='PNG')

            zip_file.writestr(f"page_{index + 1}.{file_ext}", img_buffer.getvalue())


# 3. Универсальная конвертация одиночного изображения
def convert_image(input_path: str, output_path: str, target_format: str):
    target_format = target_format.lower()
    supported_formats = {
        'jpg': 'JPEG',
        'jpeg': 'JPEG',
        'png': 'PNG',
        'webp': 'WEBP',
        'tiff': 'TIFF',
        'ico': 'ICO',
    }

    if target_format not in supported_formats:
        raise ValueError(f"Формат {target_format} не поддерживается.")

    img = Image.open(input_path)
    img = ImageOps.exif_transpose(img)

    if target_format in ['jpg', 'jpeg'] and img.mode in ('RGBA', 'LA'):
        background = Image.new('RGB', img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background
    elif img.mode != 'RGB' and target_format in ['jpg', 'jpeg']:
        img = img.convert('RGB')

    # Сохраняем результат напрямую по выходному пути на диске
    img.save(output_path, format=supported_formats[target_format])