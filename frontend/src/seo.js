import { SUPPORTED_TOOLS, MAX_FILE_SIZE_MB } from './config/tools.js';
import { HOME_FAQ } from './config/faq.js';

export const SITE_NAME = 'Конверт';

// Превью-картинка одна на весь сайт: 1200×630 — размер, который требуют
// Facebook/Telegram/VK для summary_large_image.
export const OG_IMAGE_PATH = '/og-image.png';
export const OG_IMAGE_ALT =
  'Конверт — онлайн-конвертер картинок и PDF: пакетная обработка, без регистрации';

// Абсолютный адрес нужен для canonical, og:url, sitemap и robots. В разработке
// он пустой — теги просто не выводятся, чтобы не генерировать битые ссылки.
// Файл общий: адрес приходит и из import.meta.env (браузер), и из process.env
// (сборщик статических страниц запускается в Node).
const fromVite = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SITE_URL : undefined;
const fromNode = typeof process !== 'undefined' && process.env ? process.env.VITE_SITE_URL : undefined;
export const SITE_URL = (fromVite || fromNode || '').replace(/\/+$/, '');

export const HOME_DESCRIPTION =
  'Бесплатный онлайн-конвертер изображений и PDF: JPG, PNG, WebP, TIFF, BMP, HEIC, ICO. ' +
  'Без регистрации и водяных знаков, файлы удаляются автоматически.';

// Google показывает ~155–160 символов, Яндекс — около 170. Всё, что дальше,
// обрезается уже в сниппете, поэтому лимиты инструмента стоят в конце: если
// строка всё же не влезет, потеряется общая фраза, а не «до 20 файлов».
function describeTool(tool) {
  const sizeNote = tool.target === 'pdf'
    ? `суммарно до ${MAX_FILE_SIZE_MB} МБ`
    : `файл до ${MAX_FILE_SIZE_MB} МБ`;
  return `${tool.description} Онлайн, бесплатно, без регистрации. ` +
    `До ${tool.maxFiles} файлов, ${sizeNote}.`;
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
        description: describeTool(tool),
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
      description: 'Связь с командой «Конверт»: почта для вопросов, предложений и сообщений об ошибках. Ответ в течение 12–24 часов.',
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

// Разметка для поисковиков строится из тех же данных, что рисуют страницы:
// список вопросов — из config/faq.js и config/tools.js, хлебные крошки — из
// sourceName/targetName. Поисковик показывает rich result только если разметка
// совпадает с видимым текстом, а расхождение здесь появилось бы само, при
// правке любого лимита или названия формата.
const faqPage = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
});

const breadcrumbList = (name, path) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Главная', item: absoluteUrl('/') },
    { '@type': 'ListItem', position: 2, name, item: absoluteUrl(path) },
  ],
});

// Организация и сайт нужны не для rich result, а для сущности бренда: Google
// берёт логотип в выдаче из Organization.logo, а не только из favicon, и по
// sameAs связывает сайт с публичным профилем разработчика.
const REPO_URL = 'https://github.com/Lightning2005/Convert';
const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

const organization = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE_NAME,
  url: absoluteUrl('/'),
  logo: {
    '@type': 'ImageObject',
    url: absoluteUrl('/icon-512.png'),
    width: 512,
    height: 512,
  },
  sameAs: [REPO_URL],
});

const website = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': SITE_ID,
  name: SITE_NAME,
  url: absoluteUrl('/'),
  inLanguage: 'ru',
  publisher: { '@id': ORG_ID },
});

// Приложение, а не статья: поисковик должен понимать, что страница — бесплатный
// веб-инструмент. Цена указана нулём, потому что регистрации и платежей нет.
const softwareApplication = (tool, path) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: `${tool.sourceName} в ${tool.targetName} — конвертер «${SITE_NAME}»`,
  url: absoluteUrl(path),
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any',
  inLanguage: 'ru',
  isAccessibleForFree: true,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'RUB',
  },
});

/**
 * JSON-LD для маршрута. Пустой список без VITE_SITE_URL — по той же причине,
 * что и у canonical/og:url: item обязан быть абсолютным адресом.
 */
export function getStructuredData(pathname) {
  if (!SITE_URL) return [];

  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return [faqPage(HOME_FAQ), organization(), website()];

  if (path.startsWith('/tool/')) {
    const tool = SUPPORTED_TOOLS[path.slice('/tool/'.length)];
    if (tool) {
      return [
        breadcrumbList(`${tool.sourceName} в ${tool.targetName}`, path),
        faqPage(tool.faq),
        softwareApplication(tool, path),
      ];
    }
  }

  return [];
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
