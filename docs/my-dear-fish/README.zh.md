# 大肥鱼

[English](README.md) | 中文

本仓库是 DeepSeek Harness 的一个分支，随 Windows 桌面应用一起打包六个 Yuuyuko-uu 插件和出厂默认层。新建的桌面 profile 一开始就带齐六个插件与大肥鱼人设；之后对 profile 的修改仍会覆盖出厂层。

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
| `dsh-fish-memory` | 1.1.8 | `lib/index.js` | 随时间淡化的长期记忆。 |
| `dsh-feiyu-mood` | 0.2.1 | `lib/index.js` | 每轮变化并随时间平复的心情。 |
| `dsh-speak-up` | 0.1.8 | `lib/host.js` | 无人说话时主动搭话。 |
| `dsh-tts-bridge` | 1.2.7 | `lib/index.js` | 通过 DeepSeek 网页语音朗读。 |
| `dsh-qq-bridge` | 0.1.7 | `lib/host.js` | 无需机器人账号的双向 QQ 消息。 |
| `dsh-bili-subagent` | 0.2.2 | `index.js` | 通过委派子代理浏览 B 站。 |

## 层序

桌面 profile 依次组合 `dsh-base`、`dsh-web-app` 和大肥鱼 bundle，然后应用 profile 自己的 `cordis.patch.yml`。大肥鱼 bundle 提供人设前缀和六个插件挂载；profile 层始终优先，因此用户设置与后续修改会覆盖出厂默认。

## 修改出厂行为

- 在 `fish/plugins/<name>/` 下修改插件代码；运行时加载该包 `main` 声明的入口，随包的 `lib` 文件是纯 JavaScript，没有单独的构建步骤。
- 在 `fish/bundle/cordis.patch.yml` 中修改默认人设与插件挂载。
- 增删插件时，同时更新 bundle patch 和 `apps/desktop/scripts/prepare-fish-plugins.ts` 中的 `PLUGIN_NAMES`。
- 按[构建 Windows 安装包](build.zh.md)重新构建桌面应用。

## 仓库访问

源码位于私有仓库 `https://github.com/zxr121/MyDearFish`。请使用有私有仓库读取权限的凭据克隆。

```
git clone https://github.com/zxr121/MyDearFish.git
```

这台开发机无法直连 `github.com:443`，因此推送经 `ssh.github.com:443` 使用仓库部署密钥；密钥不放在仓库内。其他机器通常通过 HTTPS 克隆。
