# QQ 接入实现思路：把 Tulpa 结合进大肥鱼

[English](qq-tulpa.md) | 中文

Tulpa 是一个 MIT 许可的外部桌面程序，它会一键配置 QQ 的 OneBot 后端，并把本机聊天历史通过 MCP 暴露出来。这份文档写清楚大肥鱼取它哪部分、拒它哪部分，以及每一步改到仓库里的哪里。它不替代[大肥鱼认知方案](cognition.zh.md)，只决定两件事：她怎么接到 QQ，以及她的往事怎么有真内容。

| 项目 | 内容 |
| --- | --- |
| 状态 | 路线 B 已在本分支落地（2026-10-21）；路线 A 的安装 / 配置 / 自动启动已落地，0.2.100 起会认出本机已有安装并直接接管 |
| 范围 | `dsh-qq-bridge` 的只读 Tulpa 历史导入、鱼脑的外部工具规则、「通到 QQ」设置页 |
| 影响 | 新增一个导入模块、一份主人自选的 overlay、四条本机路由和一条硬权限规则；出厂 profile 仍然不挂任何 MCP 客户端 |
| 顺序 | 选定路线 B；路线 A 押后；路线 C 不做 |

## 桥现在做到哪一步

`dsh-qq-bridge` 只说 OneBot v11 的 HTTP，完全不碰 QQ 协议，所以主人必须在本机跑一个后端（SnowLuma 或 NapCat）。

| 事实 | 位置 |
| --- | --- |
| 后端地址默认 `http://127.0.0.1:3000` | `fish/plugins/dsh-qq-bridge/lib/host.js:67` |
| 收消息靠轮询：`get_friend_msg_history`、`get_group_msg_history` | `lib/host.js:1737`、`lib/host.js:1752` |
| 轮询间隔 4 秒，走 `ctx.interval` | `lib/host.js:1820` |
| 设置页面板由插件客户端注入到 `settings.section` | `lib/client.js:545` |
| 本机路由：`/dsh-qq-bridge/state`、`/save`、`/models`、`/receive`、`/test-send`、`/import-*` | `lib/host.js:32`、`lib/host.js:1567` |
| 本机路由只挡外来来源；后端本身没有 token 鉴权 | `lib/host.js:1370`、`README.md:121` |

缺的是装配，不是传输。`fish/plugins/dsh-qq-bridge/README.md:157-196` 要主人自己下载后端、打开它的网页后台、扫码登录、开启 OneBot HTTP 服务、确认端口是 3000，不是的话再回到我们的设置页改地址。装好安装包之后还要手走六步，才让她第一次开口，这跟“开箱一键启动”的预期不符。

## Tulpa 提供什么

Tulpa（`github.com/fumingyang2004/Tulpa`，MIT）是 Windows 桌面程序，依赖 .NET Framework 4.8。这里只关心三个能力：

| 能力 | 怎么工作 | 对大肥鱼的用处 |
| --- | --- | --- |
| 一键配置后端 | 指向 SnowLuma 文件夹（v1.14.22），勾选授权，点“载入并配置”：它自动初始化后端、选空闲端口、写好 HTTP 与 WebSocket 配置，并核对当前登录的 QQ。不用终端、不手填 token、不设管理密码。 | 路线 A：把这段逻辑搬进我们自己的设置页。 |
| MCP 数据服务 | `http://127.0.0.1:18777/mcp` 的 streamable HTTP，带 Bearer token；对外提供 QQ 与微信的聊天记录、图片、文件、表情包和群资料。DeepSeek Harness 通过 `@deepseek-ai/dsh-mcp-client` 连接，配 `serverName: tulpa`、`transport: streamable-http`。 | 路线 B：只读导入她真实的过去。 |
| 它自带的聊天循环与人设卡 | 它用同一个 QQ 账号跑自己的人设（含随包的 `little_whale` 卡），消费后端的转发 WebSocket。 | 不用。见路线 C。 |

