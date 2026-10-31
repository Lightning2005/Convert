from django.apps import AppConfig


class ConverterConfig(AppConfig):
    name = 'converter'

    def ready(self):
        # Django не подхватывает checks.py сам — без импорта проверка не
        # регистрируется и запуск проходит мимо неё.
        from . import checks  # noqa: F401
