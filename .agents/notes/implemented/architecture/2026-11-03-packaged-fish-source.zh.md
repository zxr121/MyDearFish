# Agent Note: 安装版保留可编辑鱼源码，内核仍然固定

Status: implemented

[English](2026-11-03-packaged-fish-source.md) | 中文

## Problem

安装版里，没有确定性落点的性格倾向会被标成「需要改代码」并交给创造模式，但安装目录里没有源码仓库：`installRoot()` 解析到 exe 所在目录，`isFishCheckout()` 永远为 false，创造模式说明里也明确写着打包版改不了。主人选择让安装包随带一份可编辑源码，创造模式能改，重启后生效，同时不把安全内核变成可改文件。

## Decision

安装包把仓库的 `fish/` 作为 `resources/fish-src/fish` 一起打进去。每次启动、Host 起来之前，`DesktopProjectManager.applyRelease()` 把它 seed 到 `<DSH_HOME>/fish-src`，并把可编辑插件同步到 `<DSH_HOME>/profiles/desktop/node_modules`。两个插件以相对 `file:` 依赖写进 profile 清单，profile 作用域的模块解析会优先加载它们，早于安装包 `app.asar/dsh/node_modules` 里的同名副本。完全重启会重新执行 seed 和同步；不需要 pnpm、重新构建或改 asar。

只有行为文件可编辑：`dsh-fish-mind` 的 `lib/tendency.js`、`lib/humor.js`、`lib/memes.js`、`lib/settings-catalog.js`、`lib/config-files.js`，以及 `dsh-qq-bridge` 的 `lib/host.js`、`lib/sticker-commands.js`。这两个包里其它运行时文件——包括 `lib/index.js`、`lib/permissions.js`、`lib/privacy.js`、`lib/budget.js`、`package.json` 和 `client.js`——每次启动都从安装包原版恢复；改过的内核文件先留在 `.kernel-backup/<时间>/`，再被原版替换。白名单在 `apps/desktop/src/fish-source.ts`，扩一项就是加一行。

升级按 SHA-256 合并：原版文件只在工作副本缺失、仍等于上一版原版哈希、或是受保护内核文件时覆盖；改过的白名单文件和主人自建文件保留。删掉 `fish-src` 后，下次启动会从安装包重新生成。

创造模式通过服务端清单认出 `<DSH_HOME>/fish-src`，把它作为工作区和 `checkout` 返回，并把可编辑列表和同步警告带进 brief 和设置页弹窗。权限层接受 `creatorRoot`，在本该私有的 Harness home 里只放行这个根以下的路径；创造模式的 shell 命令不允许出现 `..` 路径段。`fish/bundle` 和另外四个插件只作参考，因为 bundle 解析是 installation-first；出厂人设仍走设置页的「性格人设」覆盖。

## Verification

`apps/desktop/tests/fish-source.spec.ts` 覆盖首装 seed、升级合并、内核恢复与备份、拒绝符号链接、profile 依赖、语法拒绝和回退。`project-manager.spec.ts` 覆盖打包路径的 `applyRelease()`。鱼脑测试覆盖安装版 creation 响应和创造模式权限边界。安装包验收会在构建产物里改 `tendency.js`、重启并确认 profile 副本变化；再改 `permissions.js`，确认原版回来且留下备份。

## Alternatives considered

**把可编辑源码放在 exe 旁边，改 NSIS 保留它。** 安装器已经会暂存 `<安装目录>\data`；再加一个目录就要在同样的提升/回滚逻辑里补暂存、回滚和卸载路径，而且应用目录只读时会失效，还要保证每条安装路径都不丢改动。

**安装版继续只读，完全靠提示词兜底。** 未识别的倾向本来就会每轮注入，不需要新能力；但它满足不了主人要的确定性行为修改，设置页也会继续承诺一条走不通的代码路径。

**整份源码都可编辑，只保护一小串内核黑名单。** `lib/index.js` 负责 broker、创造模式识别和权限预设的接线，黑名单漏掉它就能被绕过。白名单让接线和内核文件保持原版，同时覆盖主人要改的倾向和 QQ 行为文件。

**在安装版内部重新编译或打包。** 需要工具链和可写运行时目录；应用已经有测试过的 profile 副本机制，重启就够了。

## Consequences

安装版获得了和源码仓库一样的代码级定制能力，升级保留主人改动，同时 broker、隐私、预算和本地请求闸门保持固定。代价是数据目录里多了一份代码：手工搬 `data` 会带着它走，但导出和备份包不含它。可编辑文件仍然是可执行代码，白名单是护栏不是沙箱，主人要看创造模式的改动。改坏运行时代码时，删掉 `fish-src` 再重启就能恢复出厂源码。安装版的 bundle 出厂人设和另外四个插件不能热改。
