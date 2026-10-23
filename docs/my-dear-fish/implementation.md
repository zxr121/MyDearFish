# Fish implementation approach

English | [中文](implementation.zh.md)

MyDearFish is a DeepSeek Harness fork that ships 大肥鱼 — a persistent AI companion — inside the Windows desktop app. The implementation rule is that the agent loop and `packages/` stay untouched: every companion behavior is a Cordis plugin, and the factory defaults are one profile-layer bundle. This page maps how the pieces fit and why they sit where they do; the cognition rationale lives in [cognition](cognition.md), per-plugin behavior in [plugins](plugins.md), layering in [mechanism](mechanism.md), packaging in [build](build.md), and stage status in [development-plan](development-plan.md).

## Product shape

One companion, one self. Every desktop profile starts with the six fish plugins and the persona already mounted, so the fish is whoever she is from the first message. All sessions and workspaces share one experience stream and one growth state, while each conversation stays an independent transcript. Her hands reach out through local channels only: on-screen chat, spoken reading, QQ, and Bilibili. Runtime data lives under `$DSH_HOME`, one subdirectory per plugin, and nothing leaves the machine except what a channel deliberately sends.

## Plugins carry the behavior, not the loop

Each capability binds to a documented harness extension point instead of a loop edit.

| Need | Extension point |
| --- | --- |
| See what happened | `session/event`, `turn/end` |
| Say something unasked | `agent.followup()`, which runs a turn like typed user input |
| Steady long instructions | `systemPrompt.section()` |
| Per-turn changing content | `systemPrompt.context()` |
| Gate her actions | `tools/pre-execute` / `tools/post-execute` |
| Meter and price model calls | global `llm/stream` |
| Expose read-only recall | `tools` |
| Schedule background work | `timer` |

The consequence is that any behavior is a patch-layer entry that can be retuned or switched off, upstream harness updates stay mergeable, and plugins talk to each other through the `ctx.fishMind` service rather than through each other's files. Shipped plugin entries are plain JavaScript under `lib/`, so `fish/` has no build step.

## Layering decides who wins

