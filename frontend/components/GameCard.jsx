import { useState, useRef, useEffect } from 'react';
import { CheckCircle2, XCircle, ArrowRight, ZoomIn, Upload } from 'lucide-react';
import { useTranslation } from 'next-i18next/pages';
import { fetcher } from '../lib/api';

const FALLBACK = {
  'game.title': 'НАЙДИ ЛИШНЕЕ',
  'game.outfitAlt': 'Анализируемый образ',
  'game.zoomHint': 'Нажмите для увеличения',
  'game.uploadPhoto': 'Загрузить фото',
  'game.instruction': 'Выберите слово, которое',
  'game.instructionEmphasis': 'не относится',
  'game.correct': 'Верно!',
  'game.wrong': 'Ошибка. Правильный ответ:',
  'game.next': 'Следующий ряд',
  'game.finish': 'Завершить анализ',
};
import ImageViewer from './ImageViewer';
import ProgressBar from './ProgressBar';
import ResultScreen from './ResultScreen';

const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export default function GameCard({ imageSrc: initialImageSrc, gameData, outfitId, isMobile, isDesktop, onNext }) {
  const { t: tRaw, i18n } = useTranslation('common');
  const t = (key) => { const v = tRaw(key); return v === key ? (FALLBACK[key] ?? key) : v; };
  const [currentStep, setCurrentStep] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState(initialImageSrc);
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
    fetch(`${BASE}/api/game/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outfit_id: outfitId, lang: i18n.language || 'ru', score: finalScore, total: gameData.length, answers }),
    }).catch(() => {});
  };

  const handleNext = () => {
    if (currentStep < gameData.length - 1) {
      setCurrentStep((s) => s + 1);
      setSelectedOption(null);
    } else {
      const finalResults = stepResults.map((r, i) => i === currentStep ? selectedOption === currentData.correct : r);
      const finalScore = finalResults.filter(Boolean).length;
      saveSession(finalResults, finalScore);
      setIsGameOver(true);
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

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) setImageSrc(URL.createObjectURL(file));
  };

  const getButtonStyles = (option) => {
    if (!isAnswered) return 'bg-white hover:bg-zinc-200 text-zinc-950 border-zinc-200 shadow-sm';
    if (option === currentData.correct) return 'bg-emerald-900/50 border-emerald-500 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.2)]';
    if (option === selectedOption) return 'bg-rose-900/50 border-rose-500 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.2)]';
    return 'bg-zinc-800/30 border-zinc-800 text-zinc-600 opacity-40 cursor-not-allowed';
  };

  if (isGameOver) {
    return <ResultScreen score={score} total={gameData.length} onRestart={handleRestart} onNext={onNext} />;
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
                <label
                  className="cursor-pointer absolute -bottom-3 -right-3 p-3 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 shadow-xl z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Upload size={16} />
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              )}
            </div>
            {!isMobile && (
              <div className="mt-4 flex flex-col items-center gap-3 w-full">
                <p className="text-zinc-500 text-sm italic flex items-center gap-2">
                  <ZoomIn size={14} /> {t('game.zoomHint')}
                </p>
                <label className="cursor-pointer py-3 px-4 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg flex items-center gap-2 transition-colors border border-zinc-700">
                  <Upload size={14} /> <span>{t('game.uploadPhoto')}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              </div>
            )}
          </div>

          {/* Game panel */}
          <div className={`${isDesktop ? 'col-span-7' : ''} flex flex-col w-full`}>
            <main key={currentStep} className={`bg-zinc-900 ${isMobile ? 'rounded-2xl p-5' : 'rounded-2xl p-8'} border border-zinc-800 shadow-xl`}>
              <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-medium text-zinc-200 ${isMobile ? 'mb-2' : 'mb-3'} text-center`}>
                {currentData.theme}
              </h2>
              <p className={`text-zinc-400 text-center italic border-b border-zinc-800 ${isMobile ? 'pb-3 mb-4 text-[13px]' : 'pb-4 mb-6 text-sm'}`}>
                {t('game.instruction')} <span className="font-semibold text-zinc-300">{t('game.instructionEmphasis')}</span>:
              </p>

              <div className={`grid grid-cols-2 ${isMobile ? 'gap-3 mb-5' : 'gap-4 mb-8'}`}>
                {shuffledOptions.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleOptionClick(option)}
                    disabled={isAnswered}
                    className={`relative overflow-hidden w-full ${isMobile ? 'px-2 py-3 text-[12px] leading-tight min-h-[60px]' : 'p-4 text-lg tracking-wide'} rounded-xl border transition-all duration-300 font-medium ${getButtonStyles(option)}`}
                  >
                    {!isMobile && !isAnswered && (
                      <span className="absolute top-2 left-2 text-[10px] font-mono text-zinc-400 border border-zinc-300 rounded px-1.5 py-0.5">
                        {idx + 1}
                      </span>
                    )}
                    <span className="w-full break-words hyphens-auto flex items-center justify-center h-full" lang="ru">
                      {option}
                    </span>
                  </button>
                ))}
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
