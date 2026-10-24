# QQ access plan: combining Tulpa with My Dear Fish

English | [中文](qq-tulpa.zh.md)

Tulpa is an external MIT-licensed desktop program that auto-configures a QQ OneBot backend and exposes local chat history over MCP. This plan says which parts of it My Dear Fish takes, which it refuses, and what each step changes in the shipped code. It does not replace [the cognition plan](cognition.md); it decides how the fish reaches QQ and how her past gets real content.

| Item | Content |
| --- | --- |
| Status | Route B is implemented on this branch (2026-10-21); Route A stays a proposal |
| Scope | Read-only Tulpa history import in `dsh-qq-bridge`, the fish-mind external-tool rule, the `通到 QQ` settings panel |
| Impact | One import module, one owner-level overlay, four local routes, one hard permission rule; the shipped profile still mounts no MCP client |
| Order | Route B chosen; Route A deferred; Route C rejected |

## What the bridge does today

`dsh-qq-bridge` speaks OneBot v11 HTTP only. It never touches the QQ protocol itself, so the owner must run a backend (SnowLuma or NapCat) on the same machine.

| Fact | Where |
| --- | --- |
| Backend address defaults to `http://127.0.0.1:3000` | `fish/plugins/dsh-qq-bridge/lib/host.js:67` |
| Inbound is polling: `get_friend_msg_history`, `get_group_msg_history` | `lib/host.js:1737`, `lib/host.js:1752` |
| Poll runs on a 4-second `ctx.interval` | `lib/host.js:1820` |
| Settings panel is injected by the plugin client at `settings.section` | `lib/client.js:545` |
| Local routes: `/dsh-qq-bridge/state`, `/save`, `/models`, `/receive`, `/test-send`, `/import-*` | `lib/host.js:32`, `lib/host.js:1567` |
| Local HTTP trust check only rejects foreign origins; the backend itself has no token authentication | `lib/host.js:1370`, `README.md:121` |

The gap is setup, not transport. `fish/plugins/dsh-qq-bridge/README.md:157-196` asks the owner to download a backend, open its web admin, scan a QR code, enable the OneBot HTTP server, check that the port is 3000, then change the address in our settings page if it is not. That is six manual steps before the fish can speak, and it breaks the expectation that a freshly installed package starts with one click.

## What Tulpa provides

Tulpa (`github.com/fumingyang2004/Tulpa`, MIT) is a Windows desktop app that needs .NET Framework 4.8. Three of its capabilities matter here:

| Capability | How it works | Use for the fish |
| --- | --- | --- |
| One-click backend setup | Point it at a SnowLuma folder (v1.14.22), tick the authorization checkbox, click load-and-configure; it initializes the backend, picks a free port, writes the HTTP and WebSocket config, and verifies which QQ account is logged in. No terminal, no manual token, no admin password. | Route A: port this logic into our own settings page. |
| MCP data server | Streamable HTTP at `http://127.0.0.1:18777/mcp` with a Bearer token; exposes QQ and WeChat message history, images, files, stickers and group information to an external agent. DeepSeek Harness connects through `@deepseek-ai/dsh-mcp-client` with `serverName: tulpa`, `transport: streamable-http`. | Route B: read-only import of her real past. |
| Its own chat loop and persona cards | It runs its own persona (including the shipped `little_whale` cards) against the same QQ account, consuming the backend's forward WebSocket. | Not used. Route C. |

Two facts decide the shape of the plan. Tulpa consumes the forward WebSocket while our bridge only polls HTTP, so the two do not fight over a transport. And Tulpa's own documentation states that once send and group-management are ticked, that authorization is standing: the call executes directly and does not return to Tulpa for per-message approval. Our design requires every outbound message to pass `redactOutbound`, the budget ledger, the target whitelist, cooldowns, and the mute window, so those tools cannot be handed to the model.

## Route A: port the setup wizard

Move the SnowLuma one-click configuration into `dsh-qq-bridge`. Tulpa is MIT, so this logic can be vendored with attribution; the reference implementation stays outside the repository and the port is written against its behaviour.

**Configuration.** Add a `后端` object to the plugin config defaults next to the existing address key, keeping the Chinese-key style: `类型` (`snowluma`), `目录`, `端口`, `自动启动`. Normalizing a missing `后端` keeps today's behaviour exactly: address only, no process management.

**Host.** One new effect that owns the child process, reversible on dispose so no backend is left running after the plugin unloads, plus three routes under the existing prefix: probe a folder, write the backend config and start it, report readiness. Readiness is `get_login_info` returning an account, the same call the settings page already uses for "the QQ I am connected to". Startup is polling with a bounded wait; failure returns a concrete reason (folder missing, port busy, process exited, not logged in) instead of a silent retry.

**Client.** Add a section to the `通到 QQ` panel: choose folder, tick authorization, one button. After it succeeds, the address field is filled from the port that was chosen, and the existing test button shows the logged-in account. Nothing else on that page changes.

