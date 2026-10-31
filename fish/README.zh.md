# 大肥鱼运行层

[English](README.md) | 中文

这里是跑在 DSH 上的大肥鱼：插件、出厂层组合、启动和打版脚本，以及守住她行为的检查。运行数据不在这棵树里，而是放在 `data/`。

## 目录

- `fish/plugins/` —— 六个 Cordis 插件：鱼脑、QQ 桥、主动搭话、朗读桥、B 站巡检和心情。
- `fish/bundle/` —— 出厂层组合和打包清单。
- `fish/launch/` —— 一键启动、运行时同步和打版脚本。
- `fish/tests/` —— 跨插件的组合快照；每个插件的测试仍放在插件自己的目录里。
- `fish/tools/` —— 只读诊断：会话日志读取、版本诊断、对话健康观测和真模型金丝雀。

## 测试

`pnpm run test:fish` 会跑鱼脑单测、每个插件的冒烟套件、组合提示词快照和工具测试。改了 fish 文件时它在 pre-push 跑，打包 workflow 会跑，打版预检也会在推标签之前跑；没通过就不打包。`pnpm run test:fish:canary` 把固定的主人消息发给真模型，和冻结的 known-good 提示词比较回复字数；它需要 `DEEPSEEK_API_KEY`，没有密钥就返回非零，定位是夜间或手动检查，不卡发布。

## 行为变更

提示词正文、短期记忆窗口和风格提示决定她看到什么、怎么说话；改这些是行为变更，不是改文案。这样的改动必须：

- 用 `UPDATE_PROMPT_GOLDEN=1 node --test fish/tests/prompt-surface.test.mjs` 刷新组合快照，并逐条看 diff；
- 用成熟的主人画像（至少 24 条样本）跑风格和屋子场景，不能只用空画像；
- 保持房间隔离矩阵全绿：QQ 房间不漏进主人窗口，主人私下的话也不进群聊和好友视角；
- 改了提示词措辞就跑真模型金丝雀，只有接受新行为之后才重新冻结 known-good 基线。

[事故复盘 0005](../docs/postmortem/0005-fish-companion-short-reply-regression.zh.md) 记录了 2026-10 的回复退化是怎么穿过当时所有检查的。
