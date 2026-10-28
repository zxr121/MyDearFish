# 构建 Windows 安装包

[English](build.md) | 中文

在本机或 GitHub Actions 中运行打包命令即可构建未签名的 x64 安装包，其应用中包含大肥鱼 bundle 和全部插件。Actions 同时发布 GitHub Release；配置镜像后还会发布腾讯云 COS 镜像，已安装的应用据此自动更新。

## GitHub Actions

工作流 [.github/workflows/build-fish-exe.yml](../../.github/workflows/build-fish-exe.yml) 由手动触发或推送 `fish-release-*` 标签触发。它安装 Node 24 与 pnpm 11.28.5，用冻结的锁文件安装依赖，生成递增的构建版本，写入指向本仓库 Release 的 `apps/desktop/.env.windows`，运行 `pnpm run package:desktop:win:x64:unsigned -- --build-version <版本>`，校验安装包、增量文件与更新元数据，在仓库变量 `FISH_MIRROR_COS_BUCKET` 存在时把构建上传到更新镜像，然后创建标记为 latest 的 GitHub Release。

1. 在 `master` 上打开 **Actions → Build fish Windows installer → Run workflow**；或推送一个标签，例如 `git tag fish-release-20261023 && git push origin fish-release-20261023`。
2. 等待 `package` 作业完成；该作业在 90 分钟后超时。
3. 运行结束后在 **Releases** 页面下载安装包；运行页面仍保留工件 `dsh-fish-windows-installer` 14 天。

构建版本由产品版本追加 UTC 日期、运行序号和重试次数组成（本仓库为 `0.2.1-rc.2.20261023.12.1`；稳定产品版本则形如 `0.4.3-test.20261023.12.1`），因此同一产品版本可以连续发布多个构建。Release 必须是普通版本而不是 prerelease，`releases/latest/download/` 才会指向它；三个资产缺一不可：`deepseek-harness-<版本>-win-x64-unsigned.exe`、同名 `.exe.blockmap` 与 `nightly.yml`。

## 自动更新

unsigned Windows 构建随包携带 `resources/app-update.yml`，更新源是本仓库的 `https://github.com/<owner>/<repo>/releases/latest/download/`。当随包的 `package.json` 还带有 `dshDesktopUpdateSources` 时，应用按顺序询问这些 HTTPS 目录并保留第一个响应的源；随包的 GitHub 源排在最后，始终作为回退。随后应用从该源读取 `nightly.yml`，发现新版本便下载安装包，退出后由 NSIS 安装程序原地覆盖旧版本。下载沿用检查成功的那个源，因此镜像不可用时会从下一个源完整下载。

检查更新失败时，失败对话框提供“手动下载”按钮，打开随包的下载页；手动运行安装包会得到同样的覆盖安装。配置了镜像的构建把该页面指向 `<镜像>get/latest.exe`，即使 GitHub 不通也能拿到安装包。

每个构建还会把它相对上一个 `fish-release-*` 标签的提交摘要写入 `resources/update-notes.json`。应用进入工作区后，如果随包说明对应正在运行的版本、而且这个版本还没有确认过，就弹出一次“更新说明”窗口；勾选窗口里的“不再显示更新说明”后永久生效。说明只包含本次构建的内容，跳过多个版本的用户也不会看到累积列表。

### 更新镜像

[apps/desktop/scripts/publish-fish-mirror.ts](../../apps/desktop/scripts/publish-fish-mirror.ts) 把一个已校验的产物目录发布到 `ap-beijing` 地域的腾讯云 COS 桶：写入带版本号的安装包与 blockmap，把安装包复制为 `fish/win-x64/get/latest.exe` 供手动下载，最后写入 `fish/win-x64/nightly.yml`，因此读取方不会顺着更新源找到尚未上传的文件。发布完成后只保留最新两代安装包。上传失败不会改动原有更新源。

