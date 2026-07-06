export default function ProgressBar({ total, current, results, isAnswered, isMobile }) {
  return (
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
  );
}
