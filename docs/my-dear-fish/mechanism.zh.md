# 插件与默认层机制

[English](mechanism.md) | 中文

桌面应用按有序的 bundle 列表组合每个 profile，然后应用 profile 自己的 patch。大肥鱼 bundle 是应用内的一个层；桌面应用新建的 profile 会把它排在两个官方 web bundle 之后，因此它的插件与人设是出厂默认，用户 patch 仍可覆盖。

## 层的组合

profile 目录包含 `package.json` 和用户 patch 层 `cordis.patch.yml`；前者的 `dsh.profile.bundles` 按顺序列出 bundle 包名。bundle 是一个 npm 包，其清单声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。加载器按列表顺序应用每个 bundle 的 patch，再应用 profile patch，最后应用启动器的层。

桌面应用写入的顺序是：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@mydearfish/dsh-fish-bundle`，然后是用户 patch。大肥鱼 bundle 用人设前缀覆盖 `system-prompt` 条目，并插入六个插件条目。由于用户 patch 最后应用，用户不必修改 bundle 就能改变其中任何值。

## Bundle patch

[cordis.patch.yml](../../fish/bundle/cordis.patch.yml) 是出厂默认的落点。以 `id` 定位的条目修改已有加载器条目；`insert` 列表添加带各自 id 与包名的条目。

六个插入的 id（`fish-memory`、`mood`、`speak-up`、`tts-bridge`、`qq-bridge`、`bili-scroll`）属于加载器；每个 `name` 选择对应的包。条目 id 也是设置与 patch 使用的名字，因此改名会改变用户可见的 patch 接口。

bundle 只在 profile 创建时进入其 bundle 列表；`initProfile` 从不改写已有的 `package.json`。bundle patch 本身在每次启动时读取，因此修改它会影响所有已列出该 bundle 的 profile；而在加入该 bundle 之前创建的 profile 不会获得它。

## 打包

[prepare-fish-plugins.ts](../../apps/desktop/scripts/prepare-fish-plugins.ts) 把 bundle 和六个插件复制进已准备运行时的 `node_modules`，跳过 `node_modules`、`tests`、`.git` 和 `.github`。它校验每个包名与入口文件，再把包版本写入 `@deepseek-ai/dsh` 的依赖。该依赖声明把包放进安装作用域，从而供给每个 profile。

[prepare-dsh.ts](../../apps/desktop/scripts/prepare-dsh.ts) 在生产安装之后、运行时清单与描述符之前，以 `runtime:fish-packages` 步骤执行这次复制。因此描述符包含大肥鱼文件；包或入口缺失会使打包失败。

## Profile 创建

[project-manager.ts](../../apps/desktop/src/project-manager.ts) 把 `DESKTOP_PROFILE_BUNDLES` 定义为两个 web bundle 加 `@mydearfish/dsh-fish-bundle`，并在准备 profile 时传给 `initProfile`。它的恢复路径（`disableAllPlugins`）会把第三方 bundle 清理回官方 web bundle，因此恢复启动也会停用大肥鱼插件。

## 修改出厂结果

- 在 `fish/plugins/<name>/` 下改变插件行为；运行时执行 `main` 或 `index.js` 声明的入口，随包文件是纯 JavaScript。
- 在 `fish/bundle/cordis.patch.yml` 中改变人设或插件挂载。
- 增删插件时，同时修改 `fish/bundle/cordis.patch.yml` 和 `prepare-fish-plugins.ts` 中的 `PLUGIN_NAMES`。
- 按[构建 Windows 安装包](build.zh.md)重新打包；此后新建的 profile 会带上新的默认值。
