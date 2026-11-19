import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const STORAGE_KEY = 'cookie-notice-accepted';

/**
 * Предупреждение о cookie и рекламе РСЯ. Показывается полосой над контентом:
 * липкий рекламный блок снизу закрывать нельзя.
 */
export default function CookieNotice() {
  const [visible, setVisible] = useState(false);
  const location = useLocation();

  useEffect(() => {
    // localStorage есть только в браузере: решение о показе принимается после
    // гидратации, иначе статический HTML разошёлся бы с первым клиентским
    // рендером.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(STORAGE_KEY) !== '1') setVisible(true);
  }, []);

  // Не показываем плашку, если согласие уже дано или если пользователь уже на странице политики
  if (!visible || location.pathname.startsWith('/privacy')) return null;

  const accept = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Использование файлов cookie"
      className="bg-main border-b border-ui-border px-4 py-3 text-left"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs text-text-secondary leading-relaxed flex-1">
          Мы используем файлы cookie для анализа посещаемости (Яндекс.Метрика) и персонализации рекламы (Рекламная сеть Яндекса).
          Продолжая пользоваться сайтом, вы соглашаетесь с{' '}
          <Link to="/privacy" className="text-primary font-medium hover:underline">
            Политикой конфиденциальности
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={accept}
          className="shrink-0 min-h-11 inline-flex items-center justify-center bg-primary hover:bg-primary-hover active:bg-primary-active text-white text-sm font-bold px-5 py-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
        >
          Принять
        </button>
      </div>
    </div>
  );
}
