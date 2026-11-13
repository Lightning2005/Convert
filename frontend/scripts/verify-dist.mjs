// Проверка собранного dist: то, что должно быть в статических страницах после
// `npm run build`. Запускается в CI после сборки — ловит момент, когда SEO-теги,
// sitemap или манифест перестают генерироваться, но сборка при этом зелёная.
//
// Сборка обязана быть выполнена с VITE_SITE_URL: без него canonical, og:image и
// sitemap намеренно не выводятся, и проверка ниже на это и укажет.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_TOOLS } from '../src/config/tools.js';
import { getSitemapEntries, absoluteUrl } from '../src/seo.js';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const failures = [];

if (!absoluteUrl('/')) {
  console.error('VITE_SITE_URL не задан: canonical, og:image, robots.txt и sitemap не генерируются.');
  console.error('Соберите с адресом сайта — например VITE_SITE_URL=https://konvert.example.com npm run build');
  process.exit(1);
}

const sitemapUrl = (path) => absoluteUrl(path);

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

function read(path) {
  return readFileSync(join(DIST, path), 'utf8');
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html не найден — сначала выполните npm run build');
  process.exit(1);
}

const pages = getSitemapEntries().map((entry) => entry.path);

check(
  'каждая страница из sitemap собрана',
  pages.every((path) => existsSync(join(DIST, `${path === '/' ? '' : path}/index.html`))),
  pages.filter((path) => !existsSync(join(DIST, `${path === '/' ? '' : path}/index.html`))).join(', ')
);

// Дубли на .html нужны паукам и редиректам: /tool/jpeg-to-webp.html должен
// открываться так же, как /tool/jpeg-to-webp/.
check(
  'страницы продублированы в форму <путь>.html',
  pages.every((path) => existsSync(join(DIST, `${path === '/' ? 'index' : path}.html`)))
);

for (const path of pages) {
  const html = read(`${path === '/' ? '' : path}/index.html`);
  const label = `meta: ${path}`;
  const missing = [
    !/<link rel="canonical" href="https:\/\//.test(html) && 'canonical',
    !/<meta property="og:image" content="https:\/\//.test(html) && 'og:image',
    !/<meta name="twitter:image" content="https:\/\//.test(html) && 'twitter:image',
    !/<meta name="twitter:card" content="summary_large_image">/.test(html) && 'twitter:card',
    !/<meta name="description" content=".+">/.test(html) && 'description',
    !html.includes('href="/favicon.ico"') && 'ссылка на favicon.ico',
  ].filter(Boolean);

  check(label, missing.length === 0, `нет: ${missing.join(', ')}`);
}

// Длинный description поисковик обрезает прямо в сниппете, и вместе с хвостом
// пропадает обещание «до 20 файлов» — то, чем страница отличается от конкурента.
const longDescriptions = pages
  .map((path) => {
    const html = read(`${path === '/' ? '' : path}/index.html`);
    const match = html.match(/<meta name="description" content="([^"]*)">/);
    return { path, length: match ? match[1].length : 0 };
  })
  .filter(({ length }) => length > 160);
check('description не длиннее 160 символов', longDescriptions.length === 0,
  longDescriptions.map(({ path, length }) => `${path}: ${length}`).join(', '));

const robots = existsSync(join(DIST, 'robots.txt')) ? read('robots.txt') : '';
const sitemap = existsSync(join(DIST, 'sitemap.xml')) ? read('sitemap.xml') : '';

check('robots.txt указывает на sitemap', /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(robots), robots.slice(0, 80));
check(
  'sitemap содержит каждую страницу',
  pages.every((path) => sitemap.includes(`<loc>${sitemapUrl(path)}</loc>`)),
  `записей: ${(sitemap.match(/<url>/g) || []).length}, ожидалось: ${pages.length}`
);
check('в sitemap нет относительных адресов', !sitemap.includes('<loc>/'));

