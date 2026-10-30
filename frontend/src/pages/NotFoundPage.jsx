import { Link } from 'react-router-dom';

const POPULAR = [
  { slug: 'jpg-to-pdf', label: 'JPG → PDF' },
  { slug: 'pdf-to-jpg', label: 'PDF → JPG' },
  { slug: 'png-to-jpg', label: 'PNG → JPG' },
  { slug: 'heic-to-jpg', label: 'HEIC → JPG' },
];

export default function NotFoundPage() {
  return (
    <div className="w-full max-w-3xl mx-auto text-center py-12">
      <span className="text-6xl block mb-4" aria-hidden="true">🔍</span>
      <h1 className="text-3xl font-extrabold text-text-primary mb-3">Страница не найдена</h1>
      <p className="text-text-secondary text-sm mb-8 max-w-md mx-auto">
        Такой страницы или конвертера у нас нет — возможно, адрес набран с ошибкой или инструмент ещё не готов.
      </p>

      <div className="flex flex-wrap justify-center gap-2 mb-10">
        {POPULAR.map((item) => (
          <Link
            key={item.slug}
            to={`/tool/${item.slug}`}
            className="px-4 py-2 rounded-xl border border-ui-border bg-surface-muted text-sm font-medium text-text-primary hover:border-primary hover:text-primary transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </div>

      <Link
        to="/"
        className="inline-block bg-primary text-white px-6 py-2 rounded-xl text-sm font-medium hover:bg-primary-hover transition-colors shadow-sm"
      >
        На главную
      </Link>
    </div>
  );
}
