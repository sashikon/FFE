import { useState, useRef } from 'react';
import useSWR, { mutate } from 'swr';
import { Upload, Trash2, RefreshCw, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, Save, Edit3, Eye } from 'lucide-react';
import { adminFetcher, apiPost, apiDelete } from '../../lib/api';
import { withAuth } from '../../lib/withAuth';

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

function OutfitCard({ outfit, onDelete, onRetry }) {
  const [expanded, setExpanded] = useState(false);
  const [editingLang, setEditingLang] = useState(null);

  const ruReady = outfit.translations?.ru?.status === 'ready';
  const enReady = outfit.translations?.en?.status === 'ready';
  const hasError = ['ru', 'en'].some((l) => ['error', 'pending'].includes(outfit.translations?.[l]?.status));
  const canExpand = ruReady || enReady;

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
        <div className="border-t border-zinc-800 p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
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
  );
}

export default function AdminPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadItems, setUploadItems] = useState([]); // [{name, status, duplicate}]
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

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-serif tracking-wide">FFE Admin</h1>
        <div className="flex items-center gap-4">
          <a href="/admin/stats" className="text-sm text-zinc-400 hover:text-white transition-colors">Статистика</a>
          <a href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">← Галерея</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">

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
          return (
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <h2 className="text-lg font-medium text-zinc-300">Образы</h2>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-zinc-400">{total} всего</span>
                <span className="text-emerald-400">{ready} готово</span>
                {pending > 0 && <span className="text-zinc-400">{pending} в обработке</span>}
                {error > 0 && <span className="text-rose-400">{error} с ошибкой</span>}
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

        {data?.outfits && (
          <div className="space-y-3">
            {data.outfits.map((outfit) => (
              <OutfitCard
                key={outfit.id}
                outfit={outfit}
                onDelete={handleDelete}
                onRetry={handleRetry}
              />
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
