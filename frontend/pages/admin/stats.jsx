import useSWR from 'swr';
import { adminFetcher } from '../../lib/api';
import { withAuth } from '../../lib/withAuth';

function AccuracyBar({ value }) {
  const color = value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-yellow-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-zinc-400 w-8 text-right">{value}%</span>
    </div>
  );
}

export default function StatsPage() {
  const { data, isLoading } = useSWR('/api/admin/stats', adminFetcher, { refreshInterval: 30000 });

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-serif tracking-wide">FFE Stats</h1>
        <div className="flex items-center gap-4">
          <a href="/admin" className="text-sm text-zinc-400 hover:text-white transition-colors">← Образы</a>
          <a href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">← Галерея</a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-lg font-medium mb-6 text-zinc-300">Статистика игр</h2>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-zinc-900 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {data?.stats?.length === 0 && (
          <p className="text-zinc-500 text-center py-20">Пока нет сыгранных партий</p>
        )}

        {data?.stats && (
          <div className="space-y-4">
            {data.stats.map((outfit) => (
              <div key={outfit.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center gap-4 mb-4">
                  {outfit.thumb_url && (
                    <img src={outfit.thumb_url} alt="" className="w-12 h-12 object-contain rounded-lg bg-zinc-800 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">{outfit.title || outfit.id}</p>
                    <div className="flex flex-wrap items-center gap-4 mt-1 text-xs text-zinc-500">
                      <span>Партий: <span className="text-zinc-300 font-medium">{outfit.plays}</span></span>
                      {outfit.unique_players > 0 && (
                        <span>~Игроков: <span className="text-zinc-300 font-medium">{outfit.unique_players}</span></span>
                      )}
                      {outfit.plays > 0 && (
                        <span>Средний балл: <span className="text-zinc-300 font-medium">{outfit.avg_score} / {outfit.total}</span></span>
                      )}
                    </div>
                  </div>
                </div>

                {outfit.rows.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2">Точность по рядам</p>
                    {outfit.rows.map((row) => (
                      <div key={row.row_index} className="flex items-center gap-3">
                        <span className="text-xs text-zinc-600 w-12 shrink-0">Ряд {row.row_index + 1}</span>
                        <div className="flex-1">
                          <AccuracyBar value={row.accuracy ?? 0} />
                        </div>
                        <span className="text-xs text-zinc-600 w-16 text-right shrink-0">{row.plays} отв.</span>
                      </div>
                    ))}
                  </div>
                )}

                {outfit.devices && Object.keys(outfit.devices).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-zinc-800">
                    <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2">Устройства</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(outfit.devices).sort((a, b) => b[1] - a[1]).map(([device, count]) => (
                        <span key={device} className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded-full">
                          {device} · {count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {outfit.plays === 0 && (
                  <p className="text-xs text-zinc-600 italic">Ещё никто не играл</p>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export async function getServerSideProps(ctx) {
  const redirect = await withAuth(ctx);
  if (redirect) return redirect;
  return { props: {} };
}
