import { CheckCircle2, XCircle } from 'lucide-react';

export default function ProgressBar({ total, current, results, isAnswered, isMobile }) {
  const correctCount = results.filter(Boolean).length;
  const wrongCount = results.filter((r) => r === false).length;

  return (
    <div className="flex flex-col items-center w-full">
      <div className={`flex gap-2 justify-center ${isMobile ? 'mt-2' : ''}`}>
        {Array.from({ length: total }).map((_, idx) => {
          let bg = 'bg-zinc-800';
          const isPast = idx < current || (idx === current && isAnswered);
          if (isPast) {
            bg = results[idx]
              ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
              : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]';
          } else if (idx === current) {
            bg = 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.3)]';
          }
          return (
            <div
              key={idx}
              className={`${isMobile ? 'h-1.5 w-8' : 'h-1.5 w-12'} rounded-full transition-all duration-300 ${bg}`}
            />
          );
        })}
      </div>
      <div className="flex gap-4 mt-3 text-xs font-medium bg-zinc-900/50 px-3 py-1.5 rounded-full border border-zinc-800">
        <span className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 size={14} /> {correctCount}
        </span>
        <div className="w-px h-3 bg-zinc-700" />
        <span className="flex items-center gap-1.5 text-rose-400">
          <XCircle size={14} /> {wrongCount}
        </span>
      </div>
    </div>
  );
}
