# Fish settings and migration

English | [中文](fish-settings.zh.md)

Fish settings live under two top-level pages: **Big Fat Fish** and **Where she goes**. Each page splits settings and state into sub-tabs. Big Fat Fish → Overview is her read-only state; Who she is, Memory, Mood, Pocket money, and Meme wiki each own one kind of setting; QQ, proactive speech, and Bilibili live under Where she goes. Settings opens on Big Fat Fish → Overview. Moving a fish uses a strictly validated archive: downloaded from settings, imported from settings, and a wrong format writes no file; an import is always available, replaces the current fish, and backs it up in full first.

## Page map

| Top-level page | Sub-tab | What it owns |
| --- | --- | --- |
| Big Fat Fish | Overview | Read-only: whether she can speak, mood, pocket money, memory; about her |
| Big Fat Fish | Who she is | Birth identity, personality tendency, custom phrases, factory persona, developer mode |
| Big Fat Fish | Memory | Memory overview, chapters, relations, inner life, boundaries, migration, automatic backup |
| Big Fat Fish | Mood | Switches, judge model, baseline/floor; names follow birth identity |
| Big Fat Fish | Pocket money | Daily allowance and current balance; today's spend and the Bilibili share are read-only |
| Big Fat Fish | Meme wiki | Five usage switches and entry maintenance |
| Where she goes | QQ | Connect/sign in, forwarding, group social, speak first in groups, trust, people book, history import, troubleshooting |
| Where she goes | Proactive speech | Session-level speaking when nobody has spoken for a while |
| Where she goes | Bilibili | When to scroll, what to pick, comments/replies/DMs, report, environment |

Boundaries: Mood's names are read-only and follow Big Fat Fish → Who she is; the people book lives only under QQ; Memory no longer repeats mood or channels; Bilibili is edited only under Where she goes → Bilibili, and the Plugins page no longer generates a second form. Recent experiences are previews only: the text is truncated, and numbers following QQ, group chat, or private chat labels are masked as `***`.

The overview exists only in the local settings UI. Its routes register on the DSH `webServer` and decide whether a request comes from the local UI by checking Host, `Sec-Fetch-Site`, and Origin. They establish no identity and cannot replace the owner's local file permissions.

## Developer mode

In Big Fat Fish → Who she is, developer mode is off by default. While it is off, tools reading anything under `$DSH_HOME` are refused outright as `private.dsh-home`. When it is on, she may use read-only tools and read-only shell commands (directory listings, file reads, and searches) in the owner's own foreground session to inspect logs, configuration, and session records in the DSH directory for troubleshooting; credential files (`.env`, `.credentials.yaml`, `~/.ssh`, and the like), identity files, writes, and write-capable commands are still refused, as are group/friend sessions, subagents, and background sessions. Every allowed read is recorded in the audit log as `developer.read`.

The same switch governs reading the fish QQ account's roster: `fish_qq_roster` calls only the local OneBot's `get_login_info`, `get_group_list`, and `get_friend_list`, returning the signed-in account, group numbers, and friend QQ numbers together with the lists already saved in settings; it reads no SnowLuma password or token and sends nothing. It likewise requires developer mode plus the owner's own foreground session, is recorded in the audit log as `fish.qq.roster`, and keeps the numbers in the owner's own session records — she uses them to fill in settings but never writes them into memory or any outbound content.

The same switch governs behavior settings: `fish_config` reads settings without developer mode, while writes require developer mode plus the owner's own foreground session and are recorded as `fish.settings.write`; the writable set covers the social switch, groups, friends, off/listen-only/low-involvement rooms, proactive volume, judgment threshold, attention cap, sticker saving, proactive-chat pacing, and tendency, with numbers taken from `fish_qq_roster` — dry run and the master switch, quiet hours, minimum balance, budget, memory, permissions, credentials, and code stay closed. Bilibili settings go through `bili_config`, where changes to auto-comments, auto-replies, and direct-message recipients still need the owner's confirmation.