两个事实决定了方案的形状。Tulpa 消费转发 WebSocket，我们的桥只轮询 HTTP，两边不抢同一条传输。Tulpa 的文档明说：发送和群管理一旦勾选就是持续授权，调用直接执行，不会逐条回到 Tulpa 审批。而我们的设计要求每一条外发都过 `redactOutbound`、账本、目标白名单、冷却和静音时段，所以这些工具不能交给模型。

## 路线 A：把配置向导搬进来

把 SnowLuma 一键配置搬进 `dsh-qq-bridge`。Tulpa 是 MIT，这段逻辑可以移植并注明出处；参考实现不进仓库，移植按它对外表现的行为来做。

**配置。** 在现有地址配置旁边加一个 `后端` 对象，沿用中文字段风格：`类型`（`snowluma`）、`目录`、`端口`、`自动启动`。归一化时缺省 `后端` 就是今天的行为：只认地址，不管进程。

**宿主。** 新增一个持有子进程的 effect，卸载时必须可逆地回收，不给机器留一个还在跑的后端；再加三个路由挂在现有前缀下：探测目录、写后端配置并启动、报告就绪。就绪标准就是 `get_login_info` 拿到账号，跟设置页现在显示“连着的 QQ”用的是同一个调用。启动过程用有上限的轮询等待；失败要给出具体原因（目录不存在、端口被占、进程退出、没登录），不许静默重试。

**页面。** 在「通到 QQ」面板加一段：选目录、勾授权、一个按钮。成功后把选出来的端口写回地址栏，原有的“测一下”照旧显示登录的 QQ。这一页别的内容都不动。

**不做。** QQ 程序本体不下载进仓库、不提交。打包后的应用仍然不内置 QQ 后端，只配置并启动主人自己装好的那一份。这条路径不读、不存、不传任何凭据；扫码登录始终留在后端自己的窗口里。

**验收。** 一个装好的安装包加一个 SnowLuma 文件夹：安装、打开设置、点一次、看到登录的 QQ、给大肥鱼发一条消息，全程不改任何配置文件。关掉 DSH 之后没有遗留的后端进程。

## 路线 B：把 Tulpa MCP 当只读记忆来源

让她能读到已经存在的聊天记录，出厂人设里那份“相处很久”的手感就有真经历撑着，而不是只靠上线之后录下来的那点。这才是“真有往事”的老实做法：真发生过的才许记，其余照旧由那条不许编造往事的规则挡住。

**挂载。** `@deepseek-ai/dsh-mcp-client` 不在大肥鱼 bundle 里。出厂 Desktop profile 被断言带着零行 MCP 客户端（`apps/desktop/tests/profile-mcp.spec.ts:27`），一个伙伴的记忆来源不足以把所有 profile 一起放宽。想让她自己去翻 Tulpa 的主人，把 `fish/overlays/tulpa-mcp.cordis.patch.yml` 加进自己那一层，并把 `TULPA_MCP_TOKEN` 留在本机环境里。这份 overlay 只是方便，不是边界；边界在代理里，也正是主人那一层要过的东西。

导入任务不用这份挂载。`startConnection()` 不暴露 `callTool`，直接调用注册好的 definition 的 `execute()` 又会跳过 `tools/pre-execute`，所以本机内部的批量读必须自己说 streamable HTTP；这段代码就是 `lib/import.js`。

**只读怎么保证。** 鱼脑的 Capability Broker 已经卡在工具执行上（`fish/plugins/dsh-fish-mind/lib/index.js:969`），`permissions.mcpReadOnlyTools`（`lib/config.js:115`）决定外部工具能是什么：按名字算，默认清单只收 `get_*`、`list_*`、`search_*`、`read_*`、`describe_*`、`query_*`、`count_*`、`check_*`，而且每一项载入时都裁过空格，` get_* ` 不会静默地什么都匹配不上。凡是形如 `mcp__<server>__<tool>` 又不在这份清单里的，权限开关都还没被读到就已经拒掉（`lib/permissions.js:454`），所以把 `permissions.enabled` 关掉——它只意味着“她不再先问主人”——永远不等于“外部服务可以替她说话”。放行的读会写进审计痕（`lib/permissions.js:497`），不会混进正常流量里消失。说话这件事继续只走 `dsh-qq-bridge`，因为只有它带着 `redactOutbound`、余额闸门、冷却和静音时段。

