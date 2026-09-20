// Фирменный логотип на картинках постов. Накладывает сам Cloudinary — прямо в адресе,
// ничего не скачивается и не пересохраняется. Цвет выбирается по фону: тёмный на светлом, белый на тёмном.

const LOGO_ID = process.env.BRAND_LOGO_ID || 'ffe/brand/femuse-logo-white';
const LOGO_LAYER = LOGO_ID.replace(/\//g, ':');
const DARK = process.env.BRAND_LOGO_DARK || '393c3f';

// Пропорции из обложек автора: 24% ширины, отступы 7,2% слева и 4,2% снизу
const WIDTH = 0.24;
const X = 0.072;
const Y = 0.042;
const LIGHT = 140; // ярче — ставим тёмный логотип

// Вставляем преобразование после базовых, перед версией картинки
function insert(url, transform) {
  if (/\/v\d+\//.test(url)) return url.replace(/\/(v\d+)\//, `/${transform}/$1/`);
  return url.replace('/upload/', `/upload/${transform}/`);
}

// Cloudinary отдаёт картинку 1×1 пиксель — по ней и меряем фон под логотипом
async function backgroundLuminance(url) {
  const probe = insert(url, 'c_crop,g_south_west,w_0.34,h_0.14,fl_relative/c_fill,w_1,h_1/f_bmp');
  const res = await fetch(probe, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`probe ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const [b, g, r] = buf.subarray(-4, -1); // в BMP порядок BGR
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function overlay(url, color) {
  const tint = color === 'dark' ? `,e_colorize:100,co_rgb:${DARK}` : '';
  return insert(url, `l_${LOGO_LAYER},w_${WIDTH},fl_relative${tint}/fl_layer_apply,g_south_west,x_${X},y_${Y},fl_relative`);
}

// Возвращает адрес картинки с логотипом; при любой ошибке — исходный адрес
async function withBrandLogo(url) {
  if (!url || !url.includes('/upload/') || url.includes(`l_${LOGO_LAYER}`)) return url;
  let color = 'dark'; // образы игры почти всегда на белом фоне
  try {
    color = (await backgroundLuminance(url)) > LIGHT ? 'dark' : 'white';
  } catch (e) {
    console.warn(`[brand] не удалось измерить фон: ${e.message}`);
  }
  return overlay(url, color);
}

module.exports = { withBrandLogo, overlay, backgroundLuminance };
