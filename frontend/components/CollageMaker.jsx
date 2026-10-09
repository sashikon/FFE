import { useEffect, useRef, useState } from 'react';

// Вертикальные форматы. Пиксели — под соцсети: Pinterest 2:3, лента Instagram 4:5, сторис 9:16
const FORMATS = {
  '2:3': { w: 1000, h: 1500, label: '2:3 · Pinterest' },
  '4:5': { w: 1080, h: 1350, label: '4:5 · лента' },
  '9:16': { w: 1080, h: 1920, label: '9:16 · сторис' },
};

const LAYOUTS = {
  auto: 'сам выберет',
  column: 'столбик',
  grid: 'сетка в 2 колонки',
};

const proxied = (url) => `/api/visual-image?url=${encodeURIComponent(url)}`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('картинка не загрузилась'));
    img.src = src;
  });
}

// Раскладка ячеек: столбик — одна колонка; сетка — две, а нечётная последняя картинка
// занимает всю ширину нижнего ряда
function cells(n, layout, W, H, gap) {
  const mode = layout === 'auto' ? (n <= 3 ? 'column' : 'grid') : layout;
  const cols = mode === 'column' || n === 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const ch = (H - gap * (rows + 1)) / rows;
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const lastAlone = cols === 2 && i === n - 1 && n % 2 === 1;
    const c = lastAlone ? 1 : cols;
    const cw = (W - gap * (c + 1)) / c;
    const col = lastAlone ? 0 : i % cols;
    out.push({ x: gap + col * (cw + gap), y: gap + row * (ch + gap), w: cw, h: ch });
  }
  return out;
}

// cover — заполнить ячейку, обрезав лишнее по центру; contain — вписать целиком, поля залить фоном
function drawInto(ctx, img, cell, fit) {
  const ir = img.width / img.height;
  const cr = cell.w / cell.h;
  if (fit === 'cover') {
    let sw = img.width, sh = img.height, sx = 0, sy = 0;
    if (ir > cr) { sw = img.height * cr; sx = (img.width - sw) / 2; } else { sh = img.width / cr; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, cell.x, cell.y, cell.w, cell.h);
  } else {
    let w = cell.w, h = cell.h;
    if (ir > cr) h = cell.w / ir; else w = cell.h * ir;
    ctx.drawImage(img, cell.x + (cell.w - w) / 2, cell.y + (cell.h - h) / 2, w, h);
  }
}

export default function CollageMaker({ visuals, onClose, onSave }) {
  const [order, setOrder] = useState(visuals);
  const [format, setFormat] = useState('2:3');
  const [layout, setLayout] = useState('auto');
  const [fit, setFit] = useState('cover');
  const [gap, setGap] = useState(12);
  const [bg, setBg] = useState('#ffffff');
  const [images, setImages] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canvasRef = useRef(null);

  useEffect(() => {
    let alive = true;
    visuals.forEach((v) => {
      loadImage(proxied(v.image_url))
        .then((img) => alive && setImages((m) => ({ ...m, [v.id]: img })))
        .catch(() => alive && setError('Часть картинок не загрузилась — попробуйте открыть сборщик ещё раз'));
    });
    return () => { alive = false; };
  }, [visuals]);

  const ready = order.every((v) => images[v.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const { w, h } = FORMATS[format];
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const scaledGap = Math.round((gap * w) / 1000);
    cells(order.length, layout, w, h, scaledGap).forEach((cell, i) => drawInto(ctx, images[order[i].id], cell, fit));
  }, [ready, order, images, format, layout, fit, gap, bg]);

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const toBlob = () => new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/jpeg', 0.92));

  const download = async () => {
    const blob = await toBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `collage-${format.replace(':', 'x')}-${Date.now()}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onSave(await toBlob(), order);
      setMessage('Коллаж сохранён в коллекцию');
    } catch (e) {
      setMessage(`Не сохранилось: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const select = 'bg-black border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200';

  return (
    <div className="fixed inset-0 z-50 bg-black/90 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-serif">Коллаж из {order.length} визуалов</h2>
          <button onClick={onClose} className="text-sm text-zinc-400 hover:text-white">закрыть ✕</button>
        </div>

        <div className="grid gap-8 md:grid-cols-[1fr_18rem]">
          <div className="flex justify-center">
            {!ready && !error && <p className="text-zinc-500 text-sm py-20">Загружаю картинки… {Object.keys(images).length} из {order.length}</p>}
            {error && <p className="text-rose-400 text-sm py-20">{error}</p>}
            <canvas ref={canvasRef} className={`max-h-[75vh] w-auto max-w-full border border-zinc-800 ${ready ? '' : 'hidden'}`} />
          </div>

          <div className="space-y-4 text-xs">
            <label className="block space-y-1">
              <span className="text-zinc-500">Формат</span>
              <select value={format} onChange={(e) => setFormat(e.target.value)} className={`${select} w-full`}>
                {Object.entries(FORMATS).map(([k, f]) => <option key={k} value={k}>{f.label} ({f.w}×{f.h})</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-zinc-500">Раскладка</span>
              <select value={layout} onChange={(e) => setLayout(e.target.value)} className={`${select} w-full`}>
                {Object.entries(LAYOUTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-zinc-500">Как вписывать картинки</span>
              <select value={fit} onChange={(e) => setFit(e.target.value)} className={`${select} w-full`}>
                <option value="cover">заполнить ячейку, обрезав края</option>
                <option value="contain">целиком, с полями</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-zinc-500">Промежуток: {gap}</span>
              <input type="range" min="0" max="60" value={gap} onChange={(e) => setGap(Number(e.target.value))} className="w-full" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-zinc-500">Фон</span>
              <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="w-8 h-6 bg-transparent" />
              <button type="button" onClick={() => setBg('#ffffff')} className="text-zinc-500 hover:text-white">белый</button>
              <button type="button" onClick={() => setBg('#000000')} className="text-zinc-500 hover:text-white">чёрный</button>
            </label>

            <div className="space-y-1">
              <span className="text-zinc-500">Порядок (сверху вниз, слева направо)</span>
              {order.map((v, i) => (
                <div key={v.id} className="flex items-center gap-2">
                  <img src={v.thumb_url} alt="" className="w-8 h-10 object-cover rounded bg-zinc-900" />
                  <span className="flex-1 truncate text-zinc-400">{i + 1}. {v.outfit_title || v.compositions.join(', ') || 'визуал'}</span>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-zinc-400 hover:text-white disabled:opacity-20">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} className="px-1 text-zinc-400 hover:text-white disabled:opacity-20">↓</button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button onClick={download} disabled={!ready} className="px-3 py-1.5 rounded-lg text-sm bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-40">Скачать JPG</button>
              <button onClick={save} disabled={!ready || busy} className="px-3 py-1.5 rounded-lg text-sm bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40">
                {busy ? 'Сохраняю…' : 'Сохранить в коллекцию'}
              </button>
            </div>
            {message && <p className="text-zinc-400">{message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
