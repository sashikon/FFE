import { X } from 'lucide-react';
import { useEffect } from 'react';

export default function ImageViewer({ src, isOpen, onClose }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out"
      onClick={onClose}
    >
      <button
        className="absolute top-6 right-6 text-zinc-400 hover:text-white"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X size={32} />
      </button>
      <img
        src={src}
        alt="Увеличенный образ"
        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onError={(e) => { e.target.src = 'https://placehold.co/600x800/18181b/e4e4e7?text=Изображение+не+найдено'; }}
      />
    </div>
  );
}
