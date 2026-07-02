import os
from celery import shared_task
from django.conf import settings
from . import services  # Исправлен пробел

# Путь будет динамическим: /app/tmp_files в Докере или папка tmp_files в корне твоего бэкенда на Windows
TMP_DIR = os.path.join(settings.BASE_DIR, 'tmp_files')

def cleanup_files(paths: list):
    """Вспомогательная функция удаления файлов после обработки."""
    for path in paths:
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except Exception:
                pass


@shared_task(bind=True)
def images_to_pdf_task(self, image_paths: list, output_filename: str):
    output_path = os.path.join(TMP_DIR, output_filename)
    try:
        services.convert_images_to_pdf(image_paths, output_path)
        return {"status": "SUCCESS", "result_file": output_filename}
    except Exception as e:
        return {"status": "FAILURE", "error": str(e)}
    finally:
        # Исходные картинки больше не нужны — удаляем
        cleanup_files(image_paths)


@shared_task(bind=True)
def pdf_to_images_task(self, pdf_path: str, output_filename: str, target_format: str):
    output_path = os.path.join(TMP_DIR, output_filename)
    try:
        services.convert_pdf_to_images(
            pdf_path=pdf_path,
            output_path=output_path,
            target_format=target_format,
            poppler_path=settings.POPPLER_PATH
        )
        return {"status": "SUCCESS", "result_file": output_filename}
    except Exception as e:
        return {"status": "FAILURE", "error": str(e)}
    finally:
        cleanup_files([pdf_path])


@shared_task(bind=True)
def generic_convert_task(self, input_path: str, output_filename: str, target_format: str):
    output_path = os.path.join(TMP_DIR, output_filename)
    try:
        services.convert_image(input_path, output_path, target_format)
        return {"status": "SUCCESS", "result_file": output_filename}
    except Exception as e:
        return {"status": "FAILURE", "error": str(e)}
    finally:
        cleanup_files([input_path])