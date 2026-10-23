import { useRef, useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { withAuth } from '../../lib/withAuth';

const fetcher = (url) => fetch(url).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
});

const btn = 'px-3 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40';
const btnPrimary = 'px-4 py-2 rounded-lg text-sm bg-zinc-100 text-zinc-900 hover:bg-white transition-colors disabled:opacity-40';

const fmtDate = (d) => (d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const plain = (t) => (t || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const STATUS = {
  new: { label: 'в очереди', cls: 'bg-zinc-800 text-zinc-300' },
  planned: { label: 'пишу тексты', cls: 'bg-amber-500/15 text-amber-300' },
  drafted: { label: 'готово', cls: 'bg-emerald-500/15 text-emerald-300' },
  failed: { label: 'не вышло', cls: 'bg-rose-500/15 text-rose-300' },
};

const POST_STATUS = {
  draft: 'не утверждён',
  approved: 'в очереди',
  published: 'опубликован',
  deferred: 'отложен',
  rejected: 'отклонён',
  superseded: 'заменён',
};

// Файл читаем в браузере и кладём в то же поле: на сервер уходит обычный текст,
// и разбирать форматы файлов сервису канала не приходится
const TEXT_FILES = '.txt,.md,.markdown,.rtf';

function UploadForm({ minChars, onSent }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const fileRef = useRef(null);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProblem(null);
    const body = await file.text();
    setText(body);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
  };

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await fetch('/api/channel-studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text, note }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setTitle('');
      setNote('');
      setText('');
      if (fileRef.current) fileRef.current.value = '';
      onSent();
    } catch (e) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  };

  const enough = text.trim().length >= (minChars || 500);

  return (
    <section className="mb-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h2 className="text-sm text-zinc-300 mb-1">Загрузить исследование</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Статья, глава, заметки, расшифровка доклада. Из текста выйдет один пост или два — решает смысл, а не объём:
        два только если в тексте две мысли, каждая из которых держится сама.
      </p>

      <div className="flex flex-wrap gap-3 mb-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название — можно не заполнять, возьму первую строку"
          className="flex-1 min-w-64 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <input
          ref={fileRef}
          type="file"
          accept={TEXT_FILES}
          onChange={pickFile}
          className="text-xs text-zinc-500 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-xs file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700"
        />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder="Вставьте текст исследования сюда — или выберите файл .txt / .md выше"
        className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-sans leading-relaxed"
      />

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Что подчеркнуть — необязательно. Например: «важна часть про подкладку, а не про силуэт»"
        className="w-full mt-3 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
      />

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button disabled={busy || !enough} onClick={send} className={btnPrimary}>
          {busy ? 'Отправляю…' : 'Разобрать и написать'}
        </button>
        <span className="text-xs text-zinc-500">
          {text.trim().length
            ? `${text.trim().length.toLocaleString('ru-RU')} знаков${enough ? '' : ` — мало, нужно хотя бы ${minChars || 500}`}`
            : 'Текста пока нет'}
        </span>
        {problem && <span className="text-xs text-rose-400">{problem}</span>}
      </div>
    </section>
  );
}

function StudyCard({ study, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const status = STATUS[study.status] || STATUS.new;
  const working = study.status === 'new' || study.status === 'planned';

  const again = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await fetch(`/api/channel-studies/draft?id=${study.id}`, { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      onChanged();
    } catch (e) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
        <h3 className="text-sm text-zinc-200">{study.title}</h3>
        <span className={`px-2 py-0.5 rounded-md text-[11px] ${status.cls}`}>
          {working ? `${status.label}…` : status.label}
        </span>
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        {fmtDate(study.created_at)} · {Number(study.chars).toLocaleString('ru-RU')} знаков
        {study.note ? ` · просила учесть: ${study.note}` : ''}
      </p>

      {study.plan?.why && (
        <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
          <span className="text-zinc-600">Решение: </span>{study.plan.why}
        </p>
      )}

      {study.plan?.posts?.length > 0 && (
        <ol className="space-y-2 mb-3">
          {study.plan.posts.map((p, i) => (
            <li key={i} className="text-xs text-zinc-400 leading-relaxed">
              <span className="text-zinc-600">{i + 1}.</span> {p.title}
              <span className="text-zinc-600"> — {p.thesis}</span>
            </li>
          ))}
        </ol>
      )}

      {study.posts.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {study.posts.map((p) => (
            <a
              key={p.id}
              href={`/admin/channel?post=${p.id}`}
              className="px-2.5 py-1 rounded-lg text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
              title={plain(p.text)}
            >
              #{p.id} · {p.format_title || 'без формата'} · {POST_STATUS[p.status] || p.status} ↗
            </a>
          ))}
        </div>
      )}

      {study.error_msg && <p className="text-xs text-rose-400 mb-3">{study.error_msg}</p>}

      <div className="flex items-center gap-3">
        <button disabled={busy || working} onClick={again} className={btn}>
          {busy ? 'Запускаю…' : study.posts.length ? 'Написать заново' : 'Повторить'}
        </button>
        {working && <span className="text-xs text-zinc-500">Разбор идёт несколько минут, страница обновляется сама</span>}
        {problem && <span className="text-xs text-rose-400">{problem}</span>}
      </div>
    </article>
  );
}

export default function ResearchPage() {
  const { data, error, isLoading, mutate } = useSWR('/api/channel-studies', fetcher, { refreshInterval: 20000 });

  return (
    <>
      <Head>
        <title>Исследования | FFE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen bg-black text-white font-sans">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-serif tracking-wide">Исследования автора</h1>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-sm text-zinc-400 hover:text-white transition-colors">← Образы</a>
            <a href="/admin/channel" className="text-sm text-zinc-400 hover:text-white transition-colors">Канал</a>
            <a href="/admin/sources" className="text-sm text-zinc-400 hover:text-white transition-colors">Источники</a>
            <a href="/admin/trends" className="text-sm text-zinc-400 hover:text-white transition-colors">Тренды</a>
            <a href="/admin/assembly" className="text-sm text-zinc-400 hover:text-white transition-colors">Как собирается</a>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-8">
          <p className="text-sm text-zinc-500 mb-6">
            Свой текст идёт той же дорогой, что и новость: сюжет → разбор → скелет → текст → литредактура → бот.
            Готовые черновики ждут решения во вкладке «Не утверждено» на странице «Канал» и приходят в Telegram.
          </p>

          <UploadForm minChars={data?.min_chars} onSent={() => mutate()} />

          {isLoading && <p className="text-zinc-500">Загружаю…</p>}
          {error && <p className="text-rose-400 text-sm">Не удалось загрузить исследования: {error.message}</p>}
          {data?.studies?.length === 0 && <p className="text-zinc-500 text-center py-16">Исследований пока нет</p>}

          {data?.studies?.length > 0 && (
            <div className="space-y-4">
              {data.studies.map((s) => <StudyCard key={s.id} study={s} onChanged={() => mutate()} />)}
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
