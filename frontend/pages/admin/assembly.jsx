import useSWR from 'swr';
import Head from 'next/head';
import { withAuth } from '../../lib/withAuth';

const fetcher = (url) => fetch(url).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
});

const BY = {
  'код': 'bg-zinc-800 text-zinc-300',
  'вы': 'bg-emerald-500/15 text-emerald-300',
};
const byClass = (by) => BY[by] || 'bg-indigo-500/15 text-indigo-300';

function Step({ step, n }) {
  return (
    <li className="relative pl-10 pb-6 last:pb-0">
      <span className="absolute left-0 top-0 w-7 h-7 rounded-full bg-zinc-900 border border-zinc-700 text-xs text-zinc-400 flex items-center justify-center">{n}</span>
      <span className="absolute left-[13px] top-7 bottom-0 w-px bg-zinc-800 last:hidden" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-zinc-100">{step.title}</h3>
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${byClass(step.by)}`}>{step.by}</span>
      </div>
      <p className="text-sm text-zinc-400 mt-1">{step.what}</p>
    </li>
  );
}

function Variable({ variable }) {
  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
      <h3 className="text-zinc-100">{variable.title}</h3>
      <p className="text-sm text-zinc-400 mt-1 mb-3">{variable.what}</p>
      <ul className="space-y-1.5">
        {variable.values.map((v) => (
          <li key={v.key} className="text-sm">
            <span className="text-zinc-200">{v.title}</span>
            <span className="text-zinc-500"> — {v.what}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AssemblyPage() {
  const { data, error, isLoading } = useSWR('/api/channel-assembly', fetcher);

  return (
    <>
      <Head>
        <title>Как собирается пост | FFE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen bg-black text-white font-sans">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-serif tracking-wide">Как собирается пост</h1>
          <div className="flex items-center gap-4">
            <a href="/admin/channel" className="text-sm text-zinc-400 hover:text-white transition-colors">← Канал</a>
            <a href="/admin/sources" className="text-sm text-zinc-400 hover:text-white transition-colors">Источники</a>
            <a href="/admin/trends" className="text-sm text-zinc-400 hover:text-white transition-colors">Тренды</a>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-8">
          <p className="text-sm text-zinc-500 mb-8">
            Путь от новостной ленты до черновика в боте. Описание собрано из самого кода, поэтому не расходится с тем, как оно работает на самом деле.
            У каждого поста в «Канале» можно посмотреть, что из этого получилось именно у него.
          </p>

          {isLoading && <p className="text-zinc-500">Загружаю…</p>}
          {error && <p className="text-rose-400 text-sm">Не удалось загрузить: {error.message}</p>}

          {data && (
            <>
              <ol className="mb-12">
                {data.steps.map((s, i) => <Step key={s.key} step={s} n={i + 1} />)}
              </ol>

              <h2 className="text-lg font-serif mb-1">Переменные</h2>
              <p className="text-sm text-zinc-500 mb-4">
                То, что меняется от поста к посту. Одинаковые значения подряд — первый признак того, что посты начнут звучать одинаково.
              </p>
              <div className="space-y-4">
                {data.variables.map((v) => <Variable key={v.key} variable={v} />)}
              </div>
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