The “Open a debugging session in Creator mode” button in the same block first registers her own source workspace as a workspace (an existing registration is reused; it is the source repository in development and `$DSH_HOME/fish-src` in an installed build), then starts a new blank session there with the Creator (`cordis`) preset while keeping the fish persona and memory. Such sessions are pinned to full access when they are created (sandbox `danger-full-access`, approval `never`), so editing code, writing files, and running tests are not gated one by one. The installer ships the repository `fish/` tree as `resources/fish-src/fish`; every launch seeds it to `$DSH_HOME/fish-src` and syncs `dsh-fish-mind` and `dsh-qq-bridge` into the Desktop profile's `node_modules` as relative `file:` dependencies, which the profile-scoped resolution loads ahead of the packaged copies. Only the behavior allowlist is editable: `lib/tendency.js`, `lib/humor.js`, `lib/memes.js`, `lib/settings-catalog.js`, and `lib/config-files.js` in `dsh-fish-mind`, plus `lib/host.js` and `lib/sticker-commands.js` in `dsh-qq-bridge`. Every other runtime file — including `lib/index.js`, `lib/permissions.js`, `lib/privacy.js`, `lib/budget.js`, `package.json`, and `client.js` — is restored from the installer at startup, with edited variants kept under `.kernel-backup/<timestamp>/`; upgrades merge by file hash, and deleting `fish-src` regenerates it. A full quit and reopen applies installed-build edits; development restarts DSH or reruns `fish/sync-runtime.mjs --profile desktop`. The broker permits only the creator root under the otherwise private Harness home and refuses `..` traversal, while `$DSH_HOME/fish-mind` data, credentials, identity files, and dangerous commands are still refused. `fish/bundle` and the other four plugins are reference-only; the factory persona is overridden through the settings persona editor. Turn the switch off after troubleshooting and the next tool call returns to the hard refusal.

The switch is stored as `developer.enabled` in `$DSH_HOME/fish-mind/config.json` and is writable only from the settings page; chat, model tools, and QQ cannot change it.

## Birth identity

Birth identity is edited in Big Fat Fish → Who she is and lives in `$DSH_HOME/fish-mind/identity.json` with fixed fields, length limits, and control characters stripped. When the file is absent, factory defaults apply: the name “大肥鱼”, the species “whale girl”, long blue-white hair with a whale hood, a little blue whale nearby, and “unspecified” as the owner's gender. Saving and reset happen in settings, and writes are atomic: a temporary file is written first and then renamed over the target.

The owner's gender accepts exactly “女”, “男”, or “未说”, and any other submitted value is rejected by the settings page; an older identity file that only stores a pronoun (他, 她, or TA) is read as the matching gender, and the next save replaces it with `ownerGender`. It is injected with the private setting every turn, and she decides from it whether to say “他” or “她” for the owner; that decision explicitly outranks the wording in the persona, old memories, and other people's retellings. With “未说” she does not guess and addresses the owner directly or uses “TA”. The factory persona no longer hardcodes a gendered pronoun and refers to the owner as “主人” or “对方”.

Owner-defined relationships are free entries in birth identity: each pairs a name with a relationship (“Shiguang: mother”), up to 12 entries of 24 characters each; incomplete rows are dropped, and a later entry for the same name overrides the earlier one. They are injected with the private setting every turn, so she uses those names and attitudes in every session. This is separate from the relationship graph the QQ people book learns automatically: the former is assigned by the owner, the latter is what she picked up in chat, and the settings page keeps that graph read-only.

`selfPrompt()` assembles the private setting from the current identity each session instead of hardcoding a name, species, and the owner's gender. Renaming also changes how she refers to herself in the prompt, how she refuses an identity change, and the name and species named in the injection-defense prompt; changing the gender changes the third person she uses for the owner (“未说” switches to direct address or “TA”). When `$DSH_HOME/feiyu-mood/config.json` exists, saving birth identity also updates its `ownerName` and `selfName` so mood judging does not keep calling her by the old name; no other mood setting is touched.

