import { StrictMode } from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

const container = document.getElementById('root');

// Плоские файлы сборки (/privacy.html) отдают ту же разметку, но маршрутизатор
// ждёт канонический адрес — приводим URL к нему до гидратации.
if (window.location.pathname.endsWith('.html')) {
  const clean = window.location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  window.history.replaceState(null, '', clean + window.location.search + window.location.hash);
}

// Статические страницы, собранные `npm run build`, уже содержат разметку —
// гидратируем её, а на пустом контейнере (dev-сервер) рендерим с нуля.
if (container.hasChildNodes()) {
  hydrateRoot(container, <StrictMode><App /></StrictMode>);
} else {
  createRoot(container).render(<StrictMode><App /></StrictMode>);
}
