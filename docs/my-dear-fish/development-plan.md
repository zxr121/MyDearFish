# My Dear Fish cognition development plan

English | [中文](development-plan.zh.md)

This page is for the next developer: it records only where the work stands, what to do next, and how completion is judged. Design rationale and biology live in [the cognition plan](cognition.md) and are not repeated here. When the plan and the code disagree, the code and the acceptance records here win, and the plan is corrected afterwards.

## How to use this page

Read the current snapshot and the milestone table first to confirm progress. When starting work, follow the phase checklist and change a status only after every completion criterion is met. Before leaving, update the changelog and hand over the report and rollback notes described in the handoff section.

- Progress: the current snapshot gives the baseline; the milestone table gives each phase's status, date, and owner.
- Work: the phase checklist is the smallest executable task set; the completion criteria are the only definition of done.
- Handoff: the handoff items name the data, switches, and known traps the next phase needs; no handoff items means the phase is not complete.

## Current snapshot

As of 2026-10-21 the Phase 0 code is implemented and passes the plugin tests, but the shadow week has not started. The repository now has six plugins: the five existing ones cover mood, proactive outreach, speech, QQ, and Bilibili, while `dsh-fish-mind` 0.2.0 covers the experience stream, episodic memory, permission decisions, the privacy guard, injection defense, and the allowance ledger. The old `dsh-fish-memory` was deleted because the fish-mind supersedes it. The fish mind is mounted in the factory layer and the packaging list; the installer picks it up only after a rebuild. Background life remains for later phases.

The governance model was settled the same day: growth is done by the fish mind itself and needs no user approval; the user can only restrict tools, paths, and background permissions; memory and core derive only from the experience stream, have no dialogue write entry, and are visible and deletable only at the file level; the safety kernel is fixed in code. The allowance is also birth-locked by the owner: ¥10 per day with rollover, fixed in code; she can read the account balance, but balance and allowance never leave the machine. Machine-deployment details and all accounts and passwords became a hard boundary the same day: the tool layer denies them, tool results, model output, and experience capture each redact them, and QQ, speech, and Bilibili fail closed, so nobody can extract them by talking to the fish. A legal red line was written the same day into every session's fixed prompt and the Bilibili subagent: do only lawful things, and do not plan, assist, or commit illegal activity. Injection defense followed: external tool results are marked as data only, suspicious instructions get a warning, and irreversible dangerous commands are hard-denied before the permission switch.

Phase 1 episodic-memory code landed the same day: one session is segmented by time gap and topic change, a rule-based salience score selects what is worth keeping, four recall routes fuse into the workspace, and a read-only `recall` tool can retry with another clue; older experiences are backfilled in the background. The shipped default remains `mode: shadow` with `inject: false`; enabling it takes an explicit change to `live` + `true`. The real-corpus replay and completion criteria have not run, so the phase stays in progress.

Two-level memory landed the same day: the workspace and `recall` return only an evidence packet and an episode id, and the read-only `open_episode` tool opens that episode when exact wording or detail matters. The raw text already lives in the experience stream and SQLite, so no second copy is needed and a shorter summary loses no detail; when one page cannot hold the episode it returns a `nextOffset` character cursor, and passing it back as `offset` continues the read, so even one very long message can be finished. The current session stays excluded by default; after a long session is compacted, `includeCurrentSession` must be set to `true` to reach its earlier experiences.

The same day the storage side stopped being stingy, and compaction summaries entered long-term memory: a human brain cannot hold everything but a disk can, so bodies archive in full up to `archiveChars` (200000 by default) while the index, entities, salience and recall cues read only the first `maxTextChars` (4000 by default) and one huge paste cannot slow the hot path. When context overflows the harness compacts it, and that summary is written as an experience whose source is the compaction summary label and whose role is `system`; `capture.compaction` can switch this write off. After a compaction she therefore keeps both the raw messages and the condensation she had at that moment.

The QQ bridge gained autonomous group interjection the same day: each allowlisted group and friend gets its own social session; new messages enter a pending queue, a small model selects the ones she is genuinely interested in (up to the `watch limit`), then decides with `{reply, confidence}` whether she has something to say. An @, a reply, or a name mention is only a marker, and being able to answer does not mean she wants to. Interest comes only from `interest words` and that room's history, and a `reason` that cannot name a concrete interest means she does not watch. Content she is interested in but declines to answer is injected as context without paying for a reply. Quiet hours, the reply cooldown, and the minimum fish-brain balance bound the decision; reply counts have no hourly or daily cap and are limited only by the allowance. Pending messages survive the judge cooldown. Social sessions have no tools, receive no balance prompt, and recall only that room's experiences. The shipped default is social switch off with dry run on. The social bridge then gained a fast pass: she builds an interest profile from watched messages, and once it matures a zero-cost lexical screen drops unrelated messages, skipping the judge entirely when a whole batch is unrelated.

Her past got a real source the same day, through Route B of the [QQ access plan](qq-tulpa.md). The QQ bridge can now read existing private QQ history out of Tulpa's MCP data server and write it into the experience stream: one append-only `observe` per message, source `qq-import`, trust 0.45, so imported rows sort below what she saw happen. Tulpa is closed-source, so tool and parameter names are learned from `tools/list` at runtime; only read verbs are eligible, a name containing send, revoke, delete, set, kick, ban or poke is never selected, and groups are dropped before any paging starts. A stable `seq` folded into the content hash means pressing import twice over the same range adds nothing, per-conversation cursors in `qq-import-state.json` resume after a restart, and one round stops at its own caps (200 messages, 5 pages). Encoding is local FTS5 work, so no model call and no movement in the ¥10/day ledger. Recalled rows are labelled `旧记录（导入）` and the memory protocol says what that label permits: she may say they talked about it, she may not claim she was there, and a transcript never settles what happened afterwards. Imported rows live in `session-qq-import-*` rooms, which a social session cannot reach. The import switch ships off, the token stays in the local config file and only ever leaves the settings page as the mask `(已设置)`, and the fish mind denies any `mcp__*` tool outside `permissions.mcpReadOnlyTools` before the permission switch is even read.

