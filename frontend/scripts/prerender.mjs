import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const ssrEntry = path.join(root, '.vite-ssr', 'entry-server.js');

// .env/.env.production читаем так же, как Vite, чтобы адрес сайта был общий
// для браузера (import.meta.env) и для этого скрипта (process.env)
Object.assign(process.env, loadEnv('production', root, 'VITE_'));

const { SITE_URL, OG_IMAGE_PATH, OG_IMAGE_ALT, absoluteUrl, getSeo, getSitemapEntries, getStructuredData } = await import(
  pathToFileURL(path.join(root, 'src', 'seo.js')).href
);

const escapeAttr = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// JSON внутри <script> остаётся JSON, а не HTML, поэтому экранируются не кавычки,
// а символы, которые иначе закрыли бы тег раньше времени: </script> в тексте
// ответа FAQ разорвал бы блок и сломал всю разметку страницы.
const jsonLdScript = (data) => {
  const body = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script type="application/ld+json">${body}</script>`;
};

function headTags(seo) {
  const url = absoluteUrl(seo.path);
  const tags = [
    `<title>${escapeAttr(seo.title)}</title>`,
    `<meta name="description" content="${escapeAttr(seo.description)}">`,
    `<meta name="robots" content="${seo.noindex ? 'noindex,follow' : 'index,follow'}">`,
    `<meta property="og:title" content="${escapeAttr(seo.title)}">`,
    `<meta property="og:description" content="${escapeAttr(seo.description)}">`,
  ];
  if (url) {
    tags.push(`<link rel="canonical" href="${escapeAttr(url)}">`);
    tags.push(`<meta property="og:url" content="${escapeAttr(url)}">`);
    // og:image обязан быть абсолютным, поэтому теги живут в той же ветке, что и
    // canonical: без VITE_SITE_URL превью просто не выводится вместо битой ссылки.
    const image = absoluteUrl(OG_IMAGE_PATH);
    tags.push(`<meta property="og:image" content="${escapeAttr(image)}">`);
    tags.push('<meta property="og:image:width" content="1200">');
    tags.push('<meta property="og:image:height" content="630">');
    tags.push(`<meta property="og:image:alt" content="${escapeAttr(OG_IMAGE_ALT)}">`);
    tags.push(`<meta name="twitter:image" content="${escapeAttr(image)}">`);
    tags.push(`<meta name="twitter:title" content="${escapeAttr(seo.title)}">`);
    tags.push(`<meta name="twitter:description" content="${escapeAttr(seo.description)}">`);
  }
  // Robot читает эти блоки без JavaScript: ровно поэтому разметка попадает в
  // статический HTML, а не только в клиентский Seo при гидратации.
  for (const data of getStructuredData(seo.path)) tags.push(jsonLdScript(data));
  return tags.join('\n    ');
}

const { renderRoute } = await import(pathToFileURL(ssrEntry).href);
const templateRaw = await readFile(path.join(distDir, 'index.html'), 'utf8');

// Счётчик посещаемости. ID приходит из секрета сборки и попадает в HTML как
// есть, поэтому принимается только цифрами; иначе сборка падает, а не пишет
// произвольную строку в <head> каждой страницы.
const metrikaId = (process.env.VITE_METRIKA_ID || '').trim();
if (metrikaId && !/^\d+$/.test(metrikaId)) {
  throw new Error(`VITE_METRIKA_ID — это номер счётчика, только цифры: ${JSON.stringify(metrikaId)}`);
}

// Вставляется в шаблон до подстановки seo-блока, чтобы пережить prerender: теги
// внутри <!-- seo:start --> сборщик вытирает целиком. Webvisor сознательно не
// включён — он записывает экран пользователя, а на конвертере в кадр попадают
// имена и содержимое чужих файлов; для оценки аудитории достаточно хитов.
const counterTag = metrikaId
  ? `
    <script>
      (function (m, e, t, r, i, k, a) {
        m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
        m[i].l = 1 * new Date();
        for (var j = 0; j < e.scripts.length; j++) { if (e.scripts[j].src === r) { return; } }
        k = e.createElement(t), a = e.getElementsByTagName(t)[0], k.async = 1, k.src = r, a.parentNode.insertBefore(k, a);
      })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
      ym(${metrikaId}, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
    </script>
`
  : '';
const template = counterTag ? templateRaw.replace('</head>', `${counterTag}  </head>`) : templateRaw;

if (!template.includes('<!-- seo:start')) {
  throw new Error('В dist/index.html нет блока <!-- seo:start --> — нечего подставлять');
}

const blockRe = /<!-- seo:start[\s\S]*?<!-- seo:end -->/;
const routes = getSitemapEntries();
const written = [];

for (const { path: route } of routes) {
  const seo = getSeo(route);
  const markup = renderRoute(route);
  const page = template
    .replace(blockRe, headTags(seo))
    .replace('<div id="root"></div>', `<div id="root">${markup}</div>`);

  const segments = route.split('/').filter(Boolean);
  const targets = route === '/'
    ? [path.join(distDir, 'index.html')]
    : [
        // /tool/jpg-to-pdf/ — каталог с index.html (nginx try_files $uri/)
        path.join(distDir, ...segments, 'index.html'),
        // /tool/jpg-to-pdf.html — плоский файл (Netlify, Vercel, S3, nginx $uri.html)
        path.join(distDir, ...segments) + '.html',
      ];

  for (const target of targets) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, page, 'utf8');
  }
  written.push(route);
}

console.log(`Статических страниц собрано: ${written.length}`);
console.log(metrikaId
  ? `Счётчик Яндекс.Метрики N${metrikaId} вставлен во все страницы`
  : 'VITE_METRIKA_ID не задан — страницы собраны без счётчика посещаемости.');

// Страница для error_page отдающего сервера. Без неё у несуществующего адреса
// либо заглушка nginx, либо шелл приложения с кодом 200 — «мягкий 404» пауком
// читается как живой документ, а модератором как сломанный сайт.
const notFoundPage = template
  .replace(blockRe, headTags(getSeo('/404')))
  .replace('<div id="root"></div>', `<div id="root">${renderRoute('/404')}</div>`);
await writeFile(path.join(distDir, '404.html'), notFoundPage, 'utf8');

const escapeXml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sitemapFile(lastmod) {
  const urls = getSitemapEntries()
    .map(({ path: route, priority, changefreq }) => [
      '  <url>',
      `    <loc>${escapeXml(`${SITE_URL}${route}`)}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      '  </url>',
    ].join('\n'))
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

if (SITE_URL) {
  const lastmod = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(distDir, 'sitemap.xml'), sitemapFile(lastmod), 'utf8');
  await writeFile(
    path.join(distDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    'utf8'
  );
  console.log(`robots.txt и sitemap.xml: ${SITE_URL} (${getSitemapEntries().length} адресов)`);
} else {
  console.warn('VITE_SITE_URL не задан — canonical, og:url, robots.txt и sitemap.xml не сгенерированы.');
}

// ads.txt: строку берём из кабинета РСЯ, она специфична для домена и издателя
const adsTxt = (process.env.VITE_ADS_TXT || '').trim();
await writeFile(
  path.join(distDir, 'ads.txt'),
  adsTxt
    ? `${adsTxt}\n`
    : '# Заполните VITE_ADS_TXT строкой из кабинета Яндекс.Reкламы:\n' +
      '# yandex.com, pub-XXXXXXXXXXXXX, DIRECT, <контрольный параметр>\n',
  'utf8'
);
if (!adsTxt) console.warn('VITE_ADS_TXT не задан — ads.txt собран с заглушкой-комментарием.');
