import { RotateCcw, Share2, Check, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'next-i18next/pages';

const FALLBACK = {
  'result.title': 'Шифр разгадан',
  'result.subtitle': 'Ты только что прочитала этот образ изнутри.',
  'result.perfect': 'Безупречно — ты мыслишь как стилист. ✨',
  'result.good': 'Три слоя из пяти — взгляд, которому есть куда расти.',
  'result.keep_trying': 'Язык моды раскрывается постепенно — играй ещё.',
  'share': 'Поделиться результатом',
  'copied': 'Скопировано!',
  'restart': 'Сыграть заново',
  'next': 'Следующий образ',
  'shareText': 'Разгадала шифр на {{score}}/{{total}} 🖤\nА ты умеешь его читать?\n{{url}}',
};

const Confetti = () => {
  const colors = ['#10b981', '#3b82f6', '#f43f5e', '#f59e0b', '#8b5cf6', '#ffffff'];
  const pieces = Array.from({ length: 70 }).map((_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    animationDelay: `${Math.random() * 3}s`,
    backgroundColor: colors[Math.floor(Math.random() * colors.length)],
    width: `${Math.random() * 8 + 4}px`,
    height: `${Math.random() * 12 + 6}px`,
    rotate: `${Math.random() * 360}deg`,
  }));

  return (
    <div className="absolute inset-0 pointer-events-none z-[200] overflow-hidden rounded-[inherit]">
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-100px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }
        }
        .confetti-piece { animation: confetti-fall 3.5s linear infinite; }
      `}</style>
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute -top-10 confetti-piece"
          style={{
            left: p.left,
            width: p.width,
            height: p.height,
            backgroundColor: p.backgroundColor,
            animationDelay: p.animationDelay,
            transform: `rotate(${p.rotate})`,
          }}
        />
      ))}
    </div>
  );
};

export default function ResultScreen({ score, total, outfitId, onRestart, onNext }) {
  const { t: tRaw, i18n } = useTranslation('common');
  const t = (key, vars) => { const v = tRaw(key, vars); return v === key ? (FALLBACK[key] ?? key) : v; };
  const [isCopied, setIsCopied] = useState(false);
  const perfect = score === total;

  const getShareUrl = () => {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://ffe-blush.vercel.app';
    const lang = i18n?.language;
    const prefix = lang === 'en' ? '/en' : '';
    return outfitId ? `${base}${prefix}/outfit/${outfitId}` : base;
  };

  const handleShare = () => {
    const url = getShareUrl();
    const text = t('shareText', { score, total, url });
    if (navigator.share) {
      navigator.share({ text, url }).catch(() => {});
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch {}
    document.body.removeChild(ta);
  };

  const getMessage = () => {
    if (score === total) return t('result.perfect');
    if (score >= 3) return t('result.good');
    return t('result.keep_trying');
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4 relative">
      {perfect && <Confetti />}
      <div className="w-full bg-zinc-900 rounded-2xl p-6 text-center border border-zinc-800 shadow-2xl mx-auto max-w-md relative z-10">
        <h1 className="text-2xl font-serif mb-2">{t('result.title')}</h1>
        <p className="text-zinc-400 mb-6">{t('result.subtitle')}</p>
        <div className={`text-6xl font-light mb-2 ${perfect ? 'text-emerald-400' : 'text-white'}`}>
          {score} <span className="text-2xl text-zinc-500">/ {total}</span>
        </div>
        <p className={`mb-8 font-medium ${perfect ? 'text-emerald-400' : 'text-zinc-400'}`}>
          {getMessage()}
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleShare}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-lg font-medium hover:bg-emerald-500 transition-colors"
          >
            {isCopied ? <Check size={20} /> : <Share2 size={20} />}
            {isCopied ? t('copied') : t('share')}
          </button>
          {onNext && (
            <button
              onClick={onNext}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 text-zinc-200 py-3 rounded-lg font-medium hover:bg-zinc-700 transition-colors border border-zinc-700"
            >
              <ArrowRight size={20} /> {t('next')}
            </button>
          )}
          <button
            onClick={onRestart}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800/50 text-zinc-500 py-2.5 rounded-lg font-medium hover:bg-zinc-700 hover:text-zinc-200 transition-colors text-sm"
          >
            <RotateCcw size={16} /> {t('restart')}
          </button>
        </div>
      </div>
    </div>
  );
}
