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

一条命令走完：预检工作区 → 推 `fish-release-<UTC日期>` 标签触发 CI → 等 GitHub Release → 把安装包下到 `Downloads` → 对照 `nightly.yml` 校验大小和 SHA-512，最后打印完整路径和校验值。过程中显示每个阶段的耗时、CI 的 Run 编号与状态、下载百分比和速度；下载支持断点续传和自动重试，直连不通时改走 `gh-proxy.com` 镜像。

常用参数：

- `--tag fish-release-<日期>`：标签已经推过，只等发布、下载并校验。
- `--again`：这个提交已经打过版，仍要再打一版（默认会提示并退出）。
- `--dry-run`：只预检并打印计划，不推标签。
- `--out <目录>`：安装包下载目录，默认 `Downloads`。
- `--timeout <分钟>`：等 CI 的上限，默认 60。

打版前要有干净的提交；脚本会自己补好 node 和 pnpm 的 PATH，pre-push 的 typecheck 照常跑。

从源码刷新已经装进 profile 的鱼插件：

```sh
node fish/sync-runtime.mjs --profile desktop
```

默认使用的同样是 `data` 家目录。
