import { useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useTranslation } from 'next-i18next/pages';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import { fetcher } from '../lib/api';

export default function GalleryPage() {
  const { t, i18n } = useTranslation('common');
  const router = useRouter();
  const [page, setPage] = useState(1);

  const lang = i18n.language || 'ru';
  const { data, error, isLoading } = useSWR(
    `/api/outfits?lang=${lang}&page=${page}`,
    fetcher
  );

  const toggleLang = () => {
    const next = i18n.language === 'ru' ? 'en' : 'ru';
    router.push(router.asPath, router.asPath, { locale: next });
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-serif tracking-wide">FFE</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={toggleLang}
            className="text-sm text-zinc-400 hover:text-white transition-colors border border-zinc-700 px-3 py-1.5 rounded-full"
          >
            {i18n.language === 'ru' ? 'EN' : 'RU'}
          </button>
          <a
            href="/admin"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            {t('nav.admin')}
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h2 className="text-4xl font-serif mb-3">{t('gallery.title')}</h2>
          <p className="text-zinc-400">{t('gallery.subtitle')}</p>
        </div>

        {isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] bg-zinc-900 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-rose-400 text-center py-12">{t('gallery.error')}</p>
        )}

        {data?.outfits && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {data.outfits.map((outfit) => (
              <button
                key={outfit.id}
                onClick={() => router.push(`/outfit/${outfit.id}`)}
                className="group relative aspect-[3/4] bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-all duration-300"
              >
                <img
                  src={outfit.thumb_url || outfit.image_url}
                  alt={outfit.title || t('gallery.outfitAlt')}
                  className="w-full h-full object-contain p-2 transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                  <span className="text-sm font-medium text-white">{t('gallery.play')}</span>
                </div>
                {outfit.status === 'pending' && (
                  <div className="absolute top-2 right-2 bg-zinc-800/90 text-zinc-400 text-xs px-2 py-1 rounded-full">
                    {t('status.pending')}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {data?.total > data?.outfits?.length && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => setPage((p) => p + 1)}
              className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors border border-zinc-700"
            >
              {t('gallery.loadMore')}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export async function getStaticProps({ locale }) {
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
