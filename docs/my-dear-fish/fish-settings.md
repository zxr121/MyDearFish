# Fish settings and migration

English | [中文](fish-settings.zh.md)

The “Big Fat Fish” settings page is an overview of the fish, not a second configuration screen: birth identity, persona, the current self prompt, memory, mood, relationships, channels, pocket money, and fixed boundaries all appear on one page; birth identity and persona are editable, everything else is read-only, and a closed voice card can be shown again from “Channels”. Moving a fish uses a strictly validated archive: downloaded from settings, imported from settings, and when the format is wrong or the fish already has experiences, mood, or people, no file is written.

## Overview

The page reads from “who she is” to “what she remembers”, “how she is”, “where she is connected”, and “what cannot move”.

| Block | Content | Editable |
| --- | --- | --- |
| Birth identity | Name, species, appearance, how she addresses the owner, origin, extra speaking habits, free-form relationships | Yes |
| Persona | The whole persona prefix injected by the deployment layer; hot-applied on save and effective from the next turn | Yes |
| Self prompt | The full private-setting text currently injected, including fixed rules | No |
| Memory | Experience, episode, fact, and today counts; recent facts and recent experiences | No |
| Mood | Current value, label, latest reason, tail of the timeline | No |
| People-book relationships | Names, aliases, familiarity, times seen, and owner flag from the QQ people book; QQ numbers are not shown | No |
| Channels | Whether QQ, proactive speech, voice playback, and Bilibili are on; a closed voice card can be shown again here; addresses, tokens, and login state are not shown | Card visibility only |
| Pocket money | Daily grant, available balance, spent today, and call count; Bilibili patrol spend today and its quarter-of-the-grant cap | No |
| Boundaries | Shadow/inject mode, a summary of permission rules, privacy and injection counters | No |

Recent experiences are previews only: the text is truncated, and numbers following QQ, group chat, or private chat labels are masked as `***`.

The overview exists only in the local settings UI. Its routes register on the DSH `webServer` and decide whether a request comes from the local UI by checking Host, `Sec-Fetch-Site`, and Origin. They establish no identity and cannot replace the owner's local file permissions.

## Birth identity

Birth identity lives in `$DSH_HOME/fish-mind/identity.json` with fixed fields, length limits, and control characters stripped. When the file is absent, factory defaults apply: the name “大肥鱼”, the species “whale girl”, long blue-white hair with a whale hood, and a little blue whale nearby. Saving and reset happen in settings, and writes are atomic: a temporary file is written first and then renamed over the target.

Owner-defined relationships are free entries in birth identity: each pairs a name with a relationship (“Shiguang: mother”), up to 12 entries of 24 characters each; incomplete rows are dropped, and a later entry for the same name overrides the earlier one. They are injected with the private setting every turn, so she uses those names and attitudes in every session. This is separate from the relationship graph the QQ people book learns automatically: the former is assigned by the owner, the latter is what she picked up in chat, and the settings page keeps that graph read-only.

`selfPrompt()` assembles the private setting from the current identity each session instead of hardcoding a name and species. Renaming also changes how she refers to herself in the prompt, how she refuses an identity change, and the name and species named in the injection-defense prompt. When `$DSH_HOME/feiyu-mood/config.json` exists, saving birth identity also updates its `ownerName` and `selfName` so mood judging does not keep calling her by the old name; no other mood setting is touched.

The fixed kernel does not come from settings and does not read `identity.json`: privacy, legal rules, prompt-injection defense, honesty about being an AI, the pocket-money grant, and the `sealed.fish-mind` permission rule remain in code. Tools cannot write the fish-mind directory, so the model cannot change its own identity by editing `identity.json`; the settings page is a host route, not a model tool.

## Persona

The persona is the whole persona prefix of the deployment layer: the `system-prompt` plugin's `personaPrefix`, which becomes the first `deployment:persona-prefix` section of the system prompt. Settings read whichever copy is actually in effect: with no customization it shows the factory persona from `fish/bundle/cordis.patch.yml`, and after customization it shows the override in the active profile's `cordis.patch.yml`. The editor replaces the whole text, allows up to 12,000 characters, preserves line breaks, and strips control characters. The persona may not contain `{{variable}}`: the system prompt treats it as interpolation, and an unknown variable throws, so saving rejects it up front.

Saving goes through the host's existing `configEditor`: it validates the complete candidate config in memory, atomically writes the active profile's `cordis.patch.yml`, and hands it to Loader for a hot apply. No restart is needed, and the next turn speaks with the new persona. Other config and comments in the file are left alone. “Reset to factory persona” deletes the override rather than copying the factory text in, so later changes to the shipped persona still flow through.