1. 在 `ap-beijing` 创建一个对象公开读、私有写的 COS 桶；默认域名 `https://<桶名>.cos.ap-beijing.myqcloud.com` 直接提供镜像。
2. 创建一个允许上传、读取、查询和删除对象、并允许列出 `fish/win-x64/` 前缀的子账号，把它的密钥保存为仓库 Secrets `FISH_MIRROR_COS_SECRET_ID` 与 `FISH_MIRROR_COS_SECRET_KEY`。
3. 添加仓库变量 `FISH_MIRROR_COS_BUCKET`，值为桶名，例如 `fish-1250000000`。
4. 运行工作流。构建会把镜像作为第一个更新源、GitHub 作为最后一个源，并把 `get/latest.exe` 作为手动下载页。

支持镜像之前构建的安装包没有更新源列表，需要手动替换为带镜像的构建一次；之后检查更新会先走镜像，GitHub 被墙也不影响更新。

## 本机构建

本机打包需要 Node 24、仓库固定的 pnpm 版本、Git、PowerShell、tar、Python、Visual C++ Build Tools，以及提供 `vswhere.exe` 的 Windows SDK。安装依赖和准备运行时还需要访问 npm、GitHub release 资源与 nodejs.org。

写入 `apps/desktop/.env.windows`；该文件被 Git 忽略。不配置更新源时，产物没有更新通道，检查更新按“没有新版本”处理，不显示失败；写入下面的更新源后与 CI 产物行为一致；`DSH_DESKTOP_UPDATE_FEED_MIRRORS` 可选，接受以逗号分隔、先于随包源尝试的 HTTPS 目录：

```
DSH_DESKTOP_APP_ID=com.deepseek.harness
DSH_DESKTOP_UPDATE_FEED_URL=https://github.com/zxr121/MyDearFish/releases/latest/download/
DSH_DESKTOP_UPDATE_DOWNLOAD_PAGE=https://github.com/zxr121/MyDearFish/releases/latest
DSH_DESKTOP_UPDATE_FEED_MIRRORS=https://fish-1250000000.cos.ap-beijing.myqcloud.com/fish/win-x64/
DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY=4
```

npm 下载需要镜像时，在同一文件中设置 `DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com`。然后在仓库根目录运行检查与完整构建：

```
pnpm install --frozen-lockfile
pnpm run package:desktop:win:x64:unsigned --check
pnpm run package:desktop:win:x64:unsigned
```

本机构建默认使用产品版本；要在 CI 的发布序列里继续递增，用 `--build-version 0.2.1-rc.2.20261023.1` 形式指定版本。更新源、镜像列表和下载页只对 unsigned Windows 构建生效，签名构建仍使用 COS 更新配置。

## 构建新增的内容

打包会调用 [prepare-fish-plugins.ts](../../apps/desktop/scripts/prepare-fish-plugins.ts)，把 `@mydearfish/dsh-fish-bundle` 和七个插件包复制进已准备运行时的 `node_modules`，并在 `@deepseek-ai/dsh` 的依赖中声明它们。包名或入口文件缺失会使构建失败。

运行时，[project-manager.ts](../../apps/desktop/src/project-manager.ts) 把该 bundle 追加到 `DESKTOP_PROFILE_BUNDLES`，并给旧版 dsh 建好的桌面 profile 补上该 bundle；因此每个桌面 profile 都会组合 `dsh-base`、`dsh-web-app`、大肥鱼 bundle 和 profile 自己的 patch。

## 产物

安装包写入 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`；同一目录还会生成 `nightly.yml` 和 `.exe.blockmap`，它们必须与安装包一起上传到同一个 Release。镜像会在 `fish/win-x64/` 下保留这些文件两代，并持续覆盖 `nightly.yml` 与 `get/latest.exe`。打包会执行自己的完整构建和运行时 smoke，不需要在线模型。阶段日志保留在 `apps/desktop/.desktop-build/packaging-runs/`。

该安装包未签名，打包会清除签名凭据。签名发布构建遵循[打包指南](../../apps/desktop/packaging/README.zh.md)。
