import { useState, useRef } from 'react';
import useSWR, { mutate } from 'swr';
import { Upload, Trash2, RefreshCw, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { adminFetcher, apiPost, apiDelete } from '../../lib/api';
import { withAuth } from '../../lib/withAuth';

const STATUS_ICON = {
  ready: <CheckCircle2 size={14} className="text-emerald-400" />,
  pending: <Clock size={14} className="text-zinc-400 animate-spin" />,
  error: <XCircle size={14} className="text-rose-400" />,
};

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
    <div className="mt-3 space-y-2">
      <textarea
        value={rows}
        onChange={(e) => setRows(e.target.value)}
        className="w-full h-48 bg-zinc-950 text-zinc-300 text-xs font-mono p-3 rounded-lg border border-zinc-700 resize-y"
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

export default function AdminPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [expandedRows, setExpandedRows] = useState({});
  const fileRef = useRef(null);

  const toggleRows = (id, lang) => {
    const key = `${id}-${lang}`;
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const { data, isLoading } = useSWR('/api/admin/outfits', adminFetcher, {
    refreshInterval: 5000,
  });

  const handleUpload = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('image', file);
      await apiPost('/api/admin/upload', form);
      mutate('/api/admin/outfits');
    } catch (err) {
      setUploadError(err.message || 'Ошибка загрузки');
    } finally {
      setUploading(false);
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
        <a href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">
          ← Галерея
        </a>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">

        {/* Upload zone */}
        <div
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200 mb-10 ${
            isDragging
              ? 'border-zinc-400 bg-zinc-900'
              : 'border-zinc-700 hover:border-zinc-500'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleUpload(e.dataTransfer.files[0]);
          }}
        >
          <Upload size={32} className="mx-auto mb-3 text-zinc-500" />
          <p className="text-zinc-300 mb-2">Перетащите изображение или</p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors border border-zinc-700 text-sm disabled:opacity-50"
          >
            {uploading ? 'Загружаю…' : 'Выбрать файл'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files[0])}
          />
          {uploadError && <p className="mt-3 text-rose-400 text-sm">{uploadError}</p>}
        </div>

        {/* Outfits list */}
        <h2 className="text-lg font-medium mb-4 text-zinc-300">Образы</h2>

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
              <div
                key={outfit.id}
                className="flex items-center gap-4 bg-zinc-900 rounded-xl p-4 border border-zinc-800"
              >
                <img
                  src={outfit.thumb_url || outfit.image_url}
                  alt=""
                  className="w-14 h-14 object-cover rounded-lg shrink-0 bg-zinc-800"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">
                    {outfit.title || outfit.id}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {(['ru', 'en']).map((lang) => {
                      const t = outfit.translations?.[lang];
                      const status = t?.status || 'pending';
                      const key = `${outfit.id}-${lang}`;
                      return (
                        <button
                          key={lang}
                          onClick={() => status === 'ready' && toggleRows(outfit.id, lang)}
                          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                          title={status === 'ready' ? 'Просмотр/редактирование рядов' : status}
                        >
                          {STATUS_ICON[status]} {lang.toUpperCase()}
                          {status === 'ready' && (expandedRows[key] ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                        </button>
                      );
                    })}
                  </div>
                  {(['ru', 'en']).map((lang) => {
                    const key = `${outfit.id}-${lang}`;
                    const rows = outfit.translations?.[lang]?.game_rows;
                    return expandedRows[key] && rows ? (
                      <RowsEditor key={key} outfitId={outfit.id} lang={lang} initialRows={rows} />
                    ) : null;
                  })}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/outfit/${outfit.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 text-zinc-400 hover:text-white transition-colors"
                    title="Открыть"
                  >
                    <Edit3 size={16} />
                  </a>
                  {(outfit.translations?.ru?.status === 'error' || outfit.translations?.en?.status === 'error') && (
                    <button
                      onClick={() => handleRetry(outfit.id)}
                      className="p-2 text-zinc-400 hover:text-yellow-400 transition-colors"
                      title="Повторить анализ"
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(outfit.id)}
                    className="p-2 text-zinc-400 hover:text-rose-400 transition-colors"
                    title="Удалить"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
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
