# How the plugins keep the fish

English | [中文](plugins.zh.md)

“Keeping the fish” is not a decorative feature name here: six plugins each own one segment of the same DSH conversation loop. Memory decides what the companion remembers, mood decides the tone of the current turn, speak-up decides when it speaks first, speech and QQ decide how it appears outside the chat, and the Bilibili subagent decides what it does when alone. This document describes the current state in the order shared substrate, individual plugin, cross-plugin loop, defaults, and change points; every claim follows the source under `fish/plugins/`.

## The shared substrate

None of the six plugins is a standalone application; each attaches to the DSH agent lifecycle. On every turn DSH claims a message from the inbox, assembles the system prompt and context, calls the model, runs tools, writes `assistant/message`, and closes with `turn/end`. A plugin can call `agent.followup()` to put a message into a live agent's inbox so the turn runs exactly as if the user had typed it; it can append per-turn content with `systemPrompt.context()` and stable long instructions with `systemPrompt.section()`. Every plugin keeps its home under `$DSH_HOME` (on Windows, `%USERPROFILE%\.dsh` by default), in its own subdirectory or JSON file, never inside the plugin package.

### Timeline of one turn

| Stage | What happens | Plugins involved |
| --- | --- | --- |
| Message arrives | User input or a plugin `followup` enters the inbox; `source.kind` records the origin | All |
| Prompt assembly | Persona and standing hints go into `section`; per-turn memory and mood go into `context` | Memory, mood |
| Model execution | The model sees history, prompts, and tools, and may call tools | Memory, Bilibili, QQ |
| Reply written | `assistant/message` lands in the session and its text blocks accumulate | All |
| Turn ends | `turn/end` or `agent/turn-stopping` notifies observers | Mood, speech, QQ |
| Mood judgement | A short model call scores the mood change and writes state asynchronously | Mood |
| External delivery | The turn text is queued for speech or split into paragraphs for QQ | Speech, QQ |
| Next turn | New memory and mood enter the next prompt through `context` | Memory, mood |

### Message sources and mutual recognition

`source.kind` is the most important convention between the plugins. The same `user/message` means very different things depending on where it came from.

| `source.kind` | Produced by | How other plugins treat it |
| --- | --- | --- |
| `user` | The owner typing | Recall query for memory; mood judges it as a real conversation |
| `speak-up` | The speak-up plugin | Mood judges it as the companion speaking first, not as owner input |
| `bili-duty-scan` | The Bilibili schedule | Mood judges it as the companion working, not as owner input |
| `qq` | The QQ bridge | Mood currently skips it; speech and QQ delivery still process the turn |
| `plugin` | Context written by a plugin | Mood skips it; memory does not treat it as owner input |
| `runtime-context` and similar | Injected by the DSH host | Every plugin skips it; it is not conversation content |

### Two prompt-injection paths

| Path | Position and stability | Used by | Purpose |
| --- | --- | --- | --- |
| `systemPrompt.section()` | A stable block in the system prompt, ordered near the end | The `memory-hint` standing reminder | Preserve the DeepSeek prefix cache |
| `systemPrompt.context()` | Context appended to the end of the conversation each turn | Memory recall results, current mood | Content changes every turn without touching the system-prompt prefix |

### Data and switch locations

| Plugin | Data location | Shipped default |
| --- | --- | --- |
| `dsh-fish-memory` | `fish-memory/<session id>.json`, `fish-memory-config.json`, `fish-memory-backup/` | Per-session switch, off by default |
| `dsh-feiyu-mood` | `feiyu-mood/state.json`, `config.json`, `diag.log` | Mounted with automatic judging, but the target session is hard-coded |
| `dsh-speak-up` | `speak-up-config.json` | Master switch on, but dry run on and target session empty |
| `dsh-tts-bridge` | `tts-bridge.json` | Auto speech on, but the watch list is empty |
| `dsh-qq-bridge` | `qq-bridge-config.json` | Master switch off, dry run on, target session empty |
| `dsh-bili-subagent` | Config, reports, logs, and credentials under `bili-duty/` | Automatic scans off; manual `bili_scan` works |

