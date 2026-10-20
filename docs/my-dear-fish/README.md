# My Dear Fish

English | [中文](README.zh.md)

This repository is a DeepSeek Harness fork that ships the six Yuuyuko-uu plugins and a factory default layer with the Windows desktop application. A newly created desktop profile starts with all six plugins and the fish persona; later profile edits still override the factory layer.

## Repository additions

| Path | Purpose |
| --- | --- |
| `fish/plugins/` | Sources of the six plugins, including the prebuilt `lib` entries that the runtime loads. |
| `fish/bundle/` | `@mydearfish/dsh-fish-bundle`, the profile layer that mounts the plugins and sets the default persona. |
| `apps/desktop/scripts/prepare-fish-plugins.ts` | Copies the bundle and plugins into the packaged runtime and declares them in the dsh manifest. |
| `apps/desktop/src/project-manager.ts` | Adds the fish bundle to the bundles of every new desktop profile. |

## Plugins

| Plugin | Version | Entry | Capability |
| --- | --- | --- | --- |
| `dsh-fish-memory` | 1.1.8 | `lib/index.js` | Long-term memory that fades over time. |
| `dsh-feiyu-mood` | 0.2.1 | `lib/index.js` | Mood that changes per turn and settles over time. |
| `dsh-speak-up` | 0.1.8 | `lib/host.js` | Proactive conversation when nobody is talking. |
| `dsh-tts-bridge` | 1.2.7 | `lib/index.js` | Speech playback through the DeepSeek web voice. |
| `dsh-qq-bridge` | 0.1.7 | `lib/host.js` | QQ messaging in both directions without a bot account. |
| `dsh-bili-subagent` | 0.2.2 | `index.js` | Bilibili browsing through a delegated subagent. |

## Layer order

The desktop profile composes `dsh-base`, `dsh-web-app`, and the fish bundle, then applies the profile's own `cordis.patch.yml`. The fish bundle supplies the persona prefix and the six plugin mounts; the profile layer always wins, so user settings and later edits override the factory defaults. See [the plugin and default layer mechanism](mechanism.md) for profile composition and packaging details.

## Changing the shipped behavior

- Edit plugin code under `fish/plugins/<name>/`; the runtime loads the entry declared by that package's `main`, and the shipped `lib` files are plain JavaScript with no separate build step.
- Edit the default persona and plugin mounts in `fish/bundle/cordis.patch.yml`.
- When adding or removing a plugin, update both the bundle patch and `PLUGIN_NAMES` in `apps/desktop/scripts/prepare-fish-plugins.ts`.
- Follow [building the Windows installer](build.md) to rebuild the desktop application.

## Repository access

The source lives in the private repository `https://github.com/zxr121/MyDearFish`. Clone it with credentials that can read private repositories.

```
git clone https://github.com/zxr121/MyDearFish.git
```

This development machine cannot reach `github.com:443` directly, so its pushes use a repository deploy key through `ssh.github.com:443`; the key stays outside the repository. Other machines normally clone over HTTPS.
