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
  { key: 'social', label: '📱 Соцсети' },
];

const SORTS = [
  { key: 'growth', label: 'по росту' },
  { key: 'week', label: 'по упоминаниям' },
  { key: 'new', label: 'сначала новые' },
  { key: 'alpha', label: 'по алфавиту' },
];

// Быстрые вкладки по типам — то, что чаще всего нужно смотреть отдельно
const KIND_TABS = [
  { key: '', label: 'все' },
  { key: 'brand', label: '🏷 Бренды' },
  { key: 'item', label: '👗 Вещи' },
  { key: 'aesthetic', label: '✨ Эстетики' },
  { key: 'material', label: '🧵 Материалы' },
  { key: 'color', label: '🎨 Цвета' },
  { key: 'term', label: '💬 Термины' },
  { key: 'sound', label: '🎵 Звуки' },
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

// ─── Соцсети: ролики и скриншоты, присланные боту ────────────────────────────

function TermModal({ id, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 max-w-xl w-full mt-16" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end"><button onClick={onClose} className="text-sm text-zinc-400 hover:text-white">Закрыть</button></div>
        <Detail id={id} />
      </div>
    </div>
  );
}

function SocialCard({ it, kinds, onTerm }) {
  const a = it.analysis || {};
  const [frame, setFrame] = useState(0);
  const [drafting, setDrafting] = useState(null);
  const img = (i) => `/api/channel-social/${it.item_id}/frame/${i}`;
  const stats = [a.views && `👁 ${a.views}`, a.likes && `♥ ${a.likes}`, a.comments && `💬 ${a.comments}`].filter(Boolean).join(' · ');

  const draft = async () => {
    setDrafting('…');
    const r = await fetch(`/api/channel-social/${it.item_id}/draft`, { method: 'POST' });
    const body = await r.json().catch(() => ({}));
    setDrafting(r.ok ? 'Черновик пишется — появится в «Канале» и в боте через 1–2 минуты' : (body.error || `Ошибка ${r.status}`));
  };

  return (
    <article className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden flex flex-col">
      {it.frames > 0 ? (
        <div className="bg-black">
          <img src={img(frame)} alt="" className="w-full max-h-[420px] object-contain" loading="lazy" />
          {it.frames > 1 && (
            <div className="flex gap-1 p-1 overflow-x-auto">
              {Array.from({ length: it.frames }, (_, i) => (
                <button key={i} onClick={() => setFrame(i)} className={`shrink-0 rounded overflow-hidden border ${i === frame ? 'border-zinc-100' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                  <img src={img(i)} alt="" className="h-14 w-10 object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="h-24 flex items-center justify-center text-xs text-zinc-600 bg-zinc-950">картинка не сохранилась (прислано до появления раздела)</div>
      )}

      <div className="p-4 space-y-2 text-sm flex-1">
        <p className="text-xs text-zinc-500">
          {it.kind === 'video' ? '🎬' : '📱'} <span className="text-zinc-300">{it.platform || 'Соцсети'}</span>
          {it.author && ` · ${it.author}`}
          {it.duration ? ` · ${Math.round(it.duration)} с` : ''}
          {stats && ` · ${stats}`}
          <span className="float-right">{new Date(it.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
        </p>
        {a.caption && <p className="text-zinc-200">«{a.caption}»</p>}
        {a.what_happens && <p className="text-zinc-300">{a.what_happens}</p>}
        {a.shows && <p className="text-zinc-400 italic">{a.shows}</p>}
        {a.hashtags?.length > 0 && <p className="text-xs text-zinc-500">{a.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}</p>}
        {it.sound && <p className="text-xs text-zinc-400">🎵 {it.sound}</p>}
        {it.terms?.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {it.terms.map((t) => (
              <button key={t.id} onClick={() => onTerm(t.id)} className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300">
                {t.display} <span className="text-zinc-500">{kinds[t.kind] || t.kind}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pb-4">
        {it.post_id ? (
          <p className="text-xs text-zinc-500">Черновик уже есть: #{it.post_id} — во вкладках «Канала».</p>
        ) : (
          <button onClick={draft} disabled={Boolean(drafting)} className="px-3 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-60">
            {drafting ? drafting : '✍️ Сделать черновик'}
          </button>
        )}
      </div>
    </article>
  );
}

function SocialFeed({ kinds }) {
  const [kind, setKind] = useState('');
  const [platform, setPlatform] = useState('');
  const [term, setTerm] = useState(null);
  const qs = new URLSearchParams({ ...(kind && { kind }), ...(platform && { platform }) }).toString();
  const { data, error, isLoading } = useSWR(`/api/channel-social${qs ? `?${qs}` : ''}`, fetcher, { refreshInterval: 60000 });

  return (
    <>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <button onClick={() => setKind('')} className={chip(!kind)}>всё</button>
        <button onClick={() => setKind('video')} className={chip(kind === 'video')}>🎬 ролики</button>
        <button onClick={() => setKind('screenshot')} className={chip(kind === 'screenshot')}>📱 скриншоты</button>
      </div>
      {data?.platforms?.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          <button onClick={() => setPlatform('')} className={chip(!platform)}>все площадки</button>
          {data.platforms.map((p) => <button key={p} onClick={() => setPlatform(p)} className={chip(platform === p)}>{p}</button>)}
        </div>
      )}
      {isLoading && <p className="text-zinc-500">Загружаю…</p>}
      {error && <p className="text-rose-400 text-sm">Не удалось загрузить: {error.message}</p>}
      {data && data.items.length === 0 && (
        <p className="text-zinc-500 text-center py-20">Пока пусто. Пришлите боту скриншот или ролик из TikTok, Reels или Pinterest.</p>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {data?.items.map((it) => <SocialCard key={it.item_id} it={it} kinds={kinds} onTerm={setTerm} />)}
      </div>
      {term && <TermModal id={term} onClose={() => setTerm(null)} />}
    </>
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
  const [sort, setSort] = useState('growth');
  const qs = new URLSearchParams({ ...(kind && { kind }), ...(region && { region }) }).toString();
  const { data, error, isLoading } = useSWR(`/api/channel-trends${qs ? `?${qs}` : ''}`, fetcher, { refreshInterval: 300000 });
  const kinds = data?.kinds || {};
  const sorters = {
    growth: (a, b) => b.growth - a.growth || b.week - a.week,
    week: (a, b) => b.week - a.week || b.total - a.total,
    new: (a, b) => new Date(b.first_seen) - new Date(a.first_seen),
    alpha: (a, b) => a.display.localeCompare(b.display, 'ru'),
  };
  const list = [...(data?.[view] || [])].sort(sorters[sort]);

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
                {v.label}{data && v.key !== 'social' ? ` · ${data[v.key]?.length || 0}` : ''}
              </button>
            ))}
          </div>

          {view === 'social' ? <SocialFeed kinds={kinds} /> : (<>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {KIND_TABS.map((t) => (
              <button key={t.key} onClick={() => setKind(t.key)} className={chip(kind === t.key)}>{t.label}</button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
            <span className="text-zinc-600 mr-1">сортировка:</span>
            {SORTS.map((o) => <button key={o.key} onClick={() => setSort(o.key)} className={chip(sort === o.key)}>{o.label}</button>)}
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
          </>)}
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
