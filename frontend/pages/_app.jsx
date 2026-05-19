import '../styles/globals.css';
import Head from 'next/head';
import { appWithTranslation } from 'next-i18next/pages';
import i18nConfig from '../next-i18next.config';
import { Analytics } from '@vercel/analytics/next';

function App({ Component, pageProps }) {
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
