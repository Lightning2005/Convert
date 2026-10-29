import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SITE_URL, absoluteUrl, getSeo, getSitemapEntries } from '../src/seo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const ssrEntry = path.join(root, '.vite-ssr', 'entry-server.js');

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
if (!SITE_URL) {
  console.warn('VITE_SITE_URL не задан — canonical, og:url и sitemap.xml не сгенерированы.');
}