## Memory: dsh-fish-memory

The memory plugin answers how the companion can remember something from a previous conversation without drowning in old material. It does not stuff the whole history back into the prompt: it first searches the memory store with the current sentence, then ranks the few relevant entries by importance and freshness before injecting them. Writes go through the `remember` tool. Recall and writing are local computations and do not call a model.

### Mounting and lifecycle

- Every 3 seconds the plugin scans live agents and mounts the prompt block, context block, and `remember` tool only on agents whose session has memory enabled.
- When a session is switched off or archived, the next scan unmounts it; switching it back on does not wait for the 3-second timer.
- A branched session inherits the parent's memories, but subagent sessions are excluded so the Bilibili subagent does not share the owner's memory.
- Each session has one JSON file; configuration is global and holds policy parameters plus per-session switches.

### Data files

| File | Content |
| --- | --- |
| `fish-memory/<session id>.json` | All memory entries, recall traces, and statistics for the session |
| `fish-memory-config.json` | Global policy, per-session switches, import settings |
| `fish-memory-backup/` | Automatic backups so a bad write can be recovered |
| `fish-memory-diag.log` | Diagnostics for recall, writes, and model-assisted extraction |

### Recall: from one sentence to a few memories

1. Take the most recent owner message as the query; plugin context and host-injected messages do not count.
2. Apply the query-information gate first: a message with little content, such as “you there?”, skips recall entirely.
3. Split the query into words, drop words that appear in too many memories, then filter by general Chinese rarity; the remaining rare words become clues.
4. Compute the evidence score `C`: each clue contributes “rarity in the store × rarity in the owner's speech × word value”, summed and divided by the total plus a smoothing constant. Whole-word expansions count at full value, fragments at 0.8, and body-only matches at 0.6; an exact phrase of six or more characters raises `C` to at least 0.85.
5. Compute activation `A`: ordinary events decay with a 30-day half-life, and higher importance decays more slowly; long-term facts do not decay by time and enter ranking at a fixed value.
6. Compute the ranking score `P`: a weighted sum of evidence, activation, importance, and emotion; time words in the query only multiply ordering by 1.3 and do not decide who passes the gate.
7. Gate on `C`, sort by `P`, and choose the per-recall item cap from the highest `C`; then deduplicate by similarity, cap long-term facts, enforce the character budget, and render a 【你记得的事】 block with relative timestamps.

```
H = 30 × (1 + 2 × I)
A = A0 × 2^(−days / H)
C = Σ(r_store × r_speech × w) / (Σ + 1)
P = C × (0.55 + 0.25 × A + 0.15 × I + 0.05 × E)
```

The threshold gates only evidence `C`, not ranking `P`, so tightening it cannot accidentally bury a relevant but recently inactive memory. The default policy is: evidence threshold 0.35, at most 6 items, at most 800 characters, at most 8 writes per day, at most 2 long-term facts per recall, and activation 0.5 for entries without a timestamp.

### Writing: remember

- `text` is the only required field and should state one thing in one sentence; `importance` runs from 0 to 1, and a value of 1 marks the entry as a long-term fact.
- `tags` are auxiliary labels; the words in the body are what drive recall.
- Repeating the same fact does not create a new entry; it reinforces the old one, raising activation by `A' = A + 0.2 × (1 − A)` and refreshing the anchor.
- When a new entry has word similarity of at least 0.85 with an old entry and comparable length, the old entry is automatically marked “superseded”; the `取代` parameter covers the case where the model knows which entry it is updating and finds the old one at similarity 0.5.
- `事实键` states which fact the entry describes; entries with the same key keep only the newest, while older ones are marked superseded but remain recoverable. A key must not contain a specific value and must not be used for daily-changing streams.

### Where the model is used

