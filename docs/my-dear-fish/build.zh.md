# 构建 Windows 安装包

[English](build.md) | 中文

在本机或 GitHub Actions 中运行同一条打包命令即可构建安装包。两条路径都产出未签名的 x64 安装包，其应用中包含大肥鱼 bundle 和全部六个插件。

## GitHub Actions

工作流 [.github/workflows/build-fish-exe.yml](../../.github/workflows/build-fish-exe.yml) 手动触发。它安装 Node 24 与 pnpm 11.28.5，用冻结的锁文件安装依赖，写入 `apps/desktop/.env.windows`，运行 `pnpm run package:desktop:win:x64:unsigned`，并把安装包目录作为工件 `dsh-fish-windows-installer` 上传，保留 14 天。

1. 在 `master` 上打开 **Actions → Build fish Windows installer → Run workflow**。
2. 等待 `package` 作业完成；该作业在 90 分钟后超时。
3. 在运行页面下载 `dsh-fish-windows-installer`。

## 本机构建

本机打包需要 Node 24、仓库固定的 pnpm 版本、Git、PowerShell、tar、Python、Visual C++ Build Tools，以及提供 `vswhere.exe` 的 Windows SDK。安装依赖和准备运行时还需要访问 npm、GitHub release 资源与 nodejs.org。

写入 `apps/desktop/.env.windows`，配置应用 ID 和强制更新策略；该文件被 Git 忽略。

```
DSH_DESKTOP_APP_ID=com.deepseek.harness
DSH_DESKTOP_AUTO_UPDATE_ENV=production
DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN=https://api.deepseek.com
DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY=4
```

npm 下载需要镜像时，在同一文件中设置 `DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com`。然后在仓库根目录运行检查与完整构建：

```
pnpm install --frozen-lockfile
pnpm run package:desktop:win:x64:unsigned --check
pnpm run package:desktop:win:x64:unsigned
```

## 构建新增的内容

打包会调用 [prepare-fish-plugins.ts](../../apps/desktop/scripts/prepare-fish-plugins.ts)，把 `@mydearfish/dsh-fish-bundle` 和六个插件包复制进已准备运行时的 `node_modules`，并在 `@deepseek-ai/dsh` 的依赖中声明它们。包名或入口文件缺失会使构建失败。

运行时，[project-manager.ts](../../apps/desktop/src/project-manager.ts) 把该 bundle 追加到 `DESKTOP_PROFILE_BUNDLES`，因此每个新建桌面 profile 都会组合 `dsh-base`、`dsh-web-app`、大肥鱼 bundle 和 profile 自己的 patch。

## 产物

安装包写入 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`。打包会执行自己的完整构建和运行时 smoke，不需要在线模型。阶段日志保留在 `apps/desktop/.desktop-build/packaging-runs/`。

该安装包未签名，打包会清除签名凭据。签名发布构建遵循[打包指南](../../apps/desktop/packaging/README.zh.md)。
