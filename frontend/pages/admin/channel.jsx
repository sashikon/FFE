import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { withAuth } from '../../lib/withAuth';
import { adminFetcher, apiPost } from '../../lib/api';

const fetcher = (url) => fetch(url).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
});

const TABS = [
  { key: 'draft', label: 'Не утверждено' },
  { key: 'approved', label: 'В очереди' },
  { key: 'calendar', label: 'Календарь' },
  { key: 'published', label: 'Опубликовано' },
  { key: 'deferred', label: 'Отложено' },
  { key: 'all', label: 'Все' },
];

const MOVEMENT_RU = { deductive: 'дедукция — мысль сразу', inductive: 'индукция — вывод в конце' };
const CHANGE_RU = {
  recombination: 'новая комбинация известных элементов',
  meaning_shift: 'сдвиг значения у прежней вещи',
  new_practice: 'новая практика',
  revival: 'возвращение забытого',
  scale: 'изменился масштаб',
};

const STATUS = {
  draft: { label: 'не утверждён', cls: 'bg-amber-500/15 text-amber-300' },
  approved: { label: 'в очереди', cls: 'bg-emerald-500/15 text-emerald-300' },
  published: { label: 'опубликован', cls: 'bg-sky-500/15 text-sky-300' },
  deferred: { label: 'отложен', cls: 'bg-zinc-500/20 text-zinc-300' },
};

// Текст поста — разметка Telegram (b, i, a, blockquote). Пропускаем только эти теги, остальное экранируем
function safeTelegramHtml(text) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const allowed = /^<(\/?)(b|i|blockquote)>$|^<a href="(https?:\/\/[^"<>\s]+)">$|^<\/a>$/;
  return text
    .split(/(<[^>]*>)/g)
    .map((part) => {
      if (!part.startsWith('<')) return escape(part);
      const m = part.match(allowed);
      if (!m) return escape(part);
      if (m[3]) return `<a href="${m[3]}" target="_blank" rel="noopener noreferrer" class="underline">`;
      return part;
    })
    .join('')
    .replace(/\n/g, '<br/>');
}