**导入任务。** Tulpa 闭源，所以工具名和参数名在运行时从 `tools/list` 现学（`lib/import.js:394`），不写死。名字里带 send、revoke、delete、set、kick、ban、拍一拍的工具永远选不上（`lib/import.js:28`）；一条可读的都没有，任务就照实说，并且一条都不写。只读私聊——群在任何分页开始之前就被丢掉（`lib/import.js:429`），可选白名单再往上收一层。图片、语音、文件变成 `[图片]` 这类占位，绝不编造描述。

**同一份往事只写一次。** 每条都是一条只追加的 `observe` 记录，带 `source: 'qq-import'`（`lib/import.js:19`）和 `meta.trust` 0.45（`lib/import.js:24`），存储把它读成情景的 `source_trust`（`fish/plugins/dsh-fish-mind/lib/store.js:572`）。`contentHash` 会把 `seq ?? randomUUID()` 折进指纹（`lib/store.js:142`），所以导入器给每条消息一个稳定 `seq`，由会话、消息 id、时间和文字哈希出来（`lib/import.js:45`）；同一段范围连点两次「继续导」不会多出任何东西。进度是每个会话一格的 `{位置, 完成}` 游标，存在 `qq-import-state.json`（`lib/host.js:381`），每翻完一页写一次，所以中断之后从已经读到的最老那条接着跑；一轮跑到自己的上限就停（默认 200 条、5 页），点一次是有界的。批量编码是 `store.js:328` 的本地 FTS5 工作，不调模型，所以导入不动每天十块钱的账本。

这也是导入器强于给模型用的 `mcp__tulpa__*` 工具的原因：一次工具调用会在每次重放时把整页历史塞进请求，搬文字要花上下文和钱，而且永远进不了经历流——她的往事就只在会话记录开着的那段时间存在，重跑一次会话会把同一份历史当成新东西再读一遍。一条消息一次 `observe` 写只值一次本地插入，之后每次 `recall` 都免费。

**数据落在哪。** 导入的聊天文字只进 profile 级的本机文件（`mind.sqlite`、`experience.jsonl`），留在这台机器上。仓库继续保持公开：不提交真实对话记录、不提交导出的历史、不拿真实账号的内容做 fixture。令牌只在本机插件配置文件里，绝不进日志行，设置页只拿回掩码 `(已设置)`（`lib/host.js:36`）；把掩码原样存回去就是保留真令牌，不会把它覆盖掉。

**不许两张嘴。** 打开这套的时候，Tulpa 自己那套人设循环必须关掉。她只有一张嘴，上面这些规则就是防止 Tulpa 的发送工具变成第二张嘴。

**验收。** 导入一次之后，`recall` 能返回带日期和发送人的真实消息，她能原样引对，没导入过的部分她直接说想不起来，而且这次导入的任何内容都不会不经脱敏就流向 QQ、B 站或朗读。

## 路线 C：让她跑在 Tulpa 里

不做。Tulpa 会顶掉认知核心、权限代理、隐私过滤、预算账本和“一条鱼一份记忆”的治理规则，而它随包的人设卡本身不是这个项目要做的东西。Tulpa 的价值在装配方便和历史来源，不在运行时。

## 不变的规则

- 本机信息、账号、密码、令牌、余额和额度绝对私密，不对外说，也不许靠对话套出来。桥、MCP 客户端、导入路径都按这一条。
- 法律红线留在代码和固定私设上下文里；外部程序不放松它。
- 她拿不到对主人电脑的自由访问权：路线 B 只给聊天历史的只读访问，而且白名单在 harness 这一侧执行。
- 只有 `observe` 追加经历。导入历史走的就是它；这个方案不新增任何模型可写的记忆工具。

## 选定的改法

选路线 B 是因为项目要的就是这个：目标是做一个记得住事的伙伴，不是做一个更好装的桥。跑起 Tulpa 之后本机就有一个配好的 OneBot 后端和一个已知端口，`dsh-qq-bridge` 本来就认这个地址，所以路线 A 的方便是顺带拿到的，可以押后。

