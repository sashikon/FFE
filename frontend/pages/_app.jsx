import '../styles/globals.css';
import Head from 'next/head';
import { appWithTranslation } from 'next-i18next/pages';
import i18nConfig from '../next-i18next.config';
import { Analytics } from '@vercel/analytics/next';
import { useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// Переход по ссылке пина коллажа (?c=<8 знаков id>) — отмечаем один раз за сессию браузера,
// чтобы в админке было видно, какие коллажи приводят людей на сайт
function useCollageClick() {
  useEffect(() => {
    try {
      const c = new URLSearchParams(window.location.search).get('c');
      if (!c || !/^[0-9a-f]{8}$/i.test(c)) return;
      const key = `ffe-c-${c}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      fetch(`${API_BASE}/api/visual-click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ c, referrer: document.referrer || '' }),
      }).catch(() => {});
    } catch {
      // учёт переходов никогда не мешает сайту
    }
  }, []);
}

function App({ Component, pageProps }) {
  useCollageClick();
  return (
    <>
      <Head>
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      </Head>
      <Component {...pageProps} />
      <Analytics />
    </>
  );
}

export default appWithTranslation(App, i18nConfig);
