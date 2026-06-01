import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import useSWR, { mutate } from 'swr';
import { Upload, Trash2, RefreshCw, CheckCircle2, XCircle, Clock, ChevronUp, Save, Edit3, Eye, ImagePlus, Sparkles, Loader2, LayoutGrid } from 'lucide-react';
import { adminFetcher, apiPost, apiDelete } from '../../lib/api';
import { withAuth } from '../../lib/withAuth';

const AESTHETICS = [
  'Cocktail Party Outfit Ideas',
  'Gala & Formal Dresses',
  'Red Carpet Evening Gowns',
  'Evening Outfit Ideas',
  'Night Out Outfits',
  'Boardroom & Office Fashion',
  'Beach & Resort Outfits',
  'Wedding Guest Dresses',
  'Runway & Couture Looks',
  'Streetwear Fashion',
  'Sporty & Casual Outfits',
  'Party Outfit Ideas',
];

const STATUS_ICON = {
  ready: <CheckCircle2 size={14} className="text-emerald-400" />,
  pending: <Clock size={14} className="text-zinc-400 animate-spin" />,
  error: <XCircle size={14} className="text-rose-400" />,
};

function RowsTable({ rows }) {
  if (!Array.isArray(rows)) return null;
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="text-zinc-500 border-b border-zinc-800">
          <th className="text-left py-1 pr-3 font-normal w-28">Тема</th>
          <th className="text-left py-1 font-normal">Варианты (лишнее выделено)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-zinc-800/50">
            <td className="py-1.5 pr-3 text-zinc-400 align-top">{row.theme}</td>
            <td className="py-1.5">
              <div className="flex flex-wrap gap-1">
                {Array.isArray(row.options) && row.options.map((word, wi) => (
                  <span
                    key={wi}
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      word === row.correct
                        ? 'bg-rose-900/60 text-rose-300 line-through'
                        : 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {word}
                  </span>
                ))}
              </div>
              {row.explanation && (
                <p className="mt-1 text-zinc-600 italic">{row.explanation}</p>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RowsEditor({ outfitId, lang, initialRows }) {
  const [rows, setRows] = useState(JSON.stringify(initialRows, null, 2));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(rows);
      await apiPost(`/api/admin/outfit/${outfitId}/rows`, { lang, game_rows: parsed });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      mutate('/api/admin/outfits');
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={rows}
        onChange={(e) => setRows(e.target.value)}
        className="w-full h-40 bg-zinc-950 text-zinc-300 text-xs font-mono p-3 rounded-lg border border-zinc-700 resize-y"
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs rounded-lg transition-colors disabled:opacity-50"
      >
        <Save size={12} /> {saved ? 'Сохранено!' : saving ? 'Сохраняю…' : `Сохранить ${lang.toUpperCase()}`}
      </button>
    </div>
  );
}

function RenderCard({ render, onDelete, onAnalyzed, onPinterestMark }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [pExported, setPExported] = useState(render.pinterest_exported_at ?? null);
  const top = render.aesthetics?.top;

  const handleAnalyze = async (e) => {
    e.stopPropagation();
    setAnalyzing(true);
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/analyze`);
      onAnalyzed(render.id, data.aesthetics);
    } catch (err) {
      alert('Ошибка анализа: ' + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePinterestToggle = async (e) => {
    e.stopPropagation();
    const next = !pExported;
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/pinterest-mark`, { exported: next });
      setPExported(data.pinterest_exported_at);
      if (onPinterestMark) onPinterestMark(render.id, data.pinterest_exported_at);
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  };

  return (
    <div className="relative group flex flex-col gap-1.5" style={{ width: 72 }}>
      <div className="relative">
        <img
          src={render.thumb_url || render.image_url}
          alt=""
          className="w-[72px] h-[90px] object-cover rounded-lg bg-zinc-800 border border-zinc-700"
        />
        <button
          onClick={() => onDelete(render.id)}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
          title="Удалить"
        >
          <XCircle size={12} />
        </button>
        {analyzing ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
            <Loader2 size={16} className="animate-spin text-white" />
          </div>
        ) : !top ? (
          <button
            onClick={handleAnalyze}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 opacity-0 group-hover:opacity-100 rounded-lg transition-opacity text-white"
            title="Анализировать эстетику"
          >
            <Sparkles size={14} />
            <span className="text-[9px]">Анализ</span>
          </button>
        ) : (
          <button
            onClick={handleAnalyze}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-lg transition-opacity"
            title="Переанализировать"
          >
            <RefreshCw size={12} className="text-white/70" />
          </button>
        )}
        {top && !analyzing && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 rounded-b-lg overflow-hidden flex">
            <div className="bg-violet-500 h-full" style={{ width: `${top[0]?.score ?? 0}%` }} />
          </div>
        )}
        {/* Pinterest mark — top-left corner */}
        <button
          onClick={handlePinterestToggle}
          title={pExported
            ? `В Pinterest с ${new Date(pExported).toLocaleDateString('ru')} — нажми чтобы снять`
            : 'Отметить как загружено в Pinterest'}
          className={`absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold transition-all ${
            pExported
              ? 'bg-rose-600 text-white opacity-90'
              : 'bg-black/50 text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-rose-400'
          }`}
        >P</button>
      </div>

      {top?.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-[8px] text-zinc-600 w-2 shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-0.5 mb-0.5">
              <span className="text-[8px] text-zinc-400 truncate leading-tight" title={item.name}>
                {item.name.replace(/ Outfit Ideas| Dresses| Gowns| Looks| Fashion/, '')}
              </span>
              <span className="text-[8px] text-zinc-600 shrink-0">{item.score}</span>
            </div>
            <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${i === 0 ? 'bg-violet-500' : i === 1 ? 'bg-violet-700' : 'bg-violet-900'}`}
                style={{ width: `${item.score}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RendersSection({ outfitId, initialRenders }) {
  const [renders, setRenders] = useState(initialRenders || []);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleUpload = async (files) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      imageFiles.forEach((f) => form.append('render', f));
      const data = await apiPost(`/api/admin/outfit/${outfitId}/renders`, form);
      setRenders((prev) => [...prev, ...data.renders]);
    } catch (e) {
      alert('Ошибка загрузки: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (renderId) => {
    await apiDelete(`/api/admin/render/${renderId}`);
    setRenders((prev) => prev.filter((r) => r.id !== renderId));
  };

  const handleAnalyzed = (renderId, aesthetics) => {
    setRenders((prev) => prev.map((r) => r.id === renderId ? { ...r, aesthetics } : r));
  };

  const handleAnalyzeAll = async () => {
    for (const r of renders.filter((r) => !r.aesthetics)) {
      try {
        const data = await apiPost(`/api/admin/render/${r.id}/analyze`);
        handleAnalyzed(r.id, data.aesthetics);
      } catch (e) {
        console.error('analyze failed', r.id, e);
      }
    }
  };

  const unanalyzed = renders.filter((r) => !r.aesthetics).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Рендеры ({renders.length})
        </span>
        <div className="flex items-center gap-3">
          {unanalyzed > 0 && (
            <button
              onClick={handleAnalyzeAll}
              className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              <Sparkles size={11} /> Анализ всех ({unanalyzed})
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50"
          >
            <ImagePlus size={12} /> {uploading ? 'Загружаю…' : 'Добавить'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => handleUpload(e.target.files)} />
      </div>
      {renders.length === 0 ? (
        <p className="text-xs text-zinc-600 italic">Нет рендеров</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {renders.map((r) => (
            <RenderCard key={r.id} render={r} onDelete={handleDelete} onAnalyzed={handleAnalyzed}
              onPinterestMark={(id, ts) => setRenders((prev) => prev.map((x) => x.id === id ? { ...x, pinterest_exported_at: ts } : x))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PinterestExportModal({ lang, onlyNew, rendersOnly, onClose, onExported }) {
  const [items, setItems] = useState(null); // null = loading
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ lang, ...(onlyNew ? { new: 'true' } : {}), ...(rendersOnly ? { renders: 'true' } : {}) });
    adminFetcher(`/api/admin/pinterest-preview?${params}`)
      .then((data) => {
        setItems(data.outfits || []);
        setSelected(new Set((data.outfits || []).map((o) => o.id)));
      })
      .catch((e) => alert('Ошибка загрузки превью: ' + e.message));
  }, [lang, onlyNew, rendersOnly]);

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((o) => o.id)));
  };

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleExport = async () => {
    if (!selected.size) return;
    setExporting(true);
    try {
      const BASE = process.env.NEXT_PUBLIC_API_URL || '';
      const token = process.env.NEXT_PUBLIC_ADMIN_TOKEN || '';
      const ids = [...selected].join(',');
      const params = new URLSearchParams({ lang, board: 'FFE', ids, ...(rendersOnly ? { renders: 'true' } : {}) });
      const res = await fetch(`${BASE}/api/admin/pinterest-export?${params}`, {
        headers: token ? { 'x-admin-token': token } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pinterest_${lang}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      onExported();
      onClose();
    } catch (e) {
      alert('Ошибка экспорта: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-700 w-full max-w-2xl flex flex-col shadow-2xl"
        style={{ maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-sm font-medium text-zinc-100">
              Экспорт Pinterest · {lang.toUpperCase()}
              {onlyNew && <span className="ml-2 text-xs text-emerald-400 border border-emerald-800 rounded px-1.5 py-0.5">только новые</span>}
              {rendersOnly && <span className="ml-2 text-xs text-violet-400 border border-violet-800 rounded px-1.5 py-0.5">ИИ рендеры</span>}
            </p>
            {items && (
              <p className="text-xs text-zinc-500 mt-0.5">
                {selected.size} из {items.length} образов выбрано
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none transition-colors">×</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-3">
          {!items && (
            <div className="flex items-center justify-center py-16 text-zinc-600">
              <Loader2 size={20} className="animate-spin mr-2" /> Загружаю список…
            </div>
          )}

          {items?.length === 0 && (
            <div className="text-center py-16 text-zinc-600">
              <p className="text-sm">Нет {rendersOnly ? 'рендеров' : 'образов'} для экспорта.</p>
              <p className="text-xs mt-1">
                {rendersOnly
                  ? 'Все ИИ рендеры уже отмечены как загруженные в Pinterest. Или рендеры ещё не загружены.'
                  : `Все готовые образы уже отмечены как загруженные в Pinterest ${lang.toUpperCase()}.`}
              </p>
            </div>
          )}

          {items?.length > 0 && (
            <>
              {/* Select all */}
              <label className="flex items-center gap-2 px-2 py-2 mb-1 text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors">
                <input
                  type="checkbox"
                  checked={selected.size === items.length}
                  onChange={toggleAll}
                  className="accent-rose-500"
                />
                {selected.size === items.length ? 'Снять все' : 'Выбрать все'}
              </label>

              <div className="space-y-1">
                {items.map((outfit) => {
                  const isSelected = selected.has(outfit.id);
                  const hasRender = !!(outfit.render_thumb || outfit.render_url);
                  return (
                    <label
                      key={outfit.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                        isSelected ? 'bg-zinc-800' : 'bg-zinc-900 opacity-50 hover:opacity-70'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(outfit.id)}
                        className="accent-rose-500 shrink-0"
                      />

                      {/* Sketch */}
                      <div className="shrink-0">
                        <img
                          src={outfit.thumb_url || outfit.image_url}
                          alt=""
                          className="w-10 h-12 object-cover rounded-lg bg-zinc-700"
                        />
                      </div>

                      {/* Arrow + render */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-zinc-700 text-xs">→</span>
                        {hasRender ? (
                          <div className="relative">
                            <img
                              src={outfit.render_thumb || outfit.render_url}
                              alt=""
                              className="w-10 h-12 object-cover rounded-lg bg-zinc-700 border border-violet-700"
                            />
                            <span className="absolute -bottom-1 -right-1 bg-violet-600 text-white text-[8px] rounded px-0.5 leading-tight">ИИ</span>
                          </div>
                        ) : (
                          <div className="w-10 h-12 rounded-lg bg-zinc-800 border border-dashed border-zinc-700 flex items-center justify-center">
                            <span className="text-[9px] text-zinc-600 text-center leading-tight px-0.5">нет рендера</span>
                          </div>
                        )}
                      </div>

                      {/* Title */}
                      <span className="flex-1 min-w-0 text-xs text-zinc-300 truncate">
                        {outfit.title || outfit.id}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {items?.length > 0 && (
          <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between shrink-0">
            <p className="text-xs text-zinc-600">
              После скачивания все выбранные {rendersOnly ? 'рендеры получат метку P на миниатюре' : `образы получат метку P·${lang.toUpperCase()}`}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-xs text-zinc-400 hover:text-white transition-colors">
                Отмена
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || !selected.size}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
              >
                <Upload size={12} />
                {exporting ? 'Готовлю…' : `Скачать CSV (${selected.size})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CoverageBoard() {
  const { data, isLoading } = useSWR('/api/admin/coverage', adminFetcher);

  const byAesthetic = {};
  AESTHETICS.forEach((a) => { byAesthetic[a] = []; });
  (data?.renders || []).forEach((render) => {
    render.aesthetics?.top?.forEach((item, rank) => {
      if (byAesthetic[item.name]) byAesthetic[item.name].push({ ...render, rank, score: item.score });
    });
  });

  const total = data?.renders?.length ?? 0;

  return (
    <div>
      {/* Description */}
      <div className="mb-8 p-5 rounded-2xl bg-zinc-900 border border-zinc-800">
        <div className="flex items-start gap-3">
          <LayoutGrid size={18} className="text-violet-400 shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <p className="text-zinc-200 font-medium">Coverage — покрытие трендовых эстетик</p>
            <p className="text-zinc-400 leading-relaxed">
              Каждый ИИ рендер анализируется Claude Vision и относится к одной из 12 трендовых категорий Pinterest.
              Этот раздел показывает, какие эстетики уже охвачены контентом, а где дыры — туда нужно досъёмить.
            </p>
            <div className="pt-1 space-y-1 text-zinc-500 text-xs leading-relaxed">
              <p>
                <span className="text-zinc-300">Зачем это нужно для Pinterest:</span>{' '}
                Pinterest — поисковик визуального контента. Пользователи ищут именно по этим категориям:
                «Gala & Formal Dresses», «Streetwear Fashion», «Red Carpet Evening Gowns» и т.д.
                Чем шире покрытие эстетик — тем больше точек входа в аккаунт FFE из органического поиска.
              </p>
              <p>
                <span className="text-zinc-300">Как использовать:</span>{' '}
                Смотришь какие строки пустые или с малым числом → идёшь снимать рендеры именно в этой эстетике →
                загружаешь в карточку образа → запускаешь «Анализ» → рендер попадает в нужную строку здесь.
                Далее экспортируешь Pinterest CSV с этими рендерами.
              </p>
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 bg-zinc-900 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!isLoading && total === 0 && (
        <div className="text-center py-16 text-zinc-600">
          <Sparkles size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Нет проанализированных рендеров.</p>
          <p className="text-xs mt-1">Откройте карточку образа → наведите на рендер → нажмите «Анализ»</p>
        </div>
      )}

      {!isLoading && total > 0 && (<>
      <p className="text-xs text-zinc-600 mb-4">{total} рендеров проанализировано</p>
      <div className="space-y-2">
        {AESTHETICS.map((aesthetic) => {
          const primary = (byAesthetic[aesthetic] || []).filter((r) => r.rank === 0);
          const pct = total > 0 ? Math.round((primary.length / total) * 100) : 0;
          return (
            <div key={aesthetic} className="flex items-center gap-4 p-3 bg-zinc-900 rounded-xl border border-zinc-800">
              <div className="w-56 shrink-0">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-zinc-200 leading-tight">{aesthetic}</p>
                  <span className="text-xs text-zinc-600 ml-2 shrink-0">{primary.length}</span>
                </div>
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
              {primary.length === 0 ? (
                <p className="text-xs text-zinc-700 italic">—</p>
              ) : (
                <div className="flex gap-1.5 flex-wrap">
                  {primary.slice(0, 10).map((r) => (
                    <img key={r.id} src={r.thumb_url || r.image_url} alt="" className="w-9 h-11 object-cover rounded bg-zinc-800" title={r.title || r.outfit_id} />
                  ))}
                  {primary.length > 10 && <span className="text-xs text-zinc-600 self-center">+{primary.length - 10}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>)}
    </div>
  );
}

function RendersGallery({ outfits, onMutate }) {
  const [localRenders, setLocalRenders] = useState(() =>
    (outfits || []).flatMap((o) => (o.renders || []).map((r) => ({ ...r, outfit: o })))
  );
  const [filter, setFilter] = useState('all'); // 'all' | 'pinterest' | 'new'

  // Sync when outfits data changes
  useEffect(() => {
    setLocalRenders(
      (outfits || []).flatMap((o) =>
        (o.renders || []).map((r) => ({ ...r, outfit: o }))
      )
    );
  }, [outfits]);

  const handleDelete = async (renderId) => {
    if (!confirm('Удалить рендер?')) return;
    await apiDelete(`/api/admin/render/${renderId}`);
    setLocalRenders((prev) => prev.filter((r) => r.id !== renderId));
    onMutate();
  };

  const handleAnalyzed = (renderId, aesthetics) => {
    setLocalRenders((prev) =>
      prev.map((r) => (r.id === renderId ? { ...r, aesthetics } : r))
    );
  };

  const handlePinterestMark = (renderId, ts) => {
    setLocalRenders((prev) =>
      prev.map((r) => (r.id === renderId ? { ...r, pinterest_exported_at: ts } : r))
    );
  };

  const pExported = localRenders.filter((r) => r.pinterest_exported_at).length;
  const notUploaded = localRenders.filter((r) => !r.pinterest_exported_at).length;

  const visible = filter === 'pinterest'
    ? localRenders.filter((r) => r.pinterest_exported_at)
    : filter === 'new'
    ? localRenders.filter((r) => !r.pinterest_exported_at)
    : localRenders;

  if (!localRenders.length) {
    return (
      <div className="text-center py-24 text-zinc-600">
        <ImagePlus size={40} className="mx-auto mb-4 opacity-20" />
        <p className="text-sm">Нет загруженных рендеров.</p>
        <p className="text-xs mt-1">Откройте карточку образа и загрузите ИИ рендеры.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h2 className="text-lg font-medium text-zinc-300">ИИ рендеры</h2>
        <button
          onClick={() => setFilter('all')}
          className={`text-sm px-2.5 py-0.5 rounded-full border transition-colors ${filter === 'all' ? 'border-zinc-500 text-zinc-200 bg-zinc-800' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
        >{localRenders.length} всего</button>
        <button
          onClick={() => setFilter('pinterest')}
          className={`text-sm px-2.5 py-0.5 rounded-full border transition-colors ${filter === 'pinterest' ? 'border-rose-600 text-rose-300 bg-rose-950' : 'border-zinc-700 text-rose-500 hover:text-rose-400'}`}
        >{pExported} в Pinterest</button>
        <button
          onClick={() => setFilter('new')}
          className={`text-sm px-2.5 py-0.5 rounded-full border transition-colors ${filter === 'new' ? 'border-violet-600 text-violet-300 bg-violet-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
        >{notUploaded} не загружено</button>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {visible.map((render) => (
          <GalleryRenderCard
            key={render.id}
            render={render}
            outfit={render.outfit}
            onDelete={handleDelete}
            onAnalyzed={handleAnalyzed}
            onPinterestMark={handlePinterestMark}
          />
        ))}
      </div>
    </div>
  );
}

function GalleryRenderCard({ render, outfit, onDelete, onAnalyzed, onPinterestMark }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [pExported, setPExported] = useState(render.pinterest_exported_at ?? null);
  const [aesthetics, setAesthetics] = useState(render.aesthetics);
  const top = aesthetics?.top;

  const handleAnalyze = async (e) => {
    e.stopPropagation();
    setAnalyzing(true);
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/analyze`);
      setAesthetics(data.aesthetics);
      onAnalyzed(render.id, data.aesthetics);
    } catch (err) {
      alert('Ошибка анализа: ' + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePinterestToggle = async (e) => {
    e.stopPropagation();
    const next = !pExported;
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/pinterest-mark`, { exported: next });
      setPExported(data.pinterest_exported_at);
      onPinterestMark(render.id, data.pinterest_exported_at);
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  };

  return (
    <div className="group relative flex flex-col gap-2 bg-zinc-900 rounded-2xl p-2 border border-zinc-800 hover:border-zinc-600 transition-colors">
      {/* Main render image */}
      <div className="relative overflow-hidden rounded-xl bg-zinc-800" style={{ aspectRatio: '3/4' }}>
        <img
          src={render.image_url}
          alt=""
          className="w-full h-full object-cover"
        />

        {/* Overlay buttons */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all rounded-xl" />

        {/* Delete */}
        <button
          onClick={() => onDelete(render.id)}
          className="absolute top-2 right-2 w-7 h-7 bg-rose-600 hover:bg-rose-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
          title="Удалить"
        >
          <XCircle size={14} />
        </button>

        {/* Analyze */}
        {analyzing ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black/70 rounded-xl px-3 py-2 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-violet-400" />
              <span className="text-xs text-zinc-300">Анализ…</span>
            </div>
          </div>
        ) : (
          <button
            onClick={handleAnalyze}
            className={`absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all z-10 ${
              top
                ? 'bg-violet-900/80 text-violet-300 opacity-0 group-hover:opacity-100 hover:bg-violet-800'
                : 'bg-black/70 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-violet-300'
            }`}
            title={top ? 'Переанализировать' : 'Анализировать эстетику'}
          >
            <Sparkles size={10} /> {top ? 'Заново' : 'Анализ'}
          </button>
        )}

        {/* Pinterest mark */}
        <button
          onClick={handlePinterestToggle}
          title={pExported
            ? `В Pinterest с ${new Date(pExported).toLocaleDateString('ru')} — нажми чтобы снять`
            : 'Отметить как загружено в Pinterest'}
          className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold transition-all z-10 ${
            pExported
              ? 'bg-rose-600 text-white'
              : 'bg-black/60 text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-rose-400'
          }`}
        >P</button>

        {/* Outfit sketch — bottom left */}
        <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <img
            src={outfit.thumb_url || outfit.image_url}
            alt=""
            className="w-8 h-8 object-cover rounded-lg border border-zinc-600 shadow-lg"
            title={outfit.title || outfit.id}
          />
        </div>
      </div>

      {/* Aesthetics */}
      {top ? (
        <div className="px-1 space-y-1">
          {top.slice(0, 2).map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="text-[9px] text-zinc-400 truncate leading-tight">
                    {item.name.replace(/ Outfit Ideas| Dresses| Gowns| Looks| Fashion/, '')}
                  </span>
                  <span className="text-[9px] text-zinc-600 shrink-0">{item.score}</span>
                </div>
                <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${i === 0 ? 'bg-violet-500' : 'bg-violet-800'}`}
                    style={{ width: `${item.score}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[9px] text-zinc-700 italic px-1">без анализа</p>
      )}
    </div>
  );
}

function OutfitCard({ outfit, onDelete, onRetry, onPinterestMark }) {
  const [expanded, setExpanded] = useState(false);
  const [editingLang, setEditingLang] = useState(null);

  const ruReady = outfit.translations?.ru?.status === 'ready';
  const enReady = outfit.translations?.en?.status === 'ready';
  const hasError = ['ru', 'en'].some((l) => {
    const status = outfit.translations?.[l]?.status;
    return !status || ['error', 'pending'].includes(status);
  });
  const canExpand = true; // always expandable to manage renders

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800">
      <div className="flex items-center gap-4 p-4">
        <img
          src={outfit.thumb_url || outfit.image_url}
          alt=""
          className="w-14 h-14 object-cover rounded-lg shrink-0 bg-zinc-800"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200 truncate">{outfit.title || outfit.id}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {(['ru', 'en']).map((lang) => {
              const t = outfit.translations?.[lang];
              const status = t?.status || 'pending';
              return (
                <span key={lang} className="flex items-center gap-1 text-xs text-zinc-500">
                  {STATUS_ICON[status]} {lang.toUpperCase()}
                  {status === 'error' && t?.error_msg && (
                    <span className="text-rose-400 ml-1 max-w-[200px] truncate" title={t.error_msg}>
                      — {t.error_msg}
                    </span>
                  )}
                </span>
              );
            })}
            {outfit.renders?.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-zinc-500" title="ИИ рендеры">
                <ImagePlus size={11} className="text-zinc-600" />
                {outfit.renders.length}
              </span>
            )}
            {['en', 'ru'].map((l) => {
              const date = outfit.pinterest_exported?.[l];
              return (
                <button
                  key={l}
                  onClick={() => onPinterestMark(outfit.id, l, !date)}
                  title={date
                    ? `В Pinterest ${l.toUpperCase()} с ${new Date(date).toLocaleDateString('ru')} — нажми чтобы снять метку`
                    : `Отметить как загружено в Pinterest ${l.toUpperCase()}`}
                  className={`text-[10px] border rounded px-1 py-0.5 leading-none transition-colors ${
                    date
                      ? 'text-rose-400 border-rose-800 hover:bg-rose-950'
                      : 'text-zinc-700 border-zinc-800 hover:text-rose-400 hover:border-rose-800'
                  }`}
                >P·{l.toUpperCase()}</button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canExpand && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-2 text-zinc-400 hover:text-white transition-colors"
              title={expanded ? 'Скрыть ряды' : 'Показать ряды'}
            >
              {expanded ? <ChevronUp size={16} /> : <Eye size={16} />}
            </button>
          )}
          <a
            href={`/outfit/${outfit.id}`}
            target="_blank"
            rel="noreferrer"
            className="p-2 text-zinc-400 hover:text-white transition-colors"
            title="Открыть"
          >
            <Edit3 size={16} />
          </a>
          {hasError && (
            <button
              onClick={() => onRetry(outfit.id)}
              className="p-2 text-zinc-400 hover:text-yellow-400 transition-colors"
              title="Повторить анализ"
            >
              <RefreshCw size={16} />
            </button>
          )}
          <button
            onClick={() => onDelete(outfit.id)}
            className="p-2 text-zinc-400 hover:text-rose-400 transition-colors"
            title="Удалить"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 p-4 space-y-6">
          {/* Renders */}
          <RendersSection outfitId={outfit.id} initialRenders={outfit.renders || []} />

          {/* Game rows per language */}
          {(ruReady || enReady) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-800/60">
              {(['ru', 'en']).map((lang) => {
                const t = outfit.translations?.[lang];
                if (!t || t.status !== 'ready') return null;
                return (
                  <div key={lang}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{lang}</span>
                      <button
                        onClick={() => setEditingLang(editingLang === lang ? null : lang)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {editingLang === lang ? 'Отмена' : 'Редактировать JSON'}
                      </button>
                    </div>
                    {editingLang === lang ? (
                      <RowsEditor outfitId={outfit.id} lang={lang} initialRows={t.game_rows} />
                    ) : (
                      <RowsTable rows={t.game_rows} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadItems, setUploadItems] = useState([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);
  const [view, setView] = useState('outfits'); // 'outfits' | 'renders' | 'coverage'
  const [sort, setSort] = useState('date'); // 'date' | 'renders'
  const [pinterestFilter, setPinterestFilter] = useState('all'); // 'all' | 'new-en' | 'new-ru' | 'exported'
  const [exportModal, setExportModal] = useState(null); // null | {lang, onlyNew, rendersOnly}
  const fileRef = useRef(null);

  const { data, isLoading } = useSWR('/api/admin/outfits', adminFetcher, {
    refreshInterval: 5000,
  });

  const handleUpload = async (files) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    setUploadItems(imageFiles.map((f) => ({ name: f.name, status: 'uploading' })));

    const form = new FormData();
    imageFiles.forEach((f) => form.append('image', f));

    try {
      const data = await apiPost('/api/admin/upload', form);
      setUploadItems(
        data.results.map((r) => ({
          name: r.filename,
          status: r.duplicate ? 'duplicate' : 'done',
          duplicate: r.duplicate,
        }))
      );
      mutate('/api/admin/outfits');
      setTimeout(() => setUploadItems([]), 5000);
    } catch (err) {
      setUploadItems((prev) => prev.map((i) => ({ ...i, status: 'error', error: err.message })));
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить образ?')) return;
    await apiDelete(`/api/admin/outfit/${id}`);
    mutate('/api/admin/outfits');
  };

  const handleRetry = async (id) => {
    await apiPost(`/api/admin/outfit/${id}/retry`);
    mutate('/api/admin/outfits');
  };

  const handlePinterestMark = async (id, lang, exported) => {
    await apiPost(`/api/admin/outfit/${id}/pinterest-mark`, { lang, exported });
    mutate('/api/admin/outfits');
  };

  const handlePinterestExport = async (lang = 'en', onlyNew = false) => {
    try {
      setCsvExporting(true);
      const BASE = process.env.NEXT_PUBLIC_API_URL || '';
      const token = process.env.NEXT_PUBLIC_ADMIN_TOKEN || '';
      const params = new URLSearchParams({ lang, board: 'FFE', ...(onlyNew ? { new: 'true' } : {}) });
      const res = await fetch(`${BASE}/api/admin/pinterest-export?${params}`, {
        headers: token ? { 'x-admin-token': token } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pinterest_${lang}${onlyNew ? '_new' : ''}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      mutate('/api/admin/outfits');
    } catch (e) {
      alert('Ошибка экспорта: ' + e.message);
    } finally {
      setCsvExporting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Admin | FFE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
    <div className="min-h-screen bg-black text-white font-sans">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-serif tracking-wide">FFE Admin</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1">
            <button
              onClick={() => setView('outfits')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${view === 'outfits' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <Upload size={13} /> Образы
            </button>
            <button
              onClick={() => setView('renders')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${view === 'renders' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <ImagePlus size={13} /> Рендеры
            </button>
            <button
              onClick={() => setView('coverage')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${view === 'coverage' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <LayoutGrid size={13} /> Coverage
            </button>
          </div>
          <a href="/admin/stats" className="text-sm text-zinc-400 hover:text-white transition-colors">Статистика</a>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setExportModal({ lang: 'en', onlyNew: true, rendersOnly: false })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs rounded-lg transition-colors"
              title="Новые образы (эскизы) — EN"
            >
              <Upload size={12} /> Новые EN
            </button>
            <button
              onClick={() => setExportModal({ lang: 'ru', onlyNew: true, rendersOnly: false })}
              className="px-2 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs rounded-lg transition-colors"
              title="Новые образы — RU"
            >RU</button>
            <button
              onClick={() => setExportModal({ lang: 'en', rendersOnly: true, onlyNew: false })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-950 hover:bg-violet-900 border border-violet-800 text-violet-300 text-xs rounded-lg transition-colors"
              title="ИИ рендеры не загруженные в Pinterest — EN"
            >
              <ImagePlus size={12} /> Рендеры EN
            </button>
            <button
              onClick={() => setExportModal({ lang: 'ru', rendersOnly: true, onlyNew: false })}
              className="px-2 py-1.5 bg-violet-950 hover:bg-violet-900 border border-violet-800 text-violet-300 text-xs rounded-lg transition-colors"
              title="ИИ рендеры не загруженные в Pinterest — RU"
            >RU</button>
            <button
              onClick={() => setExportModal({ lang: 'en', onlyNew: false, rendersOnly: false })}
              className="px-2 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-500 text-xs rounded-lg transition-colors"
              title="Все готовые — EN"
            >Все</button>
          </div>
          <a href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">← Галерея</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {view === 'coverage' && <CoverageBoard />}
        {view === 'renders' && (
          <RendersGallery outfits={data?.outfits} onMutate={() => mutate('/api/admin/outfits')} />
        )}
        {view === 'outfits' && (<>
        <div
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200 mb-4 ${
            isDragging ? 'border-zinc-400 bg-zinc-900' : 'border-zinc-700 hover:border-zinc-500'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleUpload(e.dataTransfer.files);
          }}
        >
          <Upload size={32} className="mx-auto mb-3 text-zinc-500" />
          <p className="text-zinc-300 mb-1">Перетащите изображения или</p>
          <p className="text-zinc-600 text-xs mb-3">Можно загрузить несколько файлов сразу</p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadItems.some((i) => i.status === 'uploading')}
            className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors border border-zinc-700 text-sm disabled:opacity-50"
          >
            {uploadItems.some((i) => i.status === 'uploading') ? 'Загружаю…' : 'Выбрать файлы'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
        </div>

        {uploadItems.length > 0 && (
          <div className="mb-8 space-y-1.5">
            {uploadItems.map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
                {item.status === 'uploading' && <Clock size={14} className="text-zinc-400 animate-spin shrink-0" />}
                {item.status === 'done' && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                {item.status === 'duplicate' && <XCircle size={14} className="text-yellow-400 shrink-0" />}
                {item.status === 'error' && <XCircle size={14} className="text-rose-400 shrink-0" />}
                <span className="text-zinc-300 truncate flex-1">{item.name}</span>
                <span className="text-xs shrink-0 text-zinc-500">
                  {item.status === 'uploading' && 'Загружаю…'}
                  {item.status === 'done' && 'Загружено'}
                  {item.status === 'duplicate' && 'Дубликат'}
                  {item.status === 'error' && 'Ошибка'}
                </span>
              </div>
            ))}
          </div>
        )}

        {data?.outfits && (() => {
          const total = data.outfits.length;
          const ready = data.outfits.filter((o) => ['ru', 'en'].every((l) => o.translations?.[l]?.status === 'ready')).length;
          const pending = data.outfits.filter((o) => ['ru', 'en'].some((l) => o.translations?.[l]?.status === 'pending')).length;
          const error = data.outfits.filter((o) => ['ru', 'en'].some((l) => o.translations?.[l]?.status === 'error')).length;
          const hashCounts = {};
          data.outfits.forEach((o) => { if (o.file_hash) hashCounts[o.file_hash] = (hashCounts[o.file_hash] || 0) + 1; });
          const dupCount = data.outfits.filter((o) => o.file_hash && hashCounts[o.file_hash] > 1).length;
          const newEnCount = data.outfits.filter((o) => !o.pinterest_exported?.en && ['ru','en'].every(l => o.translations?.[l]?.status === 'ready')).length;
          const newRuCount = data.outfits.filter((o) => !o.pinterest_exported?.ru && ['ru','en'].every(l => o.translations?.[l]?.status === 'ready')).length;
          const exportedCount = data.outfits.filter((o) => o.pinterest_exported?.en || o.pinterest_exported?.ru).length;
          return (
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-4 flex-wrap">
                <h2 className="text-lg font-medium text-zinc-300">Образы</h2>
                <div className="flex items-center gap-3 text-sm flex-wrap">
                  <span className="text-zinc-400">{total} всего</span>
                  <span className="text-emerald-400">{ready} готово</span>
                  {pending > 0 && <span className="text-zinc-400">{pending} в обработке</span>}
                  {error > 0 && <span className="text-rose-400">{error} с ошибкой</span>}
                  {dupCount > 0 && (
                    <button
                      onClick={() => setShowDuplicates((v) => !v)}
                      className={`px-2 py-0.5 rounded text-xs border transition-colors ${showDuplicates ? 'border-yellow-500 text-yellow-400 bg-yellow-950' : 'border-zinc-600 text-yellow-500 hover:border-yellow-500'}`}
                    >
                      {dupCount} дубликатов
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Pinterest filter */}
                <span className="text-xs text-zinc-600">Pinterest:</span>
                <button
                  onClick={() => setPinterestFilter('all')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${pinterestFilter === 'all' ? 'border-zinc-500 text-zinc-200 bg-zinc-800' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >все</button>
                <button
                  onClick={() => setPinterestFilter('new-en')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${pinterestFilter === 'new-en' ? 'border-emerald-600 text-emerald-300 bg-emerald-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >новые EN ({newEnCount})</button>
                <button
                  onClick={() => setPinterestFilter('new-ru')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${pinterestFilter === 'new-ru' ? 'border-emerald-600 text-emerald-300 bg-emerald-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >новые RU ({newRuCount})</button>
                <button
                  onClick={() => setPinterestFilter('exported')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${pinterestFilter === 'exported' ? 'border-rose-700 text-rose-300 bg-rose-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >загружено ({exportedCount})</button>
                {/* Sort */}
                <span className="text-xs text-zinc-600 ml-2">Сортировка:</span>
                <button
                  onClick={() => setSort('date')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${sort === 'date' ? 'border-zinc-500 text-zinc-200 bg-zinc-800' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >по дате</button>
                <button
                  onClick={() => setSort('renders')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${sort === 'renders' ? 'border-violet-500 text-violet-300 bg-violet-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >с рендерами</button>
              </div>
            </div>
          );
        })()}
        {!data?.outfits && <h2 className="text-lg font-medium mb-4 text-zinc-300">Образы</h2>}

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-zinc-900 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {data?.outfits && (() => {
          const hashCounts = {};
          data.outfits.forEach((o) => { if (o.file_hash) hashCounts[o.file_hash] = (hashCounts[o.file_hash] || 0) + 1; });
          const sorted = sort === 'renders'
            ? [...data.outfits].sort((a, b) => (b.renders?.length || 0) - (a.renders?.length || 0))
            : data.outfits;
          const pFiltered = pinterestFilter === 'new-en'
            ? sorted.filter((o) => !o.pinterest_exported?.en)
            : pinterestFilter === 'new-ru'
            ? sorted.filter((o) => !o.pinterest_exported?.ru)
            : pinterestFilter === 'exported'
            ? sorted.filter((o) => o.pinterest_exported?.en || o.pinterest_exported?.ru)
            : sorted;
          const visible = showDuplicates
            ? pFiltered.filter((o) => o.file_hash && hashCounts[o.file_hash] > 1)
            : pFiltered;

          if (showDuplicates) {
            const groups = {};
            visible.forEach((o) => {
              if (!groups[o.file_hash]) groups[o.file_hash] = [];
              groups[o.file_hash].push(o);
            });
            return (
              <div className="space-y-4">
                {Object.values(groups).map((group) => (
                  <div key={group[0].file_hash} className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-3 space-y-2">
                    <p className="text-xs text-yellow-600 font-mono truncate px-1">hash: {group[0].file_hash}</p>
                    {group.map((outfit) => (
                      <OutfitCard key={outfit.id} outfit={outfit} onDelete={handleDelete} onRetry={handleRetry} onPinterestMark={handlePinterestMark} />
                    ))}
                  </div>
                ))}
              </div>
            );
          }

          return (
            <div className="space-y-3">
              {visible.map((outfit) => (
                <OutfitCard key={outfit.id} outfit={outfit} onDelete={handleDelete} onRetry={handleRetry} onPinterestMark={handlePinterestMark} />
              ))}
            </div>
          );
        })()}
        </>)}
      </main>
    </div>

    {exportModal && (
      <PinterestExportModal
        lang={exportModal.lang}
        onlyNew={exportModal.onlyNew}
        rendersOnly={exportModal.rendersOnly}
        onClose={() => setExportModal(null)}
        onExported={() => mutate('/api/admin/outfits')}
      />
    )}
    </>
  );
}

export async function getServerSideProps(ctx) {
  const redirect = await withAuth(ctx);
  if (redirect) return redirect;
  return { props: {} };
}