Names, species, appearance, and owner-defined relationships are not here; they remain in birth identity. Privacy, legal rules, prompt-injection defense, AI honesty, the pocket-money grant, and the `sealed.fish-mind` permission rule are not here either; code still fixes them. QQ sessions include only the deployment persona, the QQ scene sections, and fish-brain memory; the persona still uses the same `deployment:persona-prefix` section, so changing it does not alter the QQ section filter.

## What travels and what does not

The archive carries the fish's growth data, not this machine or this account.

| Entry | Content |
| --- | --- |
| `manifest.json` | Format name, version, export time, name, and the byte count plus SHA-256 of every file |
| `identity.json` | Birth identity |
| `memory/experience.jsonl` | The append-only experience stream and the rebuild source for memory |
| `memory/facts.json` | A snapshot of currently active long-term facts |
| `memory/working.json` | Short-term consolidation watermark; omitted when absent |
| `mood.json` | Mood, seven emotion dimensions, latest reason, and timeline; omitted when absent |
| `people.json` | The QQ people book: cross-room recognition, relationships, and shared topics; omitted when absent |

Excluded: `config.json`, `budget.json`, `budget-ledger.jsonl`, `audit.jsonl`, `diag.log`, `mind.sqlite*`, `state.json`, QQ/voice/proactive-speech/Bilibili configuration, any credential, and DSH session records. Pocket money is born again from the new owner's account; channel login state stays on the original machine.

Export reads the experience stream, facts, and mood live and never copies SQLite. The archive is written with `node:zlib` deflate and needs no third-party runtime package; `manifest.json` carries a SHA-256 for every entry. The download filename is fixed as `mydearfish-YYYY-MM-DD.zip` so Chinese names do not hit inconsistent response-header encoding.

## Strict import

Import reads and validates the entire archive in memory first. Any failed check returns an error without touching existing files.

- The input must be a ZIP; encrypted entries, data descriptors, ZIP64, multiple disks, compression other than deflate or store, directory entries, absolute paths, and `..` paths are rejected.
- Entry count, per-entry size, and total uncompressed size are capped; the central directory, local header, compressed and uncompressed sizes, and CRC32 must agree.
- Only `manifest.json` and the six data entries above are accepted. An extra file, a missing file, a file not listed in the manifest, or a checksum mismatch rejects the archive.
- `manifest.json` must declare the `mydearfish.fish` format and version 1; `identity.json`, `memory/experience.jsonl`, and `memory/facts.json` are required.
- Every experience line must be a JSON object with a timestamp, a 64-hex hash, and a non-empty `kind`; facts, mood, and the people book are checked against their own structures. A malformed structure rejects the archive.
- Import only targets an empty fish: zero experiences, zero people, and an empty mood timeline. A fish with experiences, relationships, or mood history is rejected with an explicit “this fish is not empty” message; there is no silent overwrite.

A valid archive is staged under `$DSH_HOME/fish-mind/.import-pending/`, and settings show “staged, effective after restart”. On the next startup, before opening SQLite, fish-mind revalidates the staged files and the empty-fish condition, backs up the current small files, writes experience, identity, mood, and the people book, deletes `mind.sqlite*`, restores the exported short-term watermark, and rebuilds indexes from JSONL. The fact snapshot is written back after the database opens. Applying the import writes `import-report.json`, which settings show on the next visit.

If new experiences are recorded after staging, startup does not overwrite them: the import is discarded with a rejection report, and the current fish opens normally. Export is unavailable while an import is pending, so “the fish that has not taken effect” and “the current fish” cannot be mixed into one archive.

## Failure and recovery

A wrong archive format, checksum mismatch, out-of-range entry, or non-empty fish returns 4xx with a readable reason; the existing `identity.json`, experience stream, mood, and people book stay unchanged. If the staged archive fails revalidation at startup, or the fish is no longer empty, the import is discarded with a rejection report and fish-mind opens the current data normally. If applying fails midway, the staged directory is kept for the next startup, and `import-report.json` and `diag.log` record it. Existing files are backed up under `$DSH_HOME/fish-mind/import-backup-<time>/` before an import applies; manual rollback means copying them back.

Migration does not change the security boundary: export is triggered by the owner in the local UI, the archive may contain raw conversations and relationships, and settings say clearly to share it only with someone trusted. Import writes only profile and learning data; it does not change permissions, allowance, channel configuration, or code.
