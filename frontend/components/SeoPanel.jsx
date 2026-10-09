import { useState } from 'react';
import { apiPost, apiPatch } from '../lib/api';

const API = '/api/admin/visuals';

function Field({ label, value, onChange, max, rows = 1 }) {
  const over = value.length > max;
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-zinc-500">
        <span>{label}</span>
        <span className={over ? 'text-rose-400' : 'text-zinc-600'}>{value.length}/{max}</span>
      </span>
      {rows > 1 ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="w-full bg-black border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-black border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500" />
      )}
    </label>
  );
}

// SEO-разметка визуала под пин: ИИ предлагает заголовок, запасной заголовок и описание,
// по желанию — с учётом загруженной SEO-стратегии; всё можно поправить руками
export default function SeoPanel({ visual, strategy, onChanged, defaultLang }) {
  // Язык по умолчанию — как у прошлой разметки, иначе как у надписи на картинке
  const [lang, setLang] = useState(visual.seo_lang || defaultLang || visual.overlay?.lang || 'ru');
  const [useStrategy, setUseStrategy] = useState(Boolean(strategy) && visual.seo_with_strategy !== false);
  const [title, setTitle] = useState(visual.seo_title || '');
  const [titleAlt, setTitleAlt] = useState(visual.seo_title_alt || '');
  const [description, setDescription] = useState(visual.seo_description || '');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const generate = async () => {
    setBusy('generate');
    setMessage('');
    try {
      const { visual: v } = await apiPost(`${API}/${visual.id}/generate-seo`, { lang, use_strategy: useStrategy });
      setTitle(v.seo_title || '');
      setTitleAlt(v.seo_title_alt || '');
      setDescription(v.seo_description || '');
      setMessage(useStrategy ? 'Готово, с учётом SEO-стратегии' : 'Готово');
      onChanged?.(v);
    } catch (e) {
      setMessage(`Не получилось: ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    setMessage('');
    try {
      const { visual: v } = await apiPatch(`${API}/${visual.id}`, { seo_title: title, seo_title_alt: titleAlt, seo_description: description });
      setMessage('Сохранено');
      onChanged?.(v);
    } catch (e) {
      setMessage(`Не сохранилось: ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  const copy = (s) => { navigator.clipboard?.writeText(s).then(() => setMessage('Скопировано'), () => {}); };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {['ru', 'en'].map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={`px-2 py-0.5 rounded-lg ${lang === l ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
          >{l.toUpperCase()}</button>
        ))}
        <label className={`flex items-center gap-1 ${strategy ? 'text-zinc-300' : 'text-zinc-600'}`} title={strategy ? '' : 'Стратегия ещё не загружена'}>
          <input type="checkbox" checked={useStrategy} disabled={!strategy} onChange={(e) => setUseStrategy(e.target.checked)} />
          по SEO-стратегии
        </label>
      </div>
      {!strategy && (
        <p className="text-zinc-600">SEO-стратегия не загружена — её собирают из CSV аналитики Pinterest на вкладке «SEO» в разделе «Образы». Без неё ИИ разметит по картинке и данным о ней.</p>
      )}
      <button
        type="button"
        onClick={generate}
        disabled={Boolean(busy)}
        className="px-3 py-1 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-40"
      >{busy === 'generate' ? 'ИИ размечает…' : title ? 'Разметить заново' : 'Разметить ИИ'}</button>

      {(title || titleAlt || description) && (
        <>
          <Field label="Заголовок" value={title} onChange={setTitle} max={100} />
          <Field label="Запасной заголовок" value={titleAlt} onChange={setTitleAlt} max={100} />
          <Field label="Описание" value={description} onChange={setDescription} max={500} rows={4} />
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={save} disabled={Boolean(busy)} className="px-3 py-1 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40">
              {busy === 'save' ? 'Сохраняю…' : 'Сохранить правки'}
            </button>
            <button type="button" onClick={() => copy(title)} className="text-zinc-500 hover:text-white">копировать заголовок</button>
            <button type="button" onClick={() => copy(description)} className="text-zinc-500 hover:text-white">копировать описание</button>
          </div>
        </>
      )}
      {message && <p className="text-zinc-400">{message}</p>}
    </div>
  );
}
