import { Smartphone, Tablet, Monitor } from 'lucide-react';

const FORMATS = [
  ['mobile', Smartphone],
  ['tablet', Tablet],
  ['desktop', Monitor],
];

export default function ViewSwitcher({ value, onChange }) {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex gap-1 bg-zinc-800/90 backdrop-blur-md p-1.5 rounded-full border border-zinc-700 shadow-2xl">
      {FORMATS.map(([fmt, Icon]) => (
        <button
          key={fmt}
          onClick={() => onChange(fmt)}
          className={`p-2 rounded-full transition-all duration-300 ${
            value === fmt
              ? 'bg-zinc-100 text-zinc-900 shadow-sm scale-105'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
          }`}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}
