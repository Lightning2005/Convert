import os
from celery import Celery

# Устанавливаем дефолтную переменную окружения для настроек Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

app = Celery('konvert')

# Настройки Celery будут считываться из settings.py с префиксом 'CELERY_'
app.config_from_object('django.conf:settings', namespace='CELERY')

# Автоматически ищет файлы tasks.py во всех зарегистрированных приложениях (INSTALLED_APPS)
app.autodiscover_tasks()