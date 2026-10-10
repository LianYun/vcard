import type { ReactNode } from 'react'
import type { StudyDetails } from './StudyDetailsPage'
import { t } from '../lib/i18n'

export function StudyHub({onOpenDetails,children,quickStudy}:{onOpenDetails:(page:StudyDetails)=>void;children?:ReactNode;quickStudy?:ReactNode}) {
  return <section className="study-hub app-surface">
    <div className="study-hub-nav">
      <div><span className="study-eyebrow">{t('安排你的学习')}</span><h3>{t('按自己的节奏，记得更牢')}</h3></div>
      {children}
    </div>
      <div className="study-hub-actions">
        {quickStudy}
        <button className="btn-secondary" onClick={()=>onOpenDetails('ahead')}>{t('提前学习')}</button>
      </div>
  </section>
}
