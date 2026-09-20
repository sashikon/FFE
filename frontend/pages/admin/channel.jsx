import { useState } from 'react';
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
  { key: 'published', label: 'Опубликовано' },
  { key: 'deferred', label: 'Отложено' },
  { key: 'all', label: 'Все' },
];

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

function PostCard({ post, onChanged }) {
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState(null); // null | 'edit' | 'redraft' | 'image'
  const [text, setText] = useState(post.text);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { kind: 'ok' | 'error', text }

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

  return (
    <article className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className="text-zinc-500">#{post.id}</span>
        <span className={`px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
        {post.format_title && <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">{post.format_title}</span>}
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

      {(post.thesis || post.slop?.length > 0) && (
        <div className="mt-4 pt-3 border-t border-zinc-800 text-xs space-y-1">
          {post.thesis && <p className="text-zinc-500">Тезис: <span className="text-zinc-400">{post.thesis}</span></p>}
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
  const { data, error, isLoading, mutate } = useSWR(`/api/channel-posts?status=${tab}`, fetcher, { refreshInterval: 30000 });
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
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-8">
          <p className="text-sm text-zinc-500 mb-6">Изменения отсюда видны и в боте: черновик в Telegram помечается «изменён в админке», а новая версия приходит туда же.</p>

          <BrandLogo />

          <nav className="flex flex-wrap gap-2 mb-8">
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

          {isLoading && (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-48 bg-zinc-900 rounded-xl animate-pulse" />)}
            </div>
          )}
          {error && <p className="text-rose-400 text-sm">Не удалось загрузить посты: {error.message}</p>}
          {data?.posts?.length === 0 && <p className="text-zinc-500 text-center py-20">Здесь пока пусто</p>}
          {data?.posts?.length > 0 && (
            <div className="space-y-4">
              {data.posts.map((p) => <PostCard key={`${p.id}-${p.status}`} post={p} onChanged={() => mutate()} />)}
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
