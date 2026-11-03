# Agent Note: Installed builds keep an editable fish source beside the fixed kernel

Status: implemented

English | [中文](2026-11-03-packaged-fish-source.zh.md)

## Problem

In an installed build, a personality tendency that has no deterministic landing is marked “needs code” and handed to creation mode, but the source checkout is not in the install directory. `installRoot()` resolves to the exe directory, `isFishCheckout()` stays false, and the creation brief explicitly says the packaged build cannot compile changes. The owner chose to ship an editable source copy with the installer so creation mode can change behavior and apply it after a restart, without making the safety kernel editable.

## Decision

The packaged app ships the repository `fish/` tree as `resources/fish-src/fish`. On every launch, before the Host starts, `DesktopProjectManager.applyRelease()` seeds it into `<DSH_HOME>/fish-src` and synchronizes the editable plugins into `<DSH_HOME>/profiles/desktop/node_modules`. The two plugins are declared in the profile manifest with relative `file:` specifications, so the profile-scoped module resolution loads them ahead of the packaged `app.asar/dsh/node_modules` copies. A full restart re-runs the seed and sync; no pnpm, rebuild, or asar edit is involved.

Only behavior files are editable: `dsh-fish-mind` `lib/tendency.js`, `lib/humor.js`, `lib/memes.js`, `lib/settings-catalog.js`, `lib/config-files.js`, and `dsh-qq-bridge` `lib/host.js`, `lib/sticker-commands.js`. Every other runtime file in those packages — including `lib/index.js`, `lib/permissions.js`, `lib/privacy.js`, `lib/budget.js`, `package.json`, and `client.js` — is restored from the shipped copy at startup. An edited kernel file is kept under `.kernel-backup/<timestamp>/` before the pristine copy replaces it. The allowlist lives in `apps/desktop/src/fish-source.ts`; widening it is a one-line change.

Upgrades merge by SHA-256. A pristine file replaces the working copy only when the working file is missing, unchanged from the previous pristine hash, or a guarded kernel file; edited editable files and owner-created files stay. Deleting `fish-src` makes the next launch regenerate it from the installer.

Creation mode resolves `<DSH_HOME>/fish-src` through the server manifest, returns it as the workspace and `checkout`, and includes the editable list and any synchronization warning in the brief and settings dialog. The capability broker accepts a `creatorRoot` and permits only paths inside that root under the otherwise private Harness home; creator shell commands may not use `..` segments. `fish/bundle` and the other four plugins remain reference-only because bundle resolution is installation-first; the factory persona is overridden through the settings persona editor.

## Verification

`apps/desktop/tests/fish-source.spec.ts` covers first seeding, upgrade merge, kernel restoration and backup, symlink refusal, profile dependencies, syntax rejection, and fallback. `project-manager.spec.ts` covers the packaged `applyRelease()` path. Fish-mind tests cover the packaged creation response and the creator permission boundary. The install test edits `tendency.js` in a built installer, restarts, and confirms the profile copy changed; it also edits `permissions.js` and confirms the original returns with a backup.

## Alternatives considered

**Put the editable source beside the exe and preserve it in NSIS.** The installer already stashes `<install>\data`; a second directory would need matching stash, rollback, and uninstall paths in the same promotion logic. It also breaks on read-only application directories and loses edits unless every installer path is adjusted.

**Keep the packaged build read-only and rely on the prompt fallback.** Unmatched tendency text is already injected each turn, so this needs no new surface. It does not satisfy the owner's request for deterministic behavior changes, and the settings page keeps promising a code path that cannot work.

**Make the whole checkout editable and protect only a kernel denylist.** `lib/index.js` wires the broker, creator detection, and permission presets, so a denylist that leaves it editable is bypassable. An allowlist keeps the wiring and kernel files pristine and still covers the tendency and QQ behavior files the owner edits.

**Compile or bundle changes inside the installed app.** That requires a toolchain and a writable runtime tree; the app already has a tested profile-copy mechanism, and a restart is enough.

## Consequences

Installed builds gain the same code-level customization the source checkout has, while upgrades preserve owner edits and keep the broker, privacy, budget, and local-request gates fixed. The cost is a second code location under the data directory: manually copying `data` carries it, and export or backup packages do not. Editable files are still executable code and the allowlist is a guardrail rather than a sandbox; the owner reviews the creation session's changes. If an edit breaks runtime behavior, deleting `fish-src` and restarting restores the shipped source. The bundle's factory persona and the four other plugins are not live-editable in installed builds.
