# Building the Windows installer

English | [中文](build.zh.md)

Running the packaging command locally or in GitHub Actions builds an unsigned x64 installer whose application contains the fish bundle and all plugins. Actions also publishes a GitHub Release, which installed applications use to update themselves.

## GitHub Actions

The workflow [.github/workflows/build-fish-exe.yml](../../.github/workflows/build-fish-exe.yml) runs on manual dispatch. It installs Node 24 and pnpm 11.28.5, installs dependencies with the frozen lockfile, generates an incrementing build version, writes `apps/desktop/.env.windows` pointing at this repository's releases, runs `pnpm run package:desktop:win:x64:unsigned -- --build-version <version>`, verifies the installer, differential file, and update metadata, then creates a GitHub Release marked latest.

1. Open **Actions → Build fish Windows installer → Run workflow** on `master`.
2. Wait for the `package` job; the job times out after 90 minutes.
3. Download the installer from the **Releases** page after the run; the run page also retains the artifact `dsh-fish-windows-installer` for 14 days.

The build version appends the UTC date, workflow run number, and attempt to the product version (`0.2.1-rc.2.20261023.12.1` in this checkout; a stable product version would yield `0.4.3-test.20261023.12.1`), so one product version can carry several builds. The release must be a normal release rather than a prerelease for `releases/latest/download/` to resolve to it, and it needs all three assets: `deepseek-harness-<version>-win-x64-unsigned.exe`, the matching `.exe.blockmap`, and `nightly.yml`.

## Automatic updates

An unsigned Windows build carries `resources/app-update.yml`, whose feed is `https://github.com/<owner>/<repo>/releases/latest/download/`. On launch the application reads `nightly.yml`, downloads a newer installer, and hands installation to NSIS, which replaces the old version in place after the application exits.

When an update check fails, the failure dialog offers **Download manually**, which opens `https://github.com/<owner>/<repo>/releases/latest`; running the installer by hand performs the same in-place replacement.

## Local build

Local packaging needs Node 24, the repository's pnpm version, Git, PowerShell, tar, Python, Visual C++ Build Tools, and a Windows SDK that provides `vswhere.exe`. Dependency installation and runtime preparation also need access to npm, GitHub release assets, and nodejs.org.

Write `apps/desktop/.env.windows`; the file is ignored by Git. A build without an update feed has no update channel and reports failed checks; the two feed settings below make it behave like the CI artifact:

```
DSH_DESKTOP_APP_ID=com.deepseek.harness
DSH_DESKTOP_UPDATE_FEED_URL=https://github.com/zxr121/MyDearFish/releases/latest/download/
DSH_DESKTOP_UPDATE_DOWNLOAD_PAGE=https://github.com/zxr121/MyDearFish/releases/latest
DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY=4
```

Set `DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com` in the same file when npm downloads need the mirror. Then run the checks and the full build from the repository root:

```
pnpm install --frozen-lockfile
pnpm run package:desktop:win:x64:unsigned --check
pnpm run package:desktop:win:x64:unsigned
```

A local build publishes the product version by default; pass a version such as `--build-version 0.2.1-rc.2.20261023.1` to continue CI's release sequence. The update feed and download page apply only to unsigned Windows builds; signed builds keep the COS update configuration.

## What the build adds

Packaging calls [prepare-fish-plugins.ts](../../apps/desktop/scripts/prepare-fish-plugins.ts), which copies `@mydearfish/dsh-fish-bundle` and the seven plugin packages into the prepared runtime's `node_modules` and declares them in the dependencies of `@deepseek-ai/dsh`. It fails the build when a package name or entry file is missing.

At runtime, [project-manager.ts](../../apps/desktop/src/project-manager.ts) appends the bundle to `DESKTOP_PROFILE_BUNDLES`, so every newly created desktop profile composes `dsh-base`, `dsh-web-app`, the fish bundle, and the profile's own patch.

## Output

The installer is written to `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`; the same directory also contains `nightly.yml` and the `.exe.blockmap`, which must be uploaded to the same release. Packaging runs its own complete build and runtime smoke without an online model. Stage logs remain under `apps/desktop/.desktop-build/packaging-runs/`.

The installer is unsigned, and packaging strips signing credentials. Signed release builds follow the [packaging guide](../../apps/desktop/packaging/README.md).
