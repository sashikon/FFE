// Адрес сайта в одном месте: он попадает в карту сайта, в RSS-ленты для Pinterest,
// в ссылки «поделиться» и в разметку страниц. Меняется переменной NEXT_PUBLIC_SITE_URL,
// без правок в коде — например, при переезде на свой домен.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://ffe-blush.vercel.app').replace(/\/$/, '');
