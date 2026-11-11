# 启动入口

`launch-all.mjs` 依次拉起 SnowLuma、QQ 和 DSH 桌面端（开发实例），并等待各自端口就绪。

运行数据固定写在仓库的 `data` 目录，和安装版把数据放在 `<安装目录>\data` 是同一规则；不读写 `~/.dsh`。备份、换目录或换机器时把整个 `data` 一起带走即可——前提是同一个人的同一条鱼：`data` 里有会话、记忆、人物志、QQ 收藏表情清单和 QQ 桥配置（含 SnowLuma 后台密码），凭据也在里面。

把鱼交给朋友或换一个 QQ 号时不要带 `data`：用安装包另起一个空 home，性格和记忆走设置页的「整鱼档案」导出导入；档案含记忆、性格倾向和可搬走的设置，不含收藏表情、账号群号、目标会话和凭据。

Windows 快捷方式指向 `start-dsh.bat`（前台）或 `start-dsh-silent.vbs`（无窗口，开机启动用）。

## 打版

双击 `release.bat`，或运行：

```sh
node fish/launch/release-fish.mjs
```

一条命令走完：预检工作区 → 先在本地打一版 unsigned exe（不签名，产物在 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts`）→ 推 `fish-release-<UTC日期>` 标签触发 CI → 等 GitHub Release → 把安装包下到 `Downloads` → 对照 `nightly.yml` 校验大小和 SHA-512 → 打成 `大肥鱼-<版本>-win-x64.zip`（exe + `安装说明.txt` + `nightly.yml`，旁边附 `.sha512`），最后同时打印本地包、CI 包和交付 zip 的路径与校验值。交付 zip 不含 SnowLuma 的二进制：说明里给镜像地址、文件名、摘要和「从本地 zip 安装」的做法。过程中显示每个阶段的耗时、CI 的 Run 编号与状态、下载百分比和速度；下载支持断点续传和自动重试，直连不通时改走 `gh-proxy.com` 镜像。

本地打包会重写 `apps/desktop/.desktop-build/targets/win-x64/runtime`，开发桌面端开着时脚本会先停下并提示退出；本地打包失败不会推标签，也不会触发 CI。`--tag` 只等已有发布，跳过本地打包。Windows 本机打包需要 Visual Studio C++ Build Tools，`tar` 用 System32 下的 bsdtar；Electron / electron-builder 二进制默认走 npmmirror，可用 `ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR` 覆盖。

常用参数：

- `--tag fish-release-<日期>`：标签已经推过，只等发布、下载并校验。
- `--again`：这个提交已经打过版，仍要再打一版（默认会提示并退出）。
- `--dry-run`：只预检并打印计划，不本地打包、不推标签。
- `--skip-local`：跳过本地打包，直接推标签等 CI（本机没装 VS C++ Build Tools 时用）。
- `--out <目录>`：安装包和交付 zip 的输出目录，默认 `Downloads`。
- `--timeout <分钟>`：等 CI 的上限，默认 60。

打版前要有干净的提交；脚本会自己补好 node 和 pnpm 的 PATH，pre-push 的 typecheck 照常跑。

从源码刷新已经装进 profile 的鱼插件：

```sh
node fish/sync-runtime.mjs --profile desktop
```

默认使用的同样是 `data` 家目录。

## 安装版的源码副本

安装包会把仓库的 `fish/` 作为 `resources/fish-src/fish` 一起打进去。第一次启动时复制到 `<安装目录>\data\fish-src`，之后每次启动按文件哈希合并：改过的白名单文件保留，没改过的跟着新包更新；内核文件从安装包原版恢复，改过的先备份到 `.kernel-backup/<时间>/`。启动时还会把 `dsh-fish-mind` 和 `dsh-qq-bridge` 同步进 `data/profiles/desktop/node_modules`，并在 profile 清单里写两条相对 `file:` 依赖；完全退出再打开就会加载改过的代码，不需要 pnpm、sync-runtime 或改 asar。

安装版可编辑白名单：`dsh-fish-mind` 的 `lib/tendency.js`、`lib/humor.js`、`lib/memes.js`、`lib/settings-catalog.js`、`lib/config-files.js`，以及 `dsh-qq-bridge` 的 `lib/host.js`、`lib/sticker-commands.js`。其它运行时文件（包括两个插件的 `lib/index.js`、`lib/permissions.js`、`lib/privacy.js`、`lib/budget.js`、`package.json` 和 `client.js`）每次启动都会从安装包原版恢复。`fish/bundle` 和另外四个插件只读参考，出厂人设走设置页的「性格人设」。

恢复出厂源码：删掉 `data/fish-src` 再启动，会从安装包重新生成。手工搬整个 `data` 会把源码副本一起带走；导出和自动备份不包含它。

## 测试、诊断和观测

- `pnpm run test:fish`：鱼脑、QQ 桥、组合提示词快照、说话风格契约、朗读和 B 站的整套无 key 测试。改到 `fish/**` 时 pre-push 会跑，打包 workflow 和 `release-fish.mjs` 也会在打版前跑；没过就不打包。
- `pnpm run test:fish:canary`：真模型金丝雀，夜间或改过提示词后手动跑，需要 `DEEPSEEK_API_KEY`。固定 8 条客观上要求说完整的主人消息，当前提示词和仓库里冻结的 known-good 各跑一遍，比中位字数、开头重复率和线索命中；连续两轮当前中位不到对照一半才失败。没有 key 会明确打印“跳过（不是通过）”并退出 2。提示词有意改动后，确认新提示更好，再用 `-- --freeze` 刷新 known-good。
- `pnpm run fish:doctor [-- --home <数据目录>]`：对比源码插件和 `data/profiles/*/node_modules` 里实际加载的副本（版本和 lib 内容），打印配置与最近一次请求的模型/effort、近 7 天主人回复中位。不一致时退出 1；测到旧代码、发错版本先在这里露出来。启动器每次启动也会把同一行写进 `启动日志.txt`。
- `pnpm run fish:health [-- --home <数据目录>] [--days 30] [--json]`：按天看主人回复的字数中位、思考中位、重复开头，主人提示里的教截短禁句和缺护栏，以及只剩「我：」的短期窗口。最近一天比前 7 天跌 40%，或出现退化信号时退出 1。发布后和每周各跑一次；安装版的数据目录是 `<安装目录>\data`（本机 `C:\MyDearFish\data`）。

三个工具都只读，不加锁、不改会话日志。
