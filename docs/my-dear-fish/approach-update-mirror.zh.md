# 更新镜像：让被墙的网络也能自更新

[English](approach-update-mirror.md) | 中文

## 现状

- 安装包里的 `resources/app-update.yml` 把更新源固定写成 `https://github.com/zxr121/MyDearFish/releases/latest/download/`。
- 校园网或防火墙挡住 GitHub 后，应用内检查更新、下载安装包、失败对话框里的“手动下载”都指向同一个不可达域名。
- 更新会直接替换可执行文件。公共 GitHub 代理既能替换 `nightly.yml`，也能替换安装包，`nightly.yml` 里的 sha512 无法自证；把更新交给代理等于把本机记忆和工具权限交给代理运营方。

## 目标

- 朋友在只放行国内地址的网络里，能自动检查、下载并安装新版本。
- 每发一版不需要人工搬运文件；失败必须显式报错，不能静默停在旧版。
- 不把任何密钥写进仓库或聊天；应用侧只读取公开地址。

## 方案

用腾讯云 COS 做只读镜像（项目已依赖 `cos-nodejs-sdk-v5`，并有 COS 发布代码；桶放 ap-beijing）。

应用内按顺序尝试更新源：COS 镜像 → GitHub。检查成功就用该源下载；electron-updater 的下载沿用同一次检查的 provider。构建时把顺序写进 `package.json` 的 `dshDesktopUpdateSources`；老版本没有这个字段，行为不变。

发布时 CI 把 `nightly.yml`、安装包、`.blockmap` 上传到 COS，`nightly.yml` 最后上传，避免客户端看到指向不存在文件的元数据。COS 只保留最近 2 个版本的安装包；`get/latest.exe` 是“手动下载”的稳定地址，每次发布覆盖。

镜像目录：

```
fish/win-x64/nightly.yml
fish/win-x64/deepseek-harness-<version>-win-x64-unsigned.exe
fish/win-x64/deepseek-harness-<version>-win-x64-unsigned.exe.blockmap
fish/win-x64/get/latest.exe
```

## 为什么不用公共 GitHub 代理

- 代理能同时替换元数据和安装包，无法用 sha512 自证；给鱼装更新等于把本机记忆交给代理运营方。
- 代理经常限速、断流，295MB 的安装包失败率高，失败后没有可用兜底。
- 如果以后要支持不受信任的镜像，先给 `nightly.yml` 加 Ed25519 签名、公钥随包，应用验签后再下载；这一步现在不做。

## 一次性人工步骤（需要你）

1. 腾讯云 → 对象存储：创建存储桶，地域北京，访问权限“公有读私有写”；桶名形如 `mydearfish-125xxxxxxx`。
2. 访问管理：建一个只用于上传的子用户（编程访问），只给它这个桶的读写权限；SecretId/SecretKey 自己保存，不发给任何人。
3. GitHub 仓库 → Settings → Secrets and variables → Actions：
   - Variable `FISH_MIRROR_COS_BUCKET` = 桶名（公开信息）
   - Secret `FISH_MIRROR_COS_SECRET_ID`
   - Secret `FISH_MIRROR_COS_SECRET_KEY`
4. 推一个 `fish-release-*` 标签，或手动跑 workflow。构建会把镜像地址写进安装包，并把产物传到桶里。
5. 从 Release 或 Actions 工件下载这次的新安装包，通过 QQ 或网盘发给朋友装一次；之后她就能走镜像自动更新。旧的已安装版本没有镜像地址，这一次必须人工装。

## 成本

- 存储：约 0.6GB（最近两版），按 ¥0.118/GB/月约 ¥0.07/月。
- 下行流量：¥0.5/GB；一次全量更新约 295MB，约 ¥0.15；增量更新通常小得多。
- 只有朋友更新时产生流量，目前人数下每月不到 ¥1。

## 代码改动

- `apps/desktop/scripts/desktop-auto-update-environment.mjs`：读取 `DSH_DESKTOP_UPDATE_FEED_MIRRORS`，校验地址并拼出有序 `sources`。
- `apps/desktop/scripts/electron-builder-config.mjs`：把 `sources` 写进 `extraMetadata.dshDesktopUpdateSources`。
- `apps/desktop/src/update-channel.ts`：读取并校验随包 `sources`。
- `apps/desktop/src/update-coordinator.ts`：按 `sources` 顺序 `setFeedURL` + `checkForUpdates`，全部失败才报错；下载沿用成功源的 provider。
- `apps/desktop/src/main.ts`：把 `sources` 传给 coordinator。
- `apps/desktop/scripts/publish-fish-mirror.ts`：上传产物、覆盖 `get/latest.exe`、清理旧版本。
- `.github/workflows/build-fish-exe.yml`：写入镜像地址，发布后上传 COS，把“手动下载”指向 `get/latest.exe`。
- 文档：更新 `docs/my-dear-fish/build.zh.md` 与 `build.md` 的自动更新一节，并保留本文。
- 测试：镜像地址解析、回退顺序、全部失败报错、下载沿用镜像源；上传脚本的键布局与保留策略。

## 验收

- 单测：`sources` 解析、回退顺序、全失败错误。
- 本地：起一个静态 HTTP 服务当镜像，打断主源，确认回退和下载源。
- 真机：朋友网络里打开 `https://<桶>.cos.ap-beijing.myqcloud.com/fish/win-x64/nightly.yml` 能看到 YAML；应用内检查更新能发现新版本；下载安装成功；再发一版，确认自动更新。
- 失败可见：COS 与 GitHub 都不通时，界面显示检查失败，不能假装“已是最新”。

## 回退

- 镜像不可用：自动回退 GitHub；两边都不通时保留手动安装包渠道。
- 密钥泄漏：删除子用户密钥，换一对写进 Secrets；桶是公读的，读地址不变。
- 不想用 COS：镜像地址是构建参数，换成阿里云 OSS 或任意 HTTPS 目录即可，应用侧不用改。
