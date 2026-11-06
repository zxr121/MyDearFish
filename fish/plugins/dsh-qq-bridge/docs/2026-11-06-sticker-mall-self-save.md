# 官方商城表情：她自己能不能存（2026-11-06）

## 结论

能。分两层：第一层是现在就该补的“认得出、叫得对”，第二层才是主人说的“下载一整套”。

1. **单张认得出、叫得对**：SnowLuma 收到商城表情时，OneBot 的消息段里已经带了 `emoji_id`、`emoji_package_id`、`key`、`summary`；桥现在只留了图，别的都丢了，还把 `sub_type` 当 0，自动收藏根本不把它当表情，最后只能叫“表情”。把这几个字段接住，按 `emoji_package_id` 取一次公开的表情包目录，就能拿到包名（`小喵包`）、包简介（`小喵包的日常生活w`）、这一张的官方名字（`捏捏`）和关键词。不用登录，不点链接。
2. **整套存下来、还能发**：同一套表情的 `key` 是**整包共用**的。线上样本里，同一套的 10 张、6 张不同表情用的都是同一个 key；同一个 key 至少稳定了 9 天。所以从群里见过任意一张，就等于拿到了这一套的发送凭据：把整套图下到本地，之后任意一张都能用 `mface` 段发出去，不需要塞进 200 张的 QQ 收藏，也不占收藏编号。

不能做的是“在 QQ 账号的‘我的表情包’里真的多一套”：SnowLuma 只开放了收藏表情和系统表情的接口，没有商城收藏 / 表情包下载的接口；商城网页要手机统一登录。桥里用本地系列库模拟这一层，行为上等价：能存、能查、能发。

## 记录里的那一幕

14:51 私聊，主人教小箭头 → 系列下载 → 出现在收藏下一页；她回“原来还有这一层，我一直当收藏只能一张一张攒 / 照这么下，一整套能一次进来，那我这仓库怕是要爆”。

同一天 14:10 的事故里，她发出去的 `#124` 标签只有“表情”，追问时看不到图、也说不清。两件事是同一个缺口：商城表情在桥里既没有名字，也没有系列。

## 证据

### 线上消息已经带着答案

从 SnowLuma 的消息库里取到的真实商城表情（只列公开的表情包信息，不带群号和账号）：

| emoji_package_id | 包名 | 包简介 | 收到的 summary | 包内官方名 |
| --- | --- | --- | --- | --- |
| 246925 | 小喵包 | 小喵包的日常生活w | [捏捏] | 捏捏 |
| 249028 | 鸡仔仔01 | 是鸡仔妈妈哦~ 画：DEiEAF | [舔屏] | 舔屏 |
| 242443 | 吃吃06 | 一杯吃吃表情包来了！ | [吃瓜] | 吃瓜 |
| 233426 | 星月璃璃璃 | B站直播间：22901614 | [安详] | 安详 |
| 236517 | 是芬瑞哦 | 所以今天到底是几点睡的呢？ | [可爱捏] | 可爱捏 |

- 消息里的 `emoji_id` 就是包目录里 `imgs[].id`，五套全部对得上。
- 同一套的 `key` 相同：246925 里 `52a3d7...`、`0726b6...`、`4df8d1...` 三张不同表情共用一个 key；249028 的 10 张、236517 的 6 张也各自只有一个 key。key 不是一张一个，这是“见一张就能发整套”的依据。
- 这些消息在桥里现在长这样：`type: "image"`，`sub_type: 0`，`summary: "[捏捏]"`，另有 `emoji_id` / `emoji_package_id` / `key`。桥的 `image` 分支只读了 `url/file/summary/sub_type`；`mface` 分支等的是 `type: "mface"`，SnowLuma 并不发这个类型。所以字段在进 `解析消息段` 时就被丢掉了。

### 公开的包目录

```text
https://i.gtimg.cn/club/item/parcel/<packId 的个位>/<packId>.json
```

- 返回 `name`、`mark`、`author`、`price`、`updateTime`、`imgs[]`；每张 `imgs[]` 有 `id`、`name`、`keywords`、`param`。
- 246925 的目录约 2.9 KB，16 张；`price: 0`。不需要登录、不需要 Referer。
- 图片 id 原样用，不要套收藏表情的 32 位 md5 正则：有的 id 带 `face` 前缀（如 `face77b7...`），URL 也要带前缀。

### 图

```text
https://gxh.vip.qq.com/club/item/parcel/item/<id 前两位>/<id>/raw300.gif
https://gxh.vip.qq.com/club/item/parcel/item/<id 前两位>/<id>/300x300.png
```

- 两者都实测 200；`gxh.vip.qq.com` 已在现有 QQ 媒体域名白名单里。
- 图统一走 `gxh.vip.qq.com`；`i.gtimg.cn` 只用来取目录，不用改图片白名单。

### 发

