from .strategies import ConverterFactory

def convert_images_to_pdf(image_paths: list, output_path: str):
    """Сохраняем сигнатуру для Celery-таски, делегируя логику стратегии."""
    converter = ConverterFactory.get_by_action('images_to_pdf')
    converter.convert(image_paths, output_path)


def convert_pdf_to_images(pdf_path: str, output_path: str, target_format='jpg', poppler_path=None):
    """Делегируем логику нарезки PDF соответствующей стратегии."""
    converter = ConverterFactory.get_by_action('pdf_to_images')
    converter.convert(
        input_path=pdf_path,
        output_path=output_path,
        target_format=target_format,
        poppler_path=poppler_path
    )


def convert_image(input_path: str, output_path: str, target_format: str):
    """Делегируем одиночную конвертацию универсальной стратегии изображений."""
    converter = ConverterFactory.get_by_action('generic_image')
    converter.convert(input_path, output_path, target_format=target_format)