# My Dear Fish cognition development plan

English | [中文](development-plan.zh.md)

This page is for the next developer: it records only where the work stands, what to do next, and how completion is judged. Design rationale and biology live in [the cognition plan](cognition.md) and are not repeated here. When the plan and the code disagree, the code and the acceptance records here win, and the plan is corrected afterwards.

## How to use this page

Read the current snapshot and the milestone table first to confirm progress. When starting work, follow the phase checklist and change a status only after every completion criterion is met. Before leaving, update the changelog and hand over the report and rollback notes described in the handoff section.

- Progress: the current snapshot gives the baseline; the milestone table gives each phase's status, date, and owner.
- Work: the phase checklist is the smallest executable task set; the completion criteria are the only definition of done.
- Handoff: the handoff items name the data, switches, and known traps the next phase needs; no handoff items means the phase is not complete.

## Current snapshot

As of 2026-10-21 the cognition plan is final and no code has started. The six plugins, the factory layer, desktop packaging, and the existing documentation are pushed to `master`; `fish/plugins/dsh-fish-mind` does not exist yet, and the installer's behavior is unrelated to the fish mind.

| Item | Status | Evidence |
| --- | --- | --- |
| Cognition plan | Complete | [Cognition plan](cognition.md) |
| Six plugins and factory layer | Complete and shipped | `fish/plugins/`, `fish/bundle/` |
| Desktop installer | Complete, unsigned | [Build guide](build.md) |
| Fish-mind plugin | Not started | The directory does not exist |
| Phase 0 shadow run | Next | "Phase 0" below |
| Phase 1 episodic memory | Not started, depends on Phase 0 | "Phase 1" below |

Use only five status words: not started, in progress, blocked, complete, cancelled. Change a phase to complete only when every completion criterion is met and its numbers are recorded here. An in-progress phase states the current task, branch, and last update date; a blocked phase names who or what it waits for.

| Phase | Time box | Deliverable | Status | Completed | Owner |
| --- | --- | --- | --- | --- | --- |
| Plan | 2026-10-21 | Cognition plan and development plan | Complete | 2026-10-21 | To fill |
| 0 Shadow | 2 to 3 days | Experience stream, SQLite, event listeners, no injection | Next | | Unclaimed |
| 1 Episodic memory | 1 week | Episode segmentation, multi-path recall, workspace, tools | Not started | | Unclaimed |
| 2 Consolidation and forgetting | 1 week | Nightly summaries, fact extraction, merging, backups | Not started | | Unclaimed |
| 3 Affect and drives | 1 week | Rule appraisal, core affect, virtual body | Not started | | Unclaimed |
| 4 Self and relationships | 1 to 2 weeks | Constitution, identity facts, chapters, person models | Not started | | Unclaimed |
| 5 Language and initiative | 1 to 2 weeks | Intent, channel wording, self-check, drive-driven outreach | Not started | | Unclaimed |
| 6 Dreams and interface | Optional | Dream log, memory browser, personality rings | Not started | | Unclaimed |

The time boxes assume one engineer familiar with DSH plugin development and exclude review and packaging queues. Phase 3 onward can be adjusted after measurement; do not merge Phases 0 and 1, because the shadow data is the baseline for every later acceptance.

## Phase 0: shadow run

### Goal

Let the fish mind watch without speaking. It listens to real desktop sessions and writes every experience to SQLite, but changes no prompt, injects no memory, and calls no model. After one week, the data must prove that everything worth keeping was captured and that the database can be rebuilt.

### Checklist

- [ ] Create `fish/plugins/dsh-fish-mind`: `package.json` (`type: module`, `main: lib/index.js`, version `0.1.0`), `cordis.patch.yml`, `lib/index.js`, `README.md`, and `tests/`.
- [ ] Register the Cordis service `ctx.fishMind` with seven methods: `observe`, `recall`, `remember`, `forget`, `state`, `plan`, and `reflect`; every method except `observe` returns an empty result or "not enabled".
- [ ] Keep configuration in `$DSH_HOME/fish-mind/config.json` with defaults `mode: shadow`, `inject: false`, and `retentionDays: 90`; a bad configuration falls back to defaults and writes a log entry.
- [ ] Create `$DSH_HOME/fish-mind/mind.sqlite` with WAL, `busy_timeout=5000`, `user_version=1`, and a single-writer queue; create `experiences`, `episodes`, `facts`, `people`, `intentions`, `affect_log`, `predictions`, `self_model`, `chapters`, `sleep_runs`, and `experience_fts`.
- [ ] Also write an append-only `fish-mind/experience.jsonl` as the rebuild source; recover SQLite from it when the database is damaged.
- [ ] Listen to `session/event` and `turn/end`: keep user messages, assistant replies, QQ, proactive outreach, and Bilibili reports; skip subagents, plugin-injected context, and `runtime-context`.
- [ ] Record source, trust, session, actor, and the result of sensitive-field cleaning on every experience; discard and count passwords, keys, identity numbers, bank cards, and exact addresses.
- [ ] Preprocess Chinese FTS with character bigrams and `unicode61`, and run queries through the same processor; fall back to `LIKE` for single-character queries.
- [ ] Add a rebuild command or test: clear the derived tables, replay all of `experience.jsonl`, and match the original row counts and hashes.
- [ ] Mount `fish-mind` in `fish/bundle/cordis.patch.yml` and add it to `PLUGIN_NAMES` in `apps/desktop/scripts/prepare-fish-plugins.ts`; keep it observation-only by default.
- [ ] Write metrics to `fish-mind/diag.log`: daily events, dropped events, database size, write latency p50 and p95, and errors.
- [ ] Ship tests for source mapping, sensitive-field cleaning, bigram queries, and rebuild; run them with `node --test` and add no build step.