Everyday recall and `remember` do not call a model. The model is used only for importing old archives, expanding the vocabulary, and small cleanups, all triggered by the owner; no click means no tokens. This also means memory quality comes mainly from the vocabulary, rarity, and scoring formulas rather than from a model judgement on every turn.

### Known limits

- Memory is per-session and off by default; after a fresh install, the owner must enable it for the session to be raised.
- Recall uses only the most recent owner message as its query, so older topics in a long conversation do not enter automatically.
- A single injection holds at most 6 items and 800 characters; an oversized first item is still admitted and can crowd out everything after it.
- Fact keys and “supersede” depend on the model filling them correctly; a wrong value can bury unrelated old memories, which then need recovery from the settings page.

## Mood: dsh-feiyu-mood

The mood plugin gives Da Feiyu a global state shared across sessions: one overall mood from 0 to 100 plus seven emotion dimensions from 0 to 100. At the end of each turn it makes one short model call to score the change, then injects the state as context to shape the next turn's tone. Mood is not keyword matching and does not rewrite the persona each turn; it is a state that decays, accumulates, and returns to baseline.

### State model

| Field | Meaning | Range and default |
| --- | --- | --- |
| `mood` | Overall mood baseline | 0 to 100, baseline 70, can fall to 0 |
| `dims.happy` | Happy | 0 to 100, default 0 |
| `dims.calm` | Calm | 0 to 100, default 0 |
| `dims.sweet` | Sweet | 0 to 100, default 0 |
| `dims.heartache` | Heartache | 0 to 100, default 0 |
| `dims.worry` | Worry | 0 to 100, default 0 |
| `dims.sad` | Sad | 0 to 100, default 0 |
| `dims.jealous` | Jealous | 0 to 100, default 0 |

The state is global, stored in `feiyu-mood/state.json`, and shared by every session as one persona state; the timeline keeps only recent entries so the settings page can show why the mood changed.

### Judging each turn

1. The target session's agent triggers judging on `agent/turn-stopping`, asynchronously, without blocking the reply.
2. The plugin walks session events backwards to the last real trigger message, skipping host injection and messages from other plugins.
3. It classifies the source into one of three modes: `bili-duty-scan` means “working”, `speak-up` means “speaking first”, and any other real message is normal conversation.
4. It passes the owner's content, the assistant reply, and the mode to `ctx.llm.stream` and asks for JSON only: `moodDelta`, seven `dims` values, and `reason`.
5. Judged values are clamped to −10 through 10; the overall mood takes only one third of the judged delta each turn, while the seven dimensions move immediately.
6. If neither the overall mood nor any dimension changes, no timeline entry is written; otherwise the state is persisted with its reason.

The model call follows the current session's provider and model by default, and the settings can name a separate judge model; `maxTokens` is 400 and `temperature` is 0.2 so the output stays parseable as JSON. Both automatic judging and the target session can be switched off in settings.

### Decay and injection

- Overall mood returns to its baseline with a half-life of about 3 hours; the seven emotion dimensions decay toward 0 with a half-life of about 90 minutes; intervals under one minute are not decayed.
- Injection happens only when `injectMood` is on and either overall mood is at least 5 points from baseline or some emotion or reason remains.
- Injection uses `systemPrompt.context`, appended to the end of the conversation each turn without touching the system-prompt prefix; it shows at most two emotion words scoring at least 15.
- The injected line explicitly says to use the mood for this turn's tone and not to read the line aloud, so the model does not narrate its state.

```
mood(t) = B + (mood(0) − B) × 2^(−min / 180)
dims(t) = dims(0) × 2^(−min / 90)
```

### UI and settings

- The settings page shows overall mood, the seven dimensions, the timeline, and a manual reset; all data stays local.
- The web ornament is injected through `webserver/index-inject` and maps mood to five face tiers with thresholds 80, 62, 42, and 25.
- The route prefix is `/dsh-feiyu-mood/`, serving state, config, model list, reset, session list, the ornament script, and face images.

