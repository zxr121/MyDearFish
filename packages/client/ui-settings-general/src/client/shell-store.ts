/** Shared settings viewing state for its mouse and command entry points. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type PendingTab = { tabId: string; nonce: number }
type State = { open: boolean; activeId: string | undefined; pendingTab: PendingTab | undefined }
type Actions = {
  open(draft: State): void
  close(draft: State): void
  select(draft: State, id: string): void
  openSection(draft: State, id: string): void
  openAt(draft: State, sectionId: string, tabId?: string): void
  takeRequestedTab(draft: State, nonce: number): void
}

/**
 * Declare the settings dialog state and its complete mutation API.
 * @returns one root-scoped store handle for the settings shell.
 */
export function createSettingsShellStore(): EngineStoreHandle<State, Actions> {
  return defineStore({
    init: (): State => ({
      open: false,
      activeId: undefined as string | undefined,
      pendingTab: undefined as PendingTab | undefined,
    }),
    actions: {
      open: (d) => { d.open = true },
      close: (d) => { d.open = false; d.activeId = undefined; d.pendingTab = undefined },
      select: (d, id: string) => { d.activeId = id; d.pendingTab = undefined },
      openSection: (d, id: string) => { d.activeId = id; d.pendingTab = undefined; d.open = true },
      openAt: (d, sectionId: string, tabId?: string) => {
        d.activeId = sectionId
        d.pendingTab = tabId === undefined ? undefined : { tabId, nonce: (d.pendingTab?.nonce ?? 0) + 1 }
        d.open = true
      },
      takeRequestedTab: (d, nonce: number) => {
        if (d.pendingTab?.nonce === nonce) d.pendingTab = undefined
      },
    },
  })
}
