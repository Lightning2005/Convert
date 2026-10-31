import os, time
from celery import shared_task
from django.conf import settings
from . import services  # Исправлен пробел
from .errors import describe_failure

# Путь читается из настроек при каждом обращении: /app/tmp_files в Докере,
# папка tmp_files в корне бэкенда на Windows или отдельный каталог в тестах.
def tmp_dir() -> str:
    return str(settings.TMP_FILES_DIR)


def cleanup_files(paths: list):
    """Вспомогательная функция удаления файлов после обработки."""
    for path in paths:
        if not path:
            continue
        try:
            # Без проверки exists(): между ней и os.remove файл успевает съесть
            # периодическая очистка, и удаление бросало FileNotFoundError там,
            # где конвертация уже завершилась успешно.
            os.remove(path)
        except OSError:
            pass


def is_already_done(output_path: str) -> bool:
    """Признак того, что этот запрос уже отработал.

    Celery доставляет сообщение как минимум один раз: если воркер умер между
    готовой конвертацией и ack, задача выполнится повторно — уже без исходников,
    которые удалились в finally первой попытки. Повтор падал бы с FAILURE и
    затирал готовый результат, а фронтенд показывал бы ошибку вместо файла.
    Имя выходного файла — uuid конкретного запроса, поэтому его наличие
    означает только одно: результат этого запроса уже лежит на диске.
    """
    return os.path.isfile(output_path)


@shared_task(bind=True)
def images_to_pdf_task(self, image_paths: list, output_filename: str):
    output_path = os.path.join(tmp_dir(), output_filename)
    # Конвертим в .part и публикуем через os.replace: иначе повтор мог бы
    # принять за готовый результат недописанный файл предыдущей попытки.
    part_path = f'{output_path}.part'
    try:
        if not is_already_done(output_path):
            services.convert_images_to_pdf(image_paths, part_path)
            os.replace(part_path, output_path)
        return {"status": "SUCCESS", "result_file": output_filename}
    except Exception as e:
        return {"status": "FAILURE", "error": describe_failure(e)}
    finally:
        # Исходные картинки больше не нужны — удаляем
        cleanup_files([*image_paths, part_path])


@shared_task(bind=True)
def pdf_to_images_task(self, pdf_path: str, output_filename: str, target_format: str):
    output_path = os.path.join(tmp_dir(), output_filename)
    part_path = f'{output_path}.part'
    try:
        if not is_already_done(output_path):
            services.convert_pdf_to_images(
                pdf_path=pdf_path,
                output_path=part_path,
                target_format=target_format,
                poppler_path=settings.POPPLER_PATH
            )
            os.replace(part_path, output_path)
        return {"status": "SUCCESS", "result_file": output_filename}
    except Exception as e:
        return {"status": "FAILURE", "error": describe_failure(e)}
    finally:
        cleanup_files([pdf_path, part_path])


@shared_task(bind=True)
def generic_convert_task(self, input_path: str, output_filename: str, target_format: str):
    output_path = os.path.join(tmp_dir(), output_filename)
    part_path = f'{output_path}.part'
    try:
        if not is_already_done(output_path):
            services.convert_image(input_path, part_path, target_format)
            os.replace(part_path, output_path)
        return {"status": "SUCCESS", "result_file": output_filename}
    except Exception as e:
        return {"status": "FAILURE", "error": describe_failure(e)}
    finally:
        cleanup_files([input_path, part_path])


@shared_task
def clear_old_tmp_files_task():
    """Периодическая задача для очистки файлов старше 1 часа."""
    directory = tmp_dir()
    if not os.path.exists(directory):
        return "Directory does not exist"

    now = time.time()
    cutoff = now - 3600  # 1 час назад
    deleted_count = 0

    for filename in os.listdir(directory):
        file_path = os.path.join(directory, filename)

        # Проверяем, что это файл, а не системная папка (например, .gitignore)
        if os.path.isfile(file_path):
            file_mtime = os.path.getmtime(file_path)
            if file_mtime < cutoff:
                try:
                    os.remove(file_path)
                    deleted_count += 1
                except Exception as e:
                    print(f"Ошибка удаления файла {file_path}: {e}")
                    #pass

    return f"Cleaned up {deleted_count} files."