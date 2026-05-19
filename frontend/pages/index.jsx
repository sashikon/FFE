import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useTranslation } from 'next-i18next/pages';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import { fetcher } from '../lib/api';

export default function GalleryPage() {
  const { t, i18n } = useTranslation('common');
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [allOutfits, setAllOutfits] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const sentinelRef = useRef(null);

  const lang = i18n.language || 'ru';
  const { data, error, isLoading } = useSWR(
    `/api/outfits?lang=${lang}&page=${page}`,
    fetcher
  );

  useEffect(() => {
    setAllOutfits([]);
    setPage(1);
  }, [lang]);

  useEffect(() => {
    if (!data?.outfits) return;
    setAllOutfits((prev) => {
      const ids = new Set(prev.map((o) => o.id));
      const newOnes = data.outfits.filter((o) => !ids.has(o.id));
      return [...prev, ...newOnes];
    });
    setHasMore(data.total > (page * (data.outfits.length || 12)));
  }, [data]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) setPage((p) => p + 1);
  }, [isLoading, hasMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const toggleLang = () => {
    const next = i18n.language === 'ru' ? 'en' : 'ru';
    router.push(router.asPath, router.asPath, { locale: next });
  };

  const isRu = i18n.language === 'ru';
  const siteUrl = 'https://ffe-blush.vercel.app';

  const meta = isRu
    ? {
        title: 'Язык моды — расшифруй каждый образ | FFE',
        description:
          'Умеешь читать образы? Угадывай стилевые коды, тренируй модный глаз и проверяй интуицию в игре FFE. Каждый образ — это шифр. Сможешь его разгадать?',
      }
    : {
        title: 'The Language of Fashion — Decode Every Outfit | FFE',
        description:
          "Can you crack the fashion code? Browse outfits and test your style intuition in FFE's visual fashion game. Every look tells a story — find the word that doesn't belong.",
      };

  return (
    <>
      <Head>
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={siteUrl} />
        <link rel="alternate" hrefLang="ru" href={`${siteUrl}/ru`} />
        <link rel="alternate" hrefLang="en" href={`${siteUrl}/en`} />
        <link rel="alternate" hrefLang="x-default" href={siteUrl} />

        <meta property="og:type" content="website" />
        <meta property="og:url" content={siteUrl} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:image" content={`${siteUrl}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="FFE" />
        <meta property="og:locale" content={isRu ? 'ru_RU' : 'en_US'} />
        <meta property="og:locale:alternate" content={isRu ? 'en_US' : 'ru_RU'} />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <meta name="twitter:image" content={`${siteUrl}/og-image.png`} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                '@context': 'https://schema.org',
                '@type': 'WebSite',
                name: 'FFE',
                url: siteUrl,
                description: meta.description,
                inLanguage: ['ru', 'en'],
              },
              {
                '@context': 'https://schema.org',
                '@type': 'WebApplication',
                name: isRu ? 'FFE — Язык моды' : 'FFE — The Language of Fashion',
                url: siteUrl,
                description: meta.description,
                applicationCategory: 'Game',
                operatingSystem: 'Web',
                inLanguage: ['ru', 'en'],
                offers: {
                  '@type': 'Offer',
                  price: '0',
                  priceCurrency: 'USD',
                },
              },
            ]),
          }}
        />
      </Head>
      <div className="min-h-screen bg-black text-white font-sans">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-serif tracking-wide">FFE</h1>
          <button
            onClick={toggleLang}
            className="flex text-sm text-zinc-400 hover:text-white transition-colors border border-zinc-700 px-3 py-1.5 rounded-full"
          >
            {i18n.language === 'ru' ? 'EN' : 'RU'}
          </button>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-12">
          <div className="mb-10">
            <h2 className="text-4xl font-serif mb-3">{t('gallery.title')}</h2>
            <p className="text-zinc-400">{t('gallery.subtitle')}</p>
          </div>

          {error && (
            <p className="text-rose-400 text-center py-12">{t('gallery.error')}</p>
          )}

          {allOutfits.length === 0 && isLoading && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] bg-zinc-900 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {allOutfits.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {allOutfits.map((outfit) => (
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

          {hasMore && (
            <div ref={sentinelRef} className="mt-8 flex justify-center">
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
              ) : (
                <button
                  onClick={loadMore}
                  className="md:flex hidden px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors border border-zinc-700"
                >
                  {t('gallery.loadMore')}
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    </>
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