**Non-goals.** The QQ binaries are not downloaded into the repository and not committed. The packaged app still does not bundle a QQ backend; it configures and starts one the owner installed. No credentials are read, stored, or transmitted by this path; QR login stays inside the backend's own window.

**Acceptance.** From an unpacked installer plus one SnowLuma folder: install, open settings, click once, see the logged-in QQ, and send one message to the fish, with no manual edit of any config file. Closing DSH leaves no orphan backend process.

## Route B: read-only Tulpa MCP as a memory source

Give the fish access to message history she already has, so the persona's "long relationship" tone is backed by real episodes instead of only by what was recorded since launch. This is the honest version of having a past: she is allowed to remember what really happened, and the anti-confabulation rule in the shipped persona still forbids inventing anything else.

**Mount.** `@deepseek-ai/dsh-mcp-client` is not mounted in the fish bundle. The shipped Desktop profile is asserted to carry zero MCP client rows (`apps/desktop/tests/profile-mcp.spec.ts:27`), and one companion's memory source is not a reason to widen every profile at once. An owner who wants the model to browse Tulpa adds `fish/overlays/tulpa-mcp.cordis.patch.yml` to their own layer and keeps `TULPA_MCP_TOKEN` in the local environment. That overlay is convenience, not a boundary; the boundary lives in the broker, and it is also what the owner overlay has to pass.

The import job does not use this mount. `startConnection()` exposes no `callTool`, and calling a registered definition's `execute()` directly would skip `tools/pre-execute`, so an internal bulk reader has to speak streamable HTTP itself; that code is `lib/import.js`.

**Read-only enforcement.** The fish-mind Capability Broker sits on tool execution (`fish/plugins/dsh-fish-mind/lib/index.js:969`), and `permissions.mcpReadOnlyTools` (`lib/config.js:115`) decides what an external tool may be: by name, the default list admits only `get_*`, `list_*`, `search_*`, `read_*`, `describe_*`, `query_*`, `count_*`, `check_*`, and each entry is trimmed on load so ` get_* ` cannot silently match nothing. Anything arriving as `mcp__<server>__<tool>` outside that list is denied before the permission switch is even read (`lib/permissions.js:454`), so turning `permissions.enabled` off — which means only "she does not ask the owner first" — never means "an external service may speak for her". Reads that pass are written into the audit trail (`lib/permissions.js:497`) instead of disappearing into normal traffic. Sending stays in `dsh-qq-bridge`, the only code path with `redactOutbound`, the wallet gate, cooldowns, and the mute window.

**Import job.** Tulpa is closed-source, so tool and parameter names are learned at runtime from `tools/list` (`lib/import.js:394`) rather than hardcoded. A tool whose name contains send, revoke, delete, set, kick, ban or poke is never selected (`lib/import.js:28`); if nothing readable exists, the job says so and writes nothing. Only private conversations are read — groups are dropped before any paging starts (`lib/import.js:429`), and an optional whitelist narrows it further. Image, voice and file segments become placeholders such as `[图片]`, never invented descriptions.

**One past, written once.** Each row is an append-only `observe` record with `source: 'qq-import'` (`lib/import.js:19`) and `meta.trust` 0.45 (`lib/import.js:24`), which the store reads as episode `source_trust` (`fish/plugins/dsh-fish-mind/lib/store.js:572`). `contentHash` folds `seq ?? randomUUID()` into the fingerprint (`lib/store.js:142`), so the importer gives every message a stable `seq` hashed from conversation, message id, time and text (`lib/import.js:45`); pressing 继续导 twice over the same range adds nothing. Progress is a per-conversation `{位置, 完成}` cursor in `qq-import-state.json` (`lib/host.js:381`), written after each page, so an interrupted import resumes from the oldest message already read; a round stops at its own caps (default 200 messages, 5 pages) so one click is bounded. Bulk encoding is local FTS5 work in `store.js:328` and costs no model calls, so import does not move the ¥10/day ledger.

This is also why the importer beats a model-facing `mcp__tulpa__*` tool: a tool call returns a whole page of history into the request every time it is replayed, spends context and money on hauling text, and never reaches the experience stream — so her past would exist only while the transcript was open, and re-running a session would read the same history as new. One `observe` write per message costs one local insert, and every later `recall` is free.

**Data location.** Imported transcripts land only in the profile-level files (`mind.sqlite`, `experience.jsonl`) that stay on this machine. The repository stays public: no real conversation transcripts, no exported history, no fixture copied from a live account. The token lives only in the local plugin config file, never in a log line, and the settings page only ever receives the mask `(已设置)` (`lib/host.js:36`); resending that mask keeps the stored token instead of overwriting it.

**Double-reply guard.** When this is on, Tulpa's own persona loop stays off. She has one mouth, and the rules above are what keep Tulpa's send tools from becoming a second one.

