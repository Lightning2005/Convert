import React from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { SUPPORTED_TOOLS } from '../config/tools';
import ConverterForm from '../components/ConverterForm';

export default function ConverterPage() {
  const { slug } = useParams();
  const location = useLocation();
  const toolConfig = SUPPORTED_TOOLS[slug];

  // Если пользователь ввёл некорректный URL (нет такого инструмента в конфиге)
  if (!toolConfig) {
    return (
      <div className="text-center py-12 flex flex-col items-center gap-4">
        <span className="text-6xl">🔍</span>
        <h1 className="text-2xl font-bold text-text-primary">Инструмент не найден</h1>
        <p className="text-text-secondary max-w-md text-sm">
          К сожалению, запрашиваемый конвертер не существует или находится в разработке.
        </p>
        <Link
          to="/"
          className="mt-4 bg-primary text-white px-6 py-2 rounded-xl text-sm font-medium hover:bg-primary-hover transition-colors shadow-sm"
        >
          На главную
        </Link>
      </div>
    );
  }

  // Забираем предзагруженные файлы, если они пришли с главной страницы
  const preloadedFiles = location.state?.preloadedFiles || null;

  // Очищаем стейт истории браузера, чтобы файлы не оставались там при перезагрузке
  if (location.state?.preloadedFiles) {
    window.history.replaceState({}, document.title);
  }

  // Передаем настройки и предзагруженные файлы в форму
  return <ConverterForm config={toolConfig} slug={slug} preloadedFiles={preloadedFiles} />;
}