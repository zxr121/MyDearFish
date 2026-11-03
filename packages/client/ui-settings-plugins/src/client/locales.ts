/** Locale bundles for the built-in plugins settings section. */

/** Locale keys the section renders. */
export type PluginsSettingsLocaleKey = 'nav' | 'title' | 'intro' | 'tabs' | 'empty' | 'searchKeywords'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugin status',
  title: 'Plugin status',
  intro: 'Read-only: inspect the built-in plugins and their runtime state. Install, uninstall, and enable them on the Plugins page in the sidebar.',
  tabs: 'Plugin views',
  empty: 'This deployment exposes no plugin views.',
  searchKeywords: 'plugin plugins built-in runtime status enabled disabled preset',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '插件状态',
  title: '插件状态',
  intro: '本页只读：查看内置插件和运行状态；安装、卸载、启停在左侧「插件」页。',
  tabs: '插件视图',
  empty: '本部署没有开放任何插件视图。',
  searchKeywords: '插件 内置 运行状态 启用 停用 预设',
}
