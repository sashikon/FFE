import { useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { withAuth } from '../../lib/withAuth';

const fetcher = (url) => fetch(url).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
});

const VIEWS = [
  { key: 'rising', label: '📈 Растут' },
  { key: 'top', label: 'Топ недели' },
  { key: 'fading', label: '📉 Угасают' },
];

const SIGNAL_LABEL = { news: '📰 пресса', search: '🔎 Google', screenshot: '📱 скриншоты', video: '🎬 видео' };
const REGIONS = ['сша', 'британия', 'франция', 'европа', 'россия', 'корея', 'япония', 'китай', 'индия', 'мир', 'соцсети'];

const chip = (active) => `px-2 py-1 rounded-lg text-xs transition-colors ${active ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

// Мини-график: упоминания по неделям за 8 недель
function Sparkline({ weeks }) {
  const max = Math.max(1, ...weeks);
  const w = 6;
  const gap = 2;
  return (
    <svg width={weeks.length * (w + gap)} height="24" aria-label={`по неделям: ${weeks.join(', ')}`}>
      {weeks.map((v, i) => {
        const h = Math.max(1, Math.round((v / max) * 22));
        return <rect key={i} x={i * (w + gap)} y={24 - h} width={w} height={h} rx="1" className={i === weeks.length - 1 ? 'fill-zinc-100' : 'fill-zinc-600'} />;
      })}
    </svg>
  );
}

function Detail({ id }) {
  const { data, error } = useSWR(`/api/channel-trends/${id}`, fetcher);
  if (error) return <p className="text-xs text-rose-400">Не удалось загрузить: {error.message}</p>;
  if (!data) return <p className="text-xs text-zinc-500">Загружаю…</p>;
  const suggestions = data.term.suggestions || [];
  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
      {suggestions.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1">Что ищут в Google вокруг темы:</p>
          <div className="flex flex-wrap gap-1">
            {suggestions.map((s) => <span key={s} className="px-2 py-0.5 rounded bg-zinc-800 text-xs text-zinc-300">{s}</span>)}
          </div>
        </div>
      )}
      <div>
        <p className="text-xs text-zinc-500 mb-1">Упоминания:</p>
        <ul className="space-y-1">
          {data.mentions.map((m) => (
            <li key={`${m.ref}`} className="text-xs text-zinc-400">
              <span className="text-zinc-600">{fmtDate(m.seen_at)} · {m.feed || '—'} · {m.region || '—'} · </span>
              {m.url && m.url.startsWith('http')
                ? <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:underline">{m.title}</a>
                : <span className="text-zinc-300">{m.title || m.ref.replace(/^gtrends:\w+:[\d-]+:/, 'запрос в Google: ')}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TrendRow({ t, kinds }) {
  const [open, setOpen] = useState(false);
  const growth = t.prev_week ? Math.round(((t.week - t.prev_week) / t.prev_week) * 100) : null;
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <button onClick={() => setOpen(!open)} className="w-full text-left">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-[180px] flex-1">
            <span className="text-zinc-100">{t.display}</span>
            <span className="ml-2 text-[11px] text-zinc-500">{kinds[t.kind] || t.kind}</span>
            {t.is_new && <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px]">новое</span>}
          </div>
          <Sparkline weeks={t.weeks} />
          <div className="text-xs text-zinc-400 w-28">
            <span className="text-zinc-200">{t.week}</span> за неделю
            <span className="block text-zinc-500">
              {growth === null ? `было ${t.prev_week}` : `${growth > 0 ? '+' : ''}${growth}% к прошлой`}
            </span>
          </div>
          <div className="text-xs text-zinc-500 w-24">источников: <span className="text-zinc-300">{t.feeds}</span></div>
          <div className="flex flex-wrap gap-1 text-[11px] text-zinc-500">
            {t.signals.map((s) => <span key={s}>{SIGNAL_LABEL[s] || s}</span>)}
          </div>
        </div>
        <p className="text-[11px] text-zinc-600 mt-1">{t.regions.filter(Boolean).join(' · ')}</p>
      </button>
      {open && <Detail id={t.id} />}
    </div>
  );
}

export default function TrendsPage() {
  const [view, setView] = useState('rising');
  const [kind, setKind] = useState('');
  const [region, setRegion] = useState('');
  const qs = new URLSearchParams({ ...(kind && { kind }), ...(region && { region }) }).toString();
  const { data, error, isLoading } = useSWR(`/api/channel-trends${qs ? `?${qs}` : ''}`, fetcher, { refreshInterval: 300000 });
  const list = data?.[view] || [];
  const kinds = data?.kinds || {};

  return (
    <>
      <Head>
        <title>Тренды | FFE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen bg-black text-white font-sans">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-serif tracking-wide">Тренды</h1>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-sm text-zinc-400 hover:text-white transition-colors">← Образы</a>
            <a href="/admin/channel" className="text-sm text-zinc-400 hover:text-white transition-colors">Канал</a>
            <a href="/admin/sources" className="text-sm text-zinc-400 hover:text-white transition-colors">Источники</a>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-8">
          <p className="text-sm text-zinc-500 mb-6">
            Считается по всем заметкам ленты, по поисковым трендам Google и по скриншотам и роликам соцсетей, которые вы присылаете боту (у роликов — ещё и звук).
            «Растут» — упоминаний за 7 дней больше, чем за предыдущие 7, и тему подхватили хотя бы два источника (или она есть в Google или соцсетях).
            Нажмите на тему, чтобы увидеть, где она всплывала и что ищут вокруг неё.
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            {VIEWS.map((v) => (
              <button key={v.key} onClick={() => setView(v.key)} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${view === v.key ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}>
                {v.label}{data ? ` · ${data[v.key]?.length || 0}` : ''}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 mb-2">
            <button onClick={() => setKind('')} className={chip(!kind)}>все типы</button>
            {Object.entries(kinds).map(([k, label]) => <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>{label}</button>)}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-8">
            <button onClick={() => setRegion('')} className={chip(!region)}>все регионы</button>
            {REGIONS.map((r) => <button key={r} onClick={() => setRegion(r)} className={chip(region === r)}>{r}</button>)}
          </div>

          {isLoading && <p className="text-zinc-500">Загружаю…</p>}
          {error && <p className="text-rose-400 text-sm">Не удалось загрузить тренды: {error.message}</p>}
          {data && list.length === 0 && (
            <p className="text-zinc-500 text-center py-20">
              Пока пусто. Тренды копятся с каждым прогоном — через пару дней картина станет видна. Скриншоты из соцсетей можно присылать боту уже сейчас.
            </p>
          )}
          <div className="space-y-2">
            {list.map((t) => <TrendRow key={t.id} t={t} kinds={kinds} />)}
          </div>
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