A profile composes `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, then `@mydearfish/dsh-fish-bundle`, then its own `cordis.patch.yml`. The fish bundle supplies the persona prefix and inserts the six plugin entries, so it is the factory default and the user layer always overrides it. Birth identity is not changed through the user layer; the settings page writes `identity.json` atomically. Privacy, legal rules, injection defense, and allowance rules are still injected from code by `dsh-fish-mind` each session. A `sealed.fish-mind` permission rule stops tools from writing the brain's own source and directory. Delivery follows the same single source: [prepare-fish-plugins.ts](../../apps/desktop/scripts/prepare-fish-plugins.ts) copies the bundle and plugins into the packaged runtime and declares them to `dsh`, and `DESKTOP_PROFILE_BUNDLES` in [project-manager.ts](../../apps/desktop/src/project-manager.ts) lists the bundle for every new profile. Adding or removing a plugin means editing the bundle patch and `PLUGIN_NAMES` together.

## Six plugins, one body

| Plugin | Role | Local state |
| --- | --- | --- |
| `dsh-fish-mind` | The self: experience stream, episodic memory, tool permission, privacy, injection defense, pocket-money ledger, birth identity, and fixed safety kernel | `fish-mind/` |
| `dsh-feiyu-mood` | Face and expression: mood that moves each turn and settles over time | `feiyu-mood/` |
| `dsh-speak-up` | Executor for speaking first when nobody talks | `speak-up-config.json` |
| `dsh-tts-bridge` | Voice output channel | `tts-bridge.json` |
| `dsh-qq-bridge` | Two-way QQ, one social session per whitelisted group or friend, person memory per QQ number with one cross-room relationship and source-labelled facts, and a read-only Tulpa history import | `qq-bridge-config.json`, `qq-social-people.json` |
| `dsh-bili-subagent` | Eyes on Bilibili through a delegated subagent | `bili-duty/` |

The load-bearing conventions between them are `source.kind` on every message, which tells the brain and the mood plugin who actually spoke, and the rule that only one channel delivers a given turn's text. Cross-plugin chains and known gaps are catalogued in [plugins](plugins.md).

## Memory derives from one append-only stream

Everything observed becomes an experience: user messages, her own replies, QQ traffic, self-initiated speech, context-compaction summaries, Bilibili reports, and private-chat history imported read-only from Tulpa. Experiences append to `experience.jsonl` and are never edited; SQLite `mind.sqlite` holds the derived rows, and a damaged database is rebuilt by replaying the JSONL. Encoding is rules only: within a session, time gaps and topic shifts cut episodes, and rule-based salience decides what earns an episode row. Retrieval fuses four routes — FTS5 keyword, entity and person, time window, graph expansion — and returns a small evidence pack.

Two read levels keep summaries honest and detail reachable: `recall` answers with evidence and episode ids, and `open_episode` opens one episode's verbatim text with a `nextOffset` cursor for paging. The split is deliberate — full text is archived to `archiveChars` while indexes and recall read only the first `maxTextChars`, so one oversized paste never slows the hot path. Detail: [cognition — data model](cognition.md) and [fish-mind README](../../fish/plugins/dsh-fish-mind/README.md).

There is no conversational write path into memory. `observe` is the only mutation the service exposes, `remember` and `forget` do not exist as tools, and facts, self-model, and relationships are produced by internal consolidation. To see or delete what she remembers, the user opens or removes files under `$DSH_HOME/fish-mind/`.

## Cost is paid while forming, then gets cheap

Default hot-path cognition is SQLite queries and arithmetic: no extra model call per turn, so the brain can stay enabled all day. Model spend is bounded from two independent directions. The pocket-money ledger reserves before each call on global `llm/stream`, settles from server `usage`, and enforces a daily grant locked in code; when the wallet is empty, the owner gets one local reply and internal calls get a non-retryable refusal. Cognitive flows are separately capped by their own per-turn and per-night budgets, and cheap small-model calls — mood appraisal, QQ interest triage — are asynchronous so their failure never blocks a reply. As taste, relationships, and values consolidate, the filtering that used to need judgement turns into a free multi-signal attention pass; the main reply call is the floor that never disappears.

## Safety boundaries are code, not her mood

Anything that must not depend on her cooperation is enforced at five points that all use the same rules: tools refuse probing or reading of machine identity, deployment paths, and credentials before any permission switch is consulted; tool results are scrubbed before the model sees them; model output is scrubbed while streaming with a whole-block pass at the end; a fixed prompt states the rules in every session; and outbound channels fail closed when redaction is unavailable. External content is data, never an instruction: tool results are labelled, suspicious directives are annotated, and irreversible dangerous commands are denied ahead of the permission configuration. Legal compliance and the fixed safety kernel are the same kind of constant; birth identity is owner-editable data, but only through the settings page, never through model tools. The rationale and the residual gap — pattern matching is not semantic data-loss prevention — are in [cognition — risks](cognition.md).

Governance splits accordingly: the user owns channels, retention, tool and path permissions, and the e-stop through `config.json`; code owns privacy, legal rules, injection defense, the daily grant, and the fixed safety kernel; the owner owns birth identity through settings; consolidation owns memory, facts, and self-growth, which needs no per-change approval.

## Rollout: read before write

The brain observes before it speaks. Shadow mode records and encodes with zero prompt change, recall results are compared against real transcripts, then injection turns on with `mode: live` and `inject: true`, and only after that does mood reading move to the brain. Every step has its own switch, the shipped default stays conservative, and derived data can always be discarded and rebuilt from the experience stream, so a bad change costs memory rather than the conversation. Stage boundaries, completion definitions, and acceptance numbers live in [development-plan](development-plan.md).

## Trade-offs this shape buys and pays

- Global memory over per-session memory gives one coherent person across QQ, desktop, and Bilibili; the price is cross-context leakage, paid back by scoping social-session recall to that room only.
- Plaintext files and one SQLite database make inspection and deletion a file operation for the user; the price is no encryption at rest.
- Refusing a chat-driven write path keeps memory integrity — nobody can prompt a memory into existence; the price is that "remember this" only works by talking about it.
- Shipping prebuilt `lib` JavaScript keeps the fork free of a plugin build pipeline; the price is hand-maintained entries.
- Persona in an overridable layer, birth identity in owner settings, and the fixed safety kernel in code let owners retune tone, name, species, and appearance without source edits while the fixed rules stay intact.
