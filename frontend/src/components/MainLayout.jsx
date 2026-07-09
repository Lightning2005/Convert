import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SUPPORTED_TOOLS } from '../config/tools';

export default function MainLayout({ children }) {
  const [activeDropdown, setActiveDropdown] = useState(null);

  // Состояния для мобильной навигации
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobilePdfOpen, setMobilePdfOpen] = useState(false);
  const [mobileImageOpen, setMobileImageOpen] = useState(false);

  const pdfRef = useRef(null);
  const imageRef = useRef(null);
  const location = useLocation();

  const hideAdsRoutes = ['/privacy', '/contacts'];
  const showAds = !hideAdsRoutes.includes(location.pathname);

  const toolsArray = Object.entries(SUPPORTED_TOOLS).map(([slug, data]) => ({ slug, ...data }));
  const pdfTools = toolsArray.filter(t => t.category === 'pdf');
  const imageTools = toolsArray.filter(t => t.category === 'image');

  const toggleDropdown = (menuType) => {
    setActiveDropdown((prev) => (prev === menuType ? null : menuType));
  };

  // Закрытие мобильного меню при смене страницы
  useEffect(() => {
    setMobileMenuOpen(false);
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

  // Клик снаружи десктопных дропдаунов
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        (pdfRef.current && !pdfRef.current.contains(event.target)) &&
        (imageRef.current && !imageRef.current.contains(event.target))
      ) {
        setActiveDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const dropdownClassName = "absolute left-0 mt-3 w-[32rem] max-h-[70vh] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-2 bg-main rounded-xl border border-ui-border p-2 z-50 animate-fadeIn text-text-primary shadow-md [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ui-border [&::-webkit-scrollbar-thumb]:rounded-full";

  return (
    <div className="min-h-screen flex flex-col bg-surface-muted text-text-primary">

      {/* ШАПКА */}
      <header className="w-full bg-main text-text-primary px-6 py-4 flex justify-between items-center border-b border-ui-border shrink-0 z-50">

        {/* Логотип */}
        <div className="flex-1 flex items-center gap-2 cursor-pointer">
          <Link
            to="/"
            onClick={() => setActiveDropdown(null)}
            className="flex items-center gap-2 text-text-primary hover:text-primary transition-colors group"
          >
            <svg width="48" height="28" viewBox="0 0 48 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0.525299" y="0.500782" width="46.7564" height="27" fill="white" stroke="black"/>
              <path d="M0.874518 0.25412C0.624007 0.137773 0.327329 0.246744 0.211868 0.497514C0.096408 0.748284 0.205888 1.04589 0.456399 1.16224L0.665459 0.708179L0.874518 0.25412ZM23.6943 11.9548C23.9448 12.0712 24.2415 11.9622 24.3569 11.7114C24.4724 11.4607 24.3629 11.1631 24.1124 11.0467L23.9034 11.5008L23.6943 11.9548ZM0.665459 0.708179L0.456399 1.16224L23.6943 11.9548L23.9034 11.5008L24.1124 11.0467L0.874518 0.25412L0.665459 0.708179Z" fill="black"/>
              <path d="M47.4958 0.953681C47.7458 0.836094 47.8538 0.537951 47.7371 0.28776C47.6204 0.0375683 47.3232 -0.0699294 47.0732 0.0476571L47.2845 0.500669L47.4958 0.953681ZM23.6919 11.0478C23.442 11.1654 23.3339 11.4635 23.4506 11.7137C23.5673 11.9639 23.8646 12.0714 24.1145 11.9538L23.9032 11.5008L23.6919 11.0478ZM47.2845 0.500669L47.0732 0.0476571L23.6919 11.0478L23.9032 11.5008L24.1145 11.9538L47.4958 0.953681L47.2845 0.500669Z" fill="black"/>
              <path d="M0.669489 26.9373C0.473601 27.1319 0.471774 27.4493 0.665409 27.6461C0.859044 27.843 1.17481 27.8449 1.3707 27.6502L1.0201 27.2938L0.669489 26.9373ZM19.2793 9.85728C19.4752 9.66265 19.4771 9.34527 19.2834 9.14838C19.0898 8.9515 18.774 8.94966 18.5781 9.14428L18.9287 9.50078L19.2793 9.85728ZM1.0201 27.2938L1.3707 27.6502L19.2793 9.85728L18.9287 9.50078L18.5781 9.14428L0.669489 26.9373L1.0201 27.2938Z" fill="black"/>
              <path d="M46.7291 27.3851C46.928 27.5767 47.2437 27.57 47.4342 27.3701C47.6247 27.1702 47.6179 26.8529 47.419 26.6613L47.0741 27.0232L46.7291 27.3851ZM29.2228 9.13888C29.0239 8.94733 28.7082 8.95407 28.5176 9.15395C28.3271 9.35382 28.3339 9.67114 28.5328 9.86269L28.8778 9.50078L29.2228 9.13888ZM47.0741 27.0232L47.419 26.6613L29.2228 9.13888L28.8778 9.50078L28.5328 9.86269L46.7291 27.3851L47.0741 27.0232Z" fill="black"/>
            </svg>
            <span className="font-bold text-xl tracking-tight">Конверт</span>
          </Link>
        </div>

        {/* ДИНАМИЧЕСКАЯ НАВИГАЦИЯ (ДЕCКТОП) */}
        <nav className="hidden md:flex gap-6 font-medium relative">
          {/* Дропдаун: Инструменты PDF */}
          <div className="relative" ref={pdfRef}>
            <button
              onClick={() => toggleDropdown('pdf')}
              className={`hover:text-primary flex items-center gap-1 transition focus:outline-none ${activeDropdown === 'pdf' ? 'text-text-secondary' : ''}`}
            >
              Инструменты PDF
              <svg className={`w-3 h-3 transition-transform duration-200 fill-current ${activeDropdown === 'pdf' ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </button>

            {activeDropdown === 'pdf' && (
              <div className={dropdownClassName}>
                {pdfTools.map((tool) => (
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
            )}
          </div>

          {/* Дропдаун: Конвертер изображений */}
          <div className="relative" ref={imageRef}>
            <button
              onClick={() => toggleDropdown('image')}
              className={`hover:text-primary flex items-center gap-1 transition focus:outline-none ${activeDropdown === 'image' ? 'text-text-secondary' : ''}`}
            >
              Конвертер картинок
              <svg className={`w-3 h-3 transition-transform duration-200 fill-current ${activeDropdown === 'image' ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </button>

            {activeDropdown === 'image' && (
              <div className={dropdownClassName}>
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
            )}
          </div>
        </nav>

        {/* Системные переключатели */}
        <div className="flex-1 flex items-center justify-end gap-2">
          {/* Кнопка гамбургера (мобильное меню) */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden p-2 hover:bg-surface-muted rounded-lg transition text-text-secondary flex items-center justify-center focus:outline-none"
            aria-label="Открыть меню"
          >
            <svg className="w-6 h-6 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      {/* ОСНОВНОЙ КОНТЕНТЕР */}
      <div className="flex-1 w-full flex p-6 gap-6 justify-between items-start relative max-w-[1600px] mx-auto py-12">
        {showAds && (
          <aside className="hidden xl:flex w-[200px] h-[600px] bg-main border border-ui-border rounded-xl p-4 items-center justify-center text-center text-text-secondary shrink-0 sticky top-6 z-0">
            Реклама <br /> (Небоскреб)
          </aside>
        )}

        <div className="flex-1 flex flex-col items-center gap-8 max-w-[1000px] mx-auto w-full">
          <main className="w-full flex flex-col items-center justify-between gap-8 bg-main p-8 md:p-10 rounded-2xl border border-ui-border min-h-[550px]">
            {children}
          </main>

          {showAds && (
            <div className="w-full max-w-[1000px] h-[175px] bg-main border border-ui-border rounded-xl flex items-center justify-center text-center text-text-secondary shrink-0">
              Нижний рекламный block (1000х175)
            </div>
          )}
        </div>

        {showAds && (
          <aside className="hidden xl:flex w-[200px] h-[600px] bg-main border border-ui-border rounded-xl p-4 items-center justify-center text-center text-text-secondary shrink-0 sticky top-6 z-0">
            Реклама <br /> (Небоскреб)
          </aside>
        )}
      </div>

      {/* ПОДВАЛ */}
      <footer className="w-full text-center text-xs text-text-secondary py-6 mt-auto border-t border-ui-border bg-main/50 backdrop-blur-sm flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-8 shrink-0">
        <div>
          &copy; {new Date().getFullYear()} Конверт. Все права защищены.
        </div>
        <div className="flex gap-4 font-medium">
          <Link to="/privacy" className="hover:text-primary transition">Политика конфиденциальности</Link>
          <span className="text-ui-border">|</span>
          <Link to="/contacts" className="hover:text-primary transition">Контакты</Link>
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
          <nav className="relative w-full max-w-[20rem] h-full bg-main border-l border-ui-border p-6 overflow-y-auto flex flex-col gap-6 shadow-2xl z-10 text-text-primary [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ui-border [&::-webkit-scrollbar-thumb]:rounded-full animate-fadeIn">

            {/* Шапка бокового меню */}
            <div className="flex justify-between items-center pb-4 border-b border-ui-border">
              <span className="font-bold text-lg tracking-tight">Навигация</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 hover:bg-surface-muted rounded-lg transition text-text-secondary focus:outline-none"
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
                  className="flex justify-between items-center w-full py-2.5 font-medium text-left text-text-primary hover:text-primary transition focus:outline-none"
                >
                  <span>Инструменты PDF</span>
                  <svg className={`w-4 h-4 transition-transform duration-200 fill-current text-text-secondary ${mobilePdfOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </button>

                {mobilePdfOpen && (
                  <div className="flex flex-col pl-3 border-l border-ui-border mt-1 gap-1 animate-fadeIn">
                    {pdfTools.map((tool) => (
                      <Link
                        key={tool.slug}
                        to={`/tool/${tool.slug}`}
                        className="py-2 text-sm text-text-secondary hover:text-primary transition font-normal"
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
                  className="flex justify-between items-center w-full py-2.5 font-medium text-left text-text-primary hover:text-primary transition focus:outline-none"
                >
                  <span>Конвертер картинок</span>
                  <svg className={`w-4 h-4 transition-transform duration-200 fill-current text-text-secondary ${mobileImageOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </button>

                {mobileImageOpen && (
                  <div className="flex flex-col pl-3 border-l border-ui-border mt-1 gap-1 animate-fadeIn">
                    {imageTools.map((tool) => (
                      <Link
                        key={tool.slug}
                        to={`/tool/${tool.slug}`}
                        className="py-2 text-sm text-text-secondary hover:text-primary transition font-normal"
                      >
                        {tool.sourceName} в {tool.targetName}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </nav>
        </div>
      )}

    </div>
  );
}