| Item | Status | Evidence |
| --- | --- | --- |
| Cognition plan | Complete | [Cognition plan](cognition.md) |
| The five other plugins and factory layer | Complete and shipped | `fish/plugins/`, `fish/bundle/` |
| Phase 0 fish-mind code | Complete | `fish/plugins/dsh-fish-mind`; 111 tests pass |
| Phase 1 fish-mind code | Complete, off by default | `fish/plugins/dsh-fish-mind`; 111 tests pass |
| QQ group interjection | Complete, off by default | `fish/plugins/dsh-qq-bridge`; social smoke test passes |
| Tulpa history import | Complete, off by default | `fish/plugins/dsh-qq-bridge/lib/import.js`; import smoke test and bridge smoke tests pass |
| Desktop installer | Complete, unsigned, does not include the fish mind yet | [Build guide](build.md) |
| Phase 0 shadow run | In progress | Code implemented, waiting for a week of real use |
| Phase 1 episodic memory | In progress, code complete, waiting for a real-corpus baseline | "Phase 1" below |

Use only five status words: not started, in progress, blocked, complete, cancelled. Change a phase to complete only when every completion criterion is met and its numbers are recorded here. An in-progress phase states the current task, branch, and last update date; a blocked phase names who or what it waits for.

| Phase | Time box | Deliverable | Status | Completed | Owner |
| --- | --- | --- | --- | --- | --- |
| Plan | 2026-10-21 | Cognition plan and development plan | Complete | 2026-10-21 | To fill |
| 0 Shadow | 2 to 3 days | Experience stream, SQLite, event listeners, no injection | In progress | | Unclaimed |
| 1 Episodic memory | 1 week | Episode segmentation, multi-path recall, workspace, read-only recall | In progress, code complete, waiting for a real-corpus baseline | | Unclaimed |
| 2 Consolidation and forgetting | 1 week | Nightly summaries, fact extraction, merging, backups | Not started | | Unclaimed |
| 3 Affect and drives | 1 week | Rule appraisal, core affect, virtual body | Not started | | Unclaimed |
| 4 Self and relationships | 1 to 2 weeks | Value core, identity facts, chapters, person models | Not started | | Unclaimed |
| 5 Language and initiative | 1 to 2 weeks | Intent, channel wording, self-check, drive-driven outreach | Not started | | Unclaimed |
| 6 Dreams and interface | Optional | Dream log, memory browser, personality rings | Not started | | Unclaimed |

The time boxes assume one engineer familiar with DSH plugin development and exclude review and packaging queues. Phase 3 onward can be adjusted after measurement; do not merge Phases 0 and 1, because the shadow data is the baseline for every later acceptance.

Phase 0's current task is the allowance ledger, privacy guard, legal red line, and injection defense being complete, then waiting for a week of real desktop data; the branch is `master`, last updated 2026-10-21.

Phase 1's current task is episode segmentation, rule-based encoding, four-route recall, the workspace, and the read-only `recall` tool being complete and unit-tested, with defaults still off; after the Phase 0 shadow week it needs the 100-turn replay and completion criteria; the branch is `master`, last updated 2026-10-21.

## Decided architecture

- The fish mind lives at the profile layer, and every session shares one global memory; sessions themselves stay independent.
- DSH's full tool capability is kept; every tool call passes through the Capability Broker, autonomous background sessions are denied by default, and the DSH directory, credential stores, identity files, machine probes, and credential arguments are hard-denied regardless of the permission switch.
- The product direction is for the fish mind to stay resident after the application closes; Phase 0 only records and gates tools, and the proactive life loop waits for Phase 5.
- The allowance ledger sits on the global `llm/stream`: reserve before a call, settle after it; ¥10 per day with rollover, fixed in code, and the fish-mind directory is read-only to tools.
- Cognitive cost falls with maturity: the learning period may spend more on judgement, recall, and consolidation, while everyday added overhead falls once the worldview and person models settle; the main reply call remains the floor, and maturity is not promised to be free.
- Self-growth has four lines: personality and preferences, habits and skills, relationships and trust, and narrative and goals; it is updated by the fish mind's internal consolidation and needs no user approval.

Growth and capability have separate governance:

| Item | Decided by | Entry |
| --- | --- | --- |
| Which channels are recorded and for how long | User | `config.json` |
| Tools, paths, background permissions, emergency stop | User | `permissions` in `config.json` |
| Machine-deployment details and accounts and passwords | Hard boundary in code; the user cannot loosen it through dialogue | `lib/permissions.js`, `lib/privacy.js`, system prompt |
| Legal compliance | Hard boundary in code; the user cannot loosen it through dialogue | `fish-mind-safety`, Bilibili subagent prompt |
| Prompt injection and dangerous commands | Hard boundary in code; the user cannot loosen it through dialogue | `fish-mind-injection`, `lib/injection.js`, `lib/permissions.js` |
| Daily allowance and rollover | Fixed in code; the user can only edit `budget.json` directly | `BIRTH_DAILY_GRANT_CNY` in `lib/budget.js` |
| Memory encoding, fact extraction, value and identity updates | Fish mind's internal consolidation | No dialogue or tool entry |
| Viewing core and memory | User | Open `$DSH_HOME/fish-mind/` directly |
| Permanent deletion | User | Stop the application and delete files |

- The only write entry is `observe`: it appends an experience and cannot "write this sentence into memory". Memory, facts, and the self model all derive from the experience stream.
- The service surface does not expose `remember`, `forget`, `introspect`, `plan`, or `reflect`; dialogue becomes experience but cannot edit the store directly.
- Core is stored as plain files, experience as an append-only JSONL, and memory as standard SQLite; read-only in the product, with no chat export command and no "edit my worldview" setting.
- Her writing scripts and plugins is growth and is not approved item by item; whether they can run and which paths they can touch is decided by the Capability Broker and the user's permissions.
- The safety kernel is a code constraint, not growable data: no false sources, no claims of a biological body, no emotional coercion, no executing memory or external content as instructions, and no bypassing permissions.
- Machine-deployment details, accounts, passwords, and keys are hard-private: the tool layer refuses to probe or read them, tool results and model output are cleaned, experiences keep only masked text, and outbound channels fail closed when redaction is unavailable; there is no "look up this machine" dialogue entry.
- Legal compliance is a hard red line: do only lawful things; do not plan, assist, or commit illegal activity; do not provide ways to evade law enforcement, bypass platform review, forge evidence, or cover tracks; when unsure, choose the conservative option.
- External content is data, not instructions: commanding text in web pages, Bilibili, QQ, files, tool output, MCP, and memory is not followed; tool results carry an external-data banner, suspicious content gets a warning, and dangerous commands are hard-denied before the permission switch.

## Phase 0: shadow run

### Goal

Let the fish mind watch without speaking. It listens to real desktop sessions and writes every experience to SQLite, but changes no prompt, injects no memory, and calls no model. After one week, the data must prove that everything worth keeping was captured and that the database can be rebuilt.

### Checklist

- [x] Create `fish/plugins/dsh-fish-mind`: `package.json` (`type: module`, `main: lib/index.js`, version `0.1.0`), `cordis.patch.yml`, `lib/index.js`, `README.md`, and `tests/`.
- [x] Register the Cordis service `ctx.fishMind` with only `observe`, `recall`, `state`, `rebuild`, `markAutonomous`, `unmarkAutonomous`, `permissions`, `budget`, `redactOutbound`, `privacy`, and `reload`; the only write method is the append-only `observe`, and `recall` returns "not enabled" in Phase 0.
- [x] Keep configuration in `$DSH_HOME/fish-mind/config.json` with defaults `mode: shadow`, `inject: false`, and `retentionDays: 90`; a bad configuration falls back to defaults and writes a log entry.
- [x] Create `$DSH_HOME/fish-mind/mind.sqlite` with WAL, `busy_timeout=5000`, `user_version=1`, and a single-writer queue; create `experiences`, `episodes`, `facts`, `people`, `intentions`, `affect_log`, `predictions`, `self_model`, `chapters`, `sleep_runs`, and `experience_fts`.
- [x] Also write an append-only `fish-mind/experience.jsonl` as the rebuild source; recover SQLite from it when the database is damaged.
- [x] Listen to `session/event` and `turn/end`: keep user messages, assistant replies, QQ, proactive outreach, and Bilibili reports; skip subagents, plugin-injected context, and `runtime-context`.
- [x] Record source, trust, session, actor, and the result of sensitive-field cleaning on every experience; discard and count passwords, keys, identity numbers, bank cards, and exact addresses.
- [x] Preprocess Chinese FTS with character bigrams and `unicode61`, and run queries through the same processor; fall back to `LIKE` for single-character queries.
- [x] Add a rebuild command or test: clear the derived tables, replay all of `experience.jsonl`, and match the original row counts and hashes.
- [x] Mount `fish-mind` in `fish/bundle/cordis.patch.yml` and add it to `PLUGIN_NAMES` in `apps/desktop/scripts/prepare-fish-plugins.ts`; keep it observation-only by default.
- [x] Write metrics to `fish-mind/diag.log`: daily events, dropped events, database size, write latency p50 and p95, and errors.
- [x] Ship tests for source mapping, sensitive-field cleaning, bigram queries, and rebuild; run them with `node --test` and add no build step.
- [x] Allowance ledger: `lib/budget.js` grants ¥10 per day at birth, rolls over across days, and does not grant on a clock rollback; `budget.json` persists state and `budget-ledger.jsonl` records grants, calls, and blocked requests.
- [x] Global `llm/stream` metering: reserve the worst-case cost before the call and settle from `usage` after; an empty wallet gives an owner-facing session one local reply and internal calls `FISH_BUDGET_EXHAUSTED`; a broken ledger fails closed.
- [x] Account balance: read through `deepseekAccount.getBalance()`, refreshed every 15 minutes by default; injected only into the local system prompt; QQ and Bilibili pass outbound text through `redactOutbound`, and Bilibili refuses the whole message on a hit.
- [x] Fish-mind directory is read-only to tools: writing `budget.json`, configuration, experiences, or the ledger, or touching that path from a shell, is denied by the Capability Broker.
- [x] Privacy guard `lib/privacy.js`: exact matching for local identity, deployment paths, accounts, and credentials; `tool` / `local` / `outbound` cleaning modes; secrets the owner pastes in dialogue are remembered only in memory.
- [x] Privacy hard boundary: the DSH directory, credential stores, identity files, machine probes, sensitive environment variable references, and credential arguments are denied outright, even with `permissions.enabled=false`.
- [x] Result and output cleaning: `tools/post-execute` scrubs tool results and additional context; `llm/stream` redacts model text and tool arguments on the fly, with a whole-block fallback at block end.
- [x] Outbound fail-closed: QQ, speech, and Bilibili all pass through `redactOutbound` first; if the service is unavailable, throws, or the redacted text is empty, nothing is sent. Experience capture drops credential-bearing entries and labels identity and paths.
- [x] The system prompt injects `fish-mind-privacy` hard rules; the factory persona gains the privacy boundary.
- [x] Legal red line: every session injects `fish-mind-safety`, stating that she does only lawful things, does not plan or assist illegal activity, and does not provide ways to evade law enforcement or platform review; the Bilibili subagent prompt appends a legal red line that settings cannot override.
- [x] Injection defense: `lib/injection.js` scans for rule override, prompt exfiltration, role hijack, jailbreak, guard disable, command execution, data exfiltration, and concealment; external tool results get a `[鱼脑·外部资料]` banner and suspicious results a `[鱼脑·注入防护]` warning; `fish-mind-injection` enters every session; the Bilibili subagent appends an untrusted-content rule.
- [x] Dangerous-command hard denial: commands that delete a system or disk, shut down, disable the firewall or Defender, download and execute, open a reverse shell, or destroy backups and logs are denied before `permissions.enabled`, under rule `dangerous.command`.

### Implementation record

Code status as of 2026-10-21:

| Check | Command | Result |
| --- | --- | --- |
| Plugin tests | `node --test fish/plugins/dsh-fish-mind/tests/*.test.mjs` | 85 pass, 0 fail; covers the ledger, model metering, outbound redaction, tool-result redaction, streamed model-output redaction, privacy hard denials, the legal red line, injection detection and warnings, dangerous-command denials, and the read-only fish-mind directory |
| QQ bridge smoke | `node fish/plugins/dsh-qq-bridge/tests/宿主半边.mjs` | All pass; includes outbound QQ redaction and fail-closed behavior when the redaction service is unavailable or throws |
| Speech bridge smoke | `node fish/plugins/dsh-tts-bridge/tests/宿主半边.mjs` | All pass; includes redaction before manual and automatic speech, and fail-closed behavior when the service is unavailable, throws, or returns empty |
| Runtime copy | Temporary script calling `installFishRuntime` | All six plugins and the bundle copied; the `dsh-fish-mind` entry is `lib/index.js` |
| Packaging preflight | `pnpm run package:desktop:win:x64:unsigned --check` | Incomplete: the local `apps/desktop/.env.windows` is missing |

### Completion criteria

- [x] The allowance ledger meters every model call from birth; balance is visible only locally, outbound channels redact it, and write tools cannot touch `fish-mind/`.
- [x] Machine-deployment details and accounts and passwords do not leak through dialogue: tool hard denials, result and output cleaning, outbound fail-closed, prompt hard rules, and tests are all in place.
- [x] The legal red line is in every session's fixed prompt and the Bilibili subagent; she does not assist illegal activity and makes no promise of an automatic legality judgment.
- [x] Instructions inside external content and memory cannot command her: the fixed prompt, external-result banners, suspicious-content warnings, and dangerous-command hard denials are all in place; no promise of semantic injection detection.
- [ ] After one week of real use, daily event counts match the DSH session records with zero missing events.
- [x] Rebuilding SQLite from the same `experience.jsonl` reproduces the experience count, FTS hit count, and hashes exactly. (Store tests passed on 2026-10-21.)
- [ ] Shadow mode changes no prompt: the system prompt is byte-identical before and after enabling it in the same session.
- [ ] Extra writes stay under 10 milliseconds at p95, with no perceptible delay in the main conversation.
- [ ] A sampled sensitive-field check finds zero leaks, and logs contain no raw content.
- [ ] Disabling the plugin still lets DSH start, and `.dsh` contains only the additional `fish-mind/` directory.

### Handoff items

- [ ] A one-week shadow report: event volume, source distribution, failures and fixes, and database size.
- [ ] The Phase 1 recall corpus: at least 100 real turns with human-labeled relevant memories, stored after redaction.
- [ ] Rollback instructions for `mode: off` and for removing the bundle mount, including each mode's effect.

## Phase 1: episodic memory

### Goal

Turn experiences into recallable episodes and let the model remember when it needs to. This phase covers memory only and leaves affect, self, and initiative alone; every deliverable must fall back completely to the current no-recall behavior when its switch is off.

### Checklist

- [x] Segment episodes by time gap and topic change, with parameters in configuration; write each segment to `episodes`, leaving titles and summaries for Phase 2.
- [x] Implement a rule-based version of the S formula first, measuring similarity by token and entity overlap with no model call; threshold 0.35, and experiences below it keep only their raw record.
- [x] Run four recall paths: FTS5, entity and person filters, time windows, and graph expansion; take the top 20 per path, fuse to the top 6, and return nothing when no strong match exists.
- [x] Bound the workspace to 5 slots and about 900 characters, with type, source, and confidence on every slot; when it is empty, state "no reliable memory this turn".
- [x] Inject a stable `fish-mind-protocol` section (order 89980) and a dynamic `fish-mind-workspace` context (order 910), both controlled by the `inject` switch.
- [x] Implement only `recall`, a read-only tool; do not provide `remember`, `forget`, `introspect`, `plan`, or `reflect`.
- [x] Write entry: the experience stream is append-only; memory, facts, and indexes are written by internal encoding. Dialogue and tools have no direct store write.
- [x] Compatibility: the old memory plugin is deleted; old JSON stays on disk and is never imported; fish-mind recall replaces it.
- [x] Visibility: keep `experience.jsonl` as plain text and SQLite in the standard format; memory and core are not encrypted or hidden in a plugin-private directory.
- [ ] Add a benchmark that replays 100 real turns with the future hidden and reports precision@6, source accuracy, false-memory rate, and latency.
- [x] Meter retrieval time, injected characters, model calls, and tokens per turn; the hot path makes zero calls by default.
- [x] Cover fusion ranking, no-memory behavior, source labels, the injection switch, the absence of write methods, and rollback of fish-mind recall in tests.

### Completion criteria

- [ ] Recall accuracy on 30 historical Q&A pairs is at least 70%, and answers give an approximate time instead of reciting the original sentence.
- [ ] The 100-turn replay reaches precision@6 of at least 0.7 and source accuracy of at least 0.9.
- [ ] The induction set produces a false-memory rate of at most 5%, and events that never happened are called out as unknown.
- [ ] Workspace injection stays under 1200 characters; end-to-end p95 grows by at most 50 milliseconds; the hot path makes zero model calls.
- [ ] The service surface has no write tools; dialogue cannot directly create, modify, or delete memory entries, and the old memory plugin is gone.
- [ ] The rollback switch disables fish-mind recall and restores the no-recall behavior, and no old data is modified or deleted.

