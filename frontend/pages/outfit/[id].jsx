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
  const { i18n } = useTranslation('common');
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
        Ошибка загрузки образа
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
        <p className="text-zinc-400 text-sm">Анализируем образ, подождите…</p>
        <p className="text-zinc-600 text-xs">Страница обновится автоматически</p>
      </div>
    );
  }

  const isEn = i18n.language === 'en';
  const ogTitle = isEn ? 'The Language of Fashion — crack the code' : 'Язык моды — разгадай шифр';
  const ogDesc = isEn ? 'Every outfit is a secret code. Can you crack it?' : 'Каждый образ — это тайный шифр. Умеешь ли ты его читать?';
  const ogImage = data?.thumb_url || data?.image_url || 'https://ffe-blush.vercel.app/og-image.png';

  return (
    <>
      <Head>
        <title>{ogTitle}</title>
        <meta name="description" content={ogDesc} />
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDesc} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:url" content={`https://ffe-blush.vercel.app/outfit/${id}`} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={ogTitle} />
        <meta name="twitter:description" content={ogDesc} />
        <meta name="twitter:image" content={ogImage} />
      </Head>
    <div className={`min-h-screen bg-black flex flex-col items-center ${!isDesktop ? 'justify-center p-2 pt-20' : 'pt-20'} font-sans relative overflow-hidden`}>
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm z-50"
      >
        <ArrowLeft size={16} /> Галерея
      </button>
      <ViewSwitcher value={viewFormat} onChange={setViewFormat} />

      <div className={`transition-all duration-500 bg-zinc-950 overflow-y-auto overflow-x-hidden relative flex flex-col ${frameClass}`}>
        <GameCard
          imageSrc={data.image_url}
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
