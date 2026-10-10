import { t } from '../lib/i18n'

// Blank lines separate examples in the existing cross-platform example field.
export function ExampleEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const examples = value.split('\n\n')
  return <section className="space-y-3">
    <h3 className="text-sm font-semibold">{t('例句（可选）')}</h3>
    {examples.map((example, index) => <div key={index} className="flex items-center gap-2">
      <input aria-label={t('例句 {0}', index + 1)} className="app-field min-w-0 flex-1" value={example} placeholder={t('输入例句或补充说明')} onChange={event => onChange(examples.map((item, i) => i === index ? event.target.value : item).join('\n\n'))} />
      <button type="button" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" title={t('删除例句 {0}', index + 1)} aria-label={t('删除例句 {0}', index + 1)} onClick={() => onChange(examples.filter((_, i) => i !== index).join('\n\n'))}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
    </div>)}
    <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" aria-label={t('添加例句')} title={t('添加例句')} onClick={() => onChange(value + '\n\n')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
  </section>
}
