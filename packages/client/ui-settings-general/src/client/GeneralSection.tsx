/** The General section: one column rendering feature-owned item contributions. */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'> & PropsLocale<'settings'>

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ renderSlot, t }: GeneralSectionComponentProps) {
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('general.title')}</h2>
      <p className={css.intro}>{t('general.intro')}</p>
      {renderSlot('settings.general.item', {})}
    </div>
  )
}
