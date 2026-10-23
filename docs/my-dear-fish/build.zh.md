# 构建 Windows 安装包

[English](build.md) | 中文

在本机或 GitHub Actions 中运行打包命令即可构建未签名的 x64 安装包，其应用中包含大肥鱼 bundle 和全部插件。Actions 同时发布 GitHub Release，已安装的应用据此自动更新。

## GitHub Actions

工作流 [.github/workflows/build-fish-exe.yml](../../.github/workflows/build-fish-exe.yml) 手动触发。它安装 Node 24 与 pnpm 11.28.5，用冻结的锁文件安装依赖，生成递增的构建版本，写入指向本仓库 Release 的 `apps/desktop/.env.windows`，运行 `pnpm run package:desktop:win:x64:unsigned -- --build-version <版本>`，校验安装包、增量文件与更新元数据，然后创建标记为 latest 的 GitHub Release。

1. 在 `master` 上打开 **Actions → Build fish Windows installer → Run workflow**。
2. 等待 `package` 作业完成；该作业在 90 分钟后超时。
3. 运行结束后在 **Releases** 页面下载安装包；运行页面仍保留工件 `dsh-fish-windows-installer` 14 天。

构建版本由产品版本追加 UTC 日期、运行序号和重试次数组成（本仓库为 `0.2.1-rc.2.20261023.12.1`；稳定产品版本则形如 `0.4.3-test.20261023.12.1`），因此同一产品版本可以连续发布多个构建。Release 必须是普通版本而不是 prerelease，`releases/latest/download/` 才会指向它；三个资产缺一不可：`deepseek-harness-<版本>-win-x64-unsigned.exe`、同名 `.exe.blockmap` 与 `nightly.yml`。

## 自动更新

unsigned Windows 构建随包携带 `resources/app-update.yml`，更新源是本仓库的 `https://github.com/<owner>/<repo>/releases/latest/download/`。应用启动后读取 `nightly.yml`，发现新版本便下载安装包，退出后由 NSIS 安装程序原地覆盖旧版本。

检查更新失败时，失败对话框提供“手动下载”按钮，打开 `https://github.com/<owner>/<repo>/releases/latest`；手动运行安装包会得到同样的覆盖安装。

## 本机构建

本机打包需要 Node 24、仓库固定的 pnpm 版本、Git、PowerShell、tar、Python、Visual C++ Build Tools，以及提供 `vswhere.exe` 的 Windows SDK。安装依赖和准备运行时还需要访问 npm、GitHub release 资源与 nodejs.org。

写入 `apps/desktop/.env.windows`；该文件被 Git 忽略。不配置更新源时，产物没有更新通道，检查更新会报告失败；写入下面两项后与 CI 产物行为一致：

```
DSH_DESKTOP_APP_ID=com.deepseek.harness
DSH_DESKTOP_UPDATE_FEED_URL=https://github.com/zxr121/MyDearFish/releases/latest/download/
DSH_DESKTOP_UPDATE_DOWNLOAD_PAGE=https://github.com/zxr121/MyDearFish/releases/latest
DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY=4
```

npm 下载需要镜像时，在同一文件中设置 `DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com`。然后在仓库根目录运行检查与完整构建：

```
pnpm install --frozen-lockfile
pnpm run package:desktop:win:x64:unsigned --check
pnpm run package:desktop:win:x64:unsigned
```

本机构建默认使用产品版本；要在 CI 的发布序列里继续递增，用 `--build-version 0.2.1-rc.2.20261023.1` 形式指定版本。更新源和下载页只对 unsigned Windows 构建生效，签名构建仍使用 COS 更新配置。

## 构建新增的内容

打包会调用 [prepare-fish-plugins.ts](../../apps/desktop/scripts/prepare-fish-plugins.ts)，把 `@mydearfish/dsh-fish-bundle` 和七个插件包复制进已准备运行时的 `node_modules`，并在 `@deepseek-ai/dsh` 的依赖中声明它们。包名或入口文件缺失会使构建失败。

运行时，[project-manager.ts](../../apps/desktop/src/project-manager.ts) 把该 bundle 追加到 `DESKTOP_PROFILE_BUNDLES`，因此每个新建桌面 profile 都会组合 `dsh-base`、`dsh-web-app`、大肥鱼 bundle 和 profile 自己的 patch。

## 产物

安装包写入 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`；同一目录还会生成 `nightly.yml` 和 `.exe.blockmap`，它们必须与安装包一起上传到同一个 Release。打包会执行自己的完整构建和运行时 smoke，不需要在线模型。阶段日志保留在 `apps/desktop/.desktop-build/packaging-runs/`。

该安装包未签名，打包会清除签名凭据。签名发布构建遵循[打包指南](../../apps/desktop/packaging/README.zh.md)。
