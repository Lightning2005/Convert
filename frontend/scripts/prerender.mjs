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

const { SITE_URL, OG_IMAGE_PATH, OG_IMAGE_ALT, absoluteUrl, getSeo, getSitemapEntries } = await import(
  pathToFileURL(path.join(root, 'src', 'seo.js')).href
);

const escapeAttr = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  return tags.join('\n    ');
}

const { renderRoute } = await import(pathToFileURL(ssrEntry).href);
const template = await readFile(path.join(distDir, 'index.html'), 'utf8');

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
