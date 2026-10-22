# My Dear Fish

English | [中文](README.zh.md)

This repository is a DeepSeek Harness fork that ships the five Yuuyuko-uu plugins, the fish-mind plugin `dsh-fish-mind`, and a factory default layer with the Windows desktop application. A newly created desktop profile starts with all six plugins and the fish persona; later profile edits still override the factory layer.

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
| `dsh-fish-mind` | 0.2.0 | `lib/index.js` | Shared experience stream, episodic memory with verbatim look-up, tool permission decisions, privacy and injection defense. |
| `dsh-feiyu-mood` | 0.2.1 | `lib/index.js` | Mood that changes per turn and settles over time. |
| `dsh-speak-up` | 0.1.8 | `lib/host.js` | Proactive conversation when nobody is talking. |
| `dsh-tts-bridge` | 1.2.7 | `lib/index.js` | Speech playback through the DeepSeek web voice. |
| `dsh-qq-bridge` | 0.2.30 | `lib/host.js` | QQ messaging in both directions without a bot account, including expanded forwarded chat records (with the images inside), and pokes pushed by the backend; optional autonomous group interjection where she watches only what interests her and decides whether to reply, with a zero-cost attention-score fast pass and an exploration quota for new topics once her interest profile matures. |
| `dsh-bili-subagent` | 0.2.3 | `index.js` | Bilibili browsing through a delegated subagent. |

See [how the six plugins keep the fish](plugins.md) for each plugin's mechanism, data files, cross-plugin loop, defaults, and change points; see the [dsh-fish-mind README](../../fish/plugins/dsh-fish-mind/README.md) for the experience stream and permissions.

## Cognition plan

[The cognition plan](cognition.md) starts from the biology of human memory and behavior and proposes a new cognitive core, `dsh-fish-mind`: experience stream, episodic and semantic memory, affect and drives, self and relationships, language monitoring, sleep consolidation, phased implementation, and acceptance metrics. The Phase 0 fish-mind code is implemented and currently shadow-running; recall, injection, and background life still follow the plan's phases. Progress, task breakdown, acceptance data, and handoff steps live in the [development plan](development-plan.md). For the whole build on one page — how the plugins, layering, memory, cost, and safety boundaries fit together — see the [implementation approach](implementation.md).

## QQ access plan

[The QQ access plan](qq-tulpa.md) decides how the fish reaches QQ: what `dsh-qq-bridge` already does, which parts of the external Tulpa program are worth taking (a one-click backend setup, a read-only history source), which are refused (its standing send authorization and its own chat loop), and what stays fixed.

## Layer order

The desktop profile composes `dsh-base`, `dsh-web-app`, and the fish bundle, then applies the profile's own `cordis.patch.yml`. The fish bundle supplies the persona prefix and the six plugin mounts; the profile layer always wins except for the fish-mind's code-injected fixed private setting, so user settings and later edits override the factory defaults. See [the plugin and default layer mechanism](mechanism.md) for profile composition and packaging details.

## Changing the shipped behavior

- Edit plugin code under `fish/plugins/<name>/`; the runtime loads the entry declared by that package's `main`, and the shipped `lib` files are plain JavaScript with no separate build step.
- Edit the default persona and plugin mounts in `fish/bundle/cordis.patch.yml`.
- When adding or removing a plugin, update both the bundle patch and `PLUGIN_NAMES` in `apps/desktop/scripts/prepare-fish-plugins.ts`.
- Follow [building the Windows installer](build.md) to rebuild the desktop application.

## Running after a pull

A packaged desktop build already contains the plugins; pulling source does not change an installed build. For a source or local-profile run, pnpm installs the `file:` dependencies as materialized copies under the profile's `node_modules`, so `git pull` updates the checkout but not the running copy. After pulling, run once from the repository root:

```
fish\sync-runtime.cmd
```

It locates `$DSH_HOME` (default `~/.dsh`, or the workspace `.dsh` when present), reinstalls the profile's local `file:` dependencies, and checks every installed version against the checkout. Stop dsh before refreshing, since the script rewrites the profile's `node_modules`; restart afterwards. Pass `--profile` or `--home` for a non-default profile or home.

## Repository access

The source lives in the public repository `https://github.com/zxr121/MyDearFish` and can be cloned without private-repository credentials.

```
git clone https://github.com/zxr121/MyDearFish.git
```

This development machine cannot reach `github.com:443` directly, so its pushes use a repository deploy key through `ssh.github.com:443`; the key stays outside the repository. Other machines normally clone over HTTPS.
