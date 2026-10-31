import os
import tempfile

from django.conf import settings
from django.core.checks import Error, register


@register()
def check_tmp_files_writable(app_configs, **kwargs):
    """Проверка на то, что рабочий каталог действительно доступен для записи.

    Без неё контейнер с томом от старого root-образа молча поднимается и
    отвечает 500 на первую же конвертацию: причина уезжает в трейсбек Django,
    а не в лог запуска.
    """
    directory = str(settings.TMP_FILES_DIR)
    try:
        os.makedirs(directory, exist_ok=True)
        handle, probe = tempfile.mkstemp(dir=directory, prefix='.check-')
        os.close(handle)
        os.remove(probe)
    except OSError as error:
        return [Error(
            f"Каталог рабочих файлов недоступен для записи: {directory}",
            hint=(
                f"{error}. В Docker том, созданный до перехода на непривилегированного "
                "пользователя, остаётся собственником root — поправьте один раз: "
                "docker run --rm -v <имя_тома>:/v alpine chown -R 10001:10001 /v"
            ),
            id='converter.E001',
        )]
    return []
