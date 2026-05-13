import { useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useTranslation } from 'next-i18next/pages';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import GameCard from '../../components/GameCard';
import ViewSwitcher from '../../components/ViewSwitcher';
import { fetcher } from '../../lib/api';

const FRAME_CLASS = {
  mobile: 'w-[375px] max-w-[95vw] h-[812px] max-h-[85vh] border-[8px] border-zinc-800 rounded-[2rem] shadow-2xl shrink-0',
  tablet: 'w-[768px] max-w-[95vw] h-[1024px] max-h-[85vh] border-[12px] border-zinc-800 rounded-[2rem] shadow-2xl shrink-0',
  desktop: 'w-full min-h-screen',
};

export default function OutfitPage() {
  const { query } = useRouter();
  const { id } = query;
  const { i18n } = useTranslation('common');
  const [viewFormat, setViewFormat] = useState('mobile');

  const { data, error } = useSWR(
    id ? `/api/outfit/${id}?lang=${i18n.language}` : null,
    fetcher,
    { refreshInterval: (d) => (!d || !d.game_rows ? 3000 : 0) }
  );

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

  return (
    <div className={`min-h-screen bg-black flex flex-col items-center ${!isDesktop ? 'justify-center p-2 pt-20' : 'pt-20'} font-sans relative overflow-hidden`}>
      <ViewSwitcher value={viewFormat} onChange={setViewFormat} />

      <div className={`transition-all duration-500 bg-zinc-950 overflow-y-auto overflow-x-hidden relative flex flex-col ${frameClass}`}>
        <GameCard
          imageSrc={data.image_url}
          gameData={data.game_rows}
          outfitId={id}
          isMobile={isMobile}
          isDesktop={isDesktop}
        />
      </div>
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
