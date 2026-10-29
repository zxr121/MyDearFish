# 创造模式完全权限 + QQ 花名册 + 更多可配置项（2026-10-29）

## 需求

- 设置页「用创造模式开一个调试会话」打开的会话，工作区是鱼的安装目录（已完成），但这个会话还要默认拿到完全权限，能真的改代码，不再被审批和鱼脑的只读笼子挡住。
- 开发者模式下，她能读到鱼 QQ 当前登录账号有哪些群号、QQ 号，再照着帮主人把群/好友名单、主动搭话、B 站等设置配好。
- 安全、隐私、法律红线、额度、凭据和鱼脑数据仍然不能由工具改。

## 做法

### 1. 创造模式会话默认完全权限

- 会话创建后（`session/created`）识别「`agentPreset === 'cordis'` 且 `cwd` 是鱼的安装目录」——这正是设置页按钮创建的工作区。命中的会话用 `permissionPresets.set(session, 'danger-full-access')` 钉到完全权限（沙箱 danger-full-access + 审批 never），后面直接改代码、跑命令都不用再弹。
- 只在安装目录里的创造模式生效；其它工作区的普通会话保持宿主的默认权限档。
- 服务不在或预设被部署删掉时只记诊断，不阻断会话创建。

### 2. 鱼脑的只读笼子对创造模式放行源码

- 鱼脑 Capability Broker 原来把 `$DSH_HOME/fish-mind`（记忆、预算、权限、配置）和插件自己的 `lib` 源码一起封死，连创造模式也改不了 `lib/*.js`。
- 新增创造模式判定（同样按 `cordis` + 安装目录 `cwd`）：这类会话可以把源码（包括 `fish/plugins/dsh-fish-mind/lib`）写进去，改完由主人重启/重同步生效。
- 仍然封死：`$DSH_HOME/fish-mind` 数据、凭据/身份文件、本机探测命令、不可逆危险命令、外部 MCP 写操作。创造模式可以改行为代码，但不能通过工具改记忆、预算、权限数据或把密钥带出来。
- 创造模式 brief 补一句：这个会话默认完全权限，可以直接改源码；鱼脑数据目录不通过工具改。

### 3. 开发者模式读 QQ 花名册

- 新增只读工具 `fish_qq_roster`：
  - 读 `$DSH_HOME/qq-bridge-config.json` 里的 OneBot 地址，依次尝试配置地址、`127.0.0.1:3002`、`127.0.0.1:3000`；
  - 调 OneBot 的 `get_login_info`、`get_group_list`、`get_friend_list`，返回鱼 QQ 自己的号/昵称、群（号/名/人数）、好友（号/名/备注），以及当前设置里已有的群/好友/关掉/只听/少掺和名单；
  - 不读后台密码、令牌或登录态，只读，不发消息。
- 权限门：必须 `developer.enabled === true` + 主人前台会话（群聊、好友、子代理、后台会话一律拒绝），每次放行记 `fish.qq.roster` 审计。
- 拿到的号码进入主人自己的会话记录；工具说明提醒不要把号码发到群里。

### 4. fish_config 覆盖更多可配项

- 新增 QQ 社交名单：群、好友、关掉（`group:`/`friend:`）、只听、少掺和，以及社交开关。
- 每项校验号码格式和条数上限；保留配置文件里的未知字段。
- B 站继续用 bili 插件已有的 `bili_config`（它自带字段校验、范围钳制和公开发言人工确认），不在鱼脑里复制一套 B 站 schema。
- 仍然不开放：顶层总开关、试运行、最低余额、预算、记忆、搬迁、自动备份、权限、凭据、代码（创造模式源码除外）和鱼脑数据目录。

## 代码位置

- `lib/index.js`：创造模式判定、`session/created` 权限钉住、`fish_qq_roster` 注册、开发者提示、brief。
- `lib/permissions.js`：创造模式源码放行、花名册权限门和审计。
- `lib/qq-roster.js`：OneBot 花名册读取。
- `lib/config-files.js` / `lib/settings-catalog.js`：QQ 社交名单字段和校验。
- `client.js` / `README.md` / `docs/my-dear-fish/fish-settings.*`：设置页和文档文案。

## 验证

- `node --test fish/plugins/dsh-fish-mind/tests/*.test.mjs`
- 手工：设置页打开创造模式会话 → GUI 权限显示完全权限；让它改 `fish/plugins/dsh-fish-mind/lib` 里的代码 → 能写；让它改 `data/fish-mind` 里的数据 → 仍然拒绝。
- 手工：开发者模式开 → `fish_qq_roster` 返回群/好友；关掉或在群聊会话里调用 → 拒绝；用 `fish_config` 把读到的群号写进 `社交.群` → 设置页能看到。
- 手工：`bili_config` 读/改 B 站设置照旧；自动评论/回复/私信收件人仍要主人确认。
