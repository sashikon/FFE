import { useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { withAuth } from '../../lib/withAuth';

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

function PostCard({ post }) {
  const [copied, setCopied] = useState(false);
  const status = STATUS[post.status] || { label: post.status, cls: 'bg-zinc-800 text-zinc-300' };
  const when = post.status === 'published' ? `вышел ${fmtDate(post.published_at)}`
    : post.status === 'approved' ? `одобрен ${fmtDate(post.approved_at)}`
    : `создан ${fmtDate(post.created_at)}`;

  const copy = async () => {
    await navigator.clipboard.writeText(plain(post.text));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        <div
          className="text-sm leading-relaxed text-zinc-200 min-w-0 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-3"
          dangerouslySetInnerHTML={{ __html: safeTelegramHtml(post.text) }}
        />
      </div>

      {(post.thesis || post.slop?.length > 0) && (
        <div className="mt-4 pt-3 border-t border-zinc-800 text-xs space-y-1">
          {post.thesis && <p className="text-zinc-500">Тезис: <span className="text-zinc-400">{post.thesis}</span></p>}
          {post.slop?.length > 0 && (
            <p className="text-amber-400">⚠️ шаблоны: {post.slop.map((s) => `«${s}»`).join(', ')}</p>
          )}
        </div>
      )}
    </article>
  );
}

export default function ChannelPage() {
  const [tab, setTab] = useState('draft');
  const { data, error, isLoading } = useSWR(`/api/channel-posts?status=${tab}`, fetcher, { refreshInterval: 60000 });
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
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-8">
          <p className="text-sm text-zinc-500 mb-6">Только просмотр. Утверждать, править и публиковать — в Telegram-боте.</p>

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
              {data.posts.map((p) => <PostCard key={p.id} post={p} />)}
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
