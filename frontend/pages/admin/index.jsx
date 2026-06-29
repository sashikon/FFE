import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import useSWR, { mutate } from 'swr';
import { Upload, Trash2, RefreshCw, CheckCircle2, XCircle, Clock, ChevronUp, Save, Edit3, Eye, ImagePlus, Sparkles, Loader2, LayoutGrid, Camera } from 'lucide-react';
import { adminFetcher, apiPost, apiPatch, apiDelete } from '../../lib/api';
import { withAuth } from '../../lib/withAuth';

const AESTHETICS = [
  'Cocktail Party Outfit Ideas',
  'Gala & Formal Dresses',
  'Red Carpet Evening Gowns',
  'Evening Outfit Ideas',
  'Night Out Outfits',
  'Boardroom & Office Fashion',
  'Beach & Resort Outfits',
  'Wedding Guest Dresses',
  'Runway & Couture Looks',
  'Streetwear Fashion',
  'Sporty & Casual Outfits',
  'Party Outfit Ideas',
];

const STATUS_ICON = {
  ready: <CheckCircle2 size={14} className="text-emerald-400" />,
  pending: <Clock size={14} className="text-zinc-400 animate-spin" />,
  error: <XCircle size={14} className="text-rose-400" />,
};

function RowsTable({ rows }) {
  if (!Array.isArray(rows)) return null;
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="text-zinc-500 border-b border-zinc-800">
          <th className="text-left py-1 pr-3 font-normal w-28">Тема</th>
          <th className="text-left py-1 font-normal">Варианты (лишнее выделено)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-zinc-800/50">
            <td className="py-1.5 pr-3 text-zinc-400 align-top">{row.theme}</td>
            <td className="py-1.5">
              <div className="flex flex-wrap gap-1">
                {Array.isArray(row.options) && row.options.map((word, wi) => (
                  <span
                    key={wi}
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      word === row.correct
                        ? 'bg-rose-900/60 text-rose-300 line-through'
                        : 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {word}
                  </span>
                ))}
              </div>
              {row.explanation && (
                <p className="mt-1 text-zinc-600 italic">{row.explanation}</p>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RowsEditor({ outfitId, lang, initialRows }) {
  const [rows, setRows] = useState(JSON.stringify(initialRows, null, 2));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(rows);
      await apiPost(`/api/admin/outfit/${outfitId}/rows`, { lang, game_rows: parsed });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      mutate('/api/admin/outfits');
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={rows}
        onChange={(e) => setRows(e.target.value)}
        className="w-full h-40 bg-zinc-950 text-zinc-300 text-xs font-mono p-3 rounded-lg border border-zinc-700 resize-y"
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs rounded-lg transition-colors disabled:opacity-50"
      >
        <Save size={12} /> {saved ? 'Сохранено!' : saving ? 'Сохраняю…' : `Сохранить ${lang.toUpperCase()}`}
      </button>
    </div>
  );
}

function RenderCard({ render, onDelete, onAnalyzed, onPinterestMark }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [pExported, setPExported] = useState(render.pinterest_exported_at ?? null);
  const top = render.aesthetics?.top;

  const handleAnalyze = async (e) => {
    e.stopPropagation();
    setAnalyzing(true);
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/analyze`);
      onAnalyzed(render.id, data.aesthetics);
    } catch (err) {
      alert('Ошибка анализа: ' + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePinterestToggle = async (e) => {
    e.stopPropagation();
    const next = !pExported;
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/pinterest-mark`, { exported: next });
      setPExported(data.pinterest_exported_at);
      if (onPinterestMark) onPinterestMark(render.id, data.pinterest_exported_at);
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  };

  return (
    <div className="relative group flex flex-col gap-1.5" style={{ width: 72 }}>
      <div className="relative">
        <img
          src={render.thumb_url || render.image_url}
          alt=""
          className="w-[72px] h-[90px] object-cover rounded-lg bg-zinc-800 border border-zinc-700"
        />
        {analyzing ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
            <Loader2 size={16} className="animate-spin text-white" />
          </div>
        ) : !top ? (
          <button
            onClick={handleAnalyze}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 opacity-0 group-hover:opacity-100 rounded-lg transition-opacity text-white"
            title="Анализировать эстетику"
          >
            <Sparkles size={14} />
            <span className="text-[9px]">Анализ</span>
          </button>
        ) : (
          <button
            onClick={handleAnalyze}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-lg transition-opacity"
            title="Переанализировать"
          >
            <RefreshCw size={12} className="text-white/70" />
          </button>
        )}
        {top && !analyzing && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 rounded-b-lg overflow-hidden flex">
            <div className="bg-violet-500 h-full" style={{ width: `${top[0]?.score ?? 0}%` }} />
          </div>
        )}
        {/* Pinterest mark — top-left corner */}
        <button
          onClick={handlePinterestToggle}
          title={pExported
            ? `В Pinterest с ${new Date(pExported).toLocaleDateString('ru')} — нажми чтобы снять`
            : 'Отметить как загружено в Pinterest'}
          className={`absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold transition-all ${
            pExported
              ? 'bg-rose-600 text-white opacity-90'
              : 'bg-black/50 text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-rose-400'
          }`}
        >P</button>
      </div>

      {top?.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-[8px] text-zinc-600 w-2 shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-0.5 mb-0.5">
              <span className="text-[8px] text-zinc-400 truncate leading-tight" title={item.name}>
                {item.name.replace(/ Outfit Ideas| Dresses| Gowns| Looks| Fashion/, '')}
              </span>
              <span className="text-[8px] text-zinc-600 shrink-0">{item.score}</span>
            </div>
            <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${i === 0 ? 'bg-violet-500' : i === 1 ? 'bg-violet-700' : 'bg-violet-900'}`}
                style={{ width: `${item.score}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Tip({ text, children, width = 'w-52', side = 'top' }) {
  const pos = side === 'top'
    ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'
    : 'top-full left-1/2 -translate-x-1/2 mt-1.5';
  return (
    <div className="relative group/tip inline-flex">
      {children}
      <div className={`absolute ${pos} ${width} bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] leading-snug p-2 rounded-lg shadow-xl opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity duration-150 z-50 whitespace-normal text-center`}>
        {text}
      </div>
    </div>
  );
}

function WrongReasonEditor({ layer, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(layer.wrong_reason || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await apiPatch(`/api/admin/svg-layer/${layer.id}`, { wrong_reason: value });
    onSave(value);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="mt-3 bg-rose-950/30 border border-rose-800/50 rounded-lg px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-rose-400 font-semibold uppercase tracking-wider">
          Лишний предмет: {layer.label}
        </span>
        <button
          onClick={() => setEditing(e => !e)}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {editing ? 'отмена' : 'изменить'}
        </button>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 px-2 py-1.5 resize-none focus:outline-none focus:border-zinc-500"
            placeholder="Объясни почему этот предмет лишний в контексте образа…"
          />
          <button
            onClick={handleSave}
            disabled={saving || !value.trim()}
            className="self-end text-xs px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-200 rounded transition-colors disabled:opacity-40"
          >
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          {layer.wrong_reason || <span className="italic text-zinc-600">Объяснение не задано — нажми «изменить»</span>}
        </p>
      )}
    </div>
  );
}

const SVG_CATS = [
  { key: 'all', label: 'Все', keywords: null },
  { key: 'outfit', label: 'Образ', keywords: ['образ', 'outfit', 'look', 'total'] },
  { key: 'top', label: 'Верх', keywords: ['топ', 'блуза', 'рубашка', 'корсет', 'жакет', 'пиджак', 'свитер', 'кардиган', 'футболка', 'боди'] },
  { key: 'bottom', label: 'Низ', keywords: ['юбка', 'брюки', 'шорты', 'леггинсы', 'джинсы', 'палаццо', 'бермуды'] },
  { key: 'dress', label: 'Платье', keywords: ['платье', 'комбинезон', 'сарафан'] },
  { key: 'outer', label: 'Верхняя', keywords: ['пальто', 'куртка', 'плащ', 'тренч', 'шуба', 'бомбер', 'ветровка'] },
  { key: 'shoes', label: 'Обувь', keywords: ['ботинки', 'туфли', 'сапоги', 'кроссовки', 'мюли', 'лоферы', 'челси', 'мокасины', 'балетки', 'каблук', 'обувь'] },
  { key: 'acc', label: 'Аксессуары', keywords: ['перчатки', 'сумка', 'пояс', 'шарф', 'серьги', 'колье', 'браслет', 'кольцо', 'очки', 'шляпа', 'шапка', 'берет', 'аксессуар'] },
];

function getItemCategory(label) {
  const l = label.toLowerCase();
  for (const cat of SVG_CATS) {
    if (!cat.keywords) continue;
    if (cat.keywords.some((kw) => l.includes(kw))) return cat.key;
  }
  return 'all';
}

function SvgLibraryPicker({ outfitId, existingUrls, onAdd, onClose }) {
  const [items, setItems] = useState(null);
  const [adding, setAdding] = useState(null);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    adminFetcher('/api/admin/svg-layers/library').then((d) => {
      setItems(d.items.filter((i) => !existingUrls.has(i.svg_url)));
    });
  }, []);

  const handlePick = async (item) => {
    setAdding(item.id);
    try {
      const data = await apiPost(`/api/admin/outfit/${outfitId}/svg-layers/from-library`, {
        svg_url: item.svg_url,
        label: item.label,
      });
      onAdd(data.layer);
      onClose();
    } catch (e) {
      alert('Ошибка: ' + e.message);
      setAdding(null);
    }
  };

  const visibleTabs = items
    ? SVG_CATS.filter((cat) =>
        cat.key === 'all' ||
        items.some((i) => getItemCategory(i.label) === cat.key)
      )
    : [SVG_CATS[0]];

  const filtered = items
    ? (activeTab === 'all' ? items : items.filter((i) => getItemCategory(i.label) === activeTab))
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <span className="text-sm font-medium text-zinc-200">Выбрать из загруженных</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 pt-2.5 pb-0 overflow-x-auto shrink-0 scrollbar-none">
          {visibleTabs.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveTab(cat.key)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs transition-colors whitespace-nowrap ${
                activeTab === cat.key
                  ? 'bg-zinc-100 text-zinc-900 font-medium'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-3 pt-2.5">
          {!items && <p className="text-xs text-zinc-600 text-center py-6">Загружаю…</p>}
          {items && filtered.length === 0 && (
            <p className="text-xs text-zinc-600 text-center py-6">Нет предметов в этой категории</p>
          )}
          {filtered.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handlePick(item)}
                  disabled={adding === item.id}
                  className="flex flex-col items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 rounded-xl p-2 transition-colors disabled:opacity-50"
                >
                  <img src={item.svg_url} alt={item.label} className="w-14 h-16 object-contain" />
                  <span className="text-[10px] text-zinc-300 text-center leading-tight truncate w-full">{item.label}</span>
                  <span className="text-[9px] text-zinc-600 truncate w-full text-center">{item.outfit_title || '—'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SvgLayersSection({ outfitId, initialLayers }) {
  const [layers, setLayers] = useState(initialLayers || []);
  const [pending, setPending] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editingEnId, setEditingEnId] = useState(null);
  const [editLabelEn, setEditLabelEn] = useState('');
  const [translating, setTranslating] = useState(false);
  const fileRef = useRef(null);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const data = await apiPost(`/api/admin/outfit/${outfitId}/svg-layers/analyze`, {});
      setLayers((prev) => prev.map((l) => ({
        ...l,
        is_wrong: l.id === data.wrong_layer_id,
        wrong_reason: l.id === data.wrong_layer_id ? data.reason : l.wrong_reason,
        wrong_source: l.id === data.wrong_layer_id ? 'ai' : null,
      })));
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleToggleWrong = async (layer) => {
    const next = !layer.is_wrong;
    await apiPatch(`/api/admin/svg-layer/${layer.id}`, {
      is_wrong: next,
      wrong_source: next ? 'manual' : null,
    });
    setLayers((prev) => prev.map((l) => ({
      ...l,
      is_wrong: l.id === layer.id ? next : (next ? false : l.is_wrong),
      wrong_source: l.id === layer.id ? (next ? 'manual' : null) : (next ? null : l.wrong_source),
    })));
  };

  const handleFilePick = (files) => {
    const svgFiles = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.svg') || f.type === 'image/svg+xml');
    if (!svgFiles.length) return;
    setPending(svgFiles.map((f) => ({ file: f, label: f.name.replace(/\.svg$/i, '') })));
    fileRef.current && (fileRef.current.value = '');
  };

  const handleUpload = async () => {
    if (!pending.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      pending.forEach((p, i) => {
        form.append('svg', p.file);
        form.append('labels', p.label || p.file.name.replace(/\.svg$/i, ''));
        form.append('orders', String(layers.length + i));
      });
      const data = await apiPost(`/api/admin/outfit/${outfitId}/svg-layers`, form);
      setLayers((prev) => [...prev, ...data.layers].sort((a, b) => a.sort_order - b.sort_order));
      setPending([]);
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    await apiDelete(`/api/admin/svg-layer/${id}`);
    setLayers((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSaveLabel = async (id) => {
    await apiPatch(`/api/admin/svg-layer/${id}`, { label: editLabel });
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, label: editLabel } : l));
    setEditingId(null);
  };

  const handleSaveLabelEn = async (id) => {
    await apiPatch(`/api/admin/svg-layer/${id}`, { label_en: editLabelEn });
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, label_en: editLabelEn } : l));
    setEditingEnId(null);
  };

  const handleTranslateLabels = async () => {
    setTranslating(true);
    try {
      const data = await apiPost(`/api/admin/outfit/${outfitId}/svg-layers/translate`, {});
      if (data.layers) {
        const enMap = Object.fromEntries(data.layers.map(l => [l.id, l.label_en]));
        setLayers(prev => prev.map(l => ({ ...l, label_en: enMap[l.id] ?? l.label_en })));
      }
    } catch (e) {
      alert('Ошибка перевода: ' + e.message);
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          SVG-слои ({layers.length})
        </span>
        <div className="flex items-center gap-3">
          {layers.filter(l => l.label).length >= 2 && (
            <>
              <Tip side="top" width="w-52" text="Claude переводит названия предметов на EN — для английской версии игры">
                <button
                  onClick={handleTranslateLabels}
                  disabled={translating}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                >
                  {translating ? <Loader2 size={11} className="animate-spin" /> : <span className="text-[10px]">EN</span>}
                  {translating ? 'Перевожу…' : 'Перевести'}
                </button>
              </Tip>
              <Tip side="top" width="w-60" text="Claude смотрит на эскиз образа и определяет, какой предмет из списка семиотически не вписывается — по силуэту, детали или стилю. Результат можно исправить вручную">
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors disabled:opacity-50"
                >
                  {analyzing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {analyzing ? 'Анализирую…' : 'Найти лишний'}
                </button>
              </Tip>
            </>
          )}
          <Tip text="Выбрать SVG из уже загруженных предметов других образов — без повторной загрузки файла">
            <button
              onClick={() => setShowLibrary(true)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <LayoutGrid size={12} /> Выбрать
            </button>
          </Tip>
          <Tip text="Загрузить новый SVG-файл предмета с диска">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50"
          >
            <Upload size={12} /> Загрузить
          </button>
          </Tip>
        </div>
        <input ref={fileRef} type="file" accept=".svg,image/svg+xml" multiple className="hidden"
          onChange={(e) => handleFilePick(e.target.files)} />
        {showLibrary && (
          <SvgLibraryPicker
            outfitId={outfitId}
            existingUrls={new Set(layers.map(l => l.svg_url))}
            onAdd={(layer) => setLayers((prev) => [...prev, layer])}
            onClose={() => setShowLibrary(false)}
          />
        )}
      </div>

      {/* Pending files — label before upload */}
      {pending.length > 0 && (
        <div className="mb-4 bg-zinc-800/50 rounded-xl p-3 space-y-2 border border-zinc-700">
          <p className="text-[11px] text-zinc-400 mb-2">Назови каждый предмет перед загрузкой:</p>
          {pending.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-600 w-4 shrink-0">{i + 1}</span>
              <span className="text-[10px] text-zinc-500 truncate w-24 shrink-0">{p.file.name}</span>
              <input
                value={p.label}
                onChange={(e) => setPending((prev) => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                placeholder="платье, обувь, леггинсы…"
                className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-white placeholder-zinc-600 outline-none focus:border-zinc-400"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex items-center gap-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {uploading ? <><Loader2 size={11} className="animate-spin" /> Загружаю…</> : `Загрузить ${pending.length} файл${pending.length > 1 ? 'а' : ''}`}
            </button>
            <button onClick={() => setPending([])} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">отмена</button>
          </div>
        </div>
      )}

      {/* Uploaded layers */}
      {layers.length === 0 && pending.length === 0 ? (
        <p className="text-xs text-zinc-600 italic">Нет SVG-слоёв — загрузи файлы предметов одежды</p>
      ) : layers.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {layers.map((layer) => (
            <div key={layer.id} className={`relative group flex flex-col items-center rounded-lg p-2 w-20 border transition-colors ${layer.is_wrong ? 'bg-rose-950/40 border-rose-700' : 'bg-zinc-800/60 border-transparent'}`}
              title={layer.is_wrong && layer.wrong_reason ? layer.wrong_reason : undefined}>
              <span className="absolute top-1 left-1.5 text-[9px] text-zinc-600 leading-none">{layer.sort_order}</span>
              <div className="absolute top-1 right-1 flex items-center gap-1">
                {layer.is_wrong && <span className="text-[9px] text-rose-400 font-bold leading-none">✕</span>}
                <button
                  onClick={() => handleDelete(layer.id)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 transition-all"
                >
                  <Trash2 size={10} />
                </button>
              </div>
              {layer.is_wrong && layer.wrong_source && (
                <Tip
                  side="top"
                  width="w-56"
                  text={layer.wrong_source === 'ai'
                    ? 'Помечено ИИ — Claude проанализировал эскиз образа и определил этот предмет как семиотически чужеродный'
                    : 'Помечено вручную — предмет специально загружен или выбран как ловушка для игровой механики'}
                >
                  <span className={`absolute bottom-1 left-1 text-[8px] font-medium px-1 py-0.5 rounded leading-none cursor-default ${
                    layer.wrong_source === 'ai'
                      ? 'bg-violet-900/80 text-violet-300'
                      : 'bg-amber-900/80 text-amber-300'
                  }`}>
                    {layer.wrong_source === 'ai' ? 'ИИ' : 'вручную'}
                  </span>
                </Tip>
              )}
              <Tip text={layer.is_wrong ? 'Снять метку лишнего — предмет вернётся в состав образа' : 'Отметить как лишний — этот предмет станет целью в игровой механике'}>
                <button onClick={() => handleToggleWrong(layer)}>
                  <img src={layer.svg_url} alt={layer.label} className={`w-14 h-16 object-contain ${layer.is_wrong ? 'opacity-50' : ''}`} />
                </button>
              </Tip>
              <div className="w-full mt-1">
                {editingId === layer.id ? (
                  <input
                    autoFocus
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onBlur={() => handleSaveLabel(layer.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveLabel(layer.id)}
                    className="w-full bg-transparent text-white text-[10px] text-center outline-none border-b border-zinc-500"
                  />
                ) : (
                  <button
                    onClick={() => { setEditingId(layer.id); setEditLabel(layer.label); }}
                    className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 text-center truncate transition-colors"
                    title={layer.label || 'Нажми чтобы добавить название'}
                  >
                    {layer.label || '—'}
                  </button>
                )}
                {editingEnId === layer.id ? (
                  <input
                    autoFocus
                    value={editLabelEn}
                    onChange={(e) => setEditLabelEn(e.target.value)}
                    onBlur={() => handleSaveLabelEn(layer.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveLabelEn(layer.id)}
                    className="w-full bg-transparent text-blue-300 text-[9px] text-center outline-none border-b border-blue-700"
                  />
                ) : (
                  <button
                    onClick={() => { setEditingEnId(layer.id); setEditLabelEn(layer.label_en || ''); }}
                    className="w-full text-[9px] text-blue-500 hover:text-blue-300 text-center truncate transition-colors"
                    title="EN: нажми чтобы редактировать"
                  >
                    {layer.label_en || <span className="opacity-40">EN</span>}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Wrong item explanation — editable */}
      {(() => {
        const wrong = layers.find(l => l.is_wrong);
        if (!wrong) return null;
        return (
          <WrongReasonEditor
            key={wrong.id}
            layer={wrong}
            onSave={(reason) => setLayers(prev => prev.map(l => l.id === wrong.id ? { ...l, wrong_reason: reason } : l))}
          />
        );
      })()}
    </div>
  );
}

function RendersSection({ outfitId, initialRenders }) {
  const [renders, setRenders] = useState(initialRenders || []);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleUpload = async (files) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      imageFiles.forEach((f) => form.append('render', f));
      const data = await apiPost(`/api/admin/outfit/${outfitId}/renders`, form);
      setRenders((prev) => [...prev, ...data.renders]);
    } catch (e) {
      alert('Ошибка загрузки: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (renderId) => {
    await apiDelete(`/api/admin/render/${renderId}`);
    setRenders((prev) => prev.filter((r) => r.id !== renderId));
  };

  const handleAnalyzed = (renderId, aesthetics) => {
    setRenders((prev) => prev.map((r) => r.id === renderId ? { ...r, aesthetics } : r));
  };

  const handleAnalyzeAll = async () => {
    for (const r of renders.filter((r) => !r.aesthetics)) {
      try {
        const data = await apiPost(`/api/admin/render/${r.id}/analyze`);
        handleAnalyzed(r.id, data.aesthetics);
      } catch (e) {
        console.error('analyze failed', r.id, e);
      }
    }
  };

  const unanalyzed = renders.filter((r) => !r.aesthetics).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Рендеры ({renders.length})
        </span>
        <div className="flex items-center gap-3">
          {unanalyzed > 0 && (
            <button
              onClick={handleAnalyzeAll}
              className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              <Sparkles size={11} /> Анализ всех ({unanalyzed})
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50"
          >
            <ImagePlus size={12} /> {uploading ? 'Загружаю…' : 'Добавить'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => handleUpload(e.target.files)} />
      </div>
      {renders.length === 0 ? (
        <p className="text-xs text-zinc-600 italic">Нет рендеров</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {renders.map((r) => (
            <RenderCard key={r.id} render={r} onDelete={handleDelete} onAnalyzed={handleAnalyzed}
              onPinterestMark={(id, ts) => setRenders((prev) => prev.map((x) => x.id === id ? { ...x, pinterest_exported_at: ts } : x))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PinterestExportModal({ lang, onlyNew, rendersOnly, onClose, onExported }) {
  const [items, setItems] = useState(null); // null = loading
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ lang, ...(onlyNew ? { new: 'true' } : {}), ...(rendersOnly ? { renders: 'true' } : {}) });
    adminFetcher(`/api/admin/pinterest-preview?${params}`)
      .then((data) => {
        setItems(data.outfits || []);
        setSelected(new Set((data.outfits || []).map((o) => o.id)));
      })
      .catch((e) => alert('Ошибка загрузки превью: ' + e.message));
  }, [lang, onlyNew, rendersOnly]);

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((o) => o.id)));
  };

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleExport = async () => {
    if (!selected.size) return;
    setExporting(true);
    try {
      const BASE = process.env.NEXT_PUBLIC_API_URL || '';
      const token = process.env.NEXT_PUBLIC_ADMIN_TOKEN || '';
      const ids = [...selected].join(',');
      const params = new URLSearchParams({ lang, board: 'FFE', ids, ...(rendersOnly ? { renders: 'true' } : {}) });
      const res = await fetch(`${BASE}/api/admin/pinterest-export?${params}`, {
        headers: token ? { 'x-admin-token': token } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pinterest_${lang}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      onExported();
      onClose();
    } catch (e) {
      alert('Ошибка экспорта: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-700 w-full max-w-2xl flex flex-col shadow-2xl"
        style={{ maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-sm font-medium text-zinc-100">
              Экспорт Pinterest · {lang.toUpperCase()}
              {onlyNew && <span className="ml-2 text-xs text-emerald-400 border border-emerald-800 rounded px-1.5 py-0.5">только новые</span>}
              {rendersOnly && <span className="ml-2 text-xs text-violet-400 border border-violet-800 rounded px-1.5 py-0.5">ИИ рендеры</span>}
            </p>
            {items && (
              <p className="text-xs text-zinc-500 mt-0.5">
                {selected.size} из {items.length} образов выбрано
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none transition-colors">×</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-3">
          {!items && (
            <div className="flex items-center justify-center py-16 text-zinc-600">
              <Loader2 size={20} className="animate-spin mr-2" /> Загружаю список…
            </div>
          )}

          {items?.length === 0 && (
            <div className="text-center py-16 text-zinc-600">
              <p className="text-sm">Нет {rendersOnly ? 'рендеров' : 'образов'} для экспорта.</p>
              <p className="text-xs mt-1">
                {rendersOnly
                  ? 'Все ИИ рендеры уже отмечены как загруженные в Pinterest. Или рендеры ещё не загружены.'
                  : `Все готовые образы уже отмечены как загруженные в Pinterest ${lang.toUpperCase()}.`}
              </p>
            </div>
          )}

          {items?.length > 0 && (
            <>
              {/* Select all */}
              <label className="flex items-center gap-2 px-2 py-2 mb-1 text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors">
                <input
                  type="checkbox"
                  checked={selected.size === items.length}
                  onChange={toggleAll}
                  className="accent-rose-500"
                />
                {selected.size === items.length ? 'Снять все' : 'Выбрать все'}
              </label>

              <div className="space-y-1">
                {items.map((outfit) => {
                  const isSelected = selected.has(outfit.id);
                  const hasRender = !!(outfit.render_thumb || outfit.render_url);
                  return (
                    <label
                      key={outfit.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                        isSelected ? 'bg-zinc-800' : 'bg-zinc-900 opacity-50 hover:opacity-70'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(outfit.id)}
                        className="accent-rose-500 shrink-0"
                      />

                      {/* Sketch */}
                      <div className="shrink-0">
                        <img
                          src={outfit.thumb_url || outfit.image_url}
                          alt=""
                          className="w-10 h-12 object-cover rounded-lg bg-zinc-700"
                        />
                      </div>

                      {/* Arrow + render */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-zinc-700 text-xs">→</span>
                        {hasRender ? (
                          <div className="relative">
                            <img
                              src={outfit.render_thumb || outfit.render_url}
                              alt=""
                              className="w-10 h-12 object-cover rounded-lg bg-zinc-700 border border-violet-700"
                            />
                            <span className="absolute -bottom-1 -right-1 bg-violet-600 text-white text-[8px] rounded px-0.5 leading-tight">ИИ</span>
                          </div>
                        ) : (
                          <div className="w-10 h-12 rounded-lg bg-zinc-800 border border-dashed border-zinc-700 flex items-center justify-center">
                            <span className="text-[9px] text-zinc-600 text-center leading-tight px-0.5">нет рендера</span>
                          </div>
                        )}
                      </div>

                      {/* Title */}
                      <span className="flex-1 min-w-0 text-xs text-zinc-300 truncate">
                        {outfit.title || outfit.id}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {items?.length > 0 && (
          <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between shrink-0">
            <p className="text-xs text-zinc-600">
              После скачивания все выбранные {rendersOnly ? 'рендеры получат метку P на миниатюре' : `образы получат метку P·${lang.toUpperCase()}`}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-xs text-zinc-400 hover:text-white transition-colors">
                Отмена
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || !selected.size}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
              >
                <Upload size={12} />
                {exporting ? 'Готовлю…' : `Скачать CSV (${selected.size})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MechanicScreenshots({ mechanicKey }) {
  const { data, mutate } = useSWR('/api/admin/mechanic-screenshots', adminFetcher);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const shots = data?.screenshots?.[mechanicKey] ?? [];

  const handleUpload = async (files) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    setUploading(true);
    try {
      for (const file of imgs) {
        const form = new FormData();
        form.append('mechanic_key', mechanicKey);
        form.append('image', file);
        await apiPost('/api/admin/mechanic-screenshots', form);
      }
      mutate();
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      setUploading(false);
      fileRef.current && (fileRef.current.value = '');
    }
  };

  const handleDelete = async (id) => {
    await apiDelete(`/api/admin/mechanic-screenshot/${id}`);
    mutate();
  };

  return (
    <div className="mt-5 pl-14">
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="screenshot" className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl" />
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] text-zinc-600 uppercase tracking-wider">Скриншоты</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
        >
          <ImagePlus size={11} /> {uploading ? 'Загружаю…' : 'Добавить'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => handleUpload(e.target.files)} />
      </div>

      {shots.length === 0 && !uploading && (
        <p className="text-[11px] text-zinc-700 italic">Скриншотов пока нет — нажми «Добавить»</p>
      )}

      {shots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shots.map((s) => (
            <div key={s.id} className="relative group/shot">
              <img
                src={s.image_url}
                alt="screenshot"
                onClick={() => setLightbox(s.image_url)}
                className="h-28 w-auto rounded-lg border border-zinc-700 object-cover cursor-zoom-in hover:border-zinc-500 transition-colors"
              />
              <button
                onClick={() => handleDelete(s.id)}
                className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover/shot:opacity-100 transition-opacity hover:bg-rose-900"
              >
                <Trash2 size={9} className="text-zinc-300" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MechanicsBoard({ outfits }) {
  const total = outfits?.length ?? 0;
  const readyRu = outfits?.filter((o) => o.translations?.ru?.status === 'ready').length ?? 0;
  const withVisual = outfits?.filter((o) => o.svg_layers?.some((l) => l.is_wrong)).length ?? 0;
  const withSvg = outfits?.filter((o) => o.svg_layers?.length > 0).length ?? 0;

  const MECHANICS = [
    {
      num: '01',
      name: 'Словесные раунды',
      color: 'zinc',
      status: `${readyRu} из ${total} образов`,
      trigger: 'Автоматически когда статус RU = ready',
      description: '5 последовательных раундов по семиотическим слоям образа. В каждом — 4 слова, одно лишнее. Игрок находит его.',
      rounds: [
        { name: 'Форма', desc: 'Силуэт и конструкция — трапеция, футляр, буфы, складки' },
        { name: 'Детали', desc: 'Декоративные элементы, фурнитура, отделка' },
        { name: 'Цвет', desc: 'Цветовая семантика образа' },
        { name: 'Смысл', desc: 'Архетип и нарратив — doll-like, power, romantic' },
        { name: 'Ассоциации', desc: 'Культурные и контекстуальные коды' },
      ],
    },
    {
      num: '02',
      name: 'Цветовые свотчи',
      color: 'amber',
      status: `Все образы с раундом «Цвет»`,
      trigger: 'Автоматически в раунде с theme = "цвет" / "color"',
      description: 'В раунде цвета рядом с каждым словом-вариантом появляется цветной кружок. Визуальный якорь помогает соотнести название цвета с реальным оттенком.',
      rounds: [
        { name: 'Словарь', desc: '17 цветов RU + 25 EN → HEX (бежевый, графит, антрацит, ivory, taupe…)' },
        { name: 'Fallback', desc: 'Если цвет не в словаре — свотч не показывается, слово выводится как обычно' },
      ],
    },
    {
      num: '03',
      name: 'Визуальный уровень',
      color: 'violet',
      status: `${withVisual} из ${total} образов`,
      trigger: `Когда у образа есть SVG-слои и один отмечен is_wrong (сейчас ${withSvg} образов с SVG)`,
      description: 'Первый уровень перед словесными раундами. Показывает карточки предметов одежды (SVG). Один предмет — лишний. Игрок тапает его чтобы убрать из образа.',
      rounds: [
        { name: 'Правильный тап', desc: 'Карточка вылетает с анимацией → появляется объяснение почему лишний → кнопка перехода к раундам' },
        { name: 'Неправильный тап', desc: 'Карточка трясётся → попробуй снова' },
        { name: 'Данные', desc: 'SVG-слои с метками + is_wrong: true на лишнем предмете + wrong_reason (из Claude-анализа или вручную)' },
        { name: 'Подготовка', desc: 'Загрузи SVG предметов → кнопка «Найти лишний» или клик по карточке для ручной пометки' },
      ],
    },
  ];

  const colorMap = {
    zinc: { border: 'border-zinc-700', badge: 'bg-zinc-800 text-zinc-300', dot: 'bg-zinc-500', num: 'text-zinc-600' },
    amber: { border: 'border-amber-900/60', badge: 'bg-amber-950/60 text-amber-300', dot: 'bg-amber-500', num: 'text-amber-800' },
    violet: { border: 'border-violet-900/60', badge: 'bg-violet-950/60 text-violet-300', dot: 'bg-violet-500', num: 'text-violet-800' },
  };

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h2 className="text-lg font-medium text-zinc-300 mb-1">Игровые механики</h2>
        <p className="text-xs text-zinc-600">Что реализовано в игре и как включается</p>
      </div>

      {MECHANICS.map((m) => {
        const c = colorMap[m.color];
        return (
          <div key={m.num} className={`rounded-2xl border ${c.border} bg-zinc-900 p-6`}>
            <div className="flex items-start gap-4 mb-4">
              <span className={`text-4xl font-serif font-bold ${c.num} shrink-0 leading-none`}>{m.num}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h3 className="text-base font-semibold text-zinc-100">{m.name}</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${c.badge}`}>{m.status}</span>
                </div>
                <p className="text-[11px] text-zinc-600 mb-2">{m.trigger}</p>
                <p className="text-sm text-zinc-400 leading-relaxed">{m.description}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-14">
              {m.rounds.map((r) => (
                <div key={r.name} className="flex items-start gap-2">
                  <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                  <div>
                    <span className="text-xs text-zinc-300 font-medium">{r.name}</span>
                    <span className="text-xs text-zinc-600"> — {r.desc}</span>
                  </div>
                </div>
              ))}
            </div>
            <MechanicScreenshots mechanicKey={m.num} />
          </div>
        );
      })}
    </div>
  );
}

function CoverageBoard() {
  const { data, isLoading } = useSWR('/api/admin/coverage', adminFetcher);

  const byAesthetic = {};
  AESTHETICS.forEach((a) => { byAesthetic[a] = []; });
  (data?.renders || []).forEach((render) => {
    render.aesthetics?.top?.forEach((item, rank) => {
      if (byAesthetic[item.name]) byAesthetic[item.name].push({ ...render, rank, score: item.score });
    });
  });

  const total = data?.renders?.length ?? 0;

  return (
    <div>
      {/* Description */}
      <div className="mb-8 p-5 rounded-2xl bg-zinc-900 border border-zinc-800">
        <div className="flex items-start gap-3">
          <LayoutGrid size={18} className="text-violet-400 shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <p className="text-zinc-200 font-medium">Coverage — покрытие трендовых эстетик</p>
            <p className="text-zinc-400 leading-relaxed">
              Каждый ИИ рендер анализируется Claude Vision и относится к одной из 12 трендовых категорий Pinterest.
              Этот раздел показывает, какие эстетики уже охвачены контентом, а где дыры — туда нужно досъёмить.
            </p>
            <div className="pt-1 space-y-1 text-zinc-500 text-xs leading-relaxed">
              <p>
                <span className="text-zinc-300">Зачем это нужно для Pinterest:</span>{' '}
                Pinterest — поисковик визуального контента. Пользователи ищут именно по этим категориям:
                «Gala & Formal Dresses», «Streetwear Fashion», «Red Carpet Evening Gowns» и т.д.
                Чем шире покрытие эстетик — тем больше точек входа в аккаунт FFE из органического поиска.
              </p>
              <p>
                <span className="text-zinc-300">Как использовать:</span>{' '}
                Смотришь какие строки пустые или с малым числом → идёшь снимать рендеры именно в этой эстетике →
                загружаешь в карточку образа → запускаешь «Анализ» → рендер попадает в нужную строку здесь.
                Далее экспортируешь Pinterest CSV с этими рендерами.
              </p>
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 bg-zinc-900 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!isLoading && total === 0 && (
        <div className="text-center py-16 text-zinc-600">
          <Sparkles size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Нет проанализированных рендеров.</p>
          <p className="text-xs mt-1">Откройте карточку образа → наведите на рендер → нажмите «Анализ»</p>
        </div>
      )}

      {!isLoading && total > 0 && (<>
      <p className="text-xs text-zinc-600 mb-4">{total} рендеров проанализировано</p>
      <div className="space-y-2">
        {AESTHETICS.map((aesthetic) => {
          const primary = (byAesthetic[aesthetic] || []).filter((r) => r.rank === 0);
          const pct = total > 0 ? Math.round((primary.length / total) * 100) : 0;
          return (
            <div key={aesthetic} className="flex items-center gap-4 p-3 bg-zinc-900 rounded-xl border border-zinc-800">
              <div className="w-56 shrink-0">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-zinc-200 leading-tight">{aesthetic}</p>
                  <span className="text-xs text-zinc-600 ml-2 shrink-0">{primary.length}</span>
                </div>
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
              {primary.length === 0 ? (
                <p className="text-xs text-zinc-700 italic">—</p>
              ) : (
                <div className="flex gap-1.5 flex-wrap">
                  {primary.slice(0, 10).map((r) => (
                    <img key={r.id} src={r.thumb_url || r.image_url} alt="" className="w-9 h-11 object-cover rounded bg-zinc-800" title={r.title || r.outfit_id} />
                  ))}
                  {primary.length > 10 && <span className="text-xs text-zinc-600 self-center">+{primary.length - 10}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>)}
    </div>
  );
}

function RendersGallery({ outfits, onMutate }) {
  const [localRenders, setLocalRenders] = useState(() =>
    (outfits || []).flatMap((o) => (o.renders || []).map((r) => ({ ...r, outfit: o })))
  );
  const [filter, setFilter] = useState('all'); // 'all' | 'pinterest' | 'new'
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  // Sync when outfits data changes
  useEffect(() => {
    setLocalRenders(
      (outfits || []).flatMap((o) =>
        (o.renders || []).map((r) => ({ ...r, outfit: o }))
      )
    );
  }, [outfits]);

  const handleDelete = async (renderId) => {
    if (!confirm('Удалить рендер?')) return;
    await apiDelete(`/api/admin/render/${renderId}`);
    setLocalRenders((prev) => prev.filter((r) => r.id !== renderId));
    onMutate();
  };

  const handleAnalyzed = (renderId, aesthetics) => {
    setLocalRenders((prev) =>
      prev.map((r) => (r.id === renderId ? { ...r, aesthetics } : r))
    );
  };

  const handlePinterestMark = (renderId, ts) => {
    setLocalRenders((prev) =>
      prev.map((r) => (r.id === renderId ? { ...r, pinterest_exported_at: ts } : r))
    );
  };

  const handleArchiveImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const html = await file.text();
    // Parse pin blocks: split on pin URLs
    const blocks = html.split(/<a href="https:\/\/www\.pinterest\.com\/pin\/(\d+)\/"/).slice(1);
    const pins = [];
    const uuidRe = /\/outfit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    for (let i = 0; i < blocks.length; i += 2) {
      const pinId = blocks[i];
      const block = blocks[i + 1] || '';
      const boardMatch = block.match(/Board Name: ([^\n<]+)/);
      const canonicalMatch = block.match(/Canonical Link:[\s\S]*?href="([^"]+)"/);
      const board = boardMatch ? boardMatch[1].trim().replace(/&amp;/g, '&') : '';
      const canonical = canonicalMatch ? canonicalMatch[1] : '';
      const uuidMatch = canonical.match(uuidRe);
      if (uuidMatch) pins.push({ pin_id: pinId, board, outfit_id: uuidMatch[1] });
    }
    if (!pins.length) { alert('Пины не найдены в файле'); return; }
    setSyncing(true);
    setSyncResult(null);
    try {
      const data = await apiPost('/api/admin/pinterest/import-pins', { pins });
      setSyncResult(data);
      onMutate();
    } catch (e) {
      alert('Ошибка импорта: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleCsvSync = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    // Extract pin IDs from URLs like https://www.pinterest.com/pin/123456789/
    const pinIds = [...text.matchAll(/\/pin\/(\d+)\//g)].map((m) => m[1]);
    const unique = [...new Set(pinIds)];
    if (!unique.length) { alert('PIN ID не найдены в CSV'); return; }
    setSyncing(true);
    setSyncResult(null);
    try {
      const data = await apiPost('/api/admin/pinterest/sync', { pin_ids: unique });
      setSyncResult(data);
      if (data.matched > 0) {
        await apiPost('/api/admin/pinterest/fetch-analytics', {});
        onMutate();
      }
    } catch (e) {
      alert('Ошибка синхронизации: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleFetchAnalytics = async () => {
    setSyncing(true);
    try {
      const [r1, r2] = await Promise.all([
        apiPost('/api/admin/pinterest/fetch-analytics', {}),
        apiPost('/api/admin/pinterest/fetch-sketch-analytics', {}),
      ]);
      const err = r1.last_error || r2.last_error;
      if (err) alert('Pinterest API: ' + err);
      onMutate();
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const withPinId = localRenders.filter((r) => r.pinterest_pin_id).length;

  const pExported = localRenders.filter((r) => r.pinterest_exported_at).length;
  const notUploaded = localRenders.filter((r) => !r.pinterest_exported_at).length;

  const visible = filter === 'pinterest'
    ? localRenders.filter((r) => r.pinterest_exported_at)
    : filter === 'new'
    ? localRenders.filter((r) => !r.pinterest_exported_at)
    : localRenders;

  if (!localRenders.length) {
    return (
      <div className="text-center py-24 text-zinc-600">
        <ImagePlus size={40} className="mx-auto mb-4 opacity-20" />
        <p className="text-sm">Нет загруженных рендеров.</p>
        <p className="text-xs mt-1">Откройте карточку образа и загрузите ИИ рендеры.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-medium text-zinc-300">ИИ рендеры</h2>
        <button onClick={() => setFilter('all')} className={`text-sm px-2.5 py-0.5 rounded-full border transition-colors ${filter === 'all' ? 'border-zinc-500 text-zinc-200 bg-zinc-800' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}>{localRenders.length} всего</button>
        <button onClick={() => setFilter('pinterest')} className={`text-sm px-2.5 py-0.5 rounded-full border transition-colors ${filter === 'pinterest' ? 'border-rose-600 text-rose-300 bg-rose-950' : 'border-zinc-700 text-rose-500 hover:text-rose-400'}`}>{pExported} в Pinterest</button>
        <button onClick={() => setFilter('new')} className={`text-sm px-2.5 py-0.5 rounded-full border transition-colors ${filter === 'new' ? 'border-violet-600 text-violet-300 bg-violet-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}>{notUploaded} не загружено</button>
      </div>

      {/* Pinterest sync bar */}
      <div className="flex items-center gap-3 mb-6 p-3 bg-zinc-900 rounded-xl border border-zinc-800 flex-wrap">
        <span className="text-[11px] text-zinc-500 shrink-0">Pinterest</span>
        <span className="text-[11px] text-zinc-600">{withPinId} пинов связано</span>
        <div className="flex-1" />
        <Tip text="Загрузи HTML архив Pinterest (папка pins/0001.html) — автоматически привяжет все пины к образам и рендерам" width="w-72">
          <label className={`flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 transition-colors cursor-pointer ${syncing ? 'opacity-40 pointer-events-none' : ''}`}>
            {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Загрузить архив Pinterest
            <input type="file" accept=".html" className="hidden" onChange={handleArchiveImport} disabled={syncing} />
          </label>
        </Tip>
        {withPinId > 0 && (
          <Tip text="Обновить данные показов, кликов и сохранений за последние 90 дней" width="w-52">
            <button onClick={handleFetchAnalytics} disabled={syncing} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40">
              {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Обновить аналитику
            </button>
          </Tip>
        )}
        {syncResult && (
          <span className="text-[11px] text-emerald-400">
            {syncResult.sketch_updated !== undefined
              ? `✓ эскизы: ${syncResult.sketch_updated}, рендеры: ${syncResult.render_updated}`
              : `✓ ${syncResult.matched} из ${syncResult.total_pins} привязано`}
          </span>
        )}
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {visible.map((render) => (
          <GalleryRenderCard
            key={render.id}
            render={render}
            outfit={render.outfit}
            onDelete={handleDelete}
            onAnalyzed={handleAnalyzed}
            onPinterestMark={handlePinterestMark}
          />
        ))}
      </div>
    </div>
  );
}

function GalleryRenderCard({ render, outfit, onDelete, onAnalyzed, onPinterestMark }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [pExported, setPExported] = useState(render.pinterest_exported_at ?? null);
  const [aesthetics, setAesthetics] = useState(render.aesthetics);
  const stats = render.pinterest_analytics;
  const [model, setModel] = useState(render.model_appearance || null);
  const [pinTitle, setPinTitle] = useState(render.pin_title || '');
  const [pinDesc, setPinDesc] = useState(render.pin_description || '');
  const [generatingSeo, setGeneratingSeo] = useState(false);
  const [seoLang, setSeoLang] = useState('en');
  const [editingSeo, setEditingSeo] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const top = aesthetics?.top;

  const handleAnalyze = async (e) => {
    e.stopPropagation();
    setAnalyzing(true);
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/analyze`);
      setAesthetics(data.aesthetics);
      if (data.model_appearance) setModel(data.model_appearance);
      onAnalyzed(render.id, data.aesthetics);
    } catch (err) {
      alert('Ошибка анализа: ' + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerateSeo = async (lang) => {
    setGeneratingSeo(true);
    setSeoLang(lang);
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/generate-seo`, { lang });
      setPinTitle(data.pin_title || '');
      setPinDesc(data.pin_description || '');
    } catch (err) {
      alert('Ошибка SEO: ' + err.message);
    } finally {
      setGeneratingSeo(false);
    }
  };

  const handleSaveSeo = async () => {
    await apiPatch(`/api/admin/render/${render.id}/seo`, { pin_title: editTitle, pin_description: editDesc });
    setPinTitle(editTitle);
    setPinDesc(editDesc);
    setEditingSeo(false);
  };

  const [pinIdInput, setPinIdInput] = useState('');
  const [savingPinId, setSavingPinId] = useState(false);
  const [currentPinId, setCurrentPinId] = useState(render.pinterest_pin_id || '');

  const handleSavePinId = async () => {
    const raw = pinIdInput.trim();
    const m = raw.match(/\/pin\/(\d+)/);
    const pinId = m ? m[1] : raw.replace(/\D/g, '');
    if (!pinId) return;
    setSavingPinId(true);
    try {
      await apiPatch(`/api/admin/render/${render.id}/pin-id`, { pinterest_pin_id: pinId });
      setCurrentPinId(pinId);
      setPinIdInput('');
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      setSavingPinId(false);
    }
  };

  const handlePinterestToggle = async (e) => {
    e.stopPropagation();
    const next = !pExported;
    try {
      const data = await apiPost(`/api/admin/render/${render.id}/pinterest-mark`, { exported: next });
      setPExported(data.pinterest_exported_at);
      onPinterestMark(render.id, data.pinterest_exported_at);
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  };

  return (
    <div className="group relative flex flex-col gap-2 bg-zinc-900 rounded-2xl p-2 border border-zinc-800 hover:border-zinc-600 transition-colors">
      {/* Main render image */}
      <div className="relative overflow-hidden rounded-xl bg-zinc-800" style={{ aspectRatio: '3/4' }}>
        <img
          src={render.image_url}
          alt=""
          className="w-full h-full object-cover"
        />

        {/* Overlay buttons */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all rounded-xl" />

        {/* Analyze */}
        {analyzing ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black/70 rounded-xl px-3 py-2 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-violet-400" />
              <span className="text-xs text-zinc-300">Анализ…</span>
            </div>
          </div>
        ) : (
          <button
            onClick={handleAnalyze}
            className={`absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all z-10 ${
              top
                ? 'bg-violet-900/80 text-violet-300 opacity-0 group-hover:opacity-100 hover:bg-violet-800'
                : 'bg-black/70 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-violet-300'
            }`}
            title={top ? 'Переанализировать' : 'Анализировать эстетику'}
          >
            <Sparkles size={10} /> {top ? 'Заново' : 'Анализ'}
          </button>
        )}

        {/* Pinterest mark */}
        <button
          onClick={handlePinterestToggle}
          title={pExported
            ? `В Pinterest с ${new Date(pExported).toLocaleDateString('ru')} — нажми чтобы снять`
            : 'Отметить как загружено в Pinterest'}
          className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold transition-all z-10 ${
            pExported
              ? 'bg-rose-600 text-white'
              : 'bg-black/60 text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-rose-400'
          }`}
        >P</button>

        {/* Outfit sketch — bottom left */}
        <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <img
            src={outfit.thumb_url || outfit.image_url}
            alt=""
            className="w-8 h-8 object-cover rounded-lg border border-zinc-600 shadow-lg"
            title={outfit.title || outfit.id}
          />
        </div>
      </div>

      {/* Aesthetics */}
      {top ? (
        <div className="px-1 space-y-1">
          {top.slice(0, 2).map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="text-[9px] text-zinc-400 truncate leading-tight">
                    {item.name.replace(/ Outfit Ideas| Dresses| Gowns| Looks| Fashion/, '')}
                  </span>
                  <span className="text-[9px] text-zinc-600 shrink-0">{item.score}</span>
                </div>
                <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${i === 0 ? 'bg-violet-500' : 'bg-violet-800'}`}
                    style={{ width: `${item.score}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[9px] text-zinc-700 italic px-1">без анализа</p>
      )}

      {/* Model appearance */}
      {model && (
        <div className="px-1 border-t border-zinc-800 pt-1.5 flex items-center gap-1.5 flex-wrap">
          {model.has_face ? (
            <>
              <span className="text-[9px] text-zinc-400">{model.appearance}</span>
              {model.skin_tone && (
                <span className={`text-[8px] px-1 rounded ${model.skin_tone === 'light' ? 'bg-amber-950 text-amber-300' : model.skin_tone === 'medium' ? 'bg-orange-950 text-orange-300' : 'bg-zinc-800 text-zinc-300'}`}>{model.skin_tone}</span>
              )}
            </>
          ) : (
            <span className="text-[9px] text-zinc-600">без лица</span>
          )}
        </div>
      )}

      {/* Pinterest pin link input */}
      <div className="px-1 border-t border-zinc-800 pt-2">
        {currentPinId ? (
          <div className="flex items-center justify-between">
            <a href={`https://www.pinterest.com/pin/${currentPinId}/`} target="_blank" rel="noreferrer" className="text-[9px] text-rose-400 hover:text-rose-300 truncate">pin/{currentPinId.slice(-6)}</a>
            <button onClick={() => setCurrentPinId('')} className="text-[9px] text-zinc-600 hover:text-zinc-400 ml-1 shrink-0">×</button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <input
              value={pinIdInput}
              onChange={(e) => setPinIdInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSavePinId()}
              placeholder="ссылка на пин…"
              className="flex-1 bg-transparent text-[9px] text-zinc-400 placeholder-zinc-700 outline-none min-w-0"
            />
            {pinIdInput && (
              <button onClick={handleSavePinId} disabled={savingPinId} className="text-[9px] text-rose-400 hover:text-rose-300 shrink-0">
                {savingPinId ? '…' : '✓'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pinterest analytics */}
      {stats && (
        <div className="px-1 border-t border-zinc-800 pt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
          {[
            { label: 'показы', value: stats.impressions },
            { label: 'клики', value: stats.pin_clicks },
            { label: 'переходы', value: stats.outbound_clicks },
            { label: 'сохр.', value: stats.saves },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[9px] text-zinc-600">{label}</span>
              <span className="text-[10px] text-zinc-300 font-medium tabular-nums">{value ?? '—'}</span>
            </div>
          ))}
          {render.pinterest_analytics_updated_at && (
            <p className="col-span-2 text-[8px] text-zinc-700 mt-0.5">
              {new Date(render.pinterest_analytics_updated_at).toLocaleDateString('ru')}
            </p>
          )}
        </div>
      )}
      {!stats && render.pinterest_pin_id && (
        <div className="px-1 border-t border-zinc-800 pt-1.5">
          <p className="text-[9px] text-zinc-700">пин привязан · нажми «Обновить аналитику»</p>
        </div>
      )}

      {/* Pinterest SEO */}
      <div className="px-1 border-t border-zinc-800 pt-2">
        {editingSeo ? (
          <div className="space-y-1.5">
            <input
              autoFocus
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              placeholder="Title (до 100 символов)"
              maxLength={100}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-400"
            />
            <textarea
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Description (до 500 символов)"
              maxLength={500}
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-400 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={handleSaveSeo} className="text-[10px] px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded transition-colors">Сохранить</button>
              <button onClick={() => setEditingSeo(false)} className="text-[10px] text-zinc-500 hover:text-zinc-300">отмена</button>
            </div>
          </div>
        ) : pinTitle ? (
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-1">
              <p className="text-[10px] text-zinc-300 font-medium leading-tight flex-1">{pinTitle}</p>
              <button
                onClick={() => { setEditTitle(pinTitle); setEditDesc(pinDesc); setEditingSeo(true); }}
                className="shrink-0 text-[9px] text-zinc-600 hover:text-zinc-300 transition-colors"
              >ред.</button>
            </div>
            {pinDesc && <p className="text-[9px] text-zinc-500 leading-snug">{pinDesc}</p>}
            <div className="flex gap-2 pt-0.5">
              {['en', 'ru'].map(l => (
                <button key={l} onClick={() => handleGenerateSeo(l)} disabled={generatingSeo} className="text-[9px] text-zinc-600 hover:text-violet-400 transition-colors disabled:opacity-40">
                  {generatingSeo && seoLang === l ? <Loader2 size={9} className="animate-spin inline" /> : <Sparkles size={9} className="inline" />} {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-zinc-700">Pinterest SEO:</span>
            {['en', 'ru'].map(l => (
              <button key={l} onClick={() => handleGenerateSeo(l)} disabled={generatingSeo} className="flex items-center gap-0.5 text-[9px] text-zinc-500 hover:text-violet-400 transition-colors disabled:opacity-40">
                {generatingSeo && seoLang === l ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />} {l.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TranslateAllSvgLabelsButton({ outfits }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);

  const needsTranslation = (outfits || []).filter((o) =>
    o.svg_layers?.some((l) => l.label && !l.label_en)
  );

  const handleRun = async () => {
    if (!needsTranslation.length) return;
    setRunning(true);
    setDone(0);
    for (const o of needsTranslation) {
      try {
        await apiPost(`/api/admin/outfit/${o.id}/svg-layers/translate`, {});
        setDone((n) => n + 1);
      } catch {}
    }
    setRunning(false);
  };

  if (!needsTranslation.length) return null;
  return (
    <Tip text={`Перевести EN названия SVG-предметов для ${needsTranslation.length} образов`} width="w-56">
      <button
        onClick={handleRun}
        disabled={running}
        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
      >
        {running ? <Loader2 size={11} className="animate-spin" /> : <span className="text-[10px]">EN</span>}
        {running ? `Перевожу… ${done}/${needsTranslation.length}` : `Перевести EN все (${needsTranslation.length})`}
      </button>
    </Tip>
  );
}

function GenerateAllTitlesButton({ outfits, onMutate }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const untitled = (outfits || []).filter((o) => !o.title);

  const handleRun = async () => {
    if (!untitled.length) return;
    setRunning(true);
    setDone(0);
    for (const o of untitled) {
      try {
        await apiPost(`/api/admin/outfit/${o.id}/generate-title`, {});
        setDone((n) => n + 1);
      } catch {}
    }
    setRunning(false);
    onMutate();
  };

  if (!untitled.length) return null;
  return (
    <Tip text={`Сгенерировать названия для ${untitled.length} образов без названия`} width="w-52">
      <button
        onClick={handleRun}
        disabled={running}
        className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors disabled:opacity-50"
      >
        {running ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
        {running ? `Называю… ${done}/${untitled.length}` : `Назвать все (${untitled.length})`}
      </button>
    </Tip>
  );
}

function CopyPinDescButton({ outfit }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const enRows = outfit.translations?.en?.game_rows || [];
    const title = outfit.title || outfit.id.slice(0, 8);
    const layers = enRows.map(r => r.layer).filter(Boolean).join(' · ');
    const words = enRows.flatMap(r => (r.options || []).map(o => o.word)).filter(Boolean);
    const desc = [
      title,
      layers ? `Layers: ${layers}` : '',
      words.length ? words.join(', ') : '',
      'Find the odd one out. Five rounds. No theory — just reading.',
      `https://ffe-blush.vercel.app/outfit/${outfit.id}`,
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(desc).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors ml-1"
      title="Скопировать описание для Pinterest"
    >
      {copied ? '✓ скопировано' : '📋 пин'}
    </button>
  );
}

function SketchPinField({ outfitId, initialPinId }) {
  const [pinId, setPinId] = useState(initialPinId || '');
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const raw = input.trim();
    const m = raw.match(/\/pin\/(\d+)/);
    const id = m ? m[1] : raw.replace(/\D/g, '');
    if (!id) return;
    setSaving(true);
    try {
      await apiPatch(`/api/admin/outfit/${outfitId}/sketch-pin-id`, { sketch_pin_id: id });
      setPinId(id);
      setInput('');
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (pinId) return (
    <span className="flex items-center gap-1">
      <a href={`https://www.pinterest.com/pin/${pinId}/`} target="_blank" rel="noreferrer" className="text-[10px] text-rose-500 hover:text-rose-400">эскиз↗</a>
      <button onClick={() => setPinId('')} className="text-[10px] text-zinc-700 hover:text-zinc-400">×</button>
    </span>
  );

  return (
    <span className="flex items-center gap-0.5 ml-1">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        placeholder="пин эскиза…"
        className="bg-transparent text-[10px] text-zinc-600 placeholder-zinc-800 outline-none w-20"
      />
      {input && <button onClick={handleSave} disabled={saving} className="text-[10px] text-rose-500">{saving ? '…' : '✓'}</button>}
    </span>
  );
}

function OutfitCard({ outfit, onDelete, onRetry, onPinterestMark, onTitleChange }) {
  const [expanded, setExpanded] = useState(false);
  const [editingLang, setEditingLang] = useState(null);
  const [sketchUrl, setSketchUrl] = useState(null);
  const [sketchUploading, setSketchUploading] = useState(false);
  const sketchFileRef = useRef(null);
  const [title, setTitle] = useState(outfit.title || '');
  const [editingTitle, setEditingTitle] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);

  const handleTitleSave = async (val) => {
    const t = val.trim();
    setTitle(t);
    setEditingTitle(false);
    await apiPatch(`/api/admin/outfit/${outfit.id}/title`, { title: t });
    onTitleChange?.(outfit.id, t);
  };

  const handleGenerateTitle = async () => {
    setGeneratingTitle(true);
    try {
      const data = await apiPost(`/api/admin/outfit/${outfit.id}/generate-title`, {});
      setTitle(data.title);
      onTitleChange?.(outfit.id, data.title);
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      setGeneratingTitle(false);
    }
  };

  const handleSketchReplace = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSketchUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const data = await apiPost(`/api/admin/outfit/${outfit.id}/image`, form);
      setSketchUrl(data.thumb_url || data.image_url);
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      setSketchUploading(false);
      e.target.value = '';
    }
  };

  const ruReady = outfit.translations?.ru?.status === 'ready';
  const enReady = outfit.translations?.en?.status === 'ready';
  const hasError = ['ru', 'en'].some((l) => {
    const status = outfit.translations?.[l]?.status;
    return !status || ['error', 'pending'].includes(status);
  });
  const canExpand = true; // always expandable to manage renders

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800">
      <div className="flex items-center gap-4 p-4">
        <div className="relative group w-14 h-14 shrink-0">
          <img
            src={sketchUrl || outfit.thumb_url || outfit.image_url}
            alt=""
            className="w-14 h-14 object-contain rounded-lg bg-zinc-800"
          />
          <button
            onClick={() => sketchFileRef.current?.click()}
            disabled={sketchUploading}
            title="Заменить эскиз"
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {sketchUploading
              ? <Loader2 size={16} className="text-white animate-spin" />
              : <Camera size={16} className="text-white" />}
          </button>
          <input ref={sketchFileRef} type="file" accept="image/*" className="hidden" onChange={handleSketchReplace} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => handleTitleSave(title)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(title); if (e.key === 'Escape') setEditingTitle(false); }}
                className="flex-1 min-w-0 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-sm text-zinc-200 outline-none focus:border-zinc-400"
              />
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="text-sm font-medium text-zinc-200 truncate hover:text-white transition-colors text-left"
                title="Нажми чтобы изменить название"
              >
                {title || <span className="text-zinc-600 font-normal">{outfit.id.slice(0, 8)}</span>}
              </button>
            )}
            {!editingTitle && (
              <Tip text={title ? 'Сгенерировать новое название через ИИ' : 'Придумать название через ИИ'} width="w-44">
                <button
                  onClick={handleGenerateTitle}
                  disabled={generatingTitle}
                  className="shrink-0 text-zinc-600 hover:text-violet-400 transition-colors disabled:opacity-40"
                >
                  {generatingTitle ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                </button>
              </Tip>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5 mb-0.5 flex-wrap">
            <span className="text-[10px] text-zinc-600 font-mono select-all" title="системный ID образа">{outfit.id.slice(0, 8)}</span>
            <CopyPinDescButton outfit={outfit} />
            <SketchPinField outfitId={outfit.id} initialPinId={outfit.sketch_pin_id} />
            {outfit.sketch_pin_analytics && (
              <span className="text-[10px] text-zinc-600 ml-1">
                👁 {outfit.sketch_pin_analytics.impressions ?? 0}
                {' · '}↗ {outfit.sketch_pin_analytics.outbound_clicks ?? 0}
                {' · '}♡ {outfit.sketch_pin_analytics.saves ?? 0}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {(['ru', 'en']).map((lang) => {
              const t = outfit.translations?.[lang];
              const status = t?.status || 'pending';
              return (
                <span key={lang} className="flex items-center gap-1 text-xs text-zinc-500">
                  {STATUS_ICON[status]} {lang.toUpperCase()}
                  {status === 'error' && t?.error_msg && (
                    <span className="text-rose-400 ml-1 max-w-[200px] truncate" title={t.error_msg}>
                      — {t.error_msg}
                    </span>
                  )}
                </span>
              );
            })}
            {outfit.renders?.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-zinc-500" title="ИИ рендеры">
                <ImagePlus size={11} className="text-zinc-600" />
                {outfit.renders.length}
              </span>
            )}
            {['en', 'ru'].map((l) => {
              const date = outfit.pinterest_exported?.[l];
              return (
                <button
                  key={l}
                  onClick={() => onPinterestMark(outfit.id, l, !date)}
                  title={date
                    ? `В Pinterest ${l.toUpperCase()} с ${new Date(date).toLocaleDateString('ru')} — нажми чтобы снять метку`
                    : `Отметить как загружено в Pinterest ${l.toUpperCase()}`}
                  className={`text-[10px] border rounded px-1 py-0.5 leading-none transition-colors ${
                    date
                      ? 'text-rose-400 border-rose-800 hover:bg-rose-950'
                      : 'text-zinc-700 border-zinc-800 hover:text-rose-400 hover:border-rose-800'
                  }`}
                >P·{l.toUpperCase()}</button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canExpand && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-2 text-zinc-400 hover:text-white transition-colors"
              title={expanded ? 'Скрыть ряды' : 'Показать ряды'}
            >
              {expanded ? <ChevronUp size={16} /> : <Eye size={16} />}
            </button>
          )}
          <a
            href={`/outfit/${outfit.id}`}
            target="_blank"
            rel="noreferrer"
            className="p-2 text-zinc-400 hover:text-white transition-colors"
            title="Открыть"
          >
            <Edit3 size={16} />
          </a>
          {hasError && (
            <button
              onClick={() => onRetry(outfit.id)}
              className="p-2 text-zinc-400 hover:text-yellow-400 transition-colors"
              title="Повторить анализ"
            >
              <RefreshCw size={16} />
            </button>
          )}
          <button
            onClick={() => onDelete(outfit.id)}
            className="p-2 text-zinc-400 hover:text-rose-400 transition-colors"
            title="Удалить"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 p-4 space-y-6">
          {/* SVG layers */}
          <SvgLayersSection outfitId={outfit.id} initialLayers={outfit.svg_layers || []} />

          {/* Renders */}
          <div className="border-t border-zinc-800/50 pt-4">
            <RendersSection outfitId={outfit.id} initialRenders={outfit.renders || []} />
          </div>

          {/* Game rows per language */}
          {(ruReady || enReady) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-800/60">
              {(['ru', 'en']).map((lang) => {
                const t = outfit.translations?.[lang];
                if (!t || t.status !== 'ready') return null;
                return (
                  <div key={lang}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{lang}</span>
                      <button
                        onClick={() => setEditingLang(editingLang === lang ? null : lang)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {editingLang === lang ? 'Отмена' : 'Редактировать JSON'}
                      </button>
                    </div>
                    {editingLang === lang ? (
                      <RowsEditor outfitId={outfit.id} lang={lang} initialRows={t.game_rows} />
                    ) : (
                      <RowsTable rows={t.game_rows} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadItems, setUploadItems] = useState([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);
  const [view, setView] = useState('outfits'); // 'outfits' | 'renders' | 'coverage'
  const [sort, setSort] = useState('date'); // 'date' | 'renders'
  const [pinterestFilter, setPinterestFilter] = useState('all'); // 'all' | 'new-en' | 'new-ru' | 'exported'
  const [exportModal, setExportModal] = useState(null); // null | {lang, onlyNew, rendersOnly}
  const fileRef = useRef(null);

  const { data, isLoading } = useSWR('/api/admin/outfits', adminFetcher, {
    refreshInterval: 5000,
  });

  const handleUpload = async (files) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    setUploadItems(imageFiles.map((f) => ({ name: f.name, status: 'uploading' })));

    const form = new FormData();
    imageFiles.forEach((f) => form.append('image', f));

    try {
      const data = await apiPost('/api/admin/upload', form);
      setUploadItems(
        data.results.map((r) => ({
          name: r.filename,
          status: r.duplicate ? 'duplicate' : 'done',
          duplicate: r.duplicate,
        }))
      );
      mutate('/api/admin/outfits');
      setTimeout(() => setUploadItems([]), 5000);
    } catch (err) {
      setUploadItems((prev) => prev.map((i) => ({ ...i, status: 'error', error: err.message })));
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить образ?')) return;
    await apiDelete(`/api/admin/outfit/${id}`);
    mutate('/api/admin/outfits');
  };

  const handleRetry = async (id) => {
    await apiPost(`/api/admin/outfit/${id}/retry`);
    mutate('/api/admin/outfits');
  };

  const handlePinterestMark = async (id, lang, exported) => {
    await apiPost(`/api/admin/outfit/${id}/pinterest-mark`, { lang, exported });
    mutate('/api/admin/outfits');
  };

  const handlePinterestExport = async (lang = 'en', onlyNew = false) => {
    try {
      setCsvExporting(true);
      const BASE = process.env.NEXT_PUBLIC_API_URL || '';
      const token = process.env.NEXT_PUBLIC_ADMIN_TOKEN || '';
      const params = new URLSearchParams({ lang, board: 'FFE', ...(onlyNew ? { new: 'true' } : {}) });
      const res = await fetch(`${BASE}/api/admin/pinterest-export?${params}`, {
        headers: token ? { 'x-admin-token': token } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pinterest_${lang}${onlyNew ? '_new' : ''}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      mutate('/api/admin/outfits');
    } catch (e) {
      alert('Ошибка экспорта: ' + e.message);
    } finally {
      setCsvExporting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Admin | FFE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
    <div className="min-h-screen bg-black text-white font-sans">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-serif tracking-wide">FFE Admin</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1">
            <button
              onClick={() => setView('outfits')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${view === 'outfits' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <Upload size={13} /> Образы
            </button>
            <button
              onClick={() => setView('renders')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${view === 'renders' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <ImagePlus size={13} /> Рендеры
            </button>
            <button
              onClick={() => setView('coverage')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${view === 'coverage' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <LayoutGrid size={13} /> Coverage
            </button>
            <button
              onClick={() => setView('mechanics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${view === 'mechanics' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              <Sparkles size={13} /> Механики
            </button>
          </div>
          <a href="/admin/stats" className="text-sm text-zinc-400 hover:text-white transition-colors">Статистика</a>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setExportModal({ lang: 'en', onlyNew: true, rendersOnly: false })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs rounded-lg transition-colors"
              title="Новые образы (эскизы) — EN"
            >
              <Upload size={12} /> Новые EN
            </button>
            <button
              onClick={() => setExportModal({ lang: 'ru', onlyNew: true, rendersOnly: false })}
              className="px-2 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs rounded-lg transition-colors"
              title="Новые образы — RU"
            >RU</button>
            <button
              onClick={() => setExportModal({ lang: 'en', rendersOnly: true, onlyNew: false })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-950 hover:bg-violet-900 border border-violet-800 text-violet-300 text-xs rounded-lg transition-colors"
              title="ИИ рендеры не загруженные в Pinterest — EN"
            >
              <ImagePlus size={12} /> Рендеры EN
            </button>
            <button
              onClick={() => setExportModal({ lang: 'ru', rendersOnly: true, onlyNew: false })}
              className="px-2 py-1.5 bg-violet-950 hover:bg-violet-900 border border-violet-800 text-violet-300 text-xs rounded-lg transition-colors"
              title="ИИ рендеры не загруженные в Pinterest — RU"
            >RU</button>
            <button
              onClick={() => setExportModal({ lang: 'en', onlyNew: false, rendersOnly: false })}
              className="px-2 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-500 text-xs rounded-lg transition-colors"
              title="Все готовые — EN"
            >Все</button>
          </div>
          <a href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">← Галерея</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {view === 'coverage' && <CoverageBoard />}
        {view === 'mechanics' && <MechanicsBoard outfits={data?.outfits} />}
        {view === 'renders' && (
          <RendersGallery outfits={data?.outfits} onMutate={() => mutate('/api/admin/outfits')} />
        )}
        {view === 'outfits' && (<>
        <div
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200 mb-4 ${
            isDragging ? 'border-zinc-400 bg-zinc-900' : 'border-zinc-700 hover:border-zinc-500'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleUpload(e.dataTransfer.files);
          }}
        >
          <Upload size={32} className="mx-auto mb-3 text-zinc-500" />
          <p className="text-zinc-300 mb-1">Перетащите изображения или</p>
          <p className="text-zinc-600 text-xs mb-3">Можно загрузить несколько файлов сразу</p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadItems.some((i) => i.status === 'uploading')}
            className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors border border-zinc-700 text-sm disabled:opacity-50"
          >
            {uploadItems.some((i) => i.status === 'uploading') ? 'Загружаю…' : 'Выбрать файлы'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
        </div>

        {uploadItems.length > 0 && (
          <div className="mb-8 space-y-1.5">
            {uploadItems.map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
                {item.status === 'uploading' && <Clock size={14} className="text-zinc-400 animate-spin shrink-0" />}
                {item.status === 'done' && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                {item.status === 'duplicate' && <XCircle size={14} className="text-yellow-400 shrink-0" />}
                {item.status === 'error' && <XCircle size={14} className="text-rose-400 shrink-0" />}
                <span className="text-zinc-300 truncate flex-1">{item.name}</span>
                <span className="text-xs shrink-0 text-zinc-500">
                  {item.status === 'uploading' && 'Загружаю…'}
                  {item.status === 'done' && 'Загружено'}
                  {item.status === 'duplicate' && 'Дубликат'}
                  {item.status === 'error' && 'Ошибка'}
                </span>
              </div>
            ))}
          </div>
        )}

        {data?.outfits && (() => {
          const total = data.outfits.length;
          const ready = data.outfits.filter((o) => ['ru', 'en'].every((l) => o.translations?.[l]?.status === 'ready')).length;
          const pending = data.outfits.filter((o) => ['ru', 'en'].some((l) => o.translations?.[l]?.status === 'pending')).length;
          const error = data.outfits.filter((o) => ['ru', 'en'].some((l) => o.translations?.[l]?.status === 'error')).length;
          const hashCounts = {};
          data.outfits.forEach((o) => { if (o.file_hash) hashCounts[o.file_hash] = (hashCounts[o.file_hash] || 0) + 1; });
          const dupCount = data.outfits.filter((o) => o.file_hash && hashCounts[o.file_hash] > 1).length;
          const newEnCount = data.outfits.filter((o) => !o.pinterest_exported?.en && ['ru','en'].every(l => o.translations?.[l]?.status === 'ready')).length;
          const newRuCount = data.outfits.filter((o) => !o.pinterest_exported?.ru && ['ru','en'].every(l => o.translations?.[l]?.status === 'ready')).length;
          const exportedCount = data.outfits.filter((o) => o.pinterest_exported?.en || o.pinterest_exported?.ru).length;
          return (
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-4 flex-wrap">
                <h2 className="text-lg font-medium text-zinc-300">Образы</h2>
                <div className="flex items-center gap-3 text-sm flex-wrap">
                  <span className="text-zinc-400">{total} всего</span>
                  <span className="text-emerald-400">{ready} готово</span>
                  {pending > 0 && <span className="text-zinc-400">{pending} в обработке</span>}
                  {error > 0 && <span className="text-rose-400">{error} с ошибкой</span>}
                  <GenerateAllTitlesButton outfits={data.outfits} onMutate={() => mutate('/api/admin/outfits')} />
                  <TranslateAllSvgLabelsButton outfits={data.outfits} />
                  {dupCount > 0 && (
                    <button
                      onClick={() => setShowDuplicates((v) => !v)}
                      className={`px-2 py-0.5 rounded text-xs border transition-colors ${showDuplicates ? 'border-yellow-500 text-yellow-400 bg-yellow-950' : 'border-zinc-600 text-yellow-500 hover:border-yellow-500'}`}
                    >
                      {dupCount} дубликатов
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Pinterest filter */}
                <span className="text-xs text-zinc-600">Pinterest:</span>
                <button
                  onClick={() => setPinterestFilter('all')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${pinterestFilter === 'all' ? 'border-zinc-500 text-zinc-200 bg-zinc-800' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >все</button>
                <button
                  onClick={() => setPinterestFilter('new-en')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${pinterestFilter === 'new-en' ? 'border-emerald-600 text-emerald-300 bg-emerald-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >новые EN ({newEnCount})</button>
                <button
                  onClick={() => setPinterestFilter('new-ru')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${pinterestFilter === 'new-ru' ? 'border-emerald-600 text-emerald-300 bg-emerald-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >новые RU ({newRuCount})</button>
                <button
                  onClick={() => setPinterestFilter('exported')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${pinterestFilter === 'exported' ? 'border-rose-700 text-rose-300 bg-rose-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >загружено ({exportedCount})</button>
                {/* Sort */}
                <span className="text-xs text-zinc-600 ml-2">Сортировка:</span>
                <button
                  onClick={() => setSort('date')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${sort === 'date' ? 'border-zinc-500 text-zinc-200 bg-zinc-800' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >по дате</button>
                <button
                  onClick={() => setSort('renders')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${sort === 'renders' ? 'border-violet-500 text-violet-300 bg-violet-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >с рендерами</button>
                <button
                  onClick={() => setSort(sort === 'svg' ? 'date' : 'svg')}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${sort === 'svg' ? 'border-emerald-500 text-emerald-300 bg-emerald-950' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                >с SVG</button>
              </div>
            </div>
          );
        })()}
        {!data?.outfits && <h2 className="text-lg font-medium mb-4 text-zinc-300">Образы</h2>}

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-zinc-900 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {data?.outfits && (() => {
          const hashCounts = {};
          data.outfits.forEach((o) => { if (o.file_hash) hashCounts[o.file_hash] = (hashCounts[o.file_hash] || 0) + 1; });
          const sorted = sort === 'renders'
            ? [...data.outfits].sort((a, b) => (b.renders?.length || 0) - (a.renders?.length || 0))
            : sort === 'svg'
            ? [...data.outfits].filter((o) => o.svg_layers?.length > 0)
            : data.outfits;
          const pFiltered = pinterestFilter === 'new-en'
            ? sorted.filter((o) => !o.pinterest_exported?.en)
            : pinterestFilter === 'new-ru'
            ? sorted.filter((o) => !o.pinterest_exported?.ru)
            : pinterestFilter === 'exported'
            ? sorted.filter((o) => o.pinterest_exported?.en || o.pinterest_exported?.ru)
            : sorted;
          const visible = showDuplicates
            ? pFiltered.filter((o) => o.file_hash && hashCounts[o.file_hash] > 1)
            : pFiltered;

          if (showDuplicates) {
            const groups = {};
            visible.forEach((o) => {
              if (!groups[o.file_hash]) groups[o.file_hash] = [];
              groups[o.file_hash].push(o);
            });
            return (
              <div className="space-y-4">
                {Object.values(groups).map((group) => (
                  <div key={group[0].file_hash} className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-3 space-y-2">
                    <p className="text-xs text-yellow-600 font-mono truncate px-1">hash: {group[0].file_hash}</p>
                    {group.map((outfit) => (
                      <OutfitCard key={outfit.id} outfit={outfit} onDelete={handleDelete} onRetry={handleRetry} onPinterestMark={handlePinterestMark} onTitleChange={() => mutate('/api/admin/outfits')} />
                    ))}
                  </div>
                ))}
              </div>
            );
          }

          return (
            <div className="space-y-3">
              {visible.map((outfit) => (
                <OutfitCard key={outfit.id} outfit={outfit} onDelete={handleDelete} onRetry={handleRetry} onPinterestMark={handlePinterestMark} onTitleChange={() => mutate('/api/admin/outfits')} />
              ))}
            </div>
          );
        })()}
        </>)}
      </main>
    </div>

    {exportModal && (
      <PinterestExportModal
        lang={exportModal.lang}
        onlyNew={exportModal.onlyNew}
        rendersOnly={exportModal.rendersOnly}
        onClose={() => setExportModal(null)}
        onExported={() => mutate('/api/admin/outfits')}
      />
    )}
    </>
  );
}

export async function getServerSideProps(ctx) {
  const redirect = await withAuth(ctx);
  if (redirect) return redirect;
  return { props: {} };
}