### Completion criteria

- [ ] After one week of real use, daily event counts match the DSH session records with zero missing events.
- [ ] Rebuilding SQLite from the same `experience.jsonl` reproduces the experience count, FTS hit count, and hashes exactly.
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

Turn experiences into recallable episodes and let the model remember when it needs to. This phase covers memory only and leaves affect, self, and initiative alone; every deliverable must fall back completely to the old memory plugin when its switch is off.

### Checklist

- [ ] Segment episodes by time gap and topic change, with parameters in configuration; write each segment to `episodes`, leaving titles and summaries for Phase 2.
- [ ] Implement a rule-based version of the S formula first, measuring similarity by token and entity overlap with no model call; threshold 0.35, and experiences below it keep only their raw record.
- [ ] Run four recall paths: FTS5, entity and person filters, time windows, and graph expansion; take the top 20 per path, fuse to the top 6, and return nothing when no strong match exists.
- [ ] Bound the workspace to 5 slots and about 900 characters, with type, source, and confidence on every slot; when it is empty, state "no reliable memory this turn".
- [ ] Inject a stable `fish-mind-protocol` section (order 89980) and a dynamic `fish-mind-workspace` context (order 910), both controlled by the `inject` switch.
- [ ] Implement `recall` and `remember`; `forget` soft-deletes only, and hard deletion is user-initiated only.
- [ ] Keep the old memory plugin's `remember` name and forward it to the fish mind; import old JSON read-only and disable old recall after cutover.
- [ ] Add a benchmark that replays 100 real turns with the future hidden and reports precision@6, source accuracy, false-memory rate, and latency.
- [ ] Meter retrieval time, injected characters, model calls, and tokens per turn; the hot path makes zero calls by default.
- [ ] Cover fusion ranking, no-memory behavior, source labels, the injection switch, and rollback to the old plugin in tests.

### Completion criteria

- [ ] Recall accuracy on 30 historical Q&A pairs is at least 70%, and answers give an approximate time instead of reciting the original sentence.
- [ ] The 100-turn replay reaches precision@6 of at least 0.7 and source accuracy of at least 0.9.
- [ ] The induction set produces a false-memory rate of at most 5%, and events that never happened are called out as unknown.
- [ ] Workspace injection stays under 1200 characters; end-to-end p95 grows by at most 50 milliseconds; the hot path makes zero model calls.
- [ ] The rollback switch restores the old memory plugin, and no old data is modified or deleted.

### Handoff items

- [ ] A benchmark report: corpus version, baseline numbers, failure examples, and the next fixes.
- [ ] A default-configuration table and migration notes: how old memory JSON is imported, disabled, and verified.
- [ ] The Phase 2 sleep task list, with problems exposed by the first phase's real data.

## Later phases

The design for Phases 2 through 6 is final in the cognition plan; this page records only entry conditions, the first task, and exit conditions. Expand each into the same checklist and completion criteria when work starts.

| Phase | Entry condition | First task | Exit condition |
| --- | --- | --- | --- |
| 2 Consolidation and forgetting | Phase 1 complete and a full week of data | Design the sleep job and call budget | At most 8 calls per night, contradictions resolved, job interruptible |
| 3 Affect and drives | Phases 1 and 2 complete | Rule appraisal and core-affect state machine | Affect changes have reasons; affect shifts recall by at most 0.1 |
| 4 Self and relationships | Phase 3 complete and constitution draft confirmed | Self model, person models, and boundary probes | Boundaries hold, promises are recalled, inferences carry sources |
| 5 Language and initiative | Phase 4 complete | Intent and content plan, pre-send self-check | High-risk turns are caught; proactive outreach has a reason |
| 6 Dreams and interface | Phase 5 complete and user consent | Minimum memory browser | The user can view, delete, and disable it |

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
| Episode boundaries: weights for time gap and topic change | Before Phase 1 | Too fine loses context; too coarse mixes topics |
| Fallback for single-character and rare-term search | Before Phase 1 | Affects recall for short Chinese queries |
| Whether to add local vector search | After the Phase 1 baseline | Adds dependencies and latency; prove FTS is insufficient first |
| Which model and budget sleep uses | Before Phase 2 | Sets nightly cost and summary quality |
| How much raw QQ and Bilibili content to keep | Before Phase 2 | Affects privacy and storage size |
| Whether the memory browser is desktop UI or a local page | Before Phase 6 | Affects permissions, packaging, and accessibility |

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
| 2026-10-21 | Created the development plan; recorded the completed plan and Phase 0 as the next step | To fill |
