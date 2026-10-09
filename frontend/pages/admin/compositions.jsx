import { useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { adminFetcher, apiPost, apiPatch, apiDelete } from '../../lib/api';
import { withAuth } from '../../lib/withAuth';

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

function AddForm({ known, onAdded }) {
  const [files, setFiles] = useState([]);
  const [url, setUrl] = useState('');
  const [compositions, setCompositions] = useState([]);
  const [note, setNote] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!files.length && !url.trim()) { setMessage('Выберите файлы или вставьте ссылку на картинку'); return; }
    setBusy(true);
    setMessage('');
    try {
      let res;
      if (files.length) {
        const form = new FormData();
        files.forEach((f) => form.append('image', f));
        form.append('compositions', JSON.stringify(compositions));
        form.append('note', note);
        form.append('source_url', sourceUrl);
        res = await apiPost(API, form);
      } else {
        res = await apiPost(API, { url: url.trim(), compositions, note, source_url: sourceUrl });
      }
      const added = res.results.filter((r) => !r.duplicate).length;
      const dups = res.results.length - added;
      setMessage(`Добавлено: ${added}${dups ? `, уже были в коллекции: ${dups}` : ''}`);
      setFiles([]);
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
      <h2 className="text-sm text-zinc-300">Добавить визуал</h2>
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
      <div>
        <span className="text-xs text-zinc-500 block mb-1.5">Композиция (можно несколько)</span>
        <CompositionPicker value={compositions} onChange={setCompositions} known={known} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="заметка: что здесь работает"
          className="bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
        />
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="откуда (ссылка на страницу, пин, съёмку)"
          className="bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
        />
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

function VisualCard({ v, known, onChanged, onOpen }) {
  const [editing, setEditing] = useState(false);
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
    if (!confirm('Удалить визуал из коллекции?')) return;
    try {
      await apiDelete(`${API}/${v.id}`);
      onChanged();
    } catch (err) {
      alert(`Не удалилось: ${err.message}`);
    }
  };

  return (
    <div className="break-inside-avoid mb-4 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
      <button type="button" onClick={() => onOpen(v)} className="block w-full">
        <img src={v.thumb_url} alt={v.note || v.compositions.join(', ')} loading="lazy" className="w-full h-auto bg-zinc-900" />
      </button>
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
            <div className="flex items-center gap-3 text-[11px]">
              {v.source_url && (
                <a href={v.source_url} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-300 underline truncate max-w-[50%]">источник</a>
              )}
              <button onClick={() => setEditing(true)} className="text-zinc-500 hover:text-white">править</button>
              <button onClick={remove} className="text-zinc-600 hover:text-rose-400 ml-auto">удалить</button>
            </div>
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
  const key = active ? `${API}?composition=${encodeURIComponent(active)}` : API;
  const { data, error, isLoading, mutate } = useSWR(key, adminFetcher);
  // Счётчики по типам берём из общего списка, чтобы фильтр не схлопывался при выборе типа
  const { data: all, mutate: mutateAll } = useSWR(API, adminFetcher);
  const refresh = () => { mutate(); mutateAll(); };

  const counts = all?.compositions || [];
  const known = counts.map((c) => c.name);
  const visuals = data?.visuals || [];

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
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8">
          <AddForm known={known} onAdded={refresh} />

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
              <VisualCard key={`${v.id}-${v.compositions.join('|')}-${v.note}`} v={v} known={known} onChanged={refresh} onOpen={setOpen} />
            ))}
          </div>
        </main>

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
