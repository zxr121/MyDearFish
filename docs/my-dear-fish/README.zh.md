# 大肥鱼

[English](README.md) | 中文

本仓库是 DeepSeek Harness 的一个分支，随 Windows 桌面应用一起打包五个 Yuuyuko-uu 插件、鱼脑插件 `dsh-fish-mind` 和出厂默认层。新建的桌面 profile 一开始就带齐六个插件与大肥鱼人设；之后对 profile 的修改仍会覆盖出厂层。

## 仓库新增内容

| 路径 | 用途 |
| --- | --- |
| `fish/plugins/` | 六个插件的源码，包含运行时加载的预构建 `lib` 入口。 |
| `fish/bundle/` | `@mydearfish/dsh-fish-bundle`，挂载插件并设置默认人设的 profile 层。 |
| `apps/desktop/scripts/prepare-fish-plugins.ts` | 把 bundle 与插件复制进打包后的运行时，并在 dsh 清单中声明它们。 |
| `apps/desktop/src/project-manager.ts` | 把该 bundle 加入每个新建桌面 profile 的 bundles。 |

## 插件

| 插件 | 版本 | 入口 | 能力 |
| --- | --- | --- | --- |
| `dsh-fish-mind` | 0.3.2 | `lib/index.js` | 共享经历流、情景记忆与原文回查、工具权限判定、隐私与注入防护，以及按官方峰谷价结算的零花钱账本。 |
| `dsh-feiyu-mood` | 0.2.1 | `lib/index.js` | 每轮变化并随时间平复的心情。 |
| `dsh-speak-up` | 0.1.8 | `lib/host.js` | 无人说话时主动搭话。 |
| `dsh-tts-bridge` | 1.2.7 | `lib/index.js` | 通过 DeepSeek 网页语音朗读。 |
| `dsh-qq-bridge` | 0.2.30 | `lib/host.js` | 无需机器人账号的双向 QQ 消息，能展开合并转发（连同转发里的图片）、收到后端推来的戳一戳；可选的群内自主接话，只按自己的兴趣挑内容、决定回不回，画像成熟后用零成本注意力分快判省判断费，并留了探索新话题的额度。 |
| `dsh-bili-subagent` | 0.2.3 | `index.js` | 通过委派子代理浏览 B 站。 |

六个插件的机制、数据文件、跨插件链路、默认状态和改造点见[插件养鱼机制](plugins.zh.md)；鱼脑的经历流与权限见 [dsh-fish-mind README](../../fish/plugins/dsh-fish-mind/README.md)。

## 认知方案

[大肥鱼认知方案](cognition.zh.md)从人类记忆与行为的生物学机理出发，提出新增认知核心 `dsh-fish-mind` 的完整设计：经历流、情景与语义记忆、情绪与驱力、自我与关系、语言监控、睡眠固化，以及分阶段实施和验收指标。阶段 0 的鱼脑代码已经实现，当前在影子运行；召回、注入和后台生活仍按方案分阶段推进。进度、任务拆分、验收数据和接手方式见[开发计划](development-plan.zh.md)。想一页看清整体怎么搭——插件、层序、记忆、成本和安全边界各放在哪里——见[实现思路](implementation.zh.md)。

## QQ 接入方案

[QQ 接入实现思路](qq-tulpa.zh.md) 定她怎么接到 QQ：`dsh-qq-bridge` 已经做到哪一步、外部程序 Tulpa 哪几部分值得取（一键配后端、只读的历史来源）、哪几部分拒掉（它的持续发送授权、它自己的聊天循环），以及哪些规则不动。

## 层序

桌面 profile 依次组合 `dsh-base`、`dsh-web-app` 和大肥鱼 bundle，然后应用 profile 自己的 `cordis.patch.yml`。大肥鱼 bundle 提供人设前缀和六个插件挂载；除鱼脑从代码注入的固定私设外，profile 层始终优先，因此用户设置与后续修改会覆盖出厂默认。profile 组合与打包细节见[插件与默认层机制](mechanism.zh.md)。

## 修改出厂行为

- 在 `fish/plugins/<name>/` 下修改插件代码；运行时加载该包 `main` 声明的入口，随包的 `lib` 文件是纯 JavaScript，没有单独的构建步骤。
- 在 `fish/bundle/cordis.patch.yml` 中修改默认人设与插件挂载。
- 增删插件时，同时更新 bundle patch 和 `apps/desktop/scripts/prepare-fish-plugins.ts` 中的 `PLUGIN_NAMES`。
- 按[构建 Windows 安装包](build.zh.md)重新构建桌面应用。

## 拉取后运行

打包后的桌面版自带插件，拉取源码不会改变已安装的应用；从源码或本地 profile 运行时，profile 的 `node_modules` 里是 pnpm 装出的实体副本，`git pull` 也不会自动更新它。拉取后在仓库根目录运行一次：

```
fish\sync-runtime.cmd
```

它会定位 `$DSH_HOME`（默认 `~/.dsh`；工作区内存在 `.dsh` 时用工作区的），在 `profiles/web` 里重装本地 `file:` 依赖，并逐个核对安装版本与源码一致。刷新前先关掉 dsh（脚本会改 profile 的 `node_modules`），完成后重启即生效；非默认 profile 用 `--profile`、非默认家目录用 `--home` 指定。

## 仓库访问

源码位于公开仓库 `https://github.com/zxr121/MyDearFish`，可以直接克隆，不需要私有仓库权限。

```
git clone https://github.com/zxr121/MyDearFish.git
```

这台开发机无法直连 `github.com:443`，因此推送经 `ssh.github.com:443` 使用仓库部署密钥；密钥不放在仓库内。其他机器通常通过 HTTPS 克隆。
