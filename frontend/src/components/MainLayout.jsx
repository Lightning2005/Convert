import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SUPPORTED_TOOLS } from '../config/tools';
import { ADS_ENABLED } from '../config/ads';
import AdSlot from './AdSlot';
import CookieNotice from './CookieNotice';
import logoIcon from '../assets/logo.svg';

const FLOOR_AD_KEY = 'floor-ad-dismissed';

export default function MainLayout({ children }) {
  const [activeDropdown, setActiveDropdown] = useState(null);

  // Состояния для мобильной навигации
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobilePdfOpen, setMobilePdfOpen] = useState(false);
  const [mobileImageOpen, setMobileImageOpen] = useState(false);

  //РСЯ требует кнопку закрытия липкого блока; закрытие действует до конца сессии
  const [floorDismissed, setFloorDismissed] = useState(false);

  useEffect(() => {
    // sessionStorage недоступен на сервере, поэтому флаг «рекламу уже закрыли»
    // читаем после гидратации — до неё слой отрисован как открытый.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFloorDismissed(sessionStorage.getItem(FLOOR_AD_KEY) === '1');
  }, []);

  const dismissFloorAd = () => {
    sessionStorage.setItem(FLOOR_AD_KEY, '1');
    setFloorDismissed(true);
  };

  const pdfRef = useRef(null);
  const imageRef = useRef(null);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const location = useLocation();

  const hideAdsRoutes = ['/privacy', '/contacts'];
  // Статические страницы отдаются и по адресу с завершающим слешем (/privacy/),
  // поэтому путь нормализуем — иначе правила для рекламы и главная не узнаются
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const showAds = ADS_ENABLED && !hideAdsRoutes.includes(pathname);
  const isHomePage = pathname === '/';
  const showFloor = showAds && !floorDismissed;

  const toolsArray = Object.entries(SUPPORTED_TOOLS).map(([slug, data]) => ({ slug, ...data }));
  const pdfTools = toolsArray.filter(t => t.category === 'pdf');
  const imageTools = toolsArray.filter(t => t.category === 'image');

  const toggleDropdown = (menuType) => {
    setActiveDropdown((prev) => (prev === menuType ? null : menuType));
  };

  // Закрытие мобильного меню при смене страницы
  useEffect(() => {
    // Ссылка в drawer — не единственный способ уйти со страницы: остаются
    // «назад»/«вперёд» и программный переход, поэтому закрываем по location.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileMenuOpen(false);
  }, [location]);

  // React Router прокрутку не сбрасывает, а главная стала длинной: переход с
  // сетки инструментов оставлял бы пользователя посреди текста чужой страницы.
  // Первый рендер пропускаем — на перезагрузке позицию восстанавливает браузер,
  // и сбрасывать её на 0 значит врать пользователю про «вернуться к чтению».
  const isFirstLocation = useRef(true);
  useEffect(() => {
    if (isFirstLocation.current) {
      isFirstLocation.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [location]);

  // Блокировка скролла body при открытом мобильном меню
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Drawer закрывает экран оверлеем, но страница под ним остаётся живой: Tab
  // уходил на ссылки под затемнением, а Esc ронял фокус в <body>. Держим фокус
  // внутри панели и возвращаем его на кнопку меню при закрытии.
  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const panel = drawerRef.current;
    const opener = menuButtonRef.current;
    if (!panel) return undefined;

    // Список берём в момент нажатия: секции инструментов монтируются по клику.
    const focusables = () => [...panel.querySelectorAll('a[href], button:not([disabled])')];
    focusables()[0]?.focus();

    const handleTabKey = (event) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !panel.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTabKey, true);
    return () => {
      document.removeEventListener('keydown', handleTabKey, true);
      opener?.focus();
    };
  }, [mobileMenuOpen]);

  // Клик снаружи десктопных дропдаунов (и по тач-устройствам)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        (pdfRef.current && !pdfRef.current.contains(event.target)) &&
        (imageRef.current && !imageRef.current.contains(event.target))
      ) {
        setActiveDropdown(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Esc закрывает дропдауны и мобильное меню
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setActiveDropdown(null);
      setMobileMenuOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Панели меню всегда смонтированы, а закрытая скрывается через visibility, а не
  // размонтированием: prerender отдаёт статический HTML без JavaScript, и если
  // ссылки живут только в открытом дропдауне, робот видит сайт из трёх страниц —
  // 22 инструмента остаются без единственной внутренней ссылки. visibility:hidden
  // при этом снимает их и из Tab-порядка, и с пути курсора.
  const dropdownPanelClass = (open) =>
    `absolute left-1/2 -translate-x-1/2 mt-3 w-[25rem] max-h-[70vh] overflow-y-auto grid grid-cols-2 gap-x-2 gap-y-0.5 bg-main rounded-xl border border-ui-border p-2 z-50 text-text-primary shadow-lg [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ui-border [&::-webkit-scrollbar-thumb]:rounded-full ${open ? 'visible animate-fadeIn' : 'invisible'}`;

  return (
    <div className={`min-h-screen flex flex-col bg-surface-muted text-text-primary ${showFloor ? 'page-with-floor' : ''}`}>

      {/* ШАПКА */}
      <header className="w-full bg-main text-text-primary px-6 py-4 flex justify-between items-center border-b border-ui-border shrink-0 z-50">

        {/* Логотип */}
        <div className="flex-1 flex items-center gap-2 cursor-pointer">
          <Link
            to="/"
            onClick={() => setActiveDropdown(null)}
            className="flex items-center gap-2 text-text-primary hover:text-primary transition-colors group"
          >
            <img
              src={logoIcon}
              alt="Логотип Конверт"
              className="w-12 h-7 object-contain"
            />
            <span className="font-bold text-xl tracking-tight">Конверт</span>
          </Link>
        </div>

        {/* ДИНАМИЧЕСКАЯ НАВИГАЦИЯ (ДЕCКТОП) */}
        <nav className="hidden md:flex gap-6 font-medium relative">
          {/* Дропдаун: Инструменты PDF */}
          <div className="relative" ref={pdfRef}>
            <button
              onClick={() => toggleDropdown('pdf')}
              aria-haspopup="true"
              aria-expanded={activeDropdown === 'pdf'}
              aria-controls="pdf-tools-menu"
              className={`hover:text-primary flex items-center gap-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded ${activeDropdown === 'pdf' ? 'text-text-secondary' : ''}`}
            >
              Инструменты PDF
              <svg className={`w-3 h-3 transition-transform duration-200 fill-current ${activeDropdown === 'pdf' ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </button>

            <div
              id="pdf-tools-menu"
              className={dropdownPanelClass(activeDropdown === 'pdf')}
            >
              {pdfTools.map((tool) => (
                <Link
                  key={tool.slug}
                  to={`/tool/${tool.slug}`}
                  onClick={() => setActiveDropdown(null)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-primary-light rounded-lg transition font-normal"
                >
                  <span>{tool.sourceName} в {tool.targetName}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Дропдаун: Конвертер изображений */}
          <div className="relative" ref={imageRef}>
            <button
              onClick={() => toggleDropdown('image')}
              aria-haspopup="true"
              aria-expanded={activeDropdown === 'image'}
              aria-controls="image-tools-menu"
              className={`hover:text-primary flex items-center gap-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded ${activeDropdown === 'image' ? 'text-text-secondary' : ''}`}
            >
              Конвертер картинок
              <svg className={`w-3 h-3 transition-transform duration-200 fill-current ${activeDropdown === 'image' ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </button>

            <div
              id="image-tools-menu"
              className={dropdownPanelClass(activeDropdown === 'image')}
            >
              {imageTools.map((tool) => (
                <Link
                  key={tool.slug}
                  to={`/tool/${tool.slug}`}
                  onClick={() => setActiveDropdown(null)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-primary-light rounded-lg transition font-normal"
                >
                  <span>{tool.sourceName} в {tool.targetName}</span>
                </Link>
              ))}
            </div>
          </div>
        </nav>

        {/* Системные переключатели */}
        <div className="flex-1 flex items-center justify-end gap-2">
          {/* Кнопка гамбургера (мобильное меню) */}
          <button
            ref={menuButtonRef}
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden p-2 min-h-11 min-w-11 hover:bg-surface-muted rounded-lg transition text-text-secondary flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Открыть меню"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-drawer"
          >
            <svg className="w-6 h-6 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      <CookieNotice />

      {/* ОСНОВНОЙ КОНТЕНТЕР. Отступы на мобильном уменьшены, потому что вместе с
          px-4 страниц они съедали 80px из 393 ширины экрана. */}
      <div className="flex-1 w-full flex gap-6 justify-between items-start relative max-w-[1600px] mx-auto px-4 py-6 sm:p-6 sm:py-12">
        {showAds && (
          <AdSlot
            id="ad-rail-left"
            className="hidden xl:flex w-[200px] h-[600px] bg-main border border-ui-border rounded-xl p-4 items-center justify-center text-text-secondary shrink-0 sticky top-6 z-0"
          />
        )}

        <div className="flex-1 flex flex-col items-center gap-8 max-w-[1000px] mx-auto w-full">
          <main className={
            isHomePage
              ? "w-full flex flex-col gap-8"
              : "w-full flex flex-col items-center justify-between gap-8 bg-main p-8 md:p-10 rounded-2xl border border-ui-border min-h-[550px]"
          }>
            {children}
          </main>

          {showAds && (
            <AdSlot
              id="ad-banner"
              className="hidden md:flex w-full max-w-[1000px] h-[175px] bg-main border border-ui-border rounded-xl items-center justify-center text-text-secondary shrink-0"
            />
          )}
        </div>

        {showAds && (
          <AdSlot
            id="ad-rail-right"
            className="hidden xl:flex w-[200px] h-[600px] bg-main border border-ui-border rounded-xl p-4 items-center justify-center text-text-secondary shrink-0 sticky top-6 z-0"
          />
        )}
      </div>

      {/* ЛИПКИЙ МОБИЛЬНЫЙ РЕКЛАМНЫЙ СЛОЙ. Показывает себя сам, когда внутри
          появляется креатив: см. .floor-ad в index.css. */}
      {showFloor && (
        <div
          className="floor-ad fixed bottom-0 inset-x-0 z-40 flex-col items-center gap-1.5 px-3 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] bg-surface-muted/95 backdrop-blur-sm border-t border-ui-border"
        >
          <button
            type="button"
            onClick={dismissFloorAd}
            aria-label="Закрыть рекламный блок"
            className="self-center shrink-0 flex items-center gap-1 min-h-11 px-4 py-1 rounded-full bg-text-primary/75 text-white text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Закрыть рекламу ✕
          </button>

          <AdSlot
            id="ad-floor"
            className="w-full max-w-[420px] flex-1 min-h-0 bg-main border border-ui-border rounded-xl items-center justify-center text-text-secondary"
          />
        </div>
      )}

      {/* ПОДВАЛ */}
      <footer className="w-full text-center text-xs text-text-secondary py-6 mt-auto border-t border-ui-border bg-main/50 backdrop-blur-sm flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-8 shrink-0">
        {/* Год попадает в prerender-HTML на момент сборки: до первого релиза в
            новом году статичная страница и клиент расходятся на одну цифру. */}
        <div suppressHydrationWarning={true}>
          &copy; {new Date().getFullYear()} Конверт. Все права защищены.
        </div>
        <div className="flex gap-4 font-medium">
          <Link to="/privacy" className="min-h-11 flex items-center hover:text-primary transition">Политика конфиденциальности</Link>
          <span className="text-ui-border">|</span>
          <Link to="/contacts" className="min-h-11 flex items-center hover:text-primary transition">Контакты</Link>
        </div>
      </footer>

      {/* МОБИЛЬНОЕ МЕНЮ (DRAWER) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[100] md:hidden flex justify-end">
          {/* Темный оверлей */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs animate-fadeIn"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Выезжающая панель */}
          <nav ref={drawerRef} id="mobile-drawer" role="dialog" aria-modal="true" aria-label="Мобильная навигация" className="relative w-full max-w-[20rem] h-full bg-main border-l border-ui-border p-6 overflow-y-auto flex flex-col gap-6 shadow-2xl z-10 text-text-primary [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ui-border [&::-webkit-scrollbar-thumb]:rounded-full animate-fadeIn">

            {/* Шапка бокового меню */}
            <div className="flex justify-between items-center pb-4 border-b border-ui-border">
              <span className="font-bold text-lg tracking-tight">Навигация</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 min-h-11 min-w-11 flex items-center justify-center hover:bg-surface-muted rounded-lg transition text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Закрыть меню"
              >
                <svg className="w-5 h-5 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Аккордеоны с инструментами */}
            <div className="flex flex-col gap-4">

              {/* Секция PDF */}
              <div className="flex flex-col">
                <button
                  onClick={() => setMobilePdfOpen(!mobilePdfOpen)}
                  aria-expanded={mobilePdfOpen}
                  aria-controls="mobile-pdf-menu"
                  className="flex justify-between items-center w-full min-h-11 py-2.5 font-medium text-left text-text-primary hover:text-primary transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                >
                  <span>Инструменты PDF</span>
                  <svg className={`w-4 h-4 transition-transform duration-200 fill-current text-text-secondary ${mobilePdfOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </button>

                {mobilePdfOpen && (
                  <div id="mobile-pdf-menu" className="flex flex-col pl-3 border-l border-ui-border mt-1 gap-1 animate-fadeIn">
                    {pdfTools.map((tool) => (
                      <Link
                        key={tool.slug}
                        to={`/tool/${tool.slug}`}
                        className="min-h-11 flex items-center py-2 text-sm text-text-secondary hover:text-primary transition font-normal"
                      >
                        {tool.sourceName} в {tool.targetName}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Секция изображений */}
              <div className="flex flex-col">
                <button
                  onClick={() => setMobileImageOpen(!mobileImageOpen)}
                  aria-expanded={mobileImageOpen}
                  aria-controls="mobile-image-menu"
                  className="flex justify-between items-center w-full min-h-11 py-2.5 font-medium text-left text-text-primary hover:text-primary transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                >
                  <span>Конвертер картинок</span>
                  <svg className={`w-4 h-4 transition-transform duration-200 fill-current text-text-secondary ${mobileImageOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </button>

                {mobileImageOpen && (
                  <div id="mobile-image-menu" className="flex flex-col pl-3 border-l border-ui-border mt-1 gap-1 animate-fadeIn">
                    {imageTools.map((tool) => (
                      <Link
                        key={tool.slug}
                        to={`/tool/${tool.slug}`}
                        className="min-h-11 flex items-center py-2 text-sm text-text-secondary hover:text-primary transition font-normal"
                      >
                        {tool.sourceName} в {tool.targetName}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Системные ссылки: на мобильном drawer — единственный верхний вход в них */}
            <div className="flex flex-col gap-1 pt-4 border-t border-ui-border mt-auto">
              <Link to="/" className="min-h-11 flex items-center py-2 text-sm font-medium text-text-primary hover:text-primary transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                Главная
              </Link>
              <Link to="/contacts" className="min-h-11 flex items-center py-2 text-sm text-text-secondary hover:text-primary transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                Контакты
              </Link>
              <Link to="/privacy" className="min-h-11 flex items-center py-2 text-sm text-text-secondary hover:text-primary transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                Политика конфиденциальности
              </Link>
            </div>
          </nav>
        </div>
      )}

    </div>
  );
}