import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { absoluteUrl, getSeo, getStructuredData } from '../seo';

function upsert(selector, tag, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    document.head.appendChild(el);
    return el;
  }
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

// Разметка описывает то, что человек видит на этой странице, поэтому живые
// FAQ-вопросы и хлебные крошки главной остались бы «висять» на странице
// инструмента после перехода — поисковик читает расхождение как спам.
// Скрипты удаляются все до одного: статический HTML собран prerender-ом без
// различающего атрибута, и иначе после гидратации было бы два блока.
function syncJsonLd(items) {
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());
  for (const data of items) {
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.textContent = JSON.stringify(data);
    document.head.appendChild(el);
  }
}

/** Синхронизирует <title>, description, canonical и Open Graph при переходах SPA. */
export default function Seo() {
  const location = useLocation();

  useEffect(() => {
    const seo = getSeo(location.pathname);
    const url = absoluteUrl(seo.path);

    document.title = seo.title;
    upsert('meta[name="description"]', 'meta', { name: 'description', content: seo.description });
    upsert('meta[property="og:title"]', 'meta', { property: 'og:title', content: seo.title });
    upsert('meta[property="og:description"]', 'meta', { property: 'og:description', content: seo.description });
    upsert('meta[property="og:type"]', 'meta', { property: 'og:type', content: 'website' });
    upsert('meta[property="og:locale"]', 'meta', { property: 'og:locale', content: 'ru_RU' });
    if (url) {
      upsert('meta[property="og:url"]', 'meta', { property: 'og:url', content: url });
      upsert('link[rel="canonical"]', 'link', { rel: 'canonical', href: url });
    }
    upsert('meta[name="robots"]', 'meta', {
      name: 'robots',
      content: seo.noindex ? 'noindex,follow' : 'index,follow',
    });
    syncJsonLd(getStructuredData(location.pathname));
  }, [location.pathname]);

  return null;
}