### Known limits

- The target session defaults to a hard-coded example id; that session does not exist in a fresh install, so mood never updates until the owner selects a real target.
- Every turn costs one model call, even when the judged result is zero.
- Only `user`, `speak-up`, and `bili-duty-scan` sources are recognized; a `qq` message is skipped, and judging may fall back to an earlier owner message or not run at all.
- Mood is one global copy, so simultaneous sessions overwrite the same persona state; this is a design choice, not an isolation defect.

## Taking initiative: dsh-speak-up

The speak-up plugin lets the companion open a conversation when nobody is talking to it. It does not assemble context itself: on schedule it rolls a purely local die, and only on a hit does it put a `source.kind = speak-up` message into the target session's inbox so DSH starts a normal turn. The roll costs no tokens; only an actual opening calls the model.

### Trigger chain

1. The timer fires at the configured interval, 30 minutes by default.
2. It checks the master switch, quiet hours, target sessions, and the cooldown; any failure skips this round.
3. It picks a random target among live, idle, non-archived sessions; it never wakes a cold session.
4. It takes the base hit line for peak or off-peak time, multiplies by the timing factor for how long since the owner last spoke, and adds the consecutive-miss bonus.
5. It rolls a random number from 0 to 100 and speaks only when the roll is below the hit line.
6. On a hit it builds a `user`-role message marked `speak-up`, hands it to `agent.followup()`, and flushes the session.

### Hit line

```
hit = min(100, base × factor + min(cap, misses × bonus))
```

| Parameter | Default | Effect |
| --- | --- | --- |
| Interval minutes | 30 | How often to roll |
| Peak hit line | 20 | Base line on weekdays 09:00–12:00 and 14:00–18:00 |
| Off-peak hit line | 60 | Base line at all other times, including weekends |
| Miss bonus | 10 | Each consecutive miss adds 10 points to the next line |
| Bonus cap | 40 | Consecutive-miss bonus stops at 40 points |
| Near threshold / near factor | 20 / 0.15 | If the owner spoke less than 20 minutes ago, multiply the line by 0.15 |
| Far threshold / far factor | 360 / 1.5 | If the owner has been silent for over 6 hours, multiply the line by 1.5 |
| Quiet start / quiet end | 1 / 8 | Do not speak from 01:00 to 08:00 |
| Cooldown minutes | 20 | Wait at least 20 minutes after speaking first |

The consecutive-miss count lives only in memory and resets on restart; a dry-run hit also resets it; the manual button neither rolls nor changes the counter. The master switch is on and the dry run is also on by default, so a fresh install only logs what it would have sent.

### Dry run and manual button

- Dry run writes what it would have sent to the log without touching the target session, which is useful for observing the rhythm first.
- The manual button triggers once immediately, without rolling or changing the consecutive-miss count, to confirm the target session and wording work.
- The opening line is editable in settings; the default is “Nobody has talked to me for a while, I should go say hello”.

### Known limits

- DSH accepts only `user`-role inbox messages; the plugin explicitly refuses the `developer` role rather than corrupting the session log.
- Cold sessions are not woken, so the target must be live; after a fresh install the owner must exchange a message with the target first.
- The model is called only after a hit, so rounds that do not open cost nothing.
- The consecutive-miss counter is not persisted, so the rhythm restarts after a restart.

## Speech: dsh-tts-bridge

The speech plugin has two halves: a DSH host plugin that decides which turn finished and puts its text into a queue, and a Chromium extension that feeds the text into the DeepSeek web page and clicks its read-aloud button. It does not synthesize speech itself or rely on system TTS; it borrows the read-aloud capability of `chat.deepseek.com`.

### Host side: collection and queueing

