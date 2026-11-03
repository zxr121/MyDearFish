# Agent Note: Fish settings become two top-level pages with searchable sub-tabs

Status: implemented

[English](2026-11-03-fish-settings-ia.md) | 中文

## Problem

设置弹窗原来有十二个平铺分区。鱼相关页面把可改设置、只读状态、安装向导和排查日志混在同一条长滚动里，同一个事实还出现在两处：B 站既有专用页又有按 schema 生成的表单，心情页重复出生设定里的名字，大肥鱼记忆页重复心情、人物志和通道状态。QQ 的群主动开话题和主动搭话页看起来也像两套互相竞争的控制，主人分不清哪一页管哪种行为。

## Decision

鱼设置收在两个一级页 `大肥鱼` 和 `她在外面` 下。`dsh-fish-mind` 拥有两个父分区并声明子列表槽位 `settings.fish.tab` 和 `settings.outside.tab`；心情、QQ、主动搭话和 B 站插件把现有页面注册进这些槽位，不改各自宿主接口。大肥鱼下是总览（只读，默认）、她是谁、记忆、心情、零花钱、梗百科；她在外面下是通到 QQ、主动搭话、刷 B 站。其余一级页是账号与余额、通用、模型、Agent 预设、插件状态，所以导航共七行。

外壳新增搜索框，背后是新的客户端服务 `ctx.settingsSearch`。页面注册一级页 id、可选子页 id、每次查询解析的 label 和关键词，以及可选的生效方式和只读标记。选中结果会打开对应分区，并把 `requestedTab` 传给当前分区，由分区用 `takeRequestedTab` 确认；没有子页的分区忽略这两个字段。搜索索引只是展示状态。

重复项是收掉而不是重新摆放：B 站调用 `settings.configure({ auto: false })`，插件页开始遵守 `autoGenerate === false`；心情页的主人称呼和她自己的名字改为只读，跟出生设定走；大肥鱼记忆页不再渲染心情、人物志和通道块；人物志只留在 QQ。文案开始点明每条边界，包括 QQ 的「在群里先开口」和会话级主动搭话、账号余额和零花钱、默认模型和各功能模型覆盖。每个鱼设置页顶部先写本页能设置什么，非立即生效的块带重启标签，长页提供段落锚点，鱼布尔项一律是「开/关」双段 pill。

## Verification

`pnpm run test:fish` 覆盖父页和子页注册、默认总览页、心情名字只读和 pill 控件。`pnpm run test:gui` 覆盖搜索服务、搜索结果匹配、外壳 store 的 `openAt`/`takeRequestedTab`、插件页的 `autoGenerate` 闸门和原生页文案。`DSH_SNAPSHOT=refresh pnpm run test:web` 刷新设置 ARIA golden；随后 replay 必须通过。手工验收在桌面版打开每个一级页和子页，并用一次搜索落到子页。

## Alternatives considered

**保留十二个平铺分区，只加分组标题。** 这能保留所有页面，但 B 站和身份名字的重复还在，最长的页面仍是单页。主人要求相似页面放进同一个 tab。

**把鱼设置放进单独窗口。** 第二个设置表面能把应用级 tab 从鱼的导航里拿掉，但会把搜索、引导和导航拆成两个外壳。子 tab 保留一个外壳，同时压缩导航。

**给通用 list slot 选项加关键词字段。** slot 选项只持久化 id、order、label 和 priority；搜索还需要生效标签、只读模式和每次查询解析的 resolver。用客户端服务可以把这些数据留在框架 slot core 之外。

## Consequences

`dsh-fish-mind` 现在是鱼设置的壳：关掉它会同时移除两个鱼一级页，子页注册会一直等待。这可以接受，因为鱼 bundle 把鱼脑当硬依赖，并且已经写进鱼设置指南。一级页切换仍会卸载当前面板，未保存草稿可能丢失；子页会保留访问过的面板。搜索只找页面和子页，不找单个字段，长页面仍要靠段落锚点。
