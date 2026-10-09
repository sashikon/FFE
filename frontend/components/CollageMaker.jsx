import { useEffect, useRef, useState } from 'react';
import SeoPanel from './SeoPanel';

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

const COLLAGE_MAX = 12;

// Добавить в коллаж ещё визуал: из коллекции (с фильтром по типу композиции) или файл с компьютера.
// Файл с компьютера идёт только в коллаж, в коллекцию он не сохраняется
function AddMore({ library, used, onAdd, onFiles, onClose }) {
  const [type, setType] = useState('');
  const types = [...new Set(library.flatMap((v) => v.compositions))].sort();
  const list = library.filter((v) => !used.has(v.id) && (!type || v.compositions.includes(type)));
  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-2 bg-zinc-950">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">Добавить визуал</span>
        <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white">готово</button>
      </div>
      <label className="block">
        <span className="inline-block px-2 py-1 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 cursor-pointer">файл с компьютера…</span>
        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
      </label>
      <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-black border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200">
        <option value="">из коллекции: все типы</option>
        {types.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="grid grid-cols-4 gap-1.5 max-h-60 overflow-y-auto">
        {list.map((v) => (
          <button key={v.id} type="button" onClick={() => onAdd(v)} title={v.outfit_title || v.compositions.join(', ')} className="rounded overflow-hidden border border-transparent hover:border-zinc-300">
            <img src={v.thumb_url} alt="" loading="lazy" className="w-full h-16 object-cover bg-zinc-900" />
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="text-zinc-600">В коллекции больше нечего добавить</p>}
    </div>
  );
}

export default function CollageMaker({ visuals, library = [], strategy = null, onClose, onSave, onSeoChanged }) {
  const [order, setOrder] = useState(visuals);
  const [format, setFormat] = useState('2:3');
  const [layout, setLayout] = useState('auto');
  const [fit, setFit] = useState('cover');
  const [gap, setGap] = useState(12);
  const [bg, setBg] = useState('#ffffff');
  const [images, setImages] = useState({});
  const [failed, setFailed] = useState({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Сохранённый коллаж: после сохранения его можно сразу разметить SEO
  const [saved, setSaved] = useState(null);
  // Коллаж поменяли после сохранения — SEO прежнего варианта больше не про то, что на экране
  useEffect(() => { setSaved(null); }, [order, format, layout, fit, gap, bg]);
  const canvasRef = useRef(null);

  // Догружаем картинки тех визуалов, что появились в коллаже; уже загруженные не трогаем
  const requested = useRef(new Set());
  useEffect(() => {
    order.forEach((v) => {
      if (requested.current.has(v.id)) return;
      requested.current.add(v.id);
      loadImage(v.local ? v.image_url : proxied(v.image_url))
        .then((img) => setImages((m) => ({ ...m, [v.id]: img })))
        .catch(() => setFailed((m) => ({ ...m, [v.id]: true })));
    });
  }, [order]);

  // Адреса файлов с компьютера живут, пока открыт сборщик
  const localUrls = useRef([]);
  useEffect(() => () => localUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const broken = order.filter((v) => failed[v.id]);
  const ready = order.length > 0 && order.every((v) => images[v.id]);
  const loaded = order.filter((v) => images[v.id]).length;

  const room = COLLAGE_MAX - order.length;
  const add = (v) => { if (room > 0 && !order.some((x) => x.id === v.id)) setOrder([...order, v]); };
  const addFiles = (files) => {
    const items = files.filter((f) => f.type.startsWith('image/')).slice(0, room).map((f, i) => {
      const url = URL.createObjectURL(f);
      localUrls.current.push(url);
      return { id: `file:${Date.now()}:${i}`, local: true, image_url: url, thumb_url: url, compositions: [], outfit_title: f.name };
    });
    if (items.length) setOrder([...order, ...items]);
  };
  const remove = (i) => setOrder(order.filter((_, j) => j !== i));

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
      const v = await onSave(await toBlob(), order);
      setSaved(v && !v.duplicate ? v : null);
      setMessage(v?.duplicate ? 'Такой коллаж уже есть в коллекции — SEO можно разметить на его карточке' : 'Коллаж сохранён в коллекцию');
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
          <h2 className="text-lg font-serif">Коллаж · {order.length}</h2>
          <button onClick={onClose} className="text-sm text-zinc-400 hover:text-white">закрыть ✕</button>
        </div>

        <div className="grid gap-8 md:grid-cols-[1fr_18rem]">
          <div className="flex justify-center">
            {order.length === 0 && <p className="text-zinc-500 text-sm py-20">В коллаже пусто — добавьте визуалы справа</p>}
            {order.length > 0 && !ready && !broken.length && <p className="text-zinc-500 text-sm py-20">Загружаю картинки… {loaded} из {order.length}</p>}
            {broken.length > 0 && <p className="text-rose-400 text-sm py-20">Не загрузились: {broken.length}. Уберите их из списка справа (✕) или закройте сборщик и откройте снова.</p>}
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
                  <img src={v.thumb_url} alt="" className={`w-8 h-10 object-cover rounded bg-zinc-900 ${failed[v.id] ? 'opacity-30' : ''}`} />
                  <span className={`flex-1 truncate ${failed[v.id] ? 'text-rose-400' : 'text-zinc-400'}`}>
                    {i + 1}. {v.outfit_title || v.compositions.join(', ') || 'визуал'}{v.local ? ' · с компьютера' : ''}
                  </span>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-zinc-400 hover:text-white disabled:opacity-20">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} className="px-1 text-zinc-400 hover:text-white disabled:opacity-20">↓</button>
                  <button type="button" onClick={() => remove(i)} title="Убрать из коллажа" className="px-1 text-zinc-500 hover:text-rose-400">✕</button>
                </div>
              ))}
              {!adding && (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  disabled={room <= 0}
                  className="mt-1 px-2 py-1 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                >{room > 0 ? '+ добавить визуал' : `не больше ${COLLAGE_MAX}`}</button>
              )}
            </div>

            {adding && (
              <AddMore
                library={library}
                used={new Set(order.map((v) => v.id))}
                onAdd={add}
                onFiles={addFiles}
                onClose={() => setAdding(false)}
              />
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button onClick={download} disabled={!ready} className="px-3 py-1.5 rounded-lg text-sm bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-40">Скачать JPG</button>
              <button onClick={save} disabled={!ready || busy} className="px-3 py-1.5 rounded-lg text-sm bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40">
                {busy ? 'Сохраняю…' : 'Сохранить в коллекцию'}
              </button>
            </div>
            {message && <p className="text-zinc-400">{message}</p>}
            {saved && (
              <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-950 space-y-2">
                <p className="text-zinc-300">SEO для пина</p>
                <SeoPanel key={saved.id} visual={saved} strategy={strategy} onChanged={onSeoChanged} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