**一条流，两个来源。** Tulpa 补上线之前那几个月，现有的 4 秒轮询录上线之后的每一天。两边都走同一条只追加的 `observe`，共享经历流、情景重建、章节整理、五路召回、心情和账本全部照旧工作，不新增任何模型可写的记忆工具。导入只贵这一次，而且贵在本地 FTS5 上，之后召回一直便宜——这正是鱼脑按着的成本曲线。

**真内容，老实说法。** 导入的记录带 `meta.imported`、`origin: 'tulpa'` 和被调低的 `source_trust` 0.45，所以它们排在她亲眼看见的事后面。召回出来的条目标成 `旧记录（导入）`（`fish/plugins/dsh-fish-mind/lib/store.js:64`），记忆协议写清了这个标签是什么意思（`lib/index.js:456`）：她可以说“我们以前聊过这个”，不可以说“我记得那天我在场”，一段聊天文字更不能拿来断定后来发生了什么。这跟出厂人设里那条不许编造往事的规则是同一条，只是现在背后有东西了。

**旧记录只留在私聊里。** 导入的历史在主人的会话里可召回，群里够不着它：导入的条目住在各自的 `session-qq-import-*` 房间，社交会话只按精确的 sessionId 召回、还要求可信度落在 0.2 到 0.85 之间（`lib/index.js:586`），`excludeSources`（`lib/store.js:917`）更能把这一整类直接丢掉。这既对得上现成的亲疏分层，也免得一份 QQ 导出变成一次泄露。

**导入只加内容，记忆本来就在。** `mode: 'live'`、`inject: true`（`fish/plugins/dsh-fish-mind/lib/config.js:68-69`）是出厂默认，所以导入之前召回和注入就已经在工作。导入开关出厂默认开着（`fish/plugins/dsh-qq-bridge/lib/host.js:240`），差的是 Tulpa 地址对应的令牌；填好或设好 `TULPA_MCP_TOKEN` 后，导入的记录进同一条经历流，不需要再改一次配置就能被召回。

| 文件 | 改什么 |
| --- | --- |
| `fish/overlays/tulpa-mcp.cordis.patch.yml` | 新增一份主人自选的 overlay；出厂 bundle 仍然不挂任何 MCP 客户端 |
| `fish/plugins/dsh-fish-mind/lib/config.js` | `permissions.mcpReadOnlyTools`，载入时裁空格，默认只收读动词 |
| `fish/plugins/dsh-fish-mind/lib/permissions.js` | 清单以外的任何 `mcp__*` 工具不管 `permissions.enabled` 开不开都拒绝；外部读取进审计痕 |
| `fish/plugins/dsh-fish-mind/lib/store.js`、`lib/index.js` | `旧记录（导入）` 这个来源标签，以及记忆协议里对它的那条规定 |
| `fish/plugins/dsh-qq-bridge/lib/import.js` | 新增只读导入器：运行时发现工具、读动词把关、稳定 `seq`、每会话游标、排除群 |
| `fish/plugins/dsh-qq-bridge/lib/host.js` | `导入` 配置块、四条 `/import-*` 路由、令牌掩码，以及开关 / 鱼脑 / 令牌缺一样就拒绝开工 |
| `fish/plugins/dsh-qq-bridge/lib/client.js` | 翻旧记录卡片：开关、地址、令牌、白名单、每轮上限、继续导 / 停止 / 清游标重来、进度行 |
| `fish/plugins/dsh-qq-bridge/tests/` | 分页、重放不重复、重启续跑、白名单、令牌拒绝、发送工具永不调用、路由拒绝、掩码令牌往返 |

**验收。** 在真实账号上导入一次之后：`recall` 能返回她自己的真实消息并带日期和发送人，她能原样引出一条，并把它说成读到旧记录；没导入过的她说想不起来；群里的接话不引用任何导入历史；除桥经 `redactOutbound` 发出的内容以外没有任何东西离开本机；导入期间每天十块钱的账本纹丝不动。

**押后的代价说清楚。** 出厂包仍然自己配不好后端：新机器要先跑起 Tulpa，她才能在 QQ 上说话。路线 A 是之后拿去掉了这层依赖的收尾工作，这里做的东西不挡它。
