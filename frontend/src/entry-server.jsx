import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import AppRoutes from './AppRoutes.jsx';

/** Разметка маршрута для статической страницы, собираемой при сборке. */
export function renderRoute(url) {
  return renderToString(
    <StaticRouter location={url}>
      <AppRoutes />
    </StaticRouter>
  );
}
