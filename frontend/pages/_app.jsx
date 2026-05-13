import '../styles/globals.css';
import { appWithTranslation } from 'next-i18next/pages';
import i18nConfig from '../next-i18next.config';

function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

export default appWithTranslation(App, i18nConfig);