- Every 1500 milliseconds it scans the sessions configured for listening and reads new events by sequence number.
- It aggregates only text blocks from `assistant/message`; tool calls and reasoning are excluded.
- A turn enters the queue only when `turn/end` reports `completed`; interrupted turns are not read.
- The queue holds at most 6 items and drops the oldest when full; automatic speech is on by default, and turning it off leaves only manual speech and the queue endpoints.
- The extension claims work through `/next` and may reclaim within 30 seconds; an item without a receipt for 150 seconds is dropped. A `/playing` heartbeat older than 120 seconds counts as stopped, and `/stop` clears the queue.

### Extension side: speaking the text

1. The background script asks the host for work every 1200 milliseconds and periodically confirms the DeepSeek page still exists.
2. Desktop DSH uses a random port, so the extension first knocks on the fixed ports 19387, 39871, and 39872 to ask for the current real address.
3. When there is no DeepSeek page but the queue has work, the background opens `chat.deepseek.com` in an inactive tab.
4. The content script prefixes the text with “Please repeat exactly the following passage…” and submits it in the chat box.
5. It waits for a new final reply and the read-aloud button, clicks it, and verifies with `chrome.tabs.audible` that the page is actually producing sound; silence triggers one retry.

### Prerequisites and limits

- The Chromium extension must be installed and `chat.deepseek.com` must be logged in; the page may sit in a background tab but must not be closed.
- The first use requires a real click on DeepSeek's read-aloud button, because the browser allows later automatic playback only after that gesture.
- The DeepSeek page has a daily speech quota; once exceeded the extension gets no sound and the queue treats it as a failure.
- Only text is read; tool calls, attachments other than code blocks, images, and voice messages are not.
- Speech and QQ forwarding do not know about each other, so the same completed turn may be queued for speech and forwarded to QQ.

## QQ: dsh-qq-bridge

The QQ bridge connects a DSH session to QQ in both directions: when DSH finishes a turn it sends the text to QQ in paragraphs; when the owner sends a QQ message the bridge polls it, delivers it into the target session, and DSH runs a normal turn. It does not need a bot account; it sends and receives through a local OneBot 11 HTTP backend such as NapCat or SnowLuma.

### DSH to QQ

1. The plugin watches `session/event` on the target session and records the last assistant text of each turn.
2. It sends only when `turn/end` reports `completed`; an interrupted turn is cleared and no partial text is sent.
3. It deduplicates by turn, so one turn is never forwarded twice.
4. It splits the text into natural paragraphs on blank lines, sends one message per paragraph with 450 milliseconds between them, like a person typing in sequence.
5. It calls OneBot's `send_private_msg` or `send_group_msg` as configured; an archived target session is skipped.

### QQ to DSH

1. Every 4000 milliseconds it polls private history and group history, taking the latest 10 private messages and 30 group messages.
2. It accepts only messages whose `user_id` equals the configured private QQ number; in a group it also recognizes only that number, and nobody else's messages enter DSH.
3. It deduplicates by time and `message_id`; an image-only or emoji-only message is recorded too, so it is not fetched repeatedly.
4. It keeps only text segments, joins them into one sentence, and builds a user message with `source.kind = qq`.
5. It delivers the message through `agent.followup()`; the target session must be live, and an archived or missing session is abandoned.

### Prerequisites and defaults

| Setting | Default | Meaning |
| --- | --- | --- |
| Master switch | Off | Must be turned on manually |
| Dry run | On | Logs only; does not actually send to QQ |
| Target session | Empty | Must choose the session to bridge |
| Private QQ | Empty | The owner's QQ number and the only allowlist for QQ to DSH |
| Forward private | On | Takes effect only when a private QQ number is set |
| Forward group | Off | Requires a group number when enabled |
| NapCat address | `http://127.0.0.1:3000` | The OneBot 11 HTTP backend |

### Known limits

- Only text is handled; images, voice, files, and quoted replies never become DSH content.
- QQ to DSH is polling rather than push, so delivery can lag by about 4 seconds and a message recalled between polls can be missed.
- In a group only the one configured QQ number is recognized; other speakers never enter the session.
- The mood plugin does not recognize the `qq` source, so a QQ turn may not update mood; see “Cross-plugin coupling and gaps”.