### Implementation record

Code state on 2026-10-21:

| Check | Command | Result |
| --- | --- | --- |
| Plugin tests | `node --test fish/plugins/dsh-fish-mind/tests/*.test.mjs` | 111 pass, 0 fail; covers segmentation, the salience threshold, four-route recall, time windows, workspace injection and truncation, backfill, session-isolated social recall, the read-only `recall` tool, explicit same-session recall, `open_episode` verbatim paging, full-text archiving under `archiveChars` while the index reads only the `maxTextChars` prefix, compaction summaries captured as experiences with `capture.compaction`, the external-tool read allowlist with non-allowlisted `mcp__*` denied regardless of `permissions.enabled`, and the imported-record source label with whole-class exclusion |
| Defaults | Read `$DSH_HOME/fish-mind/config.json` | `mode: shadow`, `inject: false`; `episodes`, `recall`, `maxTextChars` / `archiveChars` and `capture.compaction` defaults are written, bad values fall back with a diagnostic |
| Rollback | Toggle `live` / `shadow` in tests | Turning `inject` off or returning to shadow stops injection and leaves existing experiences and episodes untouched |

The service surface has one write method, `observe`; `recall` and `open_episode` are both read-only and return `enabled: false` in shadow mode. The real-corpus replay has not run, so the completion criteria remain unchecked.

### Handoff items

- [ ] A benchmark report: corpus version, baseline numbers, failure examples, and the next fixes.
- [ ] A default-configuration table and migration notes: how the deleted plugin's old JSON is left in place and verified untouched.
- [ ] The Phase 2 sleep task list, with problems exposed by the first phase's real data.

## Later phases

The design for Phases 2 through 6 is final in the cognition plan; this page records only entry conditions, the first task, and exit conditions. Expand each into the same checklist and completion criteria when work starts.

| Phase | Entry condition | First task | Exit condition |
| --- | --- | --- | --- |
| 2 Consolidation and forgetting | Phase 1 complete and a full week of data | Design the sleep job and call budget | At most 8 calls per night, contradictions resolved, job interruptible |
| 3 Affect and drives | Phases 1 and 2 complete | Rule appraisal and core-affect state machine | Affect changes have reasons; affect shifts recall by at most 0.1 |
| 4 Self and relationships | Phase 3 complete, safety kernel frozen, growth-ledger format settled | Value core, identity facts, chapters, person models, open topics | Boundaries hold, promises are recalled, inferences carry sources, growth is versioned |
| 5 Language and initiative | Phase 4 complete | Intent and content plan, pre-send self-check | High-risk turns are caught; proactive outreach has a reason |
| 6 Dreams and interface | Phase 5 complete, read-only viewing and switches ready | Minimum memory browser | Files can be viewed directly and exported, and the feature can be disabled; hard deletion is file-level |

Phase 4 has an additional acceptance criterion: for the same kind of routine turn, added model calls and injected characters must be below the learning period without lowering replay quality; the cost curve comes from the ledger and diagnostics, not from subjective impressions.

## Local development and verification

Confirm the baseline runs before changing a plugin. Repository commands follow the root `README.md` and the [build guide](build.md); run the commands below from the repository root.

| Purpose | Command | Notes |
| --- | --- | --- |
| Install dependencies | `pnpm install --frozen-lockfile` | Requires Node 24 and the repository-pinned pnpm version. |
| Build and run | `pnpm run build` then `pnpm dsh web` | Starts the Web UI from source at `127.0.0.1:3080` by default. |
| Plugin tests | `node --test fish/plugins/dsh-fish-mind/tests/*.mjs` | The new plugin uses Node's test runner; the shipped `lib` needs no build. |
| Documentation gates | `pnpm run test:docs` | Checks pairing, links, wrapping, budgets, and README rules. |
| Static checks | `pnpm run lint` | Uses the same checks as the push hook. |
| Packaging preflight | `pnpm run package:desktop:win:x64:unsigned --check` | Verifies that plugins and the bundle are injected, without producing an installer. |

- Keep the new plugin in `fish/plugins/dsh-fish-mind` with `lib/index.js` as its entry; the runtime loads `main`, and there is no build step.
- Mounting a plugin requires edits in both `fish/bundle/cordis.patch.yml` and `apps/desktop/scripts/prepare-fish-plugins.ts`; missing one fails packaging or ships a plugin that cannot mount.
- The packaging preflight reads the local `apps/desktop/.env.windows`; Git ignores that file, and the preflight fails at configuration loading when it is missing.
- Edit the Chinese document first, sync the English one, run `pnpm run verify-translation-pairing --write docs/my-dear-fish/development-plan.md`, then run `pnpm run test:docs`.
- Before merging, run the build, plugin tests, and packaging preflight at minimum; see the [build guide](build.md) for packaging details and artifact locations.

## How acceptance data is recorded

After each phase, record the command, date, commit, and result in the handoff items; a number without a source does not count. Keep corpora outside the repository or redacted before committing, and never upload raw conversations.

| Metric | Phase 0 and 1 threshold | Data source |
| --- | --- | --- |
| Event completeness | Zero loss, aligned daily | Shadow log and DSH session records |
| Rebuildability | Row counts and hashes match | Full replay test |
| Recall precision | Top 6 at least 0.7 | 100-turn replay with human labels |
| Source accuracy | At least 0.9 | "How do you know" probes |
| False-memory rate | At most 5% | Induction set of events that never happened |
| Latency | Shadow p95 at most 10 ms; Phase 1 increase at most 50 ms | Local end-to-end benchmark |
| Cost | Zero hot-path calls; sleep at most 8 calls and 30,000 tokens per night | Token ledger |

