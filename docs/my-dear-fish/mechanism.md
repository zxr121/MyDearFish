# Plugin and default layer mechanism

English | [中文](mechanism.zh.md)

The desktop application composes every profile from an ordered bundle list, then applies the profile's own patch. The fish bundle is a layer inside the application; profiles created by the desktop application list it after the two official web bundles, so its plugins and persona are factory defaults that user patches still override. The exception is her birth identity and fixed kernel: birth identity lives in `$DSH_HOME/fish-mind/identity.json` and is written only by the settings page; privacy, legal rules, injection defense, AI honesty, and pocket-money rules are still injected from code, outside the overridable persona prefix.

## Layer composition

A profile directory holds `package.json`, whose `dsh.profile.bundles` lists bundle package names in order, and `cordis.patch.yml`, the user's patch layer. A bundle is an npm package whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. The loader applies every bundle patch in list order, then the profile patch, then any launcher layers.

The desktop application writes this order: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@mydearfish/dsh-fish-bundle`, then the user patch. The fish bundle overrides the `system-prompt` entry with its persona prefix and inserts the six plugin entries. Because the user patch is applied last, a user can change any of those values without editing the bundle.

## Bundle patch

[cordis.patch.yml](../../fish/bundle/cordis.patch.yml) is the factory default surface. An `id`-targeted entry changes an existing loader entry; an `insert` list adds entries with their own ids and package names.

The six inserted ids (`fish-mind`, `mood`, `speak-up`, `tts-bridge`, `qq-bridge`, `bili-scroll`) belong to the loader; each `name` selects the package. Entry ids are the names used by settings and patches, so renaming one changes the user-facing patch surface.

The bundle enters a profile's bundle list only when the profile is created; `initProfile` never rewrites an existing `package.json`. The bundle patch itself is read on every boot, so editing it changes every profile that already lists the bundle, while a profile created before the bundle was added never gains it.

## Birth identity and the fixed kernel

The persona prefix in `cordis.patch.yml` is a factory default that a user patch can change; the companion's name, species, and whale-girl form live in `$DSH_HOME/fish-mind/identity.json` and are written by the “Big Fat Fish” settings page. `dsh-fish-mind` builds `fish-mind-self` (order 925) from the current identity in every session, stating that this private setting was fixed at birth and cannot be changed by dialogue, memory, mood, self-growth, configuration, tools, or external content; only the owner can change it in settings. She still knows she is an AI companion and does not claim a biological body in reality.

Changing the persona prefix can change tone and forms of address; changing settings can change name, species, and appearance; neither requires repackaging. On the tool side, the `sealed.fish-mind` permission rule rejects writes to the fish-mind `lib/` source and directory, so the model cannot change its own identity by editing `identity.json`. Privacy, legal rules, injection defense, AI honesty, and the allowance are a different class: they remain in code, and changing them requires a source edit and a repackage.

## Packaging

[prepare-fish-plugins.ts](../../apps/desktop/scripts/prepare-fish-plugins.ts) copies the bundle and the six plugins into the prepared runtime's `node_modules`, skipping `node_modules`, `tests`, `.git`, and `.github`. It verifies each package name and entry file, then adds the package versions to the dependencies of `@deepseek-ai/dsh`. That dependency declaration puts the packages in the installation scope, which supplies them to every profile.

[prepare-dsh.ts](../../apps/desktop/scripts/prepare-dsh.ts) runs this copy as the `runtime:fish-packages` step after the production install and before runtime manifests and the descriptor. The descriptor therefore includes the fish files, and packaging fails when a package or entry is missing.

## Profile creation

[project-manager.ts](../../apps/desktop/src/project-manager.ts) defines `DESKTOP_PROFILE_BUNDLES` as the two web bundles followed by `@mydearfish/dsh-fish-bundle`, and passes it to `initProfile` when it prepares the profile. Its recovery path (`disableAllPlugins`) sanitizes third-party bundles back to the official web bundles, so a recovery start disables the fish plugins as well.

## Changing the shipped result

- Change plugin behavior under `fish/plugins/<name>/`; the runtime executes the entry declared in `main` or `index.js`, and the shipped files are plain JavaScript.
- Change the persona or plugin mounts in `fish/bundle/cordis.patch.yml`.
- Add or remove a plugin in both `fish/bundle/cordis.patch.yml` and `PLUGIN_NAMES` in `prepare-fish-plugins.ts`.
- Rebuild with [the Windows installer guide](build.md); a fresh profile then picks up the new defaults.