## Bilibili: dsh-bili-subagent

The Bilibili plugin lets Da Feiyu browse videos, read subtitles, and skim comments during off-peak time, then bring the worthwhile material back to the main session. The main session does not browse directly: it calls `bili_scan` to dispatch a subagent. The subagent only reads and reports; comments and private messages are still sent by the main session according to settings.

### Flow of one automatic scan

1. Every 60 seconds the timer checks that the master switch is on, today's automatic rounds are below the cap, at least `gapHours` has passed since the last round, and the current time falls in the noon or night window.
2. When all conditions hold it charges one round to the quota, then puts a `source.kind = bili-duty-scan` message into the target session's inbox.
3. The main session wakes and calls `bili_scan`; the plugin uses `ctx.subagents.startActivation()` to dispatch a subagent with the configured provider and model.
4. The subagent searches videos from the last 7 days as instructed, skips uninteresting titles, reads subtitles for promising ones, skims comments, and picks at most `perScan` items.
5. The subagent returns an internal report to the main session; the report is appended to `out/<date>.md`, and the reply tells the main session that this is internal intelligence whose delivery is the main session's decision.
6. The main session decides whether to call `bili_reply` to comment with an @ mention or `bili_send_message` to send a private message; when both are off it only tells the owner about the report.

### Tools and the subagent

| Tool | Purpose | Main caller |
| --- | --- | --- |
| `bili_scan` | Dispatch a subagent for one scan and return its internal report | Main session |
| `bili_whoami` | Check the logged-in Bilibili account and credential state | Main session, settings |
| `bili_search` | Search videos by relevance, views, recency, or danmaku | Subagent |
| `bili_subtitle` | Fetch the full subtitle text of one video | Subagent |
| `bili_comments` | Fetch the top comments of one video | Subagent |
| `bili_reply` | Post a comment or reply to one | Main session |
| `bili_send_message` | Send a private message to a given UID | Main session |
| `bili_status` | Show today's rounds, quota, windows, login state, and report path | Main session, settings |
| `bili_login_start` | Generate a QR code for login | Settings |
| `bili_login_poll` | Poll the QR login and save the credential | Settings |
| `bili_setup` | Create an isolated venv and install the Python MCP dependencies | Settings |
| `bili_config` | Read or change plugin settings | Main session, settings |

`bili_search` has a hard filter: when a minimum view count or minimum age is configured, the tool fetches several times more results and filters them before the subagent sees anything. “Do not pick low-view videos” therefore does not depend on the prompt, because the candidates are already reduced.

### Quota, windows, and target session

- The quota counts automatic scan rounds, not videos; the default is 5 rounds per day, with at least 3 hours between rounds.
- The windows are Beijing time 12:00–14:00 and 18:00–09:00; the peak/off-peak master switch is off by default, so a fresh install does not scan automatically.
- An empty target session makes the plugin choose the most recently used non-empty, non-archived session; if none exists it creates a temporary session and releases it afterwards.
- The manual “run one round now” action does not consume the automatic quota but uses the same subagent and report path.

### Delivery gates

- A comment requires all of: automatic comments enabled, an @ mention name set, delivery mode not “private only”, and a per-round comment count above 0; otherwise the tool refuses unless the call explicitly passes `force`.
- A private message requires delivery mode not `off` and a private-message UID; otherwise it is refused.
- When both are enabled, a private message is refused until `bili_reply` has been called this round; this gate deliberately ignores `force`, so the model cannot skip the comment and go straight to private messages.
- `bili_reply` clears the pending-comment state whether it succeeds or fails, so the session cannot be locked permanently.
- Automatic comments are off by default and must be enabled by the owner; this speaks publicly with the owner's account, and both documentation and code choose the most conservative default.

### Python, login, and verification