// Манифест: браузер не покажет иконку приложения, если ссылка ведёт в никуда
// или JSON не парсится.
const manifestPath = join(DIST, 'manifest.webmanifest');
check('manifest.webmanifest собран', existsSync(manifestPath));
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  check('в манифесте есть иконки 192 и 512',
    ['192x192', '512x512'].every((size) => manifest.icons?.some((icon) => icon.sizes === size)));
  check('иконки из манифеста лежат в dist',
    manifest.icons.every((icon) => existsSync(join(DIST, icon.src.replace(/^\//, '')))));
  check('превью-картинка на месте', existsSync(join(DIST, 'og-image.png')));
}

// Фавикон: логотип в выдаче показывают только тогда, когда иконка читается на
// 16 px, а однослойный .ico ломается именно там. Заголовок ICO разбирается по
// байтам, чтобы правка иконок не превратилась снова в «обещали пять слоёв,
// положили один» — такой расход ловится только проверкой файла, не глазком.
const icoFile = join(DIST, 'favicon.ico');
let icoLayers = [];
if (existsSync(icoFile)) {
  const ico = readFileSync(icoFile);
  if (ico.length > 6 && ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1) {
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const width = ico[6 + 16 * i];
      icoLayers.push(width === 0 ? 256 : width);
    }
  }
}
check('favicon.ico многослойный', [16, 24, 32, 48, 256].every((s) => icoLayers.includes(s)),
  `слои: ${icoLayers.join(', ') || 'файл не разобран как ICO'}`);
check('в <head> нет ссылки на favicon.svg',
  !read('index.html').includes('favicon.svg'),
  'SVG переопределяет слои в Chrome, а его штрих ~1% ширины исчезает на 16 px');

// Текстовый наполнитель страниц инструментов: без него 22 страницы выглядят
// как один шаблон.
for (const slug of Object.keys(SUPPORTED_TOOLS)) {
  const html = read(`tool/${slug}/index.html`);
  const faqCount = (html.match(/<details/g) || []).length;
  const stepCount = ((html.match(/Как это работает:<\/h3>.*?<\/ol>/s) || [''])[0].match(/<li>/g) || []).length;
  check(`контент: /tool/${slug}`, faqCount === 4 && stepCount >= 3,
    `вопросов: ${faqCount}, шагов: ${stepCount}`);
}

// Перелинкование. Страница инструмента, на которую нет внутренней ссылки, для
// робота живёт только в sitemap.xml — без ссылочного веса внутри сайта она не
// индексируется. Проверка ловит момент, когда меню снова рендерится только по
// клику и в prerender-HTML не остаётся ни одного href="/tool/…".
const homeHtml = read('index.html');
const unlinkedTools = Object.keys(SUPPORTED_TOOLS)
  .filter((slug) => !homeHtml.includes(`href="/tool/${slug}"`));
check('главная ссылается на каждый инструмент', unlinkedTools.length === 0,
  `нет ссылок: ${unlinkedTools.join(', ')}`);

const deadEndTools = Object.keys(SUPPORTED_TOOLS)
  .filter((slug) => (read(`tool/${slug}/index.html`).match(/href="\/tool\//g) || []).length < 3);
check('страница инструмента не тупик', deadEndTools.length === 0,
  `мало исходящих ссылок: ${deadEndTools.join(', ')}`);

// Места под рекламу появляются в разметке только вместе с id издателя: без
// VITE_ADS_CLIENT на собранной странице не должно ни контейнеров, ни кнопки
// «Закрыть рекламу» — фальшивую рекламу модератор читает как обещание показа.
const adsConfigured = Boolean((process.env.VITE_ADS_CLIENT || '').trim());
const pagesWithSlots = pages.filter(
  (path) => read(`${path === '/' ? '' : path}/index.html`).includes('ad-slot')
);

check(
  adsConfigured ? 'места под рекламу собраны' : 'без VITE_ADS_CLIENT рекламных мест нет',
  adsConfigured ? pagesWithSlots.length > 0 : pagesWithSlots.length === 0,
  `страниц с ad-slot: ${pagesWithSlots.length} из ${pages.length}`
);

const totalHtml = (function count(dir) {
  let sum = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sum += count(full);
    else if (entry.endsWith('.html')) sum += 1;
  }
  return sum;
})(DIST);

// У корня две формы совпадают (dist/index.html и dist/.html), поэтому минус
// одна страница, и плюс одна — служебный 404.html вне sitemap.
const expectedHtml = pages.length * 2;

check('страниц в dist ровно столько, сколько маршрутов', totalHtml === expectedHtml,
  `найдено ${totalHtml}, ожидалось ${expectedHtml}`);

// error_page nginx'а указывает на этот файл: у отсутствующей страницы должен
// быть текст без JavaScript и meta robots noindex.
const notFound = existsSync(join(DIST, '404.html')) ? read('404.html') : '';
check('404.html собрана и объясняет, что случилось',
  notFound.includes('Страница не найдена') && /content="noindex,follow"/.test(notFound),
  notFound ? 'нет текста или noindex' : 'файла нет');

// Счётчик посещаемости живёт по тому же правилу, что и рекламные места: только
// вместе со своим ID из кабинета. Проверяются обе ветки — отсутствие Метрики у
// сайта без настроенного счётчика важно не меньше, чем её наличие на всех
// страницах после настройки: иначе в отчётах модератора числится аудитория,
// которую код не собирает.
const metrikaId = (process.env.VITE_METRIKA_ID || '').trim();
const allPageHtml = [...pages.map((path) => read(`${path === '/' ? '' : path}/index.html`)), notFound];
const withCounter = allPageHtml.filter((html) => html.includes('mc.yandex.ru/metrika/tag.js'));

check(
  metrikaId ? `счётчик Метрики №${metrikaId} на каждой странице` : 'без VITE_METRIKA_ID счётчика посещаемости в сборке нет',
  metrikaId
    ? withCounter.length === allPageHtml.length
      && allPageHtml.every((html) => html.includes(`ym(${metrikaId}, 'init'`))
    : withCounter.length === 0,
  `страниц со счётчиком: ${withCounter.length} из ${allPageHtml.length}`
);

// JSON-LD. Робот читает его без JavaScript, поэтому важны два факта: блок
// парсится (битый JSON поисковик молча выбрасывает, и сборка об этом не
// узнает) и его текст совпадает с тем, что человек видит на странице.
// Разметка про вопросы, которых на странице нет, для Google и Яндекса — спам,
// и rich result за неё не показывается, а не показывается вместо этого всё.
// Сравниваем именно с HTML, а не с getStructuredData: проверка, построенная
// на тех же данных, что и генератор, ничего не ловит.
// Сравнивать надо с тем, что осталось от страницы после удаления блоков
// разметки: вопрос из JSON-LD всегда присутствует в этом же JSON-LD, и проверка
// по всему HTML прошла бы даже на странице, где видимого вопроса нет — это
// поймано на подмене текста вопроса в собранной странице.
const withoutLd = (html) => html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');

function ldBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(([, body]) => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    });
}

const byType = (blocks, type) => blocks.find((block) => block && block['@type'] === type);
const matchesVisible = (html, entity) => {
  const visible = withoutLd(html);
  return entity.every(({ name, acceptedAnswer }) => visible.includes(name) && visible.includes(acceptedAnswer.text));
};

const homeLd = ldBlocks(homeHtml);
check('JSON-LD главной парсится', homeLd.length === 3 && homeLd.every(Boolean),
  `блоков: ${homeLd.length}`);

const homeFaq = byType(homeLd, 'FAQPage');
check('FAQ главной в разметке совпадает с видимым текстом',
  Boolean(homeFaq) && matchesVisible(homeHtml, homeFaq.mainEntity),
  homeFaq ? `вопросов в разметке: ${homeFaq.mainEntity.length}` : 'блока FAQPage нет');

const homeOrg = byType(homeLd, 'Organization');
const homeSite = byType(homeLd, 'WebSite');
check('Organization главной описывает бренд, логотип и профиль',
  Boolean(homeOrg) &&
    homeOrg.name === 'Конверт' &&
    homeOrg.logo?.url === absoluteUrl('/icon-512.png') &&
    existsSync(join(DIST, 'icon-512.png')) &&
    Array.isArray(homeOrg.sameAs) &&
    homeOrg.sameAs.includes('https://github.com/Lightning2005/Convert'),
  homeOrg ? `логотип: ${homeOrg.logo?.url ?? 'нет'}` : 'блока Organization нет');
check('WebSite главной ссылается на Organization',
  Boolean(homeSite) &&
    homeSite.url === absoluteUrl('/') &&
    homeSite.publisher?.['@id'] === homeOrg?.['@id'],
  homeSite ? `publisher: ${homeSite.publisher?.['@id'] ?? 'нет'}` : 'блока WebSite нет');

const ldProblems = [];
for (const slug of Object.keys(SUPPORTED_TOOLS)) {
  const html = read(`tool/${slug}/index.html`);
  const blocks = ldBlocks(html);
  const faq = byType(blocks, 'FAQPage');
  const crumb = byType(blocks, 'BreadcrumbList');
  const app = byType(blocks, 'SoftwareApplication');
  // Видимых вопросов на странице инструмента ровно столько, сколько <details>
  const visible = (withoutLd(html).match(/<details/g) || []).length;
  const ok =
    blocks.length === 3 &&
    blocks.every(Boolean) &&
    faq && crumb && app &&
    faq.mainEntity.length === visible &&
    matchesVisible(html, faq.mainEntity) &&
    crumb.itemListElement.length === 2 &&
    crumb.itemListElement.every((item, i) => /^https:\/\//.test(item.item) && (i === 0 || withoutLd(html).includes(item.name))) &&
    app.url === absoluteUrl(`/tool/${slug}`) &&
    app.applicationCategory === 'UtilitiesApplication' &&
    app.offers?.price === '0' &&
    app.name.includes(SUPPORTED_TOOLS[slug].sourceName);
  if (!ok) ldProblems.push(`${slug} (блоков: ${blocks.length}, вопросов: ${faq ? faq.mainEntity.length : 0}, видимых: ${visible}, app: ${app ? 'есть' : 'нет'})`);
}
check('JSON-LD страниц инструментов парсится и совпадает с видимым текстом',
  ldProblems.length === 0, ldProblems.join('; '));

check('у служебных страниц лишнего JSON-LD нет',
  ['/privacy', '/contacts'].every((path) => ldBlocks(read(`${path}/index.html`)).length === 0) &&
    !notFound.includes('application/ld+json'));

console.log(`\n${failures.length === 0 ? 'OK' : `Провалено: ${failures.length}`}`);
process.exit(failures.length === 0 ? 0 : 1);