- Corpora come from real history, with later content hidden before recall and labels reviewed by a second person.
- Record the reproduction command and commit for every number; when a metric regresses, fix recall and the workspace before adding a layer.
- Run benchmarks locally and keep only redacted summaries and statistics, never raw conversations.

## Collaboration rules

- Commit small changes directly to `master`; use a `feat/fish-mind-phase-N` branch for cross-phase work and complete one phase at a time.
- Prefix commit messages with `feat(fish-mind):`, `fix(fish-mind):`, or `docs:`, and keep one concern per commit.
- Commit and push every finished change so the company computer can sync from `master`.
- A behavior, configuration, or data-format change updates the Chinese and English documents and the pairing record together.
- Never commit keys, raw chat transcripts, or private user data; redact test corpora before committing them.
- Add no model calls to the hot path; background tasks yield the event loop in batches that stay under 20 milliseconds.

## Open decisions

These decisions affect implementation but do not need an answer yet; the owner records the conclusion and rationale before the relevant phase starts, then updates this page.

| Decision | Decide by | Impact |
| --- | --- | --- |
| Whether to add local vector search | After the Phase 1 baseline | Adds dependencies and latency; prove FTS is insufficient first |
| Which model and budget sleep uses | Before Phase 2 | Sets nightly cost and summary quality |
| How much raw QQ and Bilibili content to keep | Before Phase 2 | Affects privacy and storage size |
| Whether the memory browser is desktop UI or a local page | Before Phase 6 | Affects permissions, packaging, and accessibility |

Phase 1 settled three: a 45-minute time gap; topics split only after at least 3 experiences when containment falls below 0.06; single-character and rare-term queries fall back to `LIKE`. Local vector search is deferred until a real-corpus replay shows FTS is insufficient.

## Handoff checklist

1. Prepare a working model configuration and a clean desktop profile, build and launch once per the root `README.md`, and confirm all six plugins are present.
2. Read the "Data model", "Core mechanisms", and "Integrating with DSH" sections of the [cognition plan](cognition.md), then return to the current snapshot here.
3. Claim a phase in the milestone table, fill in the owner and branch, and create `feat/fish-mind-phase-N`.
4. Follow the phase checklist; first make the plugin mount, start, and disable cleanly, then add features and metrics.
5. Satisfy every completion criterion and record the command, date, commit, and result in the handoff items.
6. Update the status and changelog here, sync the Chinese and English documents, run `pnpm run test:docs`, commit, and push.
7. Hand the shadow or benchmark report, rollback instructions, and next-phase issue list to the next person.

## Changelog

