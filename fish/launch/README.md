# 启动入口

`launch-all.mjs` 依次拉起 SnowLuma、QQ 和 DSH 桌面端（开发实例），并等待各自端口就绪。

运行数据固定写在仓库的 `data` 目录，和安装版把数据放在 `<安装目录>\data` 是同一规则；不读写 `~/.dsh`。备份、换目录或换机器时把整个 `data` 一起带走即可——前提是同一个人的同一条鱼：`data` 里有会话、记忆、人物志、QQ 收藏表情清单和 QQ 桥配置（含 SnowLuma 后台密码），凭据也在里面。

把鱼交给朋友或换一个 QQ 号时不要带 `data`：用安装包另起一个空 home，性格和记忆走设置页的「整鱼档案」导出导入；档案不含收藏表情、通道配置和凭据。

Windows 快捷方式指向 `start-dsh.bat`（前台）或 `start-dsh-silent.vbs`（无窗口，开机启动用）。

从源码刷新已经装进 profile 的鱼插件：

```sh
node fish/sync-runtime.mjs --profile desktop
```

默认使用的同样是 `data` 家目录。