- On startup the plugin copies `mcp_server.py` and `asr.py` into the `bili-duty/` home, then starts the Python MCP over stdio JSON-RPC with `initialize`, `notifications/initialized`, and `tools/call`.
- `bili_setup` creates an isolated venv under the plugin home and installs `bilibili-api-python`, `aiohttp`, `mcp`, and `qrcode`; without uv it tries to download one into the plugin home instead of touching the system Python.
- After a successful QR login the credential is written to `bili-duty/bili_credential.json`, and all searches, comments, and private messages use that login state.
- Comment verification takes the latest 6 entries from `seen.md` and checks top-level comments and nested replies with the login state; entries confirmed visible within 7 days are not checked again. A miss is phrased as “not found”, not “not sent”, because review and pagination can both hide a new comment temporarily.

### Known limits

- Videos without subtitles are skipped; the plugin does not guess content from titles or summaries.
- Automatic comments and private messages use the owner's Bilibili account and carry moderation and social risk, so every default is conservative.
- The report is internal intelligence and the main session may not relay all of it; there is no hard “must report” constraint.
- The subagent provider and model default to `apii` and `deepseek-v4-pro`, and those names must be available in a different environment.

## How the six form a day

| Time | What happens | Main plugins |
| --- | --- | --- |
| 01:00–08:00 | Speak-up stays quiet; conversation still works if woken | Speak-up |
| Morning | The owner talks, memory recalls, mood judges; speak-up may open | Memory, mood, speak-up |
| 12:00–14:00 | If automatic scanning is on, a Bilibili round may run | Bilibili |
| Afternoon | Normal conversation; speech and QQ deliver each turn per their switches | Speech, QQ |
| After 18:00 | The Bilibili window reopens; speak-up uses the higher off-peak line | Bilibili, speak-up |
| End of any turn | Mood updates; speech queues; QQ forwards | Mood, speech, QQ |

Read together, the loop is: the owner speaks → memory recalls relevant old material → mood sets the tone for this turn → the model replies → mood updates from the turn → speech and QQ deliver the reply → the next turn may write new memories. Speak-up and Bilibili are the two entrances that can start a turn without owner input; they run through the same loop with different `source.kind` values, and mood interprets them differently.

## Defaults, cost, and risk

| Plugin | Shipped default | Model cost | External dependency | Main risk |
| --- | --- | --- | --- | --- |
| Memory | Off per session | Recall and writes cost nothing; import and vocabulary expansion cost tokens | None | Easy to think it is broken because it is off; a wrong fact key can bury old memories |
| Mood | On, but target session hard-coded | One short call per turn | None | Wrong target means no updates; QQ turns are skipped |
| Speak-up | On, but dry run on | One turn only after a hit | None | Silent by default; empty target means no trigger |
| Speech | Auto speech on | No model call; consumes DeepSeek web speech quota | Chromium extension, DeepSeek login | No sound when the page is closed or the quota is exhausted |
| QQ | Master switch off, dry run on | No additional model call | NapCat/SnowLuma, QQ login | Requires a local backend; text only |
| Bilibili | Automatic scans off | One subagent per round; search and subtitles cost tokens | Bilibili login, Python venv | Automatic comments and private messages carry account risk |

No plugin runs at full speed out of the box: mood is mounted but its target session is hard-coded to an example id; memory, speak-up, QQ, and Bilibili all need the owner to choose a session or enable a switch, and speech needs the extension installed. These conservative defaults are intentional, not a malfunction.

## Cross-plugin coupling and gaps

- On a turn that enters through QQ, the mood plugin skips the `qq` source, so it may judge an earlier owner message instead or skip the turn entirely. QQ conversation therefore affects mood inconsistently.
- Speech and QQ do not coordinate. When the target session completes a turn, the same text may be queued for speech and forwarded to QQ, appearing twice.
- The Bilibili report is internal input to the main session; whether and how much to relay is decided by the model on the spot. There is no hard “must report” constraint and no guarantee that the report is archived in the chat.
- Memory is enabled per session while mood is global. With several sessions at once, memory does not share but mood does, so the two use different notions of persona consistency.
- Speak-up wakes only a live, idle target session; if the owner has not opened that session for a long time, it will not bring the session back.

