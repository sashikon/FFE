import { useState, useRef, useEffect } from 'react';
import { CheckCircle2, XCircle, ArrowRight, ZoomIn, Upload } from 'lucide-react';
import { useTranslation } from 'next-i18next/pages';
import { fetcher } from '../lib/api';

// Convert raw Cloudinary URL to browser-friendly format (f_auto converts palette PNG → WebP/JPEG)
function optimizeCloudinaryUrl(url, width = 700) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width}/`);
}

const FALLBACK = {
  'game.title': 'НАЙДИ ЛИШНЕЕ',
  'game.outfitAlt': 'Образ',
  'game.zoomHint': 'Нажмите для увеличения',
  'game.uploadPhoto': 'Загрузить своё фото',
  'game.instruction': 'Одно слово — чужое. Найди его',
  'game.instructionEmphasis': '',
  'game.correct': 'Точно!',
  'game.wrong': 'Не угадала. Лишнее — ',
  'game.firstHint': 'нажми на него',
  'game.next': 'Следующий слой',
  'game.finish': 'Раскрыть шифр',
  'game.visual.theme': 'Предмет',
  'game.visual.instruction': 'Один предмет — лишний. Найди и убери его:',
  'game.visual.correct': 'Верно —',
  'game.visual.tapHint': 'нажми на лишний предмет чтобы убрать',
  'game.visual.next': 'Следующий слой',
  'game.visual.sketchHint': 'Это исходный эскиз',
  'game.render.theme': 'Образ',
  'game.render.instruction': 'Найди ИИ рендер этого образа:',
  'game.render.correct': 'Верно — ты видишь язык образа',
  'game.render.correctBody': 'Семиотика считывается даже через ИИ-интерпретацию',
  'game.render.sketchHint': 'Это исходный эскиз',
};
import ImageViewer from './ImageViewer';
import ProgressBar from './ProgressBar';
import ResultScreen from './ResultScreen';

const COLOR_MAP = {
  // RU
  'алый': '#C0392B', 'антрацит': '#2C2C2E', 'бежевый': '#C8A882',
  'белый': '#F5F5F0', 'бордовый': '#7B1A2E', 'графит': '#4A4A4A',
  'графитовый': '#4A4A4A', 'красный': '#D32F2F', 'монохром': '#6B6B6B',
  'пастель': '#E8D0C4', 'песочный': '#C2A46A', 'пудровый': '#E8C4B8',
  'пурпурный': '#7B2D8B', 'тёмно-серый': '#555555', 'тёмный': '#222222',
  'уголь': '#2C2C2C', 'чёрный': '#1A1A1A',
  // EN
  'anthracite': '#2C2C2E', 'beige': '#C8A882', 'black': '#1A1A1A',
  'burgundy': '#7B1A2E', 'camel': '#C19A6B', 'charcoal': '#36454F',
  'coral': '#E8735A', 'crimson': '#DC143C', 'dark': '#222222',
  'fuchsia': '#CC2E8A', 'graphite': '#4A4A4A', 'grey': '#808080',
  'ivory': '#F5F0E8', 'khaki': '#8B8560', 'monochrome': '#6B6B6B',
  'neon': '#39FF14', 'neon pink': '#FF6EC7', 'neutral': '#9B9B9B',
  'noir': '#1A1A1A', 'nude': '#E3C9AE', 'onyx': '#353839',
  'pastel': '#E8D0C4', 'sand': '#C2A46A', 'tan': '#D2B48C', 'taupe': '#8B8682',
  'white': '#F5F5F0',
};

const COLOR_THEMES = new Set(['цвет', 'color', 'colour']);

const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export default function GameCard({ imageSrc: initialImageSrc, svgLayers, renders, gameData, outfitId, isMobile, isDesktop, onNext }) {
  const { t: tRaw, i18n } = useTranslation('common');
  const t = (key) => { const v = tRaw(key); return v === key ? (FALLBACK[key] ?? key) : v; };

  // Visual level — shown before word rounds when outfit has a marked wrong SVG item
  const wrongSvgLayer = svgLayers?.find((l) => l.is_wrong);
  const visualLayers = svgLayers?.filter((l) => l.label && l.label.toLowerCase() !== 'образ') ?? [];
  const hasVisualLevel = !!wrongSvgLayer && visualLayers.filter((l) => !l.is_wrong).length >= 1;
  const [visualDone, setVisualDone] = useState(false);
  const [shakeId, setShakeId] = useState(null);
  const [removedId, setRemovedId] = useState(null);
  const [showVisualResult, setShowVisualResult] = useState(false);

  const handleSvgTap = (layer) => {
    if (removedId || showVisualResult) return;
    if (layer.is_wrong) {
      setRemovedId(layer.id);
      setTimeout(() => setShowVisualResult(true), 450);
    } else {
      setShakeId(layer.id);
      setTimeout(() => setShakeId(null), 420);
    }
  };

  // Render level — shown after all word rounds when outfit has renders
  const correctRender = renders?.[0] ?? null;
  const hasRenderLevel = !!correctRender;
  const [renderChoices, setRenderChoices] = useState(null); // null = not started
  const [renderSelected, setRenderSelected] = useState(null);
  const [renderShake, setRenderShake] = useState(null);
  const [renderLevelDone, setRenderLevelDone] = useState(false);

  const startRenderLevel = async () => {
    const BASE = process.env.NEXT_PUBLIC_API_URL || '';
    const data = await fetch(`${BASE}/api/renders/random?exclude=${outfitId}&count=3`).then((r) => r.json());
    const distractors = data.renders || [];
    if (distractors.length === 0) {
      // No other renders to compare against — skip render level
      setRenderLevelDone(true);
      setIsGameOver(true);
      return;
    }
    const choices = shuffleArray([correctRender, ...distractors]);
    setRenderChoices(choices);
  };

  const handleRenderTap = (render) => {
    if (renderSelected) return;
    if (render.id === correctRender.id) {
      setRenderSelected(render.id);
    } else {
      setRenderShake(render.id);
      setTimeout(() => setRenderShake(null), 420);
    }
  };

  const [currentStep, setCurrentStep] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState(() => optimizeCloudinaryUrl(initialImageSrc));
  const [stepResults, setStepResults] = useState(new Array(gameData.length).fill(null));
  const [shuffledOptions, setShuffledOptions] = useState(() => shuffleArray(gameData[0].options));
  const explanationRef = useRef(null);

  const currentData = gameData[currentStep];
  const isAnswered = selectedOption !== null;
  const isCorrect = selectedOption === currentData?.correct;

  useEffect(() => {
    setShuffledOptions(shuffleArray(gameData[currentStep].options));
  }, [currentStep, gameData]);

  useEffect(() => {
    if (isAnswered && explanationRef.current) {
      setTimeout(() => explanationRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
    }
  }, [isAnswered]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') return;
      if (e.key === 'Enter' && isAnswered && !isGameOver) { handleNext(); return; }
      if (!isAnswered && !isGameOver) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= shuffledOptions.length) handleOptionClick(shuffledOptions[num - 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAnswered, isGameOver, shuffledOptions, currentStep]);

  const handleOptionClick = (option) => {
    if (isAnswered) return;
    const correct = option === currentData.correct;
    setSelectedOption(option);
    if (correct) setScore((s) => s + 1);
    setStepResults((prev) => {
      const next = [...prev];
      next[currentStep] = correct;
      return next;
    });
  };

  const saveSession = (finalResults, finalScore) => {
    const answers = finalResults.map((correct, i) => ({ row_index: i, correct: !!correct }));
    const BASE = process.env.NEXT_PUBLIC_API_URL || '';

    let session_id = null;
    try {
      session_id = localStorage.getItem('ffe_session_id');
      if (!session_id) {
        session_id = crypto.randomUUID();
        localStorage.setItem('ffe_session_id', session_id);
      }
    } catch {}

    fetch(`${BASE}/api/game/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outfit_id: outfitId, lang: i18n.language || 'ru', score: finalScore, total: gameData.length, answers, session_id }),
    }).then((r) => {
      if (!r.ok) r.text().then((t) => console.error('[saveSession] error', r.status, t));
    }).catch((e) => console.error('[saveSession] fetch failed', e));
  };

  const handleNext = () => {
    if (currentStep < gameData.length - 1) {
      setCurrentStep((s) => s + 1);
      setSelectedOption(null);
    } else {
      const finalResults = stepResults.map((r, i) => i === currentStep ? selectedOption === currentData.correct : r);
      const finalScore = finalResults.filter(Boolean).length;
      saveSession(finalResults, finalScore);
      if (hasRenderLevel && !renderLevelDone) {
        startRenderLevel();
      } else {
        setIsGameOver(true);
      }
    }
  };

  const handleRestart = () => {
    setCurrentStep(0);
    setScore(0);
    setSelectedOption(null);
    setStepResults(new Array(gameData.length).fill(null));
    setIsGameOver(false);
    setShuffledOptions(shuffleArray(gameData[0].options));
  };

  const [showComingSoon, setShowComingSoon] = useState(false);

  const handleUploadClick = (e) => {
    e.stopPropagation();
    setShowComingSoon(true);
    setTimeout(() => setShowComingSoon(false), 2500);
  };

  const getButtonStyles = (option) => {
    if (!isAnswered) return 'bg-white hover:bg-zinc-200 text-zinc-950 border-zinc-200 shadow-sm';
    if (option === currentData.correct) return 'bg-emerald-900/50 border-emerald-500 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.2)]';
    if (option === selectedOption) return 'bg-rose-900/50 border-rose-500 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.2)]';
    return 'bg-zinc-800/30 border-zinc-800 text-zinc-600 opacity-40 cursor-not-allowed';
  };

  if (isGameOver) {
    return <ResultScreen score={score} total={gameData.length} outfitId={outfitId} onRestart={handleRestart} onNext={onNext} />;
  }

  // Render level — shown after word rounds, before result screen
  if (hasRenderLevel && renderChoices && !renderLevelDone) {
    return (
      <>
        <style>{`
          @keyframes renderShake {
            0%,100%{transform:translateX(0)}
            20%{transform:translateX(-8px)}
            50%{transform:translateX(8px)}
            80%{transform:translateX(-5px)}
          }
        `}</style>
        <ImageViewer src={imageSrc} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        <div className={`mx-auto max-w-6xl w-full flex flex-col items-center ${isMobile ? 'py-5 px-4' : 'py-12 px-6'}`}>
          <header className={`${isMobile ? 'sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md w-[calc(100%+2rem)] -mt-5 pt-4 pb-3 px-4 mb-5 border-b border-zinc-800/80' : 'mb-8'} text-center flex flex-col items-center w-full`}>
            <h1 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-serif ${isMobile ? 'mb-1' : 'mb-2'} tracking-wide`}>
              {t('game.title')}
            </h1>
            <ProgressBar total={gameData.length + 1} current={gameData.length} results={[...stepResults, null]} isAnswered={false} isMobile={isMobile} />
          </header>

          <div className={`w-full grid ${isDesktop ? 'grid-cols-12 gap-8' : 'grid-cols-1 gap-4'} items-start`}>
            {/* Sketch panel */}
            <div className={`${isDesktop ? 'col-span-5 sticky top-8' : ''} bg-zinc-900 ${isMobile ? 'rounded-2xl p-4' : 'rounded-2xl p-6'} border border-zinc-800 shadow-xl flex flex-col items-center`}>
              <div
                className={`w-full ${isMobile ? 'max-w-[200px]' : 'max-w-sm'} aspect-[3/4] bg-zinc-950/50 rounded-xl overflow-hidden relative border border-zinc-800 cursor-pointer group mx-auto`}
                onClick={() => setIsModalOpen(true)}
              >
                <img src={imageSrc} alt={t('game.outfitAlt')}
                  className="w-full h-full object-contain absolute inset-0 p-2 transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => { e.target.src = 'https://placehold.co/600x800/18181b/e4e4e7?text=Изображение+не+найдено'; }}
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center rounded-xl">
                  <ZoomIn className={`text-white ${isMobile ? 'w-10 h-10' : 'w-12 h-12'}`} />
                </div>
              </div>
              {!isMobile && (
                <p className="mt-3 text-xs text-zinc-600 italic text-center">{t('game.render.sketchHint')}</p>
              )}
            </div>

            {/* Render choice panel */}
            <div className={`${isDesktop ? 'col-span-7' : ''} flex flex-col w-full`}>
              <div className={`bg-zinc-900 ${isMobile ? 'rounded-2xl p-5' : 'rounded-2xl p-8'} border border-zinc-800 shadow-xl`}>
                <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-medium text-zinc-200 ${isMobile ? 'mb-2' : 'mb-3'} text-center`}>
                  {t('game.render.theme')}
                </h2>
                <p className={`text-zinc-400 text-center italic border-b border-zinc-800 ${isMobile ? 'pb-3 mb-4 text-[13px]' : 'pb-4 mb-6 text-sm'}`}>
                  {t('game.render.instruction')}
                </p>

                {renderSelected ? (
                  <div className="animate-in fade-in duration-500">
                    <div className={`${isMobile ? 'p-4' : 'p-5'} rounded-xl border bg-emerald-950/30 border-emerald-900/50 ${isMobile ? 'mb-5' : 'mb-6'}`}>
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className={`${isMobile ? 'w-5 h-5' : 'w-6 h-6'} text-emerald-500 shrink-0 mt-0.5`} />
                        <div>
                          <h3 className={`font-medium ${isMobile ? 'text-sm' : 'text-base'} mb-1 text-emerald-400`}>
                            {t('game.render.correct')}
                          </h3>
                          <p className={`text-zinc-300 ${isMobile ? 'text-xs leading-snug' : 'text-sm leading-relaxed'}`}>
                            {t('game.render.correctBody')}
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => { setRenderLevelDone(true); setIsGameOver(true); }}
                      className={`w-full flex items-center justify-center gap-2 bg-zinc-100 text-zinc-900 ${isMobile ? 'py-3 text-sm' : 'py-3.5 text-base'} rounded-lg font-semibold hover:bg-white transition-colors`}
                    >
                      {t('game.finish')} <ArrowRight className={isMobile ? 'w-4 h-4' : 'w-5 h-5'} />
                    </button>
                  </div>
                ) : (
                  <div className={`grid grid-cols-2 ${isMobile ? 'gap-3' : 'gap-4'}`}>
                    {renderChoices.map((render) => (
                      <button
                        key={render.id}
                        onClick={() => handleRenderTap(render)}
                        style={{
                          animation: renderShake === render.id ? 'renderShake 0.42s ease' : 'none',
                        }}
                        className="rounded-xl overflow-hidden border border-zinc-700 hover:border-zinc-500 active:scale-95 transition-all aspect-[3/4] bg-zinc-800 relative"
                      >
                        <img
                          src={render.thumb_url || render.image_url}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => { e.target.src = 'https://placehold.co/300x400/18181b/e4e4e7?text=?'; }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (hasVisualLevel && !visualDone) {
    return (
      <>
        <style>{`
          @keyframes svgShake {
            0%,100%{transform:translateX(0)}
            20%{transform:translateX(-8px)}
            50%{transform:translateX(8px)}
            80%{transform:translateX(-5px)}
          }
          @keyframes svgFlyOut {
            to{transform:translateY(-24px) scale(0.75);opacity:0}
          }
        `}</style>
        <ImageViewer src={imageSrc} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        <div className={`mx-auto max-w-6xl w-full flex flex-col items-center ${isMobile ? 'py-5 px-4' : 'py-12 px-6'}`}>
          <header className={`${isMobile ? 'sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md w-[calc(100%+2rem)] -mt-5 pt-4 pb-3 px-4 mb-5 border-b border-zinc-800/80' : 'mb-8'} text-center flex flex-col items-center w-full`}>
            <h1 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-serif ${isMobile ? 'mb-1' : 'mb-2'} tracking-wide`}>
              {t('game.title')}
            </h1>
            <ProgressBar total={gameData.length} current={-1} results={new Array(gameData.length).fill(null)} isAnswered={false} isMobile={isMobile} />
          </header>

          <div className={`w-full grid ${isDesktop ? 'grid-cols-12 gap-8' : 'grid-cols-1 gap-4'} items-start`}>
            {/* Image panel — same as word game */}
            <div className={`${isDesktop ? 'col-span-5 sticky top-8' : ''} bg-zinc-900 ${isMobile ? 'rounded-2xl p-4' : 'rounded-2xl p-6'} border border-zinc-800 shadow-xl flex flex-col items-center`}>
              <div
                className={`w-full ${isMobile ? 'max-w-[200px]' : 'max-w-sm'} aspect-[3/4] bg-zinc-950/50 rounded-xl overflow-hidden relative border border-zinc-800 cursor-pointer group mx-auto`}
                onClick={() => setIsModalOpen(true)}
              >
                <img
                  src={imageSrc}
                  alt={t('game.outfitAlt')}
                  className="w-full h-full object-contain absolute inset-0 p-2 transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => { e.target.src = 'https://placehold.co/600x800/18181b/e4e4e7?text=Изображение+не+найдено'; }}
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center rounded-xl">
                  <ZoomIn className={`text-white ${isMobile ? 'w-10 h-10' : 'w-12 h-12'}`} />
                </div>
              </div>
            </div>

            {/* Visual level panel */}
            <div className={`${isDesktop ? 'col-span-7' : ''} flex flex-col w-full`}>
              <div className={`bg-zinc-900 ${isMobile ? 'rounded-2xl p-5' : 'rounded-2xl p-8'} border border-zinc-800 shadow-xl`}>
                <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-medium text-zinc-200 ${isMobile ? 'mb-2' : 'mb-3'} text-center`}>
                  {t('game.visual.theme')}
                </h2>
                <p className={`text-zinc-400 text-center italic border-b border-zinc-800 ${isMobile ? 'pb-3 mb-4 text-[13px]' : 'pb-4 mb-6 text-sm'}`}>
                  {t('game.visual.instruction')}
                </p>

                {showVisualResult ? (
                  <div className="animate-in fade-in duration-500">
                    <div className={`${isMobile ? 'p-4' : 'p-5'} rounded-xl border bg-emerald-950/30 border-emerald-900/50 ${isMobile ? 'mb-5' : 'mb-6'}`}>
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className={`${isMobile ? 'w-5 h-5' : 'w-6 h-6'} text-emerald-500 shrink-0 mt-0.5`} />
                        <div>
                          <h3 className={`font-medium ${isMobile ? 'text-sm' : 'text-base'} mb-1 text-emerald-400`}>
                            {t('game.visual.correct')} {(i18n.language === 'en' && wrongSvgLayer.label_en) ? wrongSvgLayer.label_en : wrongSvgLayer.label}
                          </h3>
                          {(wrongSvgLayer.wrong_reason || wrongSvgLayer.wrong_reason_en) && (
                            <p className={`text-zinc-300 ${isMobile ? 'text-xs leading-snug' : 'text-sm leading-relaxed'}`}>
                              {i18n.language === 'en'
                                ? (wrongSvgLayer.wrong_reason_en || wrongSvgLayer.wrong_reason)
                                : wrongSvgLayer.wrong_reason}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setVisualDone(true)}
                      className={`w-full flex items-center justify-center gap-2 bg-zinc-100 text-zinc-900 ${isMobile ? 'py-3 text-sm' : 'py-3.5 text-base'} rounded-lg font-semibold hover:bg-white transition-colors`}
                    >
                      {t('game.visual.next')} <ArrowRight className={isMobile ? 'w-4 h-4' : 'w-5 h-5'} />
                    </button>
                  </div>
                ) : (
                  <>
                  <p className={`text-center text-zinc-600 ${isMobile ? 'text-[11px] mb-3' : 'text-xs mb-4'} flex items-center justify-center gap-1`}>
                    <span>👆</span> {t('game.visual.tapHint')}
                  </p>
                  <div className={`grid grid-cols-2 ${isMobile ? 'gap-3' : 'gap-4'}`}>
                    {visualLayers.map((layer) => (
                      <button
                        key={layer.id}
                        onClick={() => handleSvgTap(layer)}
                        style={{
                          animation: shakeId === layer.id
                            ? 'svgShake 0.42s ease'
                            : removedId === layer.id
                              ? 'svgFlyOut 0.45s ease forwards'
                              : 'none',
                          pointerEvents: removedId === layer.id ? 'none' : 'auto',
                        }}
                        className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                          removedId === layer.id
                            ? 'border-emerald-600 bg-emerald-950/30'
                            : 'border-zinc-700 bg-zinc-800/60 hover:border-zinc-500 active:scale-95'
                        }`}
                      >
                        <img
                          src={layer.svg_url}
                          alt={layer.label}
                          className={`object-contain ${isMobile ? 'w-16 h-20' : 'w-24 h-28'}`}
                        />
                        <span className={`text-zinc-300 text-center leading-tight ${isMobile ? 'text-[11px]' : 'text-xs'}`}>
                          {(i18n.language === 'en' && layer.label_en) ? layer.label_en : layer.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ImageViewer src={imageSrc} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      <div className={`mx-auto max-w-6xl w-full flex flex-col items-center ${isMobile ? 'py-5 px-4' : 'py-12 px-6'}`}>

        {/* Header */}
        <header className={`${isMobile ? 'sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md w-[calc(100%+2rem)] -mt-5 pt-4 pb-3 px-4 mb-5 border-b border-zinc-800/80' : 'mb-8'} text-center flex flex-col items-center w-full`}>
          <h1 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-serif ${isMobile ? 'mb-1' : 'mb-2'} tracking-wide`}>
            {t('game.title')}
          </h1>
          {!isMobile && (
            <p className="text-zinc-400 text-sm mb-6 tracking-widest uppercase">{currentData.theme}</p>
          )}
          <ProgressBar
            total={gameData.length}
            current={currentStep}
            results={stepResults}
            isAnswered={isAnswered}
            isMobile={isMobile}
          />
        </header>

        {/* Content grid */}
        <div className={`w-full grid ${isDesktop ? 'grid-cols-12 gap-8' : 'grid-cols-1 gap-4'} items-start`}>

          {/* Image panel */}
          <div className={`${isDesktop ? 'col-span-5 sticky top-8' : ''} bg-zinc-900 ${isMobile ? 'rounded-2xl p-4' : 'rounded-2xl p-6'} border border-zinc-800 shadow-xl flex flex-col items-center`}>
            <div
              className={`w-full ${isMobile ? 'max-w-[200px]' : 'max-w-sm'} aspect-[3/4] bg-zinc-950/50 rounded-xl overflow-hidden relative border border-zinc-800 cursor-pointer group mx-auto`}
              onClick={() => setIsModalOpen(true)}
            >
              <img
                src={imageSrc}
                alt={t('game.outfitAlt')}
                className="w-full h-full object-contain absolute inset-0 p-2 transition-transform duration-500 group-hover:scale-105"
                onError={(e) => { e.target.src = 'https://placehold.co/600x800/18181b/e4e4e7?text=Изображение+не+найдено'; }}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center rounded-xl">
                <ZoomIn className={`text-white ${isMobile ? 'w-10 h-10' : 'w-12 h-12'}`} />
              </div>
              {isMobile && (
                <div className="absolute -bottom-3 -right-3 z-10">
                  <button
                    onClick={handleUploadClick}
                    className="p-3 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 shadow-xl"
                  >
                    <Upload size={16} />
                  </button>
                  {showComingSoon && (
                    <div className="absolute bottom-12 right-0 bg-zinc-700 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                      Скоро ✦
                    </div>
                  )}
                </div>
              )}
            </div>
            {!isMobile && (
              <div className="mt-4 flex flex-col items-center gap-3 w-full">
                <p className="text-zinc-500 text-sm italic flex items-center gap-2">
                  <ZoomIn size={14} /> {t('game.zoomHint')}
                </p>
                <div className="relative">
                  <button
                    onClick={handleUploadClick}
                    className="py-3 px-4 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg flex items-center gap-2 transition-colors border border-zinc-700"
                  >
                    <Upload size={14} /> <span>{t('game.uploadPhoto')}</span>
                    <span className="text-zinc-600 text-[10px]">скоро</span>
                  </button>
                  {showComingSoon && (
                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-zinc-700 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                      Функция появится совсем скоро ✦
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Game panel */}
          <div className={`${isDesktop ? 'col-span-7' : ''} flex flex-col w-full`}>
            <main key={currentStep} className={`bg-zinc-900 ${isMobile ? 'rounded-2xl p-5' : 'rounded-2xl p-8'} border border-zinc-800 shadow-xl`}>
              <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-medium text-zinc-200 ${isMobile ? 'mb-2' : 'mb-3'} text-center`}>
                {currentData.theme}
              </h2>

              {currentStep === 0 && !isAnswered ? (
                <div className={`flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-xl ${isMobile ? 'px-3 py-2.5 mb-4' : 'px-4 py-3 mb-6'} animate-in fade-in duration-500`}>
                  <span className={`shrink-0 ${isMobile ? 'text-base' : 'text-lg'}`}>👆</span>
                  <p className={`text-zinc-200 ${isMobile ? 'text-[12px] leading-snug' : 'text-sm leading-snug'}`}>
                    {t('game.instruction')} — <span className="text-zinc-400">{t('game.firstHint')}</span>
                  </p>
                </div>
              ) : (
                <p className={`text-zinc-500 text-center italic border-b border-zinc-800 ${isMobile ? 'pb-3 mb-4 text-[12px]' : 'pb-4 mb-6 text-xs'}`}>
                  {t('game.instruction')}
                </p>
              )}

              <div className={`grid grid-cols-2 ${isMobile ? 'gap-3 mb-5' : 'gap-4 mb-8'}`}>
                {shuffledOptions.map((option, idx) => {
                  const isColorRound = COLOR_THEMES.has(currentData?.theme?.toLowerCase());
                  const swatch = isColorRound ? COLOR_MAP[option.toLowerCase()] : null;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleOptionClick(option)}
                      disabled={isAnswered}
                      className={`relative overflow-hidden w-full ${isMobile ? 'px-2 py-3 text-[12px] leading-tight min-h-[60px]' : 'p-4 text-lg tracking-wide'} rounded-xl border transition-all duration-300 font-medium ${getButtonStyles(option)}`}
                    >
                      {isDesktop && !isAnswered && (
                        <span className="absolute top-2 left-2 text-[10px] font-mono text-zinc-400 border border-zinc-300 rounded px-1.5 py-0.5">
                          {idx + 1}
                        </span>
                      )}
                      <span className="w-full break-words hyphens-auto flex items-center justify-center gap-2 h-full" lang="ru">
                        {swatch && (
                          <span
                            className="shrink-0 rounded-full border border-white/20"
                            style={{ width: isMobile ? 14 : 18, height: isMobile ? 14 : 18, background: swatch }}
                          />
                        )}
                        {option}
                      </span>
                    </button>
                  );
                })}
              </div>

              {isAnswered && (
                <div ref={explanationRef} className="animate-in fade-in duration-500">
                  <div className={`${isMobile ? 'p-4' : 'p-5'} rounded-xl border ${isCorrect ? 'bg-emerald-950/30 border-emerald-900/50' : 'bg-rose-950/30 border-rose-900/50'} ${isMobile ? 'mb-5' : 'mb-6'}`}>
                    <div className="flex items-start gap-3">
                      {isCorrect
                        ? <CheckCircle2 className={`${isMobile ? 'w-5 h-5' : 'w-6 h-6'} text-emerald-500 shrink-0 mt-0.5`} />
                        : <XCircle className={`${isMobile ? 'w-5 h-5' : 'w-6 h-6'} text-rose-500 shrink-0 mt-0.5`} />
                      }
                      <div>
                        <h3 className={`font-medium ${isMobile ? 'text-sm' : 'text-base'} mb-1 ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isCorrect ? t('game.correct') : `${t('game.wrong')} ${currentData.correct}`}
                        </h3>
                        <p className={`text-zinc-300 ${isMobile ? 'text-xs leading-snug' : 'text-sm leading-relaxed'}`}>
                          {currentData.explanation}
                        </p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleNext}
                    className={`w-full flex items-center justify-center gap-2 bg-zinc-100 text-zinc-900 ${isMobile ? 'py-3 text-sm' : 'py-3.5 text-base'} rounded-lg font-semibold hover:bg-white transition-colors group`}
                  >
                    {currentStep === gameData.length - 1 ? t('game.finish') : t('game.next')}
                    {!isMobile && (
                      <span className="text-[10px] font-mono bg-zinc-300/50 text-zinc-700 rounded px-1.5 py-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        Enter ↵
                      </span>
                    )}
                    <ArrowRight className={isMobile ? 'w-4 h-4' : 'w-5 h-5'} />
                  </button>
                </div>
              )}
            </main>
          </div>

        </div>
      </div>
    </>
  );
}