const plain = (text) => text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const fmtDate = (d) => (d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

// Какие кнопки показывать в каком статусе
const ACTIONS_BY_STATUS = {
  draft: ['approve', 'now', 'defer', 'reject'],
  deferred: ['approve', 'now', 'reject'],
  approved: ['now', 'defer', 'reject'],
  published: [],
};
const ACTION_LABEL = {
  approve: '✅ В очередь',
  now: '🚀 Опубликовать сейчас',
  defer: '⏸ Отложить',
  reject: '✖️ Удалить',
};
const CONFIRM = {
  now: 'Опубликовать этот пост в канал прямо сейчас?',
  reject: 'Удалить пост? Вернуть его будет нельзя.',
};

async function postAction(id, op, body) {
  const r = await fetch(`/api/channel-posts/${id}/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const btn = 'px-3 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40';
const btnPrimary = 'px-3 py-1.5 rounded-lg text-xs bg-zinc-100 text-zinc-900 hover:bg-white transition-colors disabled:opacity-40';

// Фирменный логотип: он накладывается на картинку каждого поста автоматически
function BrandLogo() {
  const { data, mutate } = useSWR('/api/admin/brand/logo', adminFetcher);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const logo = data?.logo;

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('image', file);
      await apiPost('/api/admin/brand/logo', form);
      setMessage({ kind: 'ok', text: 'Логотип обновлён' });
      mutate();
    } catch (e) {
      setMessage({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mb-8">
      <h2 className="text-sm text-zinc-300 mb-1">Логотип на картинках</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Накладывается автоматически на картинку каждого поста, слева внизу. Цвет подбирается по фону: тёмный на светлом, белый на тёмном. Годится PNG с прозрачностью или SVG.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        {logo ? (
          <>
            <div className="bg-white rounded-lg px-4 py-3"><img src={logo.url.replace('/upload/', '/upload/w_180,e_colorize:100,co_rgb:393c3f/')} alt="" className="h-5" /></div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3"><img src={logo.url.replace('/upload/', '/upload/w_180/')} alt="" className="h-5" /></div>
            <span className="text-xs text-zinc-500">{logo.width}×{logo.height}</span>
          </>
        ) : (
          <span className="text-xs text-amber-400">Логотип ещё не загружен — картинки выходят без него.</span>
        )}

        <label className={`${btn} cursor-pointer ml-auto`}>
          {busy ? 'Загружаю…' : logo ? 'Заменить' : 'Загрузить логотип'}
          <input type="file" accept="image/png,image/svg+xml" className="hidden" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {message && <span className={`text-xs ${message.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{message.text}</span>}
      </div>
    </section>
  );
}

// Массовое определение формата — для постов, сделанных до появления форматов
function BulkFormats({ posts, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const without = (posts || []).filter((p) => !p.format && p.status !== 'published').length;
  if (!without && !result) return null;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/channel-posts/format-all', { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setResult(body);
      onChanged();
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <button disabled={busy} onClick={run} className={btnPrimary}>
        {busy ? 'Определяю…' : `🤖 Определить формат у ${without} постов`}
      </button>
      {result?.error && <span className="text-xs text-rose-400">{result.error}</span>}
      {result?.done && (
        <span className="text-xs text-emerald-400">
          Готово: {result.done.length} из {result.total}
          {result.failed?.length ? `, не получилось: ${result.failed.length}` : ''}
        </span>
      )}
    </div>
  );
}

// Календарь: когда выйдет каждый одобренный пост и что уже вышло
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]}, ${d} ${MONTHS[m - 1]}`;
}

const headline = (text) => stripTagsPlain(text).split('\n')[0].slice(0, 70);
const stripTagsPlain = (t) => t.replace(/<[^>]+>/g, '');

// Понедельник недели, в которую попадает дата (ISO «гггг-мм-дд»)
function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const shift = (date.getUTCDay() + 6) % 7; // понедельник — начало недели
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
};

function DayCell({ iso, day, today, onOpen }) {
  const format = day?.slots?.[0]?.format_title;
  const dayNum = Number(iso.slice(-2));
  const clickable = Boolean(day);
  return (
    <div
      onClick={() => clickable && onOpen(iso)}
      className={`min-h-[104px] rounded-lg border p-2 text-left ${clickable ? 'cursor-pointer hover:border-zinc-600' : ''} ${iso === today ? 'border-zinc-500 bg-zinc-900' : day ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-900 bg-zinc-950'}`}>
      <div className="mb-1">
        <span className={`text-xs ${iso === today ? 'text-zinc-100' : 'text-zinc-500'}`}>{dayNum}</span>
        {format && (
          <span className="block text-[10px] leading-tight text-zinc-500 line-clamp-2" title={format}>{format}</span>
        )}
      </div>
      {day?.published?.map((p) => (
        <p key={p.id} className="text-[11px] leading-tight text-sky-300 mb-1 line-clamp-2">📣 {headline(p.text)}</p>
      ))}
      {day?.slots?.map((slot) => (
        <p key={slot.hour} className="text-[11px] leading-tight mb-1 line-clamp-3">
          {slot.post ? (
            <>
              <span className="text-zinc-500">{slot.hour}:00 </span>
              <span className={slot.matched ? 'text-zinc-200' : 'text-zinc-400'}>{headline(slot.post.text)}</span>
            </>
          ) : (
            <span className="text-zinc-700">{slot.hour}:00 свободно</span>
          )}
        </p>
      ))}
    </div>
  );
}

