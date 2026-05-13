import '../styles/globals.css';
import { appWithTranslation } from 'next-i18next/pages';

function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

export default appWithTranslation(App);