## Change map

| What to change | Where | Effect |
| --- | --- | --- |
| Persona, names, default tone | `personaPrefix` in `fish/bundle/cordis.patch.yml` | Affects every new profile, and a user patch can still override it |
| How easily memory is recalled | Memory settings policy, or `DEFAULT_POLICY` | Changes item count, character budget, threshold, and daily writes |
| Mood dimensions, judging frequency, judge model | Mood settings and the dimension table and judge chain in `lib/index.js` | Changing dimensions changes the injected line and face tiers |
| Speak-up frequency and hours | Hit lines, interval, and quiet hours in speak-up settings | Turn off dry run to actually speak; changing hit lines is safer than changing code |
| What speech reads | Watch list and auto-speech switch in speech settings | Requires the extension and a DeepSeek page |
| QQ two-way bridge | Target session, QQ number, group number, dry run in QQ settings | Requires a local OneBot backend; validate with dry run first |
| What Bilibili scans | `keywords`, `scanPrompt`, and `perScan` in Bilibili settings | Changes the subagent prompt and how many items it picks |
| Whether Bilibili speaks publicly | `autoComment`, `mentionName`, `dmMode`, `dmUid` | All off by default; enabling speaks with the owner's account |
| Automatic scan windows and quota | `peakValley`, `noon`, `night`, `perDay`, `gapHours` | Automatic scans are off by default and run by window once enabled |
| Plugin defaults themselves | `fish/bundle/cordis.patch.yml` and each plugin's defaults | Changes the shipped behavior of a new install and requires repackaging |

Configuration covers most ways of raising the fish; only code changes alter the mechanism itself. In descending order of impact, decide the persona and default switches first, then the memory and mood conventions, and only then the outward-facing paths such as Bilibili and QQ.

## Observing and troubleshooting

| Symptom | Where to look first |
| --- | --- |
| Memory seems inactive | Whether memory is enabled for the session; recall and write records in `fish-memory-diag.log` |
| Mood never changes | Whether the mood target session is the current session; whether `feiyu-mood/diag.log` shows a failed judgement |
| Never speaks first | Master switch, dry run, target sessions, quiet hours; recent log on the `speak-up` settings page |
| Text exists but there is no sound | Whether the extension is installed, DeepSeek is logged in and open, and the speech quota remains; host queue state |
| QQ does not receive or send | Whether NapCat listens on port 3000, QQ is logged in, the target session is archived, and dry run is still on |
| Bilibili does not scan automatically | Whether `peakValley` is on, today's quota is exhausted, and the target session is live; `bili-duty/duty.log` |
| A comment reports success but nobody can see it | The comment verification result on the Bilibili settings page; `seen.md` and `verify-state.json` |

Every plugin writes diagnostics to its own home rather than relying on the main DSH log. When troubleshooting, read the plugin's own log and settings page before suspecting the model.

## Conclusion: what to decide first

This mechanism description maps to three decisions. First, whether the goal is a companion that remembers, feels, and reaches out, or a tool that answers on demand and never interrupts; the former needs memory, mood, and speak-up enabled, while the latter keeps the conservative defaults. Second, how much model cost is acceptable; one short call per turn for mood and one subagent per Bilibili round are the main expenses. Third, whether the plugins may speak outwardly with the owner's account; Bilibili comments and QQ forwarding both belong here, and their defaults are already off or in dry run.

The mechanism itself does not have to change. What needs deciding is which switches ship enabled and which stay for the owner to turn on. Once those three points are settled, changing code under `fish/plugins/` or defaults in `fish/bundle/cordis.patch.yml` will not turn “keeping the fish” into “losing the tank”.