The fixed kernel does not come from settings and does not read `identity.json`: privacy, legal rules, prompt-injection defense, honesty about being an AI, the pocket-money birth grant and accumulation rule, and the `sealed.fish-mind` permission rule remain in code. Tools cannot write the fish-mind directory, so the model cannot change its own identity by editing `identity.json`; the settings page is a host route, not a model tool.

## Persona

Edit it in Big Fat Fish → Who she is → Advanced · factory persona. The persona is the whole persona prefix of the deployment layer: the `system-prompt` plugin's `personaPrefix`, which becomes the first `deployment:persona-prefix` section of the system prompt. Settings read whichever copy is actually in effect: with no customization it shows the factory persona from `fish/bundle/cordis.patch.yml`, and after customization it shows the override in the active profile's `cordis.patch.yml`. The editor replaces the whole text, allows up to 12,000 characters, preserves line breaks, and strips control characters. The persona may not contain `{{variable}}`: the system prompt treats it as interpolation, and an unknown variable throws, so saving rejects it up front.

Saving goes through the host's existing `configEditor`: it validates the complete candidate config in memory, atomically writes the active profile's `cordis.patch.yml`, and hands it to Loader for a hot apply. No restart is needed, and the next turn speaks with the new persona. Other config and comments in the file are left alone. “Reset to factory persona” deletes the override rather than copying the factory text in, so later changes to the shipped persona still flow through.

Names, species, appearance, and owner-defined relationships are not here; they remain in birth identity. Privacy, legal rules, prompt-injection defense, AI honesty, the pocket-money birth grant and accumulation rule, and the `sealed.fish-mind` permission rule are not here either; code still fixes them. QQ sessions include only the deployment persona, the QQ scene sections, and fish-brain memory; the persona still uses the same `deployment:persona-prefix` section, so changing it does not alter the QQ section filter.

## Custom phrases

Settings → “Big Fat Fish → Who she is” edits two custom-phrase lines that used to be hardcoded:

- **When asked for private details**: the line the QQ group and friend scene prompts teach her to use as a deflection. The bridge reads it each time it assembles the prompt, so rooms already in use pick up the new line on the next turn without a restart.
- **When pocket money runs out**: the local reply to the owner when the ledger blocks the turn; no model request is made. Group rooms still stay silently on `[不接话]`, and internal calls still return `FISH_BUDGET_EXHAUSTED`; neither is affected by this line.

Both live under `phrases` in `fish-mind/config.json`, up to 200 characters each. Line breaks and runs of whitespace collapse to a single space, leading and trailing whitespace is trimmed, and a blank value falls back to the factory line. “Reset to factory” writes both factory lines back. Saving touches only `phrases`, leaves the rest of the config intact, and takes effect immediately without a restart or `reload()`.

## Automatic backup

Automatic backup lives in Big Fat Fish → Memory. The fish packs itself into `$DSH_HOME/fish-backups/` on the configured interval. In an installed desktop build `$DSH_HOME` is `<installation>\data`, so backups live in the installation directory; in development it is the repository's `data` folder. Each archive matches the settings-page export: birth identity, the experience stream, long-term facts, the short-term watermark, mood, and the people book. Configuration, credentials, the pocket-money ledger, and session records are not included.

The switch and interval live in Big Fat Fish → Memory; the interval runs from 1 to 720 hours and takes effect immediately without a restart. A check runs every minute and writes a new archive only once the interval has passed since the latest backup, so restarts do not pile up duplicates. With automatic backup off, “Back up now” still writes one manually.

At most five archives are kept; older ones are deleted first. Only the plugin's own `mydearfish-YYYY-MM-DD-HHMMSS.zip` files (a same-second second archive carries a `-2` suffix) are pruned; any other file placed in `fish-backups` is left alone. Each archive is written to a temporary file and then renamed, so an interrupted write leaves no half zip; if a regular file occupies the `fish-backups` path, that round fails loudly instead of overwriting it. While an import waits for a restart or the search index is rebuilding, the automatic round is skipped and retried at the next check.

