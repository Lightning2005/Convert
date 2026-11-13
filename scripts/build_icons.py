"""Собирает иконки сайта из одной геометрии: синий квадрат со скруглением и белый конверт.

Зачем скрипт, а не пять PNG из редактора: раньше знак был белым конвертом на
прозрачном фоне. На белой странице Google и во вкладке браузера он читался как
«битая картинка» — белый прямоугольник с чёрными диагоналями, ровно заглушка
незагруженного изображения. Здесь фон — фирменный синий #2563EB (тот же, что у
og-image), а конверт белый, поэтому иконка одинаково видна на светлой и тёмной
теме.

Каждый размер рисуется отдельно, а не уменьшается из 512: штрих клапана не
должен стать тоньше 1.5 px, иначе на 16 px иконка снова расплывается в пятно.
Промежуточные размеры рисуются с восьмикратным запасом и уменьшаются LANCZOS —
это даёт сглаженные края без размытия мелких деталей.

Запуск: .venv/Scripts/python.exe scripts/build_icons.py
"""

from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image, ImageDraw

BLUE = (37, 99, 235, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

PUBLIC = Path(__file__).resolve().parent.parent / "frontend" / "public"
ICO_SIZES = (16, 24, 32, 48, 64, 256)
SUPERSAMPLE = 8


def render(size: int, *, rounded: bool = True) -> Image.Image:
    """Одна иконка заданного размера. rounded=False — квадрат без прозрачных углов."""
    scale = size * SUPERSAMPLE
    img = Image.new("RGBA", (scale, scale), CLEAR)
    draw = ImageDraw.Draw(img)

    radius = 0.22 * scale if rounded else 0
    draw.rounded_rectangle([0, 0, scale - 1, scale - 1], radius=radius, fill=BLUE)

    # Конверт: белый прямоугольник с синим клапаном. Пропорции сняты с og-image,
    # чтобы знак в выдаче и превью соцсетей был одним и тем же.
    x0, x1 = 0.20 * scale, 0.80 * scale
    y0, y1 = 0.31 * scale, 0.69 * scale
    draw.rounded_rectangle([x0, y0, x1, y1], radius=0.05 * scale, fill=WHITE)

    stroke = max(1.5, size * 0.055) * SUPERSAMPLE
    apex = (0.5 * scale, 0.525 * scale)
    draw.line(
        [(x0 + stroke / 2, y0 + stroke / 2), apex, (x1 - stroke / 2, y0 + stroke / 2)],
        fill=BLUE,
        width=int(round(stroke)),
        joint="curve",
    )

    return img.resize((size, size), Image.LANCZOS)


def write_ico(path: Path, sizes=ICO_SIZES) -> None:
    """Многослойный .ico с PNG-слоями: каждый размер нарисован отдельно."""
    layers = []
    for size in sizes:
        buffer = path.parent / f".ico-{size}.png"
        render(size).save(buffer, format="PNG", optimize=True)
        layers.append((size, buffer.read_bytes()))
        buffer.unlink()

    count = len(layers)
    offset = 6 + 16 * count
    directory = b""
    payload = b""
    for size, data in layers:
        edge = 0 if size == 256 else size
        directory += struct.pack(
            "<BBBBHHII", edge, edge, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)
        payload += data

    path.write_bytes(struct.pack("<HHH", 0, 1, count) + directory + payload)


def write_svg(path: Path) -> None:
    """Тот же знак в SVG: файл больше не подключается из <head>, но должен
    совпадать с .ico и PNG, иначе его рано или поздно подключат обратно."""
    path.write_text(
        '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">\n'
        '  <rect width="48" height="48" rx="10.5" fill="#2563EB"/>\n'
        '  <rect x="9.6" y="14.9" width="28.8" height="18.2" rx="1.8" fill="#FFFFFF"/>\n'
        '  <path d="M10.6 15.9L24 25.2L37.4 15.9" stroke="#2563EB" stroke-width="2.6" '
        'stroke-linecap="round" stroke-linejoin="round"/>\n'
        "</svg>\n",
        encoding="utf-8",
    )


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    write_ico(PUBLIC / "favicon.ico")

    render(32).save(PUBLIC / "favicon-32.png", optimize=True)
    render(48).save(PUBLIC / "favicon-48.png", optimize=True)

    # Иконки приложения: система обрезает углы сама, поэтому фон залит целиком.
    render(180, rounded=False).save(PUBLIC / "apple-touch-icon.png", optimize=True)
    render(192, rounded=False).save(PUBLIC / "icon-192.png", optimize=True)
    render(512, rounded=False).save(PUBLIC / "icon-512.png", optimize=True)

    write_svg(PUBLIC / "favicon.svg")

    for name in ("favicon.ico", "favicon-32.png", "favicon-48.png",
                 "apple-touch-icon.png", "icon-192.png", "icon-512.png", "favicon.svg"):
        print(f"{name}: {(PUBLIC / name).stat().st_size} B")


if __name__ == "__main__":
    main()
