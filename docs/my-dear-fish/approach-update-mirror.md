# Update mirror: self-updates on a blocked network

English | [中文](approach-update-mirror.zh.md)

## Current state

- The installed `resources/app-update.yml` pins the update feed to `https://github.com/zxr121/MyDearFish/releases/latest/download/`.
- Once a campus network or firewall blocks GitHub, the in-app update check, the installer download, and the failure dialog's “Download manually” all point at the same unreachable domain.
- An update replaces the executable directly. A public GitHub proxy can replace both `nightly.yml` and the installer, and the sha512 in `nightly.yml` cannot prove either; delegating updates to a proxy hands this machine's memory and tool permissions to the proxy operator.

## Goal

- On a network that only reaches domestic addresses, the friend can still check, download, and install new versions automatically.
- Each release needs no manual file transfer; failures must be explicit rather than silently staying on the old version.
- No key goes into the repository or chat; the application reads only public addresses.

## Approach

Use Tencent COS as a read-only mirror: the project already depends on `cos-nodejs-sdk-v5` and contains COS publication code, and the bucket lives in ap-beijing.

The application tries update sources in order: COS mirror, then GitHub. A successful check downloads from that source, and electron-updater reuses the provider of that check. The build writes the order into `dshDesktopUpdateSources` in `package.json`; older versions lack the field and keep their behavior.

During publication CI uploads `nightly.yml`, the installer, and the `.blockmap` to COS, with `nightly.yml` last so clients never see metadata pointing at a missing file. COS keeps only the two newest installers; `get/latest.exe` is the stable “Download manually” address, overwritten on every release.

Mirror layout:

```
fish/win-x64/nightly.yml
fish/win-x64/deepseek-harness-<version>-win-x64-unsigned.exe
fish/win-x64/deepseek-harness-<version>-win-x64-unsigned.exe.blockmap
fish/win-x64/get/latest.exe
```

## Why not a public GitHub proxy

- A proxy can replace both the metadata and the installer, and sha512 cannot prove either; giving the fish an update through it hands this machine's memory to the proxy operator.
- Proxies commonly throttle or drop long transfers; a 295MB installer fails often, and a failure has no usable fallback.
- Supporting untrusted mirrors later would first require an Ed25519 signature in `nightly.yml` with the public key shipped in the package, verified before download; that step is not part of this change.

## One-time manual steps (owner)

1. Tencent Cloud → Object Storage: create a bucket in the Beijing region with “public read, private write” access; its name looks like `mydearfish-125xxxxxxx`.
2. Access management: create a sub-user for uploads only (programmatic access) with read/write access to this bucket alone; keep the SecretId/SecretKey yourself and send them to nobody.
3. GitHub repository → Settings → Secrets and variables → Actions:
   - Variable `FISH_MIRROR_COS_BUCKET` = bucket name (public information)
   - Secret `FISH_MIRROR_COS_SECRET_ID`
   - Secret `FISH_MIRROR_COS_SECRET_KEY`
4. Push a `fish-release-*` tag or run the workflow manually. The build embeds the mirror address and uploads the artifacts to the bucket.
5. Download this new installer from the Release or the Actions artifact and send it to the friend over QQ or a file service for one install; afterwards she updates through the mirror automatically. The existing installation has no mirror address, so this single manual install is required.

## Cost

- Storage: about 0.6GB for the two newest versions, about ¥0.07/month at ¥0.118/GB/month.
- Outbound traffic: ¥0.5/GB; one full update is about 295MB, about ¥0.15; differential updates are usually much smaller.
- Traffic occurs only when the friend updates; at the current headcount it stays under ¥1/month.

## Code changes

- `apps/desktop/scripts/desktop-auto-update-environment.mjs`: read `DSH_DESKTOP_UPDATE_FEED_MIRRORS`, validate the addresses, and assemble the ordered `sources`.
- `apps/desktop/scripts/electron-builder-config.mjs`: write `sources` into `extraMetadata.dshDesktopUpdateSources`.
- `apps/desktop/src/update-channel.ts`: read and validate the packaged `sources`.
- `apps/desktop/src/update-coordinator.ts`: `setFeedURL` and `checkForUpdates` in `sources` order, reporting only after every source fails; downloads reuse the provider of the successful source.
- `apps/desktop/src/main.ts`: pass `sources` to the coordinator.
- `apps/desktop/scripts/publish-fish-mirror.ts`: upload artifacts, overwrite `get/latest.exe`, and remove old versions.
- `.github/workflows/build-fish-exe.yml`: write the mirror address, upload to COS after publication, and point “Download manually” at `get/latest.exe`.
- Documentation: update the automatic-update section of `docs/my-dear-fish/build.md` and `docs/my-dear-fish/build.zh.md`, and keep this document.
- Tests: mirror address parsing, fallback order, all-failed reporting, and downloads following the mirror source; the uploader's key layout and retention policy.

## Acceptance

- Unit tests: `sources` parsing, fallback order, all-failed errors.
- Local: serve a static HTTP directory as the mirror, break the primary source, and confirm fallback and download source.
- Real machine: on the friend's network, open `https://<bucket>.cos.ap-beijing.myqcloud.com/fish/win-x64/nightly.yml` and see YAML; the in-app check finds the new version; download and install succeed; publish another version and confirm the automatic update.
- Visible failure: when neither COS nor GitHub is reachable, the UI shows a failed check and never claims to be up to date.

## Rollback

- Mirror unavailable: fall back to GitHub automatically; when both are unreachable, keep the manual installer channel.
- Key leaked: delete the sub-user key and put a new pair in Secrets; the bucket is public-read, so read addresses stay the same.
- Do not want COS: the mirror address is a build parameter, so Alibaba OSS or any HTTPS directory works without application changes.
