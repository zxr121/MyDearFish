# Building the Windows installer

English | [中文](build.zh.md)

The installer is built by running the same packaging command locally or in GitHub Actions. Either path produces an unsigned x64 installer whose application contains the fish bundle and all six plugins.

## GitHub Actions

The workflow [.github/workflows/build-fish-exe.yml](../../.github/workflows/build-fish-exe.yml) runs on manual dispatch. It installs Node 24 and pnpm 11.28.5, installs dependencies with the frozen lockfile, writes `apps/desktop/.env.windows`, runs `pnpm run package:desktop:win:x64:unsigned`, and uploads the installer directory as the artifact `dsh-fish-windows-installer` for 14 days.

1. Open **Actions → Build fish Windows installer → Run workflow** on `master`.
2. Wait for the `package` job; the job times out after 90 minutes.
3. Download `dsh-fish-windows-installer` from the run page.

## Local build

Local packaging needs Node 24, the repository's pnpm version, Git, PowerShell, tar, Python, Visual C++ Build Tools, and a Windows SDK that provides `vswhere.exe`. Dependency installation and runtime preparation also need access to npm, GitHub release assets, and nodejs.org.

Write `apps/desktop/.env.windows` with the application ID and mandatory-update policy; the file is ignored by Git.

```
DSH_DESKTOP_APP_ID=com.deepseek.harness
DSH_DESKTOP_AUTO_UPDATE_ENV=production
DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN=https://api.deepseek.com
DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY=4
```

Set `DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com` in the same file when npm downloads need the mirror. Then run the checks and the full build from the repository root:

```
pnpm install --frozen-lockfile
pnpm run package:desktop:win:x64:unsigned --check
pnpm run package:desktop:win:x64:unsigned
```

## What the build adds

Packaging calls [prepare-fish-plugins.ts](../../apps/desktop/scripts/prepare-fish-plugins.ts), which copies `@mydearfish/dsh-fish-bundle` and the seven plugin packages into the prepared runtime's `node_modules` and declares them in the dependencies of `@deepseek-ai/dsh`. It fails the build when a package name or entry file is missing.

At runtime, [project-manager.ts](../../apps/desktop/src/project-manager.ts) appends the bundle to `DESKTOP_PROFILE_BUNDLES`, so every newly created desktop profile composes `dsh-base`, `dsh-web-app`, the fish bundle, and the profile's own patch.

## Output

The installer is written to `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`. Packaging runs its own complete build and runtime smoke without an online model. Stage logs remain under `apps/desktop/.desktop-build/packaging-runs/`.

The installer is unsigned, and packaging strips signing credentials. Signed release builds follow the [packaging guide](../../apps/desktop/packaging/README.md).
