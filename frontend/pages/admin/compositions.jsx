import { useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { adminFetcher, apiPost, apiPatch, apiDelete } from '../../lib/api';
import { withAuth } from '../../lib/withAuth';
import CollageMaker from '../../components/CollageMaker';
import SeoPanel from '../../components/SeoPanel';

const COLLAGE_MAX = 12;

// Стартовый набор типов. Это подсказки, а не закрытый список: можно вписать свой тип,
// и он появится в фильтре, как только на него будет помечен хотя бы один визуал
const PRESETS = [
  'по центру',
  'правило третей',
  'диагональ',
  'симметрия',
  'асимметрия',
  'крупный план',
  'деталь',
  'в полный рост',
  'сверху / раскладка',
  'группа / ряд',
  'пустое пространство',
  'рамка в кадре',
  'повтор / ритм',
  'обрезка краем кадра',
];

const API = '/api/admin/visuals';

function CompositionPicker({ value, onChange, known }) {
  const [custom, setCustom] = useState('');
  const options = [...new Set([...PRESETS, ...known])];
  const toggle = (c) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  const addCustom = () => {
    const c = custom.trim().toLowerCase();
    if (c && !value.includes(c)) onChange([...value, c]);
    setCustom('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            className={`px-2 py-1 rounded-lg text-xs transition-colors ${value.includes(c) ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
          >{c}</button>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder="свой тип композиции"
          className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
        />
        <button type="button" onClick={addCustom} className="px-3 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700">добавить</button>
      </div>
    </div>
  );
}

// Выбор из того, что уже есть в игре: эскизы образов и рендеры. Картинки не загружаются заново —
// визуал ссылается на образ или рендер
function LibraryPicker({ selected, onChange, taken }) {
  const { data, error, isLoading } = useSWR('/api/admin/outfits', adminFetcher);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');

  const keyOf = (p) => (p.render_id ? `r:${p.render_id}` : `o:${p.outfit_id}`);
  const isSelected = (p) => selected.some((s) => keyOf(s) === keyOf(p));
  const toggle = (p) => onChange(isSelected(p) ? selected.filter((s) => keyOf(s) !== keyOf(p)) : [...selected, p]);

  const query = q.trim().toLowerCase();
  const outfits = (data?.outfits || []).filter((o) =>
    !query || `${o.title || ''} ${o.title_en || ''}`.toLowerCase().includes(query));

  const tile = (pick, thumb, label) => {
    const inCollection = taken.has(keyOf(pick));
    const on = isSelected(pick);
    return (
      <button
        key={keyOf(pick)}
        type="button"
        disabled={inCollection}
        onClick={() => toggle(pick)}
        title={inCollection ? 'Уже в коллекции' : label}
        className={`relative w-24 shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${on ? 'border-zinc-100' : 'border-transparent hover:border-zinc-600'} ${inCollection ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        <img src={thumb} alt={label} loading="lazy" className="w-24 h-32 object-cover bg-zinc-900" />
        <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-zinc-300 px-1 py-0.5 truncate">
          {inCollection ? 'уже есть' : label}
        </span>
        {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-zinc-100 text-zinc-900 text-xs flex items-center justify-center">✓</span>}
      </button>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[['all', 'всё'], ['sketch', 'эскизы образов'], ['render', 'рендеры']].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`px-2 py-1 rounded-lg text-xs transition-colors ${kind === k ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
          >{label}</button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="поиск по названию образа"
          className="flex-1 min-w-[10rem] bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
        />
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-xs text-zinc-500 hover:text-white">снять выбор ({selected.length})</button>
        )}
      </div>

      {isLoading && <p className="text-xs text-zinc-500">Загружаю образы…</p>}
      {error && <p className="text-xs text-rose-400">Не удалось загрузить образы: {error.message}</p>}

      <div className="max-h-[28rem] overflow-y-auto space-y-3 pr-1">
        {outfits.map((o) => {
          const renders = kind === 'sketch' ? [] : o.renders || [];
          const showSketch = kind !== 'render';
          if (!showSketch && !renders.length) return null;
          return (
            <div key={o.id}>
              <p className="text-xs text-zinc-400 mb-1 truncate">{o.title || 'Без названия'}</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {showSketch && tile({ outfit_id: o.id }, o.thumb_url || o.image_url, 'эскиз')}
                {renders.map((r, i) => tile({ render_id: r.id }, r.thumb_url || r.image_url, `рендер ${i + 1}`))}
              </div>
            </div>
          );
        })}
        {data && outfits.length === 0 && <p className="text-xs text-zinc-500">Ничего не нашлось</p>}
      </div>
    </div>
  );
}

function AddForm({ known, taken, onAdded }) {
  const [mode, setMode] = useState('upload');
  const [picks, setPicks] = useState([]);
  const [files, setFiles] = useState([]);
  const [url, setUrl] = useState('');
  const [compositions, setCompositions] = useState([]);
  const [note, setNote] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'library' && !picks.length) { setMessage('Выберите эскизы или рендеры'); return; }
    if (mode === 'upload' && !files.length && !url.trim()) { setMessage('Выберите файлы или вставьте ссылку на картинку'); return; }
    setBusy(true);
    setMessage('');
    try {
      let res;
      if (mode === 'library') {
        res = await apiPost(API, { picks, compositions, note });
      } else if (files.length) {
        const form = new FormData();
        files.forEach((f) => form.append('image', f));
        form.append('compositions', JSON.stringify(compositions));
        form.append('note', note);
        form.append('source_url', sourceUrl);
        res = await apiPost(API, form);
      } else {
        res = await apiPost(API, { url: url.trim(), compositions, note, source_url: sourceUrl });
      }
      const added = res.results.filter((r) => r.visual).length;
      const dups = res.results.filter((r) => r.duplicate).length;
      const missing = res.results.filter((r) => r.missing).length;
      setMessage(`Добавлено: ${added}${dups ? `, уже были в коллекции: ${dups}` : ''}${missing ? `, не найдено (образ удалён?): ${missing}` : ''}`);
      setFiles([]);
      setPicks([]);
      setUrl('');
      setNote('');
      setSourceUrl('');
      e.target.reset();
      onAdded();
    } catch (err) {
      setMessage(`Не получилось: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 mb-8 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm text-zinc-300">Добавить визуал</h2>
        <div className="flex gap-1">
          {[['upload', 'загрузить'], ['library', 'из образов и рендеров']].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => { setMode(k); setMessage(''); }}
              className={`px-2 py-1 rounded-lg text-xs transition-colors ${mode === k ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
            >{label}</button>
          ))}
        </div>
      </div>
      {mode === 'library' && <LibraryPicker selected={picks} onChange={setPicks} taken={taken} />}
      {mode === 'upload' && (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-zinc-500">Файлы (до 20 за раз)</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="block w-full mt-1 text-xs text-zinc-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-zinc-800 file:text-zinc-200"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">…или ссылка на картинку</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={files.length > 0}
            placeholder="https://…/image.jpg"
            className="w-full mt-1 bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 disabled:opacity-40"
          />
        </label>
      </div>
      )}
      <div>
        <span className="text-xs text-zinc-500 block mb-1.5">Композиция (можно несколько)</span>
        <CompositionPicker value={compositions} onChange={setCompositions} known={known} />
      </div>
      <div className={`grid gap-3 ${mode === 'upload' ? 'sm:grid-cols-2' : ''}`}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="заметка: что здесь работает"
          className="bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
        />
        {mode === 'upload' && <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="откуда (ссылка на страницу, пин, съёмку)"
          className="bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
        />}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-1.5 rounded-lg text-sm bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-50"
        >{busy ? 'Загружаю…' : 'Добавить'}</button>
        {message && <span className="text-xs text-zinc-400">{message}</span>}
      </div>
    </form>
  );
}

function VisualCard({ v, known, onChanged, onOpen, picked, onPick, strategy }) {
  const [editing, setEditing] = useState(false);
  const [seo, setSeo] = useState(false);
  const [compositions, setCompositions] = useState(v.compositions);
  const [note, setNote] = useState(v.note);
  const [sourceUrl, setSourceUrl] = useState(v.source_url);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await apiPatch(`${API}/${v.id}`, { compositions, note, source_url: sourceUrl });
      setEditing(false);
      onChanged();
    } catch (err) {
      alert(`Не сохранилось: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(v.origin === 'upload' ? 'Удалить визуал из коллекции?' : 'Убрать из коллекции? Сам образ и рендер останутся в игре.')) return;
    try {
      await apiDelete(`${API}/${v.id}`);
      onChanged();
    } catch (err) {
      alert(`Не удалилось: ${err.message}`);
    }
  };

  return (
    <div className={`relative break-inside-avoid mb-4 bg-zinc-950 border rounded-xl overflow-hidden ${picked ? 'border-zinc-100' : 'border-zinc-800'}`}>
      <button type="button" onClick={() => onOpen(v)} className="block w-full">
        <img src={v.thumb_url} alt={v.note || v.compositions.join(', ')} loading="lazy" className="w-full h-auto bg-zinc-900" />
      </button>
      <button
        type="button"
        onClick={onPick}
        title={picked ? 'Убрать из коллажа' : 'Взять в коллаж'}
        className={`absolute top-2 right-2 min-w-[1.75rem] h-7 px-2 rounded-full text-xs font-medium transition-colors ${picked ? 'bg-zinc-100 text-zinc-900' : 'bg-black/60 text-zinc-300 hover:bg-black/80'}`}
      >{picked ? picked : '+ в коллаж'}</button>
      <div className="p-3 space-y-2">
        {!editing && (
          <>
            {v.compositions.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {v.compositions.map((c) => (
                  <span key={c} className="px-1.5 py-0.5 rounded bg-zinc-800 text-[11px] text-zinc-300">{c}</span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-amber-500">без типа композиции</p>
            )}
            {v.note && <p className="text-xs text-zinc-400">{v.note}</p>}
            {v.seo_title && (
              <p className="text-[11px] text-zinc-300" title={v.seo_description || ''}>
                <span className="text-zinc-600">{(v.seo_lang || '').toUpperCase()} · </span>{v.seo_title}
              </p>
            )}
            {v.pinterest_exported_at && (
              <p className="text-[11px] text-emerald-600">
                в CSV Pinterest {new Date(v.pinterest_exported_at).toLocaleDateString('ru-RU')}
                <button
                  onClick={async () => { await apiPatch(`${API}/${v.id}`, { pinterest_exported: false }); onChanged(); }}
                  className="ml-2 text-zinc-600 hover:text-white"
                  title="Снять отметку, чтобы визуал снова попал в экспорт"
                >снять</button>
              </p>
            )}
            {v.origin !== 'upload' && (
              <p className="text-[11px] text-zinc-500 truncate">
                {v.origin === 'render' ? 'рендер' : 'эскиз'} · {v.outfit_title || 'образ без названия'}
              </p>
            )}
            <div className="flex items-center gap-3 text-[11px]">
              {v.source_url && (
                <a href={v.source_url} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-300 underline truncate max-w-[50%]">источник</a>
              )}
              <button onClick={() => setEditing(true)} className="text-zinc-500 hover:text-white">править</button>
              <button onClick={() => setSeo(!seo)} className={v.seo_title ? 'text-emerald-500 hover:text-emerald-300' : 'text-zinc-500 hover:text-white'}>
                {v.seo_title ? 'SEO ✓' : 'SEO'}
              </button>
              <button onClick={remove} className="text-zinc-600 hover:text-rose-400 ml-auto">удалить</button>
            </div>
            {seo && (
              <div className="pt-2 border-t border-zinc-800">
                <SeoPanel visual={v} strategy={strategy} onChanged={onChanged} />
              </div>
            )}
          </>
        )}
        {editing && (
          <>
            <CompositionPicker value={compositions} onChange={setCompositions} known={known} />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="заметка"
              className="w-full bg-black border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            />
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="источник"
              className="w-full bg-black border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            />
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className="px-3 py-1 rounded-lg text-xs bg-zinc-100 text-zinc-900 disabled:opacity-50">сохранить</button>
              <button
                onClick={() => { setEditing(false); setCompositions(v.compositions); setNote(v.note); setSourceUrl(v.source_url); }}
                className="px-3 py-1 rounded-lg text-xs text-zinc-400 hover:text-white"
              >отмена</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CompositionsPage() {
  const [active, setActive] = useState('');
  const [open, setOpen] = useState(null);
  // Визуалы для коллажа в порядке, в котором их отметили; выбор сохраняется при смене фильтра
  const [picked, setPicked] = useState([]);
  const [collage, setCollage] = useState(false);
  const key = active ? `${API}?composition=${encodeURIComponent(active)}` : API;
  const { data, error, isLoading, mutate } = useSWR(key, adminFetcher);
  // Счётчики по типам берём из общего списка, чтобы фильтр не схлопывался при выборе типа
  const { data: all, mutate: mutateAll } = useSWR(API, adminFetcher);
  const refresh = () => { mutate(); mutateAll(); };

  const counts = all?.compositions || [];
  const known = counts.map((c) => c.name);
  const visuals = data?.visuals || [];
  // Что из образов и рендеров уже в коллекции — в выборе такие картинки неактивны
  const taken = new Set((all?.visuals || []).flatMap((v) =>
    v.render_id ? [`r:${v.render_id}`] : v.outfit_id ? [`o:${v.outfit_id}`] : []));

  // Удалённые визуалы выпадают из выбора, а правки (типы, заметка) подтягиваются из свежего списка
  if (all?.visuals) {
    const fresh = new Map(all.visuals.map((v) => [v.id, v]));
    const live = picked.filter((p) => fresh.has(p.id)).map((p) => fresh.get(p.id));
    if (live.length !== picked.length || live.some((v, i) => v !== picked[i])) setPicked(live);
  }

  const togglePick = (v) => setPicked((p) => {
    if (p.some((x) => x.id === v.id)) return p.filter((x) => x.id !== v.id);
    if (p.length >= COLLAGE_MAX) { alert(`В коллаж помещается до ${COLLAGE_MAX} визуалов`); return p; }
    return [...p, v];
  });

  // Готовый коллаж ложится в коллекцию как обычный загруженный визуал с типами исходных картинок
  const saveCollage = async (blob, order) => {
    const form = new FormData();
    form.append('image', blob, 'collage.jpg');
    form.append('compositions', JSON.stringify([...new Set(order.flatMap((v) => v.compositions))]));
    form.append('note', `Коллаж из ${order.length}`);
    // Из чего собран коллаж — пригодится ИИ при SEO-разметке; файлы с компьютера в коллекции нет
    form.append('collage_of', JSON.stringify(order.filter((v) => !v.local).map((v) => v.id)));
    const res = await apiPost(API, form);
    refresh();
    const r = res.results?.[0];
    return r?.visual || (r?.duplicate ? { id: r.id, duplicate: true } : null);
  };

  return (
    <>
      <Head>
        <title>Композиции | FFE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen bg-black text-white font-sans">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-serif tracking-wide">Композиции</h1>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-sm text-zinc-400 hover:text-white transition-colors">← Образы</a>
            <a href="/admin/channel" className="text-sm text-zinc-400 hover:text-white transition-colors">Канал</a>
            <a href="/admin/trends" className="text-sm text-zinc-400 hover:text-white transition-colors">Тренды</a>
            <a href="/admin/sources" className="text-sm text-zinc-400 hover:text-white transition-colors">Источники</a>
            <a
              href="/admin?export=collages&lang=ru"
              className="px-3 py-1.5 bg-amber-950 hover:bg-amber-900 border border-amber-800 text-amber-300 text-xs rounded-lg transition-colors"
              title="Коллажи с SEO-разметкой — в CSV для Pinterest (откроется окно экспорта в «Образах»)"
            >Экспорт CSV</a>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8 pb-24">
          <AddForm known={known} taken={taken} onAdded={refresh} />

          <div className="flex flex-wrap gap-1.5 mb-6">
            <button
              onClick={() => setActive('')}
              className={`px-2 py-1 rounded-lg text-xs transition-colors ${!active ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
            >все{all ? ` · ${all.total}` : ''}</button>
            {counts.map((c) => (
              <button
                key={c.name}
                onClick={() => setActive(active === c.name ? '' : c.name)}
                className={`px-2 py-1 rounded-lg text-xs transition-colors ${active === c.name ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
              >{c.name} · {c.count}</button>
            ))}
          </div>

          {isLoading && <p className="text-zinc-500">Загружаю…</p>}
          {error && <p className="text-rose-400 text-sm">Не удалось загрузить визуалы: {error.message}</p>}
          {data && visuals.length === 0 && (
            <p className="text-zinc-500 text-center py-20">{active ? 'С этим типом композиции пока ничего нет' : 'Коллекция пока пуста — добавьте первый визуал выше'}</p>
          )}

          <div className="columns-2 sm:columns-3 lg:columns-4 gap-4">
            {visuals.map((v) => (
              <VisualCard
                key={`${v.id}-${v.compositions.join('|')}-${v.note}`}
                v={v}
                known={known}
                onChanged={refresh}
                onOpen={setOpen}
                picked={picked.findIndex((x) => x.id === v.id) + 1}
                onPick={() => togglePick(v)}
                strategy={all?.seo_strategy || null}
              />
            ))}
          </div>
        </main>

        {picked.length > 0 && !collage && (
          <div className="fixed bottom-0 inset-x-0 z-40 bg-zinc-950/95 border-t border-zinc-800">
            <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
              <span className="text-sm text-zinc-300">В коллаж: {picked.length}</span>
              <button
                onClick={() => setCollage(true)}
                disabled={picked.length < 2}
                className="px-4 py-1.5 rounded-lg text-sm bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-40"
              >Собрать коллаж</button>
              {picked.length < 2 && <span className="text-xs text-zinc-500">отметьте хотя бы два</span>}
              <button onClick={() => setPicked([])} className="text-xs text-zinc-500 hover:text-white ml-auto">снять выбор</button>
            </div>
          </div>
        )}

        {collage && (
          <CollageMaker visuals={picked} library={all?.visuals || []} strategy={all?.seo_strategy || null} onClose={() => setCollage(false)} onSave={saveCollage} onSeoChanged={refresh} />
        )}

        {open && (
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6" onClick={() => setOpen(null)}>
            <img src={open.image_url} alt="" className="max-w-full max-h-full object-contain" />
          </div>
        )}
      </div>
    </>
  );
}

export async function getServerSideProps(ctx) {
  const redirect = await withAuth(ctx);
  if (redirect) return redirect;
  return { props: {} };
}