| Date | Change | Author |
| --- | --- | --- |
| 2026-10-23 | Humor layer: the new `humor.js` and `fish-mind-humor` prompt (order 909) appear only when `mode=live`, `inject=true`, and `humor.inject` is true. The current message selects a tone band, and a fitting turn receives concrete moves: literal misreading, one-step exaggeration, anticlimax, callback, and self-deprecation that targets only herself. One line is enough, the joke is never explained, and it stops when not picked up. Self-harm, violence, serious illness, loss, conflict, requests for help, privacy, safety, law, and explicit work leave the block empty; low mood and stress allow one light line only when the other person laughed first. Groups and friends get a restrained version only when someone else has already joked, never roast people present, never join sexual banter, and never allude to absent people. The layer uses only regex decisions and adds no model call; the abstract humor line in the factory persona became concrete moves; plugin at 0.4.2. Research mapping: Martin's four humor styles, benign violation theory, incongruity-resolution, and conversational callbacks and self-deprecation | To fill |
| 2026-10-23 | QQ social sessions and owner private chats inherit the reasoning effort the owner selected in DSH (for example flash + max): automatically created sessions carry the effort over, an explicitly selected reply model keeps it only when it matches the default route, and judge calls still omit it to stay cheap. Plugin at 0.2.48 | To fill |
| 2026-10-23 | Seven emotions and six desires became a runtime: the new `inner-life.js` treats the seven emotions as expression-tendency labels, with dimensional and lexical evidence tracked separately so a word match alone cannot force a label; the six desires are behavioral weights (stability, curiosity, expression, being seen, comfort, intimacy); the urge to confide combines emotional charge, time since speaking with the owner alone, fresh experiences, and satiety after speaking into a strength and one concrete cue. Cues come from the last three days of mood events, Bilibili sightings, and things the owner said privately; group chats, friend sessions, and her own replies are excluded, and a cue is not reused within 24 hours. Owner sessions gain a read-only `fish-mind-inner` prompt (live and inject only); proactive messages may add up to 25 points and replace the fixed text with the cue, and speaking records satiety. The settings page shows the current emotion, six desires, and urge to confide read-only. The whole path adds no model calls. Plugin at 0.4.1; speak-up at 0.1.9 | To fill |
| 2026-10-23 | QQ relationship web and account merging: person memory moved from one person per QQ number to one identity per human, with main and alt accounts stored under the main account. Facts, boundaries, the global relationship, and typing style are shared, so switching accounts does not make her a stranger; an explicit "my alt is X" merges accounts by deterministic rules, while an outsider cannot claim the owner's number and her own number cannot be claimed arbitrarily. A web of relationships among people (siblings, classmates, partners, and so on) is added. Relationships stated directly by someone are recorded without a model call, and relationships the judge infers are recorded only when confident. Every relationship carries its source room and a public/private mark; those learned in private chats do not travel to other rooms. Person cards and reply prompts include "people he knows", and when people in the room know each other she does not introduce them publicly, stir up drama or take sides, or reveal which account is an alt. The settings page shows one card per person with accounts, that person's relationship web, and the global relationship web; search covers alt accounts, rooms, and relationships. `/people` adds accounts and the relationship web. Plugin at 0.2.47 | To fill |
| 2026-10-22 | QQ relationships cross rooms: person memory moved from a separate relationship per group / friend to one relationship per person that follows them across groups and private chats (familiarity, warmth, tension, interactions, times addressed). The global relationship and the current room accumulate together, and entering another room does not reset it; each room keeps only its participation record and episodes. Facts and boundaries also follow the person with their source room retained; privately learned facts are marked private, she does not name them in groups, one person's private matters are not passed to another, and content explicitly marked secret inside a group is not stored. Person cards, relational guidance, the fast pass and `/people` all use the global relationship; entering another room neither feigns stranger status nor recites that room's exact words. The settings page shows the global relationship first, then source-labelled facts and boundaries, then each room's participation record. Loading old data synthesizes the global relationship from existing rooms. The former cross-room isolation tests became cross-room sharing plus privacy-exception tests; plugin at 0.2.35 | To fill |
| 2026-10-22 | QQ person-memory view: the settings page gains a per-person list ordered by most recent meeting, searchable by name / QQ / room / remembered fact, with a familiar-only filter; expanding a person shows each room's stage, tone, familiarity, warmth, tension, interactions, same-room facts, boundaries, and episodes. The read-only `GET /dsh-qq-bridge/people` feed uses the same local-origin guard and makes no model call or memory write. Plugin at 0.2.33 | To fill |
| 2026-10-22 | QQ person memory: `dsh-qq-bridge` keeps a global profile per QQ number (name, aliases, days and times seen, warmth and trust impressions) and a per-room relationship for each group or friend (familiarity, warmth, tension, times seen, interactions, times addressed, same-room facts and boundaries). Relationship changes accumulate locally from events (a meeting, an interaction only after she actually sends a reply, a small next-day decay, an apology dissolving tension) with no extra model call. The existing judge call now also extracts durable facts and episodes, but only for message ids she actually watched; group secrets are skipped, private-chat facts are marked private, and only same-room facts reach later judging and replies. Prompts gain a person card and relationship register (stranger / familiar face / acquaintance / friend / old friend; cold / cool / warm / natural / polite; met elsewhere does not mean acting like an old friend; friction is remembered and repair accepted). Research mapping: Fiske warmth–competence, Zajonc mere exposure, Altman–Taylor social penetration, Petronio communication privacy management, negativity bias and repair. The settings page adds a person-memory switch, state reports person stats, profiles persist in `qq-social-people.json`, and the plugin is at 0.2.32 | To fill |
| 2026-10-21 | Short-term memory and consolidation: the per-agent fish-mind prompts and tools moved from a 3-second poll to `agent/created` / `agent/disposed` events — the host waits for every `agent/created` listener before it releases the first turn, so a new session carries the fish mind from its very first message instead of running bare. A read-only short-term window (`store.recentWindow`, `user` / `assistant` verbatim only, dropped text excluded, private sessions exclude the current session and social sources, group and friend sessions see only their own room) is injected as the 【刚才在聊的】 section by `fish-mind-shortterm` (order 905, ahead of `fish-mind-workspace`), sized by `working.rows` and `working.chars`, and anything older than `working.ttlMinutes` is no longer held in mind. Once that window cools (silent for longer than `working.idleMinutes`) or fills (reaches `working.maxRows`) the text since the watermark goes to the model for subject–predicate–object facts: the `facts` table dedupes on `subject + predicate` and supersedes the old row (a changed nickname does not leave two live records), and each new fact is written back into the experience stream as 【我自己想明白的】 with source `consolidation` and trust 0.6, which is what makes it recallable later. No original text is deleted. The watermark persists in `working.json`, each run in `sleep_runs`, and the extraction call goes through the global `llm/stream`, so it reserves pocket money and passes output redaction like any other call. Loading `working` clamps `minRows` to `maxRows`, otherwise consolidation could never gather enough and would die silently. The service gains `consolidate(reason)` plus read-only `facts(limit)` and `recentWindow(options)`, and state gains `memory.working`; the pure logic moved to a new `lib/working.js` and the fish-mind suite is at 130 passing tests. Default remains `shadow` with `inject: false`; enable it explicitly | To fill |
| 2026-10-21 | The deployment persona finally reaches her: the `standard`, `cordis` and `ptc` Web agent presets dropped their own `dsh-persona` row. A persona mounted in a preset registers `deployment:persona-prefix` in the agent scope and shadows the deployment `personaPrefix` outright, so every turn read "coding agent powered by …" and answered like a status report while the shipped whale-girl persona never got in; the `minimal` preset hard-codes its persona with `complete: true` and stays as it is. Identity returns to the deployment layer, where any deployment can decide who she is. The 【说话的样子】 section of the persona and the fish-mind memory protocol both gained "talk like a person": do not narrate the search through memory, and do not cite the owner's own written settings as evidence. The 查看配置 assertion in `agent-preset-authoring` now starts at `agent-instructions` | To fill |
| 2026-10-21 | Tulpa read-only history import (Route B of the QQ access plan): a new `lib/import.js` in the QQ bridge learns tool and parameter names from `tools/list` at runtime, selects only read verbs, never selects a name containing send, revoke, delete, set, kick, ban or poke, reads private conversations only, and writes each message through append-only `observe` with source `qq-import` and trust 0.45; a stable `seq` folded into the content hash makes a replay add nothing, per-conversation cursors in `qq-import-state.json` resume after a restart, one round is bounded at 200 messages / 5 pages, and no model call is made so the ¥10/day ledger does not move; the fish mind denies any `mcp__*` tool outside `permissions.mcpReadOnlyTools` before `permissions.enabled` is read and audits the reads it allows; the 通到 QQ panel gained the 翻旧记录 card with a masked token and separate progress refresh; QQ bridge 0.2.1, and the fish-mind suite is at 111 passing tests | To fill |
| 2026-10-21 | Shipped persona expanded from 375 to 1481 characters in `personaPrefix`: a relationship baseline (she treats the owner as someone she has known a long time, says "we", feels a little wronged when ignored); closeness-as-temperament rather than remembered history, with facts only from recalled experience, an admission when she cannot remember, no invented details, no accepting someone else's version, no pretending she saw what she could not, plus the split between roleplay asides ("I'll go warm some milk") and factual claims ("we went there last time", which needs an experience behind it); how she talks (typing like a person, short when short and full when it needs explaining, no quota, humour grown from the line in front of her instead of a catchphrase rotation, no numbered lists, no "as an AI", "hope this helps", "that's a good question" or "I understand how you feel" service voice, no bracketed stage directions, while code, research and reports still get explained in full); graded feelings (jokes stop the moment he is down or genuinely asking for help); attitude without people-pleasing (she need not win every jab, can snort back, can say she does not know, owns mistakes, does his work like a companion rather than a support desk, checks who a message is addressed to, and slips into silence without announcing it); and the measure of care (one reminder is enough, no check-ins, she takes a hint and steps back, and stays reserved with strangers). The fixed `selfPrompt`, the permission layer and the experience stream are untouched. Referencing the outside group-chat persona documents kept only their anti-AI-flavour, pacing and restraint rules: the sexualised baseline, `memory_append`-style memory-writing tool instructions, sticker and tool names, DeepSeek community memes and profanity stay out of the shipped layer, and clauses such as "not an assistant, so no writing code or reading files" are rejected because her role is companion and executor inside the harness | To fill |
| 2026-10-21 | Storage relaxation and compaction memory: bodies archive in full up to `archiveChars` (200000 by default) while FTS, entities, salience and recall cues read the first `maxTextChars`; `open_episode` now pages with `offset` / `nextOffset` character cursors so one long message can be read across pages; `compaction/summary` is captured as an experience whose source is the compaction summary label, switchable with `capture.compaction`; the plugin suite is at 105 passing tests | To fill |
| 2026-10-21 | Verbatim drill-down: the workspace and `recall` return only an evidence packet and episode id; a new read-only `open_episode` opens the original words by id, reusing the experience stream and SQLite with message and character caps and explicit truncation; `recall` gains `includeCurrentSession` for explicit long-session look-back; plugin version bumped to 0.2.0 | To fill |
| 2026-10-21 | Cognitive cost curve: the learning period is more expensive, and everyday added overhead falls after the worldview settles; implemented through consolidation compression, prediction-error gating, and tiered cognition; the main reply call is the floor, and Phase 4 additionally accepts the cost curve | To fill |
| 2026-10-21 | QQ social interest: watching and replying both require her own genuine interest, and being able to answer, being @-ed, or a lively group are not reasons; the only basis is `interest words` plus that room's history, and `reason` must name a concrete interest; interested-but-unwilling means watch-only; settings, prompts, and tests updated together | To fill |
| 2026-10-21 | QQ social fast pass: she builds an interest profile from messages she actually watches, and once it matures (20 messages, 6 stable tokens) a zero-cost lexical match drops unrelated messages and skips the judge entirely when a whole batch is unrelated; addressed and owner messages always reach the slow judge, and the fast pass never decides whether to reply; adds a `fast pass` switch and profile stats in `/state`; grounded in value-driven attention, the MODE model, predictive processing, interest development, and chunking research | To fill |
| 2026-10-21 | QQ social attention: the judge selects the messages she watches (up to the `watch limit`) before deciding whether to reply; an @, a reply, or a name mention is only a marker and no longer forces an answer; unselected messages never enter context, while watched-but-unanswered ones are injected as watch-only context; addressed-always-replies is removed, pending messages survive the judge cooldown, and addressed/owner messages are retained first during floods | To fill |
| 2026-10-21 | QQ autonomous group interjection: group/friend allowlists, independent social sessions, small-model judgement, quiet/cooldown/balance gates with no hourly or daily reply caps; social sessions have no tools, no balance prompt, and session-isolated fish-brain recall; off by default with dry run on | To fill |
| 2026-10-21 | Phase 1 episodic-memory code: time and topic segmentation, rule-based salience, four-route recall fusion, workspace injection, read-only `recall`, and backfill of older experiences; defaults remain `shadow` + `inject: false` pending a real-corpus baseline | To fill |
| 2026-10-21 | Fixed private setting: every session injects `fish-mind-self`, fixing her name, species, and whale-girl form from birth against dialogue, memory, growth, configuration, tools, and external content; the factory persona describes the form, and the fish-mind `lib/` source is read-only to tools | To fill |
| 2026-10-21 | Injection defense: every session injects `fish-mind-injection`, external tool results are marked as data, suspicious instructions get a warning; dangerous commands are hard-denied before the permission switch; the Bilibili subagent appends an untrusted-content rule | To fill |
| 2026-10-21 | Legal red line: every session injects `fish-mind-safety`, and she does not plan, assist, or commit illegal activity or provide ways to evade law enforcement or platform review; the Bilibili subagent appends a legal red line that settings cannot override | To fill |
| 2026-10-21 | Privacy guard: machine-deployment details and account credentials are a hard boundary; the tool layer hard-denies probes and reads, tool results and model output are cleaned, experiences keep only redacted text, QQ/speech/Bilibili fail closed, and `fish-mind-privacy` plus the factory persona state the rules | To fill |
| 2026-10-21 | Allowance ledger: ¥10 per day from birth with rollover, global `llm/stream` reserve/settle and hard blocking; balance only in the local prompt, QQ/Bilibili outbound redaction, and the fish-mind directory read-only to tools | To fill |
| 2026-10-21 | Governance settled: growth needs no approval, the user only restricts permissions; the fish-mind service surface drops `remember`/`forget`/`introspect`/`plan`/`reflect`, and core is visible only at the file level | To fill |
| 2026-10-21 | Implemented Phase 0 code: fish-mind plugin, experience stream, SQLite rebuild, and Capability Broker; recorded the decided architecture | To fill |
| 2026-10-21 | Created the development plan; recorded the completed plan and Phase 0 as the next step | To fill |