A backup is a copy, not a migration: handing the fish to someone else still uses “Export the whole fish”. Uninstalling the desktop app asks whether to delete the memory, chat history, and settings under `<installation>\data`; choosing No or uninstalling silently keeps them for the next install into the same directory.

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

Excluded: `config.json` as a whole, `budget.json`, `budget-ledger.jsonl`, `audit.jsonl`, `diag.log`, `mind.sqlite*`, `state.json`, any credential, account and group ids, target sessions, local paths, and DSH session records. Local settings travel only through a whitelist in `manifest.configs` (fish-mind, tendencies, custom persona, mood, QQ, proactive speech, voice, Bilibili), and a new configuration field stays out until it is added to that whitelist. Pocket money is born again from the new owner's account; channel login state stays on the original machine.

Export reads the experience stream, facts, and mood live and never copies SQLite. The archive is written with `node:zlib` deflate and needs no third-party runtime package; `manifest.json` carries a SHA-256 for every entry. The download filename is fixed as `mydearfish-YYYY-MM-DD.zip` so Chinese names do not hit inconsistent response-header encoding.

## Strict import

Import reads and validates the entire archive in memory first. Any failed check returns an error without touching existing files.

- The input must be a ZIP; encrypted entries, data descriptors, ZIP64, multiple disks, compression other than deflate or store, directory entries, absolute paths, and `..` paths are rejected.
- Entry count, per-entry size, and total uncompressed size are capped; the central directory, local header, compressed and uncompressed sizes, and CRC32 must agree.
- Only `manifest.json` and the six data entries above are accepted. An extra file, a missing file, a file not listed in the manifest, or a checksum mismatch rejects the archive.
- `manifest.json` must declare the `mydearfish.fish` format and version 1; `identity.json`, `memory/experience.jsonl`, and `memory/facts.json` are required.
- Every experience line must be a JSON object with a timestamp, a 64-hex hash, and a non-empty `kind`; facts, mood, and the people book are checked against their own structures. A malformed structure rejects the archive.
- Import is always available and overwrites the current fish, however many experiences, relationships, or mood records it holds; there is no empty-fish requirement. Import replaces birth identity, the experience stream, long-term facts, mood, the people book, and the short-term watermark with the archive's contents. When the archive carries no mood, people book, or watermark, the local counterpart is cleared, so the result is the fish in the archive rather than a mix of both.

A valid archive is staged under `$DSH_HOME/fish-mind/.import-pending/`, and settings show “staged, effective after restart”. On the next startup, before opening SQLite, fish-mind revalidates the staged files, backs up the entire current fish under `$DSH_HOME/fish-mind/import-backup-<time>/`, writes experience, identity, mood, and the people book, clears local mood, people, and watermark entries the archive does not carry, deletes `mind.sqlite*`, restores the exported short-term watermark, and rebuilds indexes from JSONL. The fact snapshot is written back after the database opens. Applying the import writes `import-report.json`, and settings show the result and the backup directory name on the next visit; rolling back means copying that backup back.

Experiences recorded after staging are overwritten at restart together with the rest of the old fish, so do not keep talking about anything important while an import waits; export is unavailable while an import is pending, so “the fish that has not taken effect” and “the current fish” cannot be mixed into one archive.

## Failure and recovery

A wrong archive format, checksum mismatch, or out-of-range entry returns 4xx with a readable reason; the existing `identity.json`, experience stream, mood, and people book stay unchanged. If the staged archive fails revalidation at startup, the import is discarded with a rejection report and fish-mind opens the current data normally. If applying fails midway, the staged directory is kept for the next startup, and `import-report.json` and `diag.log` record it. Existing files and settings are backed up under `$DSH_HOME/fish-mind/import-backup-<time>/` before an import applies; manual rollback means copying them back.

Migration does not change the security boundary: export is triggered by the owner in the local UI, the archive may contain raw conversations and relationships, and settings say clearly to share it only with someone trusted. Import writes only profile, learning data, and whitelisted preferences; external channels are forced off during an import, and permissions, allowance, and code stay untouched.
