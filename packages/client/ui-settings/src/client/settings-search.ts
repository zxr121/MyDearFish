/** Cross-section settings search index owned by the settings domain base. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** When a settings page's edits take effect. */
export type SettingsSearchApplies = 'live' | 'restart'

/** Whether a page edits settings or only reports state. */
export type SettingsSearchMode = 'settings' | 'view'

/**
 * One searchable settings page or sub-page. `label` and `keywords` are
 * resolved per query so a locale switch needs no re-registration.
 */
export interface SettingsSearchTarget {
  /** Top-level section id (`fish`, `outside`, `general`, …). */
  sectionId: string
  /** Optional sub-tab id inside the section. */
  tabId?: string
  /** Display label resolved at query time. */
  label: () => string
  /** Extra search terms resolved at query time. */
  keywords: () => readonly string[]
  /** Effect tag shown beside the result. */
  applies?: SettingsSearchApplies
  /** Read-only pages say so in the result. */
  mode?: SettingsSearchMode
}

/**
 * Search index for the settings shell. Pages register their own targets; the
 * shell combines them with the live navigation rows and navigates to the
 * selected section (and optional sub-tab).
 */
export class SettingsSearch extends Service {
  private readonly entries = new Map<string, SettingsSearchTarget>()
  private snapshot: readonly SettingsSearchTarget[] = Object.freeze([])
  private readonly listeners = new Set<() => void>()

  /** @param ctx - the providing ui-settings context. */
  constructor(ctx: Context) {
    super(ctx, 'settingsSearch')
  }

  /**
   * Register one searchable target.
   * @param target - section/tab identity plus per-query label and keywords.
   * @returns the disposer removing this target.
   * @throws when the same section/tab pair is already registered.
   */
  register(target: SettingsSearchTarget): () => void {
    if (target.sectionId === '') throw new Error('settingsSearch: sectionId must not be empty')
    const key = `${target.sectionId}\u0000${target.tabId ?? ''}`
    if (this.entries.has(key)) {
      throw new Error(`settingsSearch: duplicate target "${target.sectionId}${target.tabId === undefined ? '' : ` / ${target.tabId}`}"`)
    }
    this.entries.set(key, target)
    this.publish()
    let active = true
    return () => {
      if (!active) return
      active = false
      this.entries.delete(key)
      this.publish()
    }
  }

  /**
   * Current targets; the array identity changes only when a target is added or removed.
   * @returns the stable snapshot array.
   */
  getSnapshot = (): readonly SettingsSearchTarget[] => this.snapshot

  /**
   * Subscribe to target changes.
   * @param listener - called after each add or removal.
   * @returns the disposer removing this listener.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(): void {
    this.snapshot = Object.freeze([...this.entries.values()])
    for (const listener of this.listeners) listener()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Settings-owned page and sub-page search index. */
    settingsSearch: SettingsSearch
  }
}