**Acceptance.** After one import, `recall` returns real messages with dates and senders, she can quote them back correctly, she says she does not remember what was never imported, and nothing about the import reaches QQ, Bilibili, or speech output unredacted.

## Route C: run her inside Tulpa

Rejected. Tulpa would replace the cognitive core, the permission broker, the privacy filters, the budget ledger, and the governance rules that make her one fish with one memory; the persona cards alone are not the project. Tulpa's value here is setup convenience and a history source, not a runtime.

## Fixed rules

- Machine information, accounts, passwords, tokens, balances, and quotas stay private; they are never sent out and never extractable through conversation. This holds for the bridge, the MCP client, and the import path alike.
- The legal red line stays in code and in the fixed persona context; an external program does not relax it.
- She does not get free access to the owner's computer: Route B grants read access to chat history only, through an allowlist enforced in the harness.
- Only `observe` appends experience. Importing history uses it; nothing in this plan adds a memory-writing tool the model can call.

## The chosen path

Route B is what this project needs: the goal is a companion who remembers, not a bridge that is easier to install. Running Tulpa also leaves a configured OneBot backend on a known port, which `dsh-qq-bridge` already accepts, so Route A's convenience is obtained without building it and can stay deferred.

**One stream, two sources.** Tulpa fills the months before launch; the existing 4-second polling records everything after. Both write through the same append-only `observe`, so the shared experience stream, the episode rebuild, chapter organization, the five recall routes, mood, and the budget ledger keep working unchanged, and no model-facing memory-write tool is added. Import is expensive once in local FTS5 work, recall stays cheap afterwards, which is the cost curve the brain is already built on.

**Real content, honest framing.** Imported rows carry `meta.imported`, `origin: 'tulpa'` and a lowered `source_trust` of 0.45, so they sort below what she saw happen. Recalled rows are labelled `旧记录（导入）` (`fish/plugins/dsh-fish-mind/lib/store.js:64`) and the memory protocol states what that label means (`lib/index.js:456`): she may say 我们以前聊过这个, she may not say 我记得那天我在场, and a transcript never settles what happened afterwards. That is the same rule as the shipped anti-confabulation persona clause, now with something behind it.

**Old records stay in the private room.** Imported history is recallable in the owner's conversation. It is unreachable from a group: imported rows live in their own `session-qq-import-*` rooms, a social session recalls only its exact session id with trust inside 0.2 to 0.85 (`lib/index.js:586`), and `excludeSources` (`lib/store.js:917`) can drop the class outright. This matches the existing closeness tiers, and it keeps a QQ export from becoming a leak.

**Import only adds content; memory is already on.** `mode: 'live'` and `inject: true` (`fish/plugins/dsh-fish-mind/lib/config.js:68-69`) are the shipped defaults, so recall and injection work before any import. The import switch itself ships on (`fish/plugins/dsh-qq-bridge/lib/host.js:240`); the missing piece is the token for the Tulpa address, and once `TULPA_MCP_TOKEN` is set the imported rows enter the same experience stream and become recallable without a second configuration change.

| File | Change |
| --- | --- |
| `fish/overlays/tulpa-mcp.cordis.patch.yml` | New opt-in owner overlay; the shipped bundle still mounts no MCP client |
| `fish/plugins/dsh-fish-mind/lib/config.js` | `permissions.mcpReadOnlyTools`, trimmed on load, defaults to read verbs only |
| `fish/plugins/dsh-fish-mind/lib/permissions.js` | Any `mcp__*` tool outside the list is denied regardless of `permissions.enabled`; external reads are audited |
| `fish/plugins/dsh-fish-mind/lib/store.js`, `lib/index.js` | The `旧记录（导入）` source label and the memory-protocol rule for it |
| `fish/plugins/dsh-qq-bridge/lib/import.js` | New read-only importer: runtime tool discovery, read-verb gating, stable `seq`, per-conversation cursor, groups excluded |
| `fish/plugins/dsh-qq-bridge/lib/host.js` | `导入` config block, four `/import-*` routes, token masking, refusal when the switch, the brain, or the token is missing |
| `fish/plugins/dsh-qq-bridge/lib/client.js` | The 翻旧记录 card: switch, address, token, whitelist, per-round caps, 继续导 / 停止 / 清游标重来, progress line |
| `fish/plugins/dsh-qq-bridge/tests/` | Paging, no-duplicate-on-replay, resume-after-restart, whitelist, token refusal, send tools never called, route refusals, masked token round-trip |

**Acceptance.** After one import on a real account: `recall` returns her actual messages with dates and senders, she quotes one back correctly, she calls it an old record she read, she says she does not remember what was never imported, group replies reference no imported history, nothing leaves this machine except what the bridge sends through `redactOutbound`, and the ¥10/day ledger does not move during import.

**Deferred, with its cost named.** The shipped package still cannot configure a backend by itself: a fresh machine needs Tulpa running before the fish can speak on QQ. Route A is the follow-up that removes that dependency, and nothing built here blocks it.
