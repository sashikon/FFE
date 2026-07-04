import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useTranslation } from 'next-i18next/pages';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import { ArrowLeft } from 'lucide-react';
import GameCard from '../../components/GameCard';
import ViewSwitcher from '../../components/ViewSwitcher';
import { fetcher } from '../../lib/api';

const FRAME_CLASS = {
  mobile: 'w-[375px] max-w-[95vw] h-[812px] max-h-[85vh] border-[8px] border-zinc-800 rounded-[2rem] shadow-2xl shrink-0',
  tablet: 'w-[768px] max-w-[95vw] h-[1024px] max-h-[85vh] border-[12px] border-zinc-800 rounded-[2rem] shadow-2xl shrink-0',
  desktop: 'w-full min-h-screen',
};

export default function OutfitPage() {
  const router = useRouter();
  const { query } = router;
  const { id } = query;
  const { t, i18n } = useTranslation('common');
  const [viewFormat, setViewFormat] = useState('mobile');

  const lang = i18n.language || 'ru';
  const { data, error } = useSWR(
    id ? `/api/outfit/${id}?lang=${lang}` : null,
    fetcher,
    { refreshInterval: (d) => (!d || !d.game_rows ? 3000 : 0) }
  );
  const { data: listData } = useSWR(`/api/outfits?lang=${lang}&page=1`, fetcher);

  const handleNext = () => {
    const others = (listData?.outfits || []).filter((o) => o.id !== id && o.status !== 'pending');
    if (!others.length) { router.push('/'); return; }
    const next = others[Math.floor(Math.random() * others.length)];
    router.push(`/outfit/${next.id}`);
  };

  const isMobile = viewFormat === 'mobile';
  const isDesktop = viewFormat === 'desktop';
  const frameClass = FRAME_CLASS[viewFormat];

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-rose-400">
        {t('outfit.errorLoading')}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-16 h-16 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!data.game_rows) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
        <p className="text-zinc-400 text-sm">{t('outfit.analyzing')}</p>
        <p className="text-zinc-600 text-xs">{t('outfit.autoRefresh')}</p>
      </div>
    );
  }

  const isRu = i18n.language === 'ru';
  const siteUrl = 'https://ffe-blush.vercel.app';
  const outfitTitle = data?.title;
  const outfitTitleEn = data?.title_en;

  const meta = isRu
    ? {
        title: outfitTitle
          ? `${outfitTitle} — расшифруй образ | FFE`
          : 'Расшифруй этот образ | FFE — Язык моды',
        description:
          'Одно слово лишнее — найдёшь его? Проверь свой стилевой слух в игре FFE и узнай, насколько хорошо ты говоришь на языке моды.',
      }
    : {
        title: outfitTitleEn
          ? `${outfitTitleEn} — Decode This Outfit | FFE`
          : 'Decode This Outfit | FFE — The Language of Fashion',
        description:
          "One word doesn't belong. Can you find it? Play FFE's fashion decoding game and see how well you speak the language of style.",
      };

  const canonicalUrl = `${siteUrl}/outfit/${id}`;
  const ogImage = data?.image_url || `${siteUrl}/og-image.png`;

  return (
    <>
      <Head>
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={canonicalUrl} />
        <link rel="alternate" hrefLang="ru" href={canonicalUrl} />
        <link rel="alternate" hrefLang="en" href={canonicalUrl} />
        <link rel="alternate" hrefLang="x-default" href={canonicalUrl} />

        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content="FFE" />
        <meta property="og:locale" content={isRu ? 'ru_RU' : 'en_US'} />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <meta name="twitter:image" content={ogImage} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                '@context': 'https://schema.org',
                '@type': 'BreadcrumbList',
                itemListElement: [
                  {
                    '@type': 'ListItem',
                    position: 1,
                    name: isRu ? 'Галерея' : 'Gallery',
                    item: `${siteUrl}${isRu ? '' : '/en'}`,
                  },
                  {
                    '@type': 'ListItem',
                    position: 2,
                    name: meta.title,
                    item: canonicalUrl,
                  },
                ],
              },
              {
                '@context': 'https://schema.org',
                '@type': 'ImageObject',
                contentUrl: data?.image_url,
                description: meta.description,
                name: meta.title,
                url: canonicalUrl,
              },
            ]),
          }}
        />
      </Head>
      <div className={`min-h-screen bg-black flex flex-col items-center ${!isDesktop ? 'justify-center p-2 pt-20' : 'pt-20'} font-sans relative overflow-hidden`}>
        <button
          onClick={() => router.push('/')}
          className="absolute top-4 left-4 flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm z-50"
        >
          <ArrowLeft size={16} /> {i18n.language === 'en' ? 'Gallery' : 'Галерея'}
        </button>
        <ViewSwitcher value={viewFormat} onChange={setViewFormat} />

        <div className={`transition-all duration-500 bg-zinc-950 overflow-y-auto overflow-x-hidden relative flex flex-col ${frameClass}`}>
          <GameCard
            imageSrc={data.image_url}
            svgLayers={data.svg_layers?.length > 0 ? data.svg_layers : undefined}
            renders={data.renders?.length > 0 ? data.renders : undefined}
            gameData={data.game_rows}
            outfitId={id}
            isMobile={isMobile}
            isDesktop={isDesktop}
            onNext={handleNext}
          />
        </div>
      </div>
    </>
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
