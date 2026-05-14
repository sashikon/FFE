import '../styles/globals.css';
import { appWithTranslation } from 'next-i18next/pages';
import i18nConfig from '../next-i18next.config';
import { Analytics } from '@vercel/analytics/next';

function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <Analytics />
    </>
  );
}

export default appWithTranslation(App, i18nConfig);
