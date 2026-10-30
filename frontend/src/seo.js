import { SUPPORTED_TOOLS, MAX_FILE_SIZE_MB } from './config/tools.js';

export const SITE_NAME = 'Конверт';

// Превью-картинка одна на весь сайт: 1200×630 — размер, который требуют
// Facebook/Telegram/VK для summary_large_image.
export const OG_IMAGE_PATH = '/og-image.png';
export const OG_IMAGE_ALT =
  'Конверт — онлайн-конвертер картинок и PDF: 22 формата, пакетная обработка, без регистрации';

// Абсолютный адрес нужен для canonical, og:url, sitemap и robots. В разработке
// он пустой — теги просто не выводятся, чтобы не генерировать битые ссылки.
// Файл общий: адрес приходит и из import.meta.env (браузер), и из process.env
// (сборщик статических страниц запускается в Node).
const fromVite = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SITE_URL : undefined;
const fromNode = typeof process !== 'undefined' && process.env ? process.env.VITE_SITE_URL : undefined;
export const SITE_URL = (fromVite || fromNode || '').replace(/\/+$/, '');

export const HOME_DESCRIPTION =
  'Бесплатный онлайн-конвертер изображений и PDF: JPG, PNG, WebP, TIFF, BMP, HEIC, ICO. ' +
  'Без регистрации, водяных знаков и лимитов на качество. Файлы удаляются с сервера автоматически.';

function describeTool(slug, tool) {
  const sizeNote = tool.target === 'pdf'
    ? `суммарно до ${MAX_FILE_SIZE_MB} МБ`
    : `файл до ${MAX_FILE_SIZE_MB} МБ`;
  return `${tool.description} Конвертация ${tool.sourceName} в ${tool.targetName} онлайн бесплатно, без регистрации. ` +
    `До ${tool.maxFiles} файлов в одной операции, ${sizeNote}.`;
}

/**
 * Возвращает метаданные страницы для маршрута. Один источник правды и для
 * клиентского <Seo/>, и для сборщика статических HTML-страниц.
 */
export function getSeo(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') {
    return {
      title: `${SITE_NAME} — бесплатный онлайн-конвертер файлов`,
      description: HOME_DESCRIPTION,
      path,
    };
  }

  if (path.startsWith('/tool/')) {
    const slug = path.slice('/tool/'.length);
    const tool = SUPPORTED_TOOLS[slug];
    if (tool) {
      return {
        title: `${tool.sourceName} в ${tool.targetName} — конвертировать онлайн · ${SITE_NAME}`,
        description: describeTool(slug, tool),
        path,
      };
    }
  }

  if (path === '/privacy') {
    return {
      title: `Политика конфиденциальности · ${SITE_NAME}`,
      description: 'Какие данные собирает «Конверт», как обрабатываются и когда удаляются загруженные файлы, как работает реклама РСЯ на сайте.',
      path,
    };
  }

  if (path === '/contacts') {
    return {
      title: `Контакты · ${SITE_NAME}`,
      description: 'Обратная связь с командой «Конверт»: адрес электронной почты и сроки ответа.',
      path,
    };
  }

  return {
    title: `Страница не найдена · ${SITE_NAME}`,
    description: 'Такой страницы нет. На главной — все доступные инструменты конвертации изображений и PDF.',
    path,
    noindex: true,
  };
}

export function absoluteUrl(path) {
  if (!SITE_URL) return '';
  return `${SITE_URL}${path === '/' ? '/' : path}`;
}

/** Все индексируемые маршруты: главный, каждый инструмент и юридические страницы. */
export function getSitemapEntries() {
  return [
    { path: '/', priority: '1.0', changefreq: 'weekly' },
    ...Object.keys(SUPPORTED_TOOLS).map((slug) => ({
      path: `/tool/${slug}`,
      priority: '0.8',
      changefreq: 'monthly',
    })),
    { path: '/privacy', priority: '0.3', changefreq: 'yearly' },
    { path: '/contacts', priority: '0.3', changefreq: 'yearly' },
  ];
}
