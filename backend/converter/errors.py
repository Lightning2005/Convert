import re

GENERIC_FAILURE = 'Файл не удалось обработать. Проверьте, что он не повреждён, и попробуйте ещё раз.'

_CYRILLIC = re.compile(r'[а-яё]', re.IGNORECASE)


def describe_failure(exc):
    """Текст ошибки, который можно показать пользователю.

    Сообщения стратегий написаны по-русски и не содержат путей — отдаём их как
    есть. Библиотечные ошибки («cannot identify image file
    '/app/tmp_files/<uuid>.png'», многострочный stderr poppler) выдают и
    внутреннюю структуру файлов, и английскую терминологию — вместо них
    возвращаем понятную фразу.
    """
    message = ' '.join(str(exc).split())

    if not message or len(message) > 300:
        return GENERIC_FAILURE
    if any(sep in message for sep in ('/', '\\')):
        return GENERIC_FAILURE

    return message if _CYRILLIC.search(message) else GENERIC_FAILURE
