import { useCardEditor } from './CardEditor'
import { t } from '../lib/i18n'
export function AddCardForm({ onAdded }: { onAdded?: () => void }) {
  const openEditor = useCardEditor()
  return <section className="app-surface space-y-4 p-5 sm:p-6"><h2 className="font-semibold">{t('创建卡片')}</h2><p className="section-copy">{t('记录一个问题、概念或知识点，使用 Markdown 丰富卡片内容。')}</p><button className="btn-primary" onClick={() => openEditor({ kind: 'create', onSaved: onAdded })}>{t('创建卡片')}</button></section>
}
