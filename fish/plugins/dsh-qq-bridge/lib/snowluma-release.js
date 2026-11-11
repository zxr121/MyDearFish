// SnowLuma 发行包来源
//
// 上游 SnowLuma/SnowLuma 仓库已经下线（2026-11 前后）：GitHub API、仓库页和资产直链
// 都返回 404。官方 v2.4.2 的 Windows 发行包仍保留在下面这些镜像仓库的 Releases 里。
//
// 元数据用发行包自带的 release.json 资产读取，不调用会限流的 GitHub API；
// 镜像里的 release.json 仍把 browser_download_url 指向已不存在的官方仓库，
// 所以下载地址必须按“实际提供元数据的镜像仓库”重新拼，不能直接拿来用。

/** 仍保留官方发行包的镜像仓库；顺序即兜底顺序。 */
export const 发行镜像仓库 = [
  { 仓库: 'XingYunStar/snowluma', 说明: '发行包归档' },
  { 仓库: 'TomyJan/SnowLuma', 说明: '上游 fork 镜像' },
]

/** 已下线的官方仓库，仅用于文案说明和识别旧配置。 */
export const 官方发行仓库 = 'SnowLuma/SnowLuma'

/** 国内可用的 GitHub 文件镜像；release 资产和 release.json 资产都走它们。 */
export const 下载镜像前缀 = [
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
]

/** 镜像仓库里随 Release 一起发布、列出资产名与摘要的元数据文件。 */
export const 发行元数据文件 = 'release.json'

/**
 * 所有元数据地址都取不到时兜底用的最后一次核对过的完整包。
 * 镜像上的 release.json 暂时 404、限流或返回坏 JSON 时，仍然能直接按这个地址下载并校验。
 * 更新镜像版本时一起改这里；资产名、大小和 sha256 必须与镜像的 release.json 一致。
 */
export const 最后已知发行包 = {
  标签: 'v2.4.2',
  版本: '2.4.2',
  资产: {
    name: 'SnowLuma-v2.4.2-win-x64.zip',
    size: 43_361_462,
    digest: 'sha256:0912926c5e73260f35b000278a8658493fc9452f36782c32fa86f0e825bad81a',
  },
}

function 仓库页面(仓库) {
  return `https://github.com/${仓库}`
}

/**
 * 逐个尝试的发行元数据地址：先国内镜像，最后才回 GitHub 直连。
 * 每个候选都带上是哪个镜像仓库提供的，下载时据此改写资产地址。
 * @param {{仓库: string, 说明: string}[]} [镜像们] - 保留发行包的镜像仓库。
 * @param {string[]} [前缀们] - GitHub 文件镜像前缀。
 * @returns {{仓库: string, 说明: string, 地址: string}[]} 按尝试顺序排列的元数据地址。
 */
export function 发布元数据地址候选(镜像们 = 发行镜像仓库, 前缀们 = 下载镜像前缀) {
  const 出 = []
  const 加 = (仓库, 说明, 地址) => {
    if (!出.some((x) => x.地址 === 地址)) 出.push({ 仓库, 说明, 地址 })
  }
  const 元数据 = `releases/latest/download/${发行元数据文件}`
  for (const 前缀 of 前缀们) {
    const 服务 = 前缀.replace(/^https:\/\//, '').replace(/\/$/, '')
    for (const 镜像 of 镜像们) {
      加(镜像.仓库, `${服务} 镜像`, `${前缀}${仓库页面(镜像.仓库)}/${元数据}`)
    }
  }
  for (const 镜像 of 镜像们) {
    加(镜像.仓库, 'GitHub 直连', `${仓库页面(镜像.仓库)}/${元数据}`)
  }
  return 出
}

/**
 * 在某个镜像仓库里拼出某个版本的发行包地址。
 * @param {string} 仓库 - 形如 `owner/name` 的镜像仓库。
 * @param {string} 标签 - Release 的 tag，例如 `v2.4.2`。
 * @param {string} 资产名 - 发行包文件名。
 * @returns {string} GitHub 直连地址。
 */
export function 发行包下载地址(仓库, 标签, 资产名) {
  return `${仓库页面(仓库)}/releases/download/${encodeURIComponent(标签)}/${encodeURIComponent(资产名)}`
}

/**
 * 从 Release 的资产列表里挑 Windows x64 完整包。
 * `-lite.zip` 不带 node.exe，装好也起不来，所以只认完整包。
 * @param {unknown} 资产们 - release.json 的 assets。
 * @returns {{name: string, size?: number, digest?: string} | null} 选中的资产，没有就返回 null。
 */
export function 选Windows发行包(资产们) {
  const 列表 = Array.isArray(资产们) ? 资产们 : []
  return 列表.find((资产) => /^SnowLuma-v[\d.]+-win-x64\.zip$/i.test(String((资产 && 资产.name) || ''))) || null
}

/**
 * 给发行包地址加国内镜像候选，最后回直连；已经是镜像地址的不再叠加前缀。
 * @param {string} 地址 - GitHub 发行包直连地址。
 * @param {string[]} [前缀们] - GitHub 文件镜像前缀。
 * @returns {string[]} 按尝试顺序排列的下载地址。
 */
export function 下载地址候选(地址, 前缀们 = 下载镜像前缀) {
  if (!/^https:\/\/github\.com\//i.test(地址)) return [地址]
  const 出 = 前缀们.map((前缀) => `${前缀}${地址}`)
  出.push(地址)
  return [...new Set(出)]
}

/**
 * 下载源的可读标签，写进设置页的进度和失败原因。
 * @param {string} 地址 - 下载地址。
 * @returns {string} 例如 `gh-proxy 镜像` / `GitHub 直连`。
 */
export function 下载源标签(地址) {
  if (地址.startsWith('https://gh-proxy.com/')) return 'gh-proxy 镜像'
  if (地址.startsWith('https://ghproxy.net/')) return 'ghproxy.net 镜像'
  return 'GitHub 直连'
}
