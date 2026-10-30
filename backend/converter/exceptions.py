import math

from rest_framework import status
from rest_framework.views import exception_handler


def throttled_message(wait_seconds):
    """Текст для 429: DRF по умолчанию отвечает по-английски и в другом поле."""
    if not wait_seconds:
        return 'Слишком много запросов. Попробуйте позже.'

    seconds = math.ceil(wait_seconds)
    if seconds >= 120:
        return f'Слишком много запросов. Повторите через {round(seconds / 60)} мин.'
    return f'Слишком много запросов. Повторите через {seconds} сек.'


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)

    # Фронтенд показывает поле `error` — ответы DRF приходят с `detail`, и
    # ограниченный по частоте запрос выглядел бы как «Ошибка сервера: 429».
    if response is not None and response.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        response.data = {'error': throttled_message(getattr(exc, 'wait', None))}

    return response
