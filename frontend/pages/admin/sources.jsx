import { useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { withAuth } from '../../lib/withAuth';

const fetcher = (url) => fetch(url).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
});

const LAYERS = {
  industry: { label: 'Индустрия', hint: 'бизнес, бренды, рынок' },
  production: { label: 'Производство', hint: 'фабрики, сырьё, отходы' },
  culture: { label: 'Культура', hint: 'смыслы, стиль, общество' },
};

const KIND_CLS = {
  RSS: 'bg-zinc-800 text-zinc-300',
  'карта сайта': 'bg-indigo-500/15 text-indigo-300',
  'поиск новостей': 'bg-amber-500/15 text-amber-300',
  telegram: 'bg-sky-500/15 text-sky-300',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—');
const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);

function SourceRow({ s }) {
  const silent = daysSince(s.last_published);
  const isSilent = silent === null || silent > 14;
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-zinc-100 hover:underline">{s.name}</a>
        <span className={`px-2 py-0.5 rounded-full text-[11px] ${KIND_CLS[s.kind] || 'bg-zinc-800 text-zinc-300'}`}>{s.kind}</span>
        {isSilent && <span className="px-2 py-0.5 rounded-full text-[11px] bg-rose-500/15 text-rose-300">молчит</span>}
      </div>
      <p className="text-sm text-zinc-400 mb-2">{s.description}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>за неделю: <span className="text-zinc-300">{s.week}</span></span>
        <span>всего: <span className="text-zinc-300">{s.total}</span></span>
        <span>в постах: <span className="text-zinc-300">{s.posts}</span></span>
        <span>последняя: <span className="text-zinc-300">{fmtDate(s.last_published)}</span></span>
        <span className="flex flex-wrap gap-1">
          {s.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{t}</span>)}
        </span>
      </div>
    </div>
  );
}

export default function SourcesPage() {
  const { data, error, isLoading } = useSWR('/api/channel-sources', fetcher, { refreshInterval: 120000 });
  const [active, setActive] = useState([]);
  const [q, setQ] = useState('');

  const sources = data?.sources || [];
  const allTags = [...new Set(sources.flatMap((s) => s.tags))].sort((a, b) => a.localeCompare(b, 'ru'));
  const toggle = (t) => setActive((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const filtered = sources.filter((s) =>
    active.every((t) => s.tags.includes(t))
    && (!q.trim() || `${s.name} ${s.description}`.toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <>
      <Head>
        <title>Источники канала | FFE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen bg-black text-white font-sans">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-serif tracking-wide">Источники канала</h1>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-sm text-zinc-400 hover:text-white transition-colors">← Образы</a>
            <a href="/admin/channel" className="text-sm text-zinc-400 hover:text-white transition-colors">Канал</a>
            <a href="/admin/stats" className="text-sm text-zinc-400 hover:text-white transition-colors">Статистика</a>
            <a href="/admin/trends" className="text-sm text-zinc-400 hover:text-white transition-colors">Тренды</a>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-8">
          {isLoading && <p className="text-zinc-500">Загружаю…</p>}
          {error && <p className="text-rose-400 text-sm">Не удалось загрузить источники: {error.message}</p>}

          {data && (
            <>
              <p className="text-sm text-zinc-500 mb-4">
                {sources.length} источников. «Молчит» — за 14 дней ничего не пришло: лента могла закрыться или сменить адрес.
              </p>

              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск по названию и описанию"
                className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 mb-3 focus:outline-none focus:border-zinc-500"
              />

              <div className="flex flex-wrap gap-1.5 mb-8">
                {allTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggle(t)}
                    className={`px-2 py-1 rounded-lg text-xs transition-colors ${active.includes(t) ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
                  >{t}</button>
                ))}
                {active.length > 0 && (
                  <button onClick={() => setActive([])} className="px-2 py-1 rounded-lg text-xs text-zinc-500 hover:text-white">сбросить</button>
                )}
              </div>

              {Object.entries(LAYERS).map(([key, layer]) => {
                const group = filtered.filter((s) => s.layer === key);
                if (!group.length) return null;
                return (
                  <section key={key} className="mb-8">
                    <h2 className="text-sm text-zinc-300 mb-1">{layer.label} <span className="text-zinc-600">· {layer.hint} · {group.length}</span></h2>
                    <div className="space-y-2 mt-3">
                      {group.map((s) => <SourceRow key={s.name} s={s} />)}
                    </div>
                  </section>
                );
              })}

              {filtered.length === 0 && <p className="text-zinc-500 text-center py-20">Ничего не нашлось</p>}
            </>
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