// Карточка дня: заголовки целиком, без обрезки
function DayDetails({ iso, day, onClose, onOpenPost }) {
  if (!day) return null;
  const format = day.slots?.[0]?.format_title;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 max-w-xl w-full mt-16" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-2 mb-4">
          <h3 className="text-zinc-100">{dayLabel(iso)}</h3>
          {format && <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-300">{format}</span>}
          <button onClick={onClose} className="ml-auto text-sm text-zinc-400 hover:text-white">Закрыть</button>
        </div>

        {day.published?.map((p) => (
          <div key={p.id} className="mb-4 pb-4 border-b border-zinc-800 last:border-0">
            <p className="text-xs text-sky-300 mb-1">📣 опубликован · #{p.id}</p>
            <p className="text-sm text-zinc-200">{stripTagsPlain(p.text).split('\n')[0]}</p>
            <button onClick={() => onOpenPost(p.id, 'published')} className={`${btn} mt-2`}>Открыть пост</button>
          </div>
        ))}

        {day.slots?.map((slot) => (
          <div key={slot.hour} className="mb-4 pb-4 border-b border-zinc-800 last:border-0">
            <p className="text-xs text-zinc-500 mb-1">
              {slot.hour}:00{slot.post ? ` · #${slot.post.id}` : ''}{slot.post && !slot.matched ? ' · занял слот другого формата' : ''}
            </p>
            {slot.post ? (
              <div className="flex gap-3">
                {slot.post.image_url && <img src={slot.post.image_url} alt="" className="w-16 h-20 object-cover rounded bg-zinc-800 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{stripTagsPlain(slot.post.text).split('\n')[0]}</p>
                  {slot.post.thesis && <p className="text-xs text-zinc-500 mt-1">{slot.post.thesis}</p>}
                  <button onClick={() => onOpenPost(slot.post.id, 'approved')} className={`${btn} mt-2`}>Открыть пост</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-600">слот свободен</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Расписание форматов: какой формат в какой день двух недель
function FormatsLegend({ activeKey }) {
  const { data } = useSWR('/api/channel-formats', fetcher);
  const [open, setOpen] = useState(false);
  const formats = data?.formats || [];
  if (!formats.length) return null;

  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const cell = (week, day) => formats.find((f) => f.week === week && f.day === day);

  return (
    <div className="mt-8">
      <button onClick={() => setOpen(!open)} className="text-sm text-zinc-400 hover:text-white transition-colors">
        {open ? '▾' : '▸'} Расписание форматов
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="text-xs border-separate border-spacing-1 min-w-[640px]">
            <thead>
              <tr>
                <th />
                {days.map((d) => <th key={d} className="font-normal text-zinc-500 px-2">{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {[1, 2].map((week) => (
                <tr key={week}>
                  <td className="text-zinc-500 pr-2 whitespace-nowrap">Неделя {week}</td>
                  {days.map((_, i) => {
                    const f = cell(week, i + 1);
                    if (!f) return <td key={i} />;
                    const active = f.key === activeKey;
                    return (
                      <td
                        key={i}
                        title={f.idea}
                        className={`px-2 py-1.5 rounded-lg align-top ${active ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-300'}`}
                      >{f.title}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-zinc-500 mt-2">Выделен формат сегодняшнего дня. Наведите на формат, чтобы увидеть, о чём он.</p>
        </div>
      )}
    </div>
  );
}

function Calendar({ onOpenPost }) {
  const [days, setDays] = useState(30);
  const [view, setView] = useState('grid');
  const [selected, setSelected] = useState(null);
  const { data, error, isLoading } = useSWR(`/api/channel-schedule?days=${days}`, fetcher, { refreshInterval: 60000 });

  if (isLoading) return <p className="text-zinc-500">Загружаю календарь…</p>;
  if (error) return <p className="text-rose-400 text-sm">Не удалось загрузить календарь: {error.message}</p>;
  if (!data) return null;

  const byDate = {};
  for (const slot of data.slots) (byDate[slot.date] ||= { slots: [], published: [] }).slots.push(slot);
  for (const p of data.published) (byDate[p.date] ||= { slots: [], published: [] }).published.push(p);
  const dates = Object.keys(byDate).sort();
  const today = data.slots[0]?.date || dates[0];

  // сетка: целые недели от первой до последней даты
  const first = weekStart(dates[0]);
  const last = weekStart(dates[dates.length - 1]);
  const weeks = [];
  for (let w = first; w <= last; w = addDays(w, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  }

  const tab = (active) => `px-3 py-1.5 rounded-lg text-sm transition-colors ${active ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`;

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setView('grid')} className={tab(view === 'grid')}>Сеткой</button>
        <button onClick={() => setView('list')} className={tab(view === 'list')}>Списком</button>
        <span className="mx-1 text-zinc-700">·</span>
        <button onClick={() => setDays(14)} className={tab(days === 14)}>2 недели</button>
        <button onClick={() => setDays(30)} className={tab(days === 30)}>месяц</button>
      </div>

      <p className="text-sm text-zinc-500 mb-4">
        Публикация в {data.publish_hours.map((h) => `${h}:00`).join(' и ')} ({data.timezone}). В слот идёт пост формата дня, а если такого в очереди нет — самый старый одобренный.
        {data.queue_left > 0 && ` Ещё ${data.queue_left} постов в очереди не поместились в две недели.`}
      </p>

      {selected && (
        <DayDetails
          iso={selected}
          day={byDate[selected]}
          onClose={() => setSelected(null)}
          onOpenPost={(id, status) => { setSelected(null); onOpenPost(id, status); }}
        />
      )}

      {view === 'grid' ? (
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
                <div key={d} className="text-center text-[11px] text-zinc-500 py-1">{d}</div>
              ))}
            </div>
            <div className="space-y-1">
              {weeks.map((week) => (
                <div key={week[0]} className="grid grid-cols-7 gap-1">
                  {week.map((iso) => <DayCell key={iso} iso={iso} day={byDate[iso]} today={today} onOpen={setSelected} />)}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {dates.map((date) => {
            const day = byDate[date];
            const format = day.slots[0]?.format_title;
            const isPast = day.slots.length === 0;
            return (
              <div key={date} className={`rounded-xl border p-4 ${date === today ? 'border-zinc-600 bg-zinc-900' : isPast ? 'border-zinc-900 bg-zinc-950' : 'border-zinc-800 bg-zinc-900'}`}>
                <div className="flex flex-wrap items-baseline gap-2 mb-2">
                  <span className="text-sm text-zinc-200">{dayLabel(date)}</span>
                  {format && <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-300">{format}</span>}
                </div>
                {day.published.map((p) => (
                  <p key={p.id} className="text-sm text-sky-300 mb-1">📣 <button onClick={() => onOpenPost(p.id, 'published')} className="text-zinc-300 hover:text-white underline underline-offset-2">#{p.id}</button> {headline(p.text)}</p>
                ))}
                {day.slots.map((slot) => (
                  <p key={slot.hour} className="text-sm mb-1">
                    <span className="text-zinc-500">{slot.hour}:00 · </span>
                    {slot.post ? (
                      <>
                        <button onClick={() => onOpenPost(slot.post.id, 'approved')} className="text-zinc-300 hover:text-white underline underline-offset-2">#{slot.post.id}</button>{' '}
                        <span className="text-zinc-200">{headline(slot.post.text)}</span>
                        {!slot.matched && <span className="text-zinc-600">{slot.no_format ? ' · без формата' : ' · другой формат'}</span>}
                      </>
                    ) : (
                      <span className="text-zinc-600">свободно</span>
                    )}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <FormatsLegend activeKey={byDate[today]?.slots?.[0]?.format_key} />
    </>
  );
}

// Выбор картинки: все эскизы и рендеры игры, с фильтром и сортировкой
const KIND_LABEL = { sketch: 'эскиз', render: 'рендер' };

function ImagePicker({ post, onPick, onClose, busy }) {
  const { data, error, isLoading, mutate } = useSWR('/api/channel-library', fetcher);
  const [refreshing, setRefreshing] = useState(false);

  // свежий рендер, добавленный в игре только что
  const refresh = async () => {
    setRefreshing(true);
    try {
      await mutate(fetcher('/api/channel-library?refresh=1'), { revalidate: false });
    } finally {
      setRefreshing(false);
    }
  };

  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('new');

  const counts = data?.counts || {};
  const images = (data?.images || [])
    .filter((i) => kind === 'all' || i.kind === kind)
    .filter((i) => !q.trim() || `${i.title} ${i.descriptor}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (sort === 'title'
      ? a.title.localeCompare(b.title, 'ru')
      : new Date(b.created_at || 0) - new Date(a.created_at || 0)));

  const chip = (active) => `px-2 py-1 rounded-lg text-xs transition-colors ${active ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`;

  return (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: чёрный, буфы, офис…"
          className="flex-1 min-w-[200px] bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
        />
        <button disabled={busy || refreshing} onClick={refresh} className={btn}>{refreshing ? 'Обновляю…' : 'Обновить'}</button>
        <button disabled={busy} onClick={() => onPick(null)} className={btn}>Без картинки</button>
        <button disabled={busy} onClick={onClose} className={btn}>Закрыть</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
        <button onClick={() => setKind('all')} className={chip(kind === 'all')}>все ({(counts.sketches || 0) + (counts.renders || 0)})</button>
        <button onClick={() => setKind('sketch')} className={chip(kind === 'sketch')}>эскизы ({counts.sketches || 0})</button>
        <button onClick={() => setKind('render')} className={chip(kind === 'render')}>рендеры ({counts.renders || 0})</button>
        <span className="mx-1 text-zinc-600">·</span>
        <button onClick={() => setSort('new')} className={chip(sort === 'new')}>сначала новые</button>
        <button onClick={() => setSort('title')} className={chip(sort === 'title')}>по названию</button>
        <span className="ml-auto text-zinc-500">{images.length} из {(counts.sketches || 0) + (counts.renders || 0)}</span>
      </div>

      {isLoading && <p className="text-sm text-zinc-500">Загружаю картинки…</p>}
      {error && <p className="text-sm text-rose-400">Не удалось загрузить: {error.message}</p>}
      {data && images.length === 0 && <p className="text-sm text-zinc-500">Ничего не нашлось</p>}

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[28rem] overflow-y-auto">
        {images.map((i) => (
          <button
            key={i.image_id}
            disabled={busy}
            onClick={() => onPick(i.image_id)}
            title={i.descriptor}
            className={`group relative rounded-lg overflow-hidden border transition-colors ${i.image_id === post.image_ref ? 'border-zinc-100' : 'border-zinc-800 hover:border-zinc-600'}`}
          >
            <img src={i.thumb_url} alt="" className="w-full h-28 object-cover bg-zinc-800" loading="lazy" />
            <span className="block px-1.5 py-1 text-[10px] leading-tight text-zinc-400 text-left line-clamp-2">{i.title}</span>
            <span className="absolute top-1 left-1 text-[10px] bg-black/70 text-zinc-300 rounded px-1">{KIND_LABEL[i.kind]}</span>
            {i.image_id === post.image_ref && (
              <span className="absolute top-1 right-1 text-[10px] bg-zinc-100 text-zinc-900 rounded px-1">сейчас</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// Формат поста: можно выбрать вручную или определить по тексту
function FormatPicker({ post, onChanged }) {
  const { data } = useSWR('/api/channel-formats', fetcher);
  const [busy, setBusy] = useState(false);
  const formats = data?.formats || [];
  const editable = post.status !== 'published';

  const set = async (value) => {
    setBusy(true);
    try {
      await postAction(post.id, 'format', value === 'auto' ? { auto: true } : { format: value || null });
      onChanged();
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!editable) {
    return post.format_title
      ? <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">{post.format_title}</span>
      : null;
  }

  return (
    <select
      value={post.format || ''}
      disabled={busy || !formats.length}
      onChange={(e) => set(e.target.value)}
      className={`px-2 py-0.5 rounded-full text-xs border-0 focus:outline-none cursor-pointer ${post.format ? 'bg-zinc-800 text-zinc-300' : 'bg-amber-500/15 text-amber-300'}`}
    >
      <option value="">{busy ? 'меняю…' : 'без формата'}</option>
      <option value="auto">🤖 определить по тексту</option>
      {formats.map((f) => <option key={f.key} value={f.key}>{f.title}</option>)}
    </select>
  );
}

function PostCard({ post, onChanged, highlighted }) {
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState(null); // null | 'edit' | 'redraft' | 'image'
  const [text, setText] = useState(post.text);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { kind: 'ok' | 'error', text }

  const [showBones, setShowBones] = useState(false);
  const status = STATUS[post.status] || { label: post.status, cls: 'bg-zinc-800 text-zinc-300' };
  const when = post.status === 'published' ? `вышел ${fmtDate(post.published_at)}`
    : post.status === 'approved' ? `одобрен ${fmtDate(post.approved_at)}`
    : `создан ${fmtDate(post.created_at)}`;
  const editable = post.status !== 'published';

  const copy = async () => {
    await navigator.clipboard.writeText(plain(post.text));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const run = async (fn, okText) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: 'ok', text: okText });
      setMode(null);
      onChanged();
    } catch (e) {
      setMessage({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const doAction = (action) => {
    if (CONFIRM[action] && !window.confirm(CONFIRM[action])) return;
    run(() => postAction(post.id, 'action', { action }), 'Готово');
  };

  const sk = post.skeleton;
  const sources = Array.isArray(post.research_sources) ? post.research_sources : [];

  return (
    <article id={`post-${post.id}`} className={`bg-zinc-900 rounded-xl border p-5 transition-colors ${highlighted ? 'border-zinc-100' : 'border-zinc-800'}`}>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className="text-zinc-500">#{post.id}</span>
        <span className={`px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
        <FormatPicker post={post} onChanged={onChanged} />
        <span className="text-zinc-500">{when}</span>
        <button onClick={copy} className="ml-auto text-zinc-400 hover:text-white transition-colors">
          {copied ? 'Скопировано' : 'Копировать текст'}
        </button>
      </div>

      <div className="flex gap-5">
        {post.image_url && (
          <img src={post.image_url} alt="" className="w-28 h-36 object-cover rounded-lg bg-zinc-800 shrink-0" />
        )}
        {mode === 'edit' ? (
          <div className="flex-1 min-w-0">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(24, Math.max(10, text.split('\n').length + 2))}
              className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm font-mono text-zinc-200 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-xs text-zinc-500 mt-1">
              Разметка Telegram: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;, &lt;a href="…"&gt;ссылка&lt;/a&gt;. Слоган канала добавится сам.
              <span className={`ml-2 ${text.length > 3800 ? 'text-rose-400' : ''}`}>{text.length} / 3800</span>
            </p>
          </div>
        ) : (
          <div
            className="text-sm leading-relaxed text-zinc-200 min-w-0 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-3"
            dangerouslySetInnerHTML={{ __html: safeTelegramHtml(post.text) }}
          />
        )}
      </div>

      {(post.thesis || post.slop?.length > 0 || sk) && (
        <div className="mt-4 pt-3 border-t border-zinc-800 text-xs space-y-1">
          {post.thesis && <p className="text-zinc-500">Тезис: <span className="text-zinc-400">{post.thesis}</span></p>}
          {(sk || sources.length > 0 || post.origin) && (
            <button onClick={() => setShowBones(!showBones)} className="text-zinc-500 hover:text-zinc-300 underline">
              {showBones ? 'Скрыть' : 'Как собран'}
            </button>
          )}
          {showBones && (
            <div className="mt-2 space-y-2 text-zinc-400">
              <p className="text-zinc-500">
                Формат: <span className="text-zinc-300">{post.format_title || '—'}</span>
                {sk?.movement && <> · ход: <span className="text-zinc-300">{MOVEMENT_RU[sk.movement] || sk.movement}</span></>}
                {post.lens && <> · линза: <span className="text-zinc-300">{post.lens}</span></>}
              </p>
              {sk && (
                <div className="pl-3 border-l border-zinc-800 space-y-1">
                  <p>Вопрос: <span className="text-zinc-300">{sk.question}</span></p>
                  {sk.change && <p>Что изменилось: <span className="text-zinc-300">{CHANGE_RU[sk.change] || sk.change}</span></p>}
                  <p>Ответ: <span className="text-zinc-300">{sk.answer}</span></p>
                  {sk.pillars?.length > 0 && (
                    <ol className="list-decimal list-inside space-y-0.5">
                      {sk.pillars.map((x, i) => (
                        <li key={i}><span className="text-zinc-300">{x.claim}</span>{x.evidence ? <span className="text-zinc-600"> — {x.evidence}</span> : null}</li>
                      ))}
                    </ol>
                  )}
                  {sk.gaps && <p className="text-amber-400">не хватает: {sk.gaps}</p>}
                </div>
              )}
              {post.origin && <p>Истоки: <span className="text-zinc-300">{post.origin}</span></p>}
              {sources.length > 0 && (
                <p>
                  Справка:{' '}
                  {sources.map((u, i) => (
                    <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:underline mr-2">{i + 1}</a>
                  ))}
                  <a href="/admin/assembly" className="text-zinc-600 hover:text-zinc-400 underline ml-1">как это собирается</a>
                </p>
              )}
              {sources.length === 0 && (
                <a href="/admin/assembly" className="text-zinc-600 hover:text-zinc-400 underline">как это собирается</a>
              )}
            </div>
          )}
          {post.slop?.length > 0 && (
            <p className="text-amber-400">⚠️ шаблоны: {post.slop.map((s) => `«${s}»`).join(', ')}</p>
          )}
        </div>
      )}

      {mode === 'image' && (
        <ImagePicker
          post={post}
          busy={busy}
          onClose={() => setMode(null)}
          onPick={(imageId) => run(
            () => postAction(post.id, 'image', { image_id: imageId }),
            imageId ? 'Картинка изменена' : 'Пост будет без картинки'
          )}
        />
      )}

      {mode === 'redraft' && (
        <div className="mt-4">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="Что поправить? Например: короче, без Бодрийяра, вопрос читателю — одной фразой"
            className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Модель перепишет пост по комментарию, новая версия появится во вкладке «Не утверждено» и в боте через 1–2 минуты.
            {post.status === 'approved' && ' Пост будет снят из очереди до утверждения новой версии.'}
            {' '}Общие замечания попадут в «уроки редактора».
          </p>
        </div>
      )}

      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {mode === 'edit' ? (
            <>
              <button
                disabled={busy || !text.trim() || text.length > 3800}
                onClick={() => run(() => postAction(post.id, 'text', { text }), 'Текст сохранён')}
                className={btnPrimary}
              >Сохранить</button>
              <button disabled={busy} onClick={() => { setMode(null); setText(post.text); }} className={btn}>Отмена</button>
            </>
          ) : mode === 'redraft' ? (
            <>
              <button
                disabled={busy || !feedback.trim()}
                onClick={() => run(
                  () => postAction(post.id, 'redraft', { feedback }),
                  'Отправлено: модель переписывает пост, новая версия появится через 1–2 минуты'
                ).then(() => setFeedback(''))}
                className={btnPrimary}
              >Отправить</button>
              <button disabled={busy} onClick={() => setMode(null)} className={btn}>Отмена</button>
            </>
          ) : (
            <>
              {ACTIONS_BY_STATUS[post.status]?.map((a) => (
                <button key={a} disabled={busy} onClick={() => doAction(a)} className={a === 'approve' ? btnPrimary : btn}>
                  {post.status === 'approved' && a === 'defer' ? '⏸ Снять из очереди' : ACTION_LABEL[a]}
                </button>
              ))}
              <button disabled={busy} onClick={() => setMode('image')} className={btn}>
                {post.image_url ? '🖼 Сменить картинку' : '🖼 Добавить картинку'}
              </button>
              <button disabled={busy} onClick={() => { setText(post.text); setMode('edit'); }} className={btn}>✏️ Редактировать</button>
              <button disabled={busy} onClick={() => setMode('redraft')} className={btn}>🤖 Поправить через модель</button>
            </>
          )}
          {busy && <span className="text-xs text-zinc-500">…</span>}
          {message && (
            <span className={`text-xs ${message.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{message.text}</span>
          )}
        </div>
      )}
    </article>
  );
}

export default function ChannelPage() {
  const [tab, setTab] = useState('draft');
  const [highlight, setHighlight] = useState(null);
  const [search, setSearch] = useState('');

  // переход из календаря к тексту поста
  const openPost = (id, status) => {
    setTab(status === 'published' ? 'published' : 'approved');
    setHighlight(id);
  };
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`post-${highlight}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(() => setHighlight(null), 2500);
      return () => clearTimeout(timer);
    }
  });

  // поиск ищет по всем статусам: человек ищет конкретный пост, а не пост во вкладке
  const query = search.trim();
  const { data, error, isLoading, mutate } = useSWR(
    tab === 'calendar' && !query ? null
      : `/api/channel-posts?status=${query ? 'all' : tab}${query ? `&q=${encodeURIComponent(query)}` : ''}`,
    fetcher,
    { refreshInterval: query ? 0 : 30000 }
  );
  const counts = data?.counts || {};

  return (
    <>
      <Head>
        <title>Канал | FFE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen bg-black text-white font-sans">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-serif tracking-wide">Канал о смыслах в моде</h1>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-sm text-zinc-400 hover:text-white transition-colors">← Образы</a>
            <a href="/admin/stats" className="text-sm text-zinc-400 hover:text-white transition-colors">Статистика</a>
            <a href="/admin/sources" className="text-sm text-zinc-400 hover:text-white transition-colors">Источники</a>
            <a href="/admin/trends" className="text-sm text-zinc-400 hover:text-white transition-colors">Тренды</a>
            <a href="/admin/assembly" className="text-sm text-zinc-400 hover:text-white transition-colors">Как собирается</a>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-8">
          <p className="text-sm text-zinc-500 mb-6">Изменения отсюда видны и в боте: черновик в Telegram помечается «изменён в админке», а новая версия приходит туда же.</p>

          <BrandLogo />

          <BulkFormats posts={data?.posts} onChanged={() => mutate()} />

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти пост — по тексту, тезису или номеру"
              className="w-full sm:w-96 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            {query && (
              <span className="text-xs text-zinc-500">
                найдено {data?.posts?.length ?? '…'} по всем статусам ·{' '}
                <button onClick={() => setSearch('')} className="underline hover:text-zinc-300">сбросить</button>
              </span>
            )}
          </div>

          <nav className={`flex flex-wrap gap-2 mb-8 ${query ? 'opacity-40 pointer-events-none' : ''}`}>
            {TABS.map((t) => {
              const n = t.key === 'all'
                ? ['draft', 'approved', 'published', 'deferred'].reduce((s, k) => s + (counts[k] || 0), 0)
                : counts[t.key];
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${tab === t.key ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}
                >
                  {t.label}{data && n !== undefined ? ` · ${n}` : ''}
                </button>
              );
            })}
          </nav>

          {tab === 'calendar' && !query && <Calendar onOpenPost={openPost} />}

          {(tab !== 'calendar' || query) && isLoading && (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-48 bg-zinc-900 rounded-xl animate-pulse" />)}
            </div>
          )}
          {(tab !== 'calendar' || query) && error && <p className="text-rose-400 text-sm">Не удалось загрузить посты: {error.message}</p>}
          {(tab !== 'calendar' || query) && data?.posts?.length === 0 && (
            <p className="text-zinc-500 text-center py-20">{query ? `По запросу «${query}» ничего не нашлось` : 'Здесь пока пусто'}</p>
          )}
          {(tab !== 'calendar' || query) && data?.posts?.length > 0 && (
            <div className="space-y-4">
              {data.posts.map((p) => (
                <PostCard key={`${p.id}-${p.status}`} post={p} onChanged={() => mutate()} highlighted={p.id === highlight} />
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

export async function getServerSideProps(ctx) {
  const redirect = await withAuth(ctx);
  if (redirect) return redirect;
  return { props: {} };
}