- SnowLuma 的 `mface.fromSegment` 接受 `{ emoji_id, emoji_package_id, key, summary }`，组包时用 `faceId / tabId / key`；`send_group_msg` / `send_private_msg` 直接能发。
- 同包 key 共用，见上表。
- **唯一没验的**：拿 A 张的 key 发同包 B 张。需要一次真发（发给主人私聊即可），验证后再把这条当默认路径；失败就退回“先收进收藏再发”。

### 商城本身

- `https://zb.vip.qq.com/hybrid/emoticonmall/home` 打开是“手机统一登录”。
- SnowLuma 的动作清单里只有 `fetch_custom_face`、`fetch_custom_face_detail`、`fetch_sys_faces`、`search_sys_faces` 等，没有商城列表 / 包下载。
- 所以**不做登录抓商城、不做全站爬取**；系列来源只有“聊天里见过的包”和“主人明确给的 id”。

## 做法

### 第一层：认得出、叫得对（小改，先落）

- `解析消息段` 的 `image` 分支接住 `emoji_id / emoji_package_id / key`，`summary` 去括号；有 `emoji_id` 就标 `商城/表情`，别只靠 `subType`。`mface` 分支同样。
- 新增 `lib/sticker-pack.js`：
  - `取系列(packId)`：抓目录，缓存 7 天；失败只回落 summary，不阻塞消息。
  - `净表情名()`：官方名优先；空 / 泛词退回 summary；再退回场景。
  - `系列图址(id, 动/静)`：gxh 直链。
- `存表情包`：自动收藏的标签改成“官方名 → 场景 → 表情”，不再一律“表情”；索引多存 `packId / packName / packMark`（旧索引缺字段不影响）。
- 提示：清单里显示 `#124 捏捏`；图注可带 `来自《小喵包》`；不再把“表情”当正式名。
- 学表情统计：商城表情也算表情，群表情语感不再漏掉这一类。

### 第二层：存一整套、用整套（完整功能）

- 新索引 `qq-packs.json` + `qq-stickers/packs/<packId>/`；每套存 `name / mark / author / key / price / addedAt` 和每张 `{ id, name, keywords, file, bytes }`。
- 触发：她写 `[存系列:#<packId>]`（不发出去）；提示在本批出现商城表情时给出 `#id《包名》N 张`，主人说“这套存下来”她就写。也接受主人直接点名已见过的包。
- 限额：只收 `price === 0`、`status` 正常；单套 ≤ 40 张、≤ 10 MB；每天 ≤ 2 套；总 ≤ 30 套 / 300 MB；超了明说，不静默丢。
- 发送：`[发表情:系列#<packId>:<名字>]` → 找本地条目 → `send_group_msg` / `send_private_msg` 的 `mface` 段（`emoji_id / emoji_package_id / key / summary`）。发成功才记；key 缺失就退回“先收进收藏再发”或照实说发不了。
- 回看：主人问“那套里那个捏捏”，按名字 / 关键词在系列库里找，取本地图进上下文；找不到就说找不到。
- 设置页：在“她在外面 → 通到 QQ”的表情区加“系列”，显示包名、张数、占用，可删；不做原始 JSON。
- 提示只列最近 / 常用的 2–3 套和每套前几个名字，不把几百张全铺进去。

### 不做

- 不批量爬商城、不登录商城、不用主人或鱼的 QQ 去扫码。
- 不把整套塞进 QQ 收藏：现在收藏 129/200，剩 71 个位置，一套 16 张，四套就满。
- 不在没验证的情况下假设 key 能跨张发送；先测一张。

## 验证

- 单测（离线 fixture）：5 套目录解析、官方名优先、summary 回落、缓存 TTL、非 free 拒绝、限额、旧索引兼容、mface 段构造、提示快照。
- 线上小试：选 246925（16 张，0.57 MB），下载 → 核对名字 → 发同包另一张给主人私聊；成功后再开自动。
- 失败路径：目录 404 / 超时、图片 404、key 缺失、收藏满，都要有明确说法，不假装成功。

## 代码落点

- `fish/plugins/dsh-qq-bridge/lib/host.js`：`解析消息段`、`存表情包`、`试自动存表情`、`表情提示`、发送分支。
- `fish/plugins/dsh-qq-bridge/lib/sticker-pack.js`（新）：纯函数 + 注入 fetch，便于离线测试。
- `fish/plugins/dsh-qq-bridge/lib/settings-catalog.js` / `client.js`：系列列表（第二层）。
- `fish/plugins/dsh-qq-bridge/tests/`：`视频.mjs` 的 mface 用例扩展；新增系列用例。
- CHANGELOG + 版本号按规矩走。

## 成本

- 第一层：解析 + 取名 + 缓存 + 测试，一次小版本。
- 第二层：系列库、发送、限额、设置页、测试，一次完整版本；主要成本在发送验证和设置页。
