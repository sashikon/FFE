import { useState, useRef } from 'react';
import useSWR, { mutate } from 'swr';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import { Upload, Trash2, RefreshCw, CheckCircle2, XCircle, Clock, Edit3 } from 'lucide-react';
import { adminFetcher, apiPost, apiDelete } from '../../lib/api';

const STATUS_ICON = {
  ready: <CheckCircle2 size={14} className="text-emerald-400" />,
  pending: <Clock size={14} className="text-zinc-400 animate-spin" />,
  error: <XCircle size={14} className="text-rose-400" />,
};

export default function AdminPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileRef = useRef(null);

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
                      const status = outfit.translations?.[lang]?.status || 'pending';
                      return (
                        <span key={lang} className="flex items-center gap-1 text-xs text-zinc-500">
                          {STATUS_ICON[status]} {lang.toUpperCase()}
                        </span>
                      );
                    })}
                  </div>
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

export async function getServerSideProps({ locale }) {
  try {
    return {
      props: {
        ...(await serverSideTranslations(locale ?? 'ru', ['common'])),
      },
    };
  } catch {
    return { props: {} };
  }
}
