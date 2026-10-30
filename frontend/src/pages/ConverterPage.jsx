import { useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { SUPPORTED_TOOLS } from '../config/tools';
import ConverterForm from '../components/ConverterForm';
import NotFoundPage from './NotFoundPage';

export default function ConverterPage() {
  const { slug } = useParams();
  const location = useLocation();
  const toolConfig = SUPPORTED_TOOLS[slug];

  // Забираем предзагруженные файлы, если они пришли с главной страницы
  const preloadedFiles = location.state?.preloadedFiles || null;

  // Очищаем стейт истории браузера, чтобы файлы не оставались там при перезагрузке
  useEffect(() => {
    if (location.state?.preloadedFiles) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Если пользователь ввёл некорректный URL (нет такого инструмента в конфиге)
  if (!toolConfig) {
    return <NotFoundPage />;
  }

  // Передаем настройки и предзагруженные файлы в форму
  return <ConverterForm key={slug} config={toolConfig} preloadedFiles={preloadedFiles} />;
}