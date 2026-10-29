# Being human in groups, filling feature gaps, and the energy budget

English | [中文](approach-human-presence.zh.md)

This document answers three questions: why she still does not feel human in a group, what to change, and how to spend less money while staying natural. The design draws on research into human multi-party conversation; the landing sites are the current code in `dsh-qq-bridge` and `dsh-fish-mind`. Items that are not implemented yet are marked as such, so the plan never reads as the current state.

## In one sentence

Let her actually be present in a group: every message enters a room ledger first, and a graded participation decision (not watching / short acknowledgment / joining / starting) decides what happens next; treat the balance as energy that runs down, so when she is tired she speaks less and shorter instead of mechanically shutting up; the savings come from not re-judging, not re-feeding context, and keeping cache hits, not from flattening replies into perfunctory lines. Time continuity starts in 0.2.96: when she wants to answer but this is not the moment, the thread stays open and she comes back to it once the room quiets down, instead of forcing a reply or losing it forever; since 0.2.97 open threads persist across restarts and can wait hours instead of ten minutes.

## Her seven current breakpoints

| Breakpoint | Current behavior | Code location |
| --- | --- | --- |
| Hearing equals being picked | The judge model picks at most 12 messages per round into `watch`; whatever it does not pick, she never sees | `关注上限` and the judge prompt in `host.js` |
| Remembering only what she picked | Only picked messages enter the one-hour buffer, and the next round's context comes only from that buffer | `并入社交缓冲`, `带上下文` |
| Only speak or stay silent | The judge returns `reply: true/false`; there is no middle rung for “acknowledge”, “send a sticker”, or “this one needs no reply” | `判.reply === true \|\| 必须回` |
| No sense of who talks to whom | `对别人说` recognizes only replies and @; addressing a third person by name is missed | Where group messages are ingested |
| No self in the group | Mood judging skips `qq-social-*`, the inner-life prompt returns empty for social sessions, and proactive talk excludes social rooms | `dsh-feiyu-mood`, `dsh-fish-mind`, `dsh-speak-up` |
| Mechanical rhythm | Consecutive messages are fixed at 450 ms apart, with fixed splitting rules | Segment send delay |
| No social battery | Only per-group hourly and daily counts; no “this room has heard enough from me, rest a while” | `主动每时`, `该歇口气` |

Of these seven, the first three share one root: the bridge ties “seeing” and “replying” into a single judgment. People do not work that way; they stay present first, then decide whether to speak this time.

## How people stay in a group

| Mechanism | Research finding | What she should do | Change |
| --- | --- | --- | --- |
| Participation framework | Goffman: those present split into “ratified participants” and “bystanders”, and bystanders still hear | Messages she did not pick still enter the ledger so she can join on a later turn | Room ledger |
| Turn allocation | Sacks / Schegloff / Jefferson: the current speaker can select the next one by name, @, or gaze | Use names and reply chains to decide whom a message addresses | Addressee detection |
| Grounding | Clark & Brennan: conversation relies on both sides confirming they mean the same thing | Before joining, check whether someone already answered this | Answered markers |
| Diffusion of responsibility | Darley & Latané: the more people present, the fewer feel they should act | When nobody asks her, silence is normal; she need not answer every batch | Participation ladder |
| Participation inequality | Nielsen 90-9-1: the vast majority only read | Her speech should be far rarer than her reading | Social battery |
| Communication accommodation | Giles: people converge toward the other side's pace and wording | Keep the existing room speech sense and style matching, but use it only when she truly speaks | Existing |
| Repair | Schegloff: “huh?” starts a repair when something was misheard | When the other side replies “?” or “what did you say”, rephrase instead of repeating | Repair turn |

## Presence: ledger, addressee, ladder

### Room ledger

Each group and each friend keeps the latest 240 messages in memory for up to one hour; the fields are only `id`, time, speaker, QQ number, the first 120 characters of the body, the reply target, and whether the message calls her. Hard filters still run first: disabled rooms, ignored people, topics she does not discuss, and pure ads never enter the ledger. The ledger is not persisted and clears on restart; long-term memory still belongs to the fish brain's experience stream.

The ledger fixes three things: the judge model sees what this room has been talking about, not what she picked last round; she can pick up a topic she did not pick but that became relevant later; and questions someone already answered are not put to her again.

### Addressee

Every message gets an addressee: `她`, a specific person, `大家`, or `不确定`. The evidence, in order: where the reply chain points, whether anyone is @-mentioned, whether the message opens with a name address such as `名字，` or `名字你……`, and whether the sentence contains `你觉得呢`. Names are recognized only within the first eight characters of the opening, so a person mentioned in passing in the body is not treated as being called.

A message marked “addressed to someone else” gets no proactive interjection unless it also calls her. Both halves now live in the bridge (0.2.88): replies, @-mentions, and name-opening addresses all mark a message as addressed to someone else; such messages also enter the room ledger, so she can join a later turn on the same topic.

### Participation ladder

The judge model no longer answers only “reply / stay silent”; it answers with a rung:

| Rung | Behavior | Cost |
| --- | --- | --- |
| 0 not watching | Record only, never enters her view | Zero |
| 1 short acknowledgment | One sticker, an echo, or a reaction within twenty characters | The judge call alone; no reply-model call |
| 2 join | A normal reply turn | Judge + reply |
| 3 start | Proactively open a new topic | Reply + proactive quota |

Rung 1 landed in 0.2.90: besides `watch` and `reply`, the judge model may return `short` (2–12 characters); the bridge sanitizes it (strips quotes, rejects @-mentions, links, and parenthetical explanations, requires 2–20 characters), then sends it straight to the group without calling the reply model. Being called directly, being asked about herself, an affinity lookup, private chat, a room that is resting / listen-only / in dry-run, or the same line spoken within ten minutes all fall back to a normal reply. Turning `社交.短应` off sends everything through the full reply path.

Rung 1 is the key to saving money: many group messages need only `嗯`, `确实`, `哈哈`, or one sticker, yet each previously cost another reply-model call; letting the judge model hand back a short reaction, or using an echo or sticker directly, removes that cost. Rungs 0 and 1 must genuinely be allowed to happen, or she remains the one who answers every sentence.

### Answered and silence

When someone in the group replies to another message that has not been judged yet, the bridge removes the replied-to message from the pending queue before the reply enters it (messages that call her, and the same person continuing their own thought, stay). Marking everything accumulated before she speaks as answered is not implemented yet; it is deferred to the thread-grouping round so an active topic is not cut off.

### Read-only mood

Since 0.2.91, the chat prompt filter no longer drops the `feiyu-mood` context injected by the mood plugin: she enters a social room with her current mood, expressed as one line of state that explicitly tells her not to read it aloud. The mood plugin already skips judging `qq-social-*` sessions, so group chats and friend private chats never change her mood; only conversations with the owner move it.

### Reply strands

Since 0.2.92, context is grouped by "who this replies to": when a reply or judgment needs older words, the bridge first fills in the strand containing the quoted message, then fills the remaining count budget with the most recent chatter (20 messages / 2400 characters for replies, 12 messages for judgments), and finally orders everything by time. Every segment she sends records its real message ids, so a later reply to her can reconnect the whole strand. The budget does not grow; it just yields space to more relevant words.

### Rhythm jitter

The pause between two consecutive sends is no longer a fixed 450 milliseconds; it falls between 0.4 and 1.2 seconds based on the length of the previous segment plus some randomness: longer after a long line, shorter after a brief reaction. Owner private chats and social sessions share this rhythm, so it no longer reads like a timer.

### Rhythm

Group reply delays stop being fixed: jitter of 0.6 to 1.6 times based on message length and mood, never below 0.8 seconds; 0.4 to 1.2 seconds between consecutive sends; when the other side keeps typing, wait for the last message. The longer the text, the likelier it splits into two messages, but anything that fits in one stays one.

### Social battery

Since 0.2.93, how many messages other people sent in the room during the last ten minutes becomes a heat level: twenty or more counts as chatty and cuts her proactive quota to sixty percent, forty or more counts as a flood and cuts it to thirty percent, always leaving at least one turn per hour and per day. People do not force their way into a lively conversation, and this saves money too. Being called, being asked about herself, owner messages, and friend private chats bypass this quota; turning `社交.电量` off uses the fixed quota only. Heat reads the room's activity, not how much she herself has said: consecutive-speech caps already bound that, and following the room's rhythm is what makes her look human.

### Repair turn

Since 0.2.94, when someone replies "?", "what did you say", "didn't catch that", or "what do you mean", and that message is a private chat, a reply to her, or an @ of her within ten minutes of her last line, the bridge skips judgment, carries her original sentence into the reply turn, and asks her to rephrase it: no verbatim repeat, no bare "huh?", no long apology. A question that sounds like a mishearing deserves an answer anyway, and this turn saves one judgment call. Question marks outside the ten-minute window or not aimed at her still go through judgment; listen-only and resting rooms stay silent. Turning `社交.重说` off sends everything through judgment.

### Time continuity (since 0.2.96)

Right now she lives only inside "this batch of messages": a batch arrives, one judgment runs, and within seconds she replies or does not; proactive speech is a dice roll weighted by time and mood. People are not like that. They see a message and answer later, come back with "was busy, what did you say earlier", and the next day ask "how did that interview go". None of this needs a model running in the background; the existing room ledger, fish-mind memory, and proactive quota are enough.

Three steps, with the first two landed:

1. **Keep the thread (done in 0.2.96)**: when judgment picks a message and she has something to say, but cooldown, low battery, quota, quiet hours, or a busy room blocks the moment, she does not force a reply. The message becomes an open thread in the room; listen-only, resting, and closed rooms keep nothing. Ten minutes later by default, once the room has been quiet for two minutes and she is present again, one cheap judgment decides whether to add a line; that line carries the original words and recent context, and she may naturally say she just saw it without explaining where she was. It shares the proactive quota, holds at most three threads per room, and drops a thread after three times the delay or at the day change.
2. **Late replies (done in 0.2.97)**: open threads persist to a local `qq-bridge-threads.json` under `DSH_HOME` (only the original words, speaker, time, and hang reason), updated whenever a thread is kept, dropped, answered by someone else, replied to, or its room is removed. Threads from the same day come back after a restart; cross-day and malformed entries are dropped. The `社交.迟到分钟` cap rises to 360, so something missed before clocking off can still be answered hours later once the room quiets down; when she returns she looks at these first and decides which to pick up.
3. **Next-day callbacks (later)**: turn facts that invite a follow-up (an interview, a trip, a pet, an exam, a promise) into time-aware openers, replacing the random dice roll in proactive speech — a callback with a reason feels more human and wastes less money.

Guards: expiry, a confidence threshold, and a per-room cap; if someone else already answered the thread in the meantime, she drops it instead of adding a duplicate; a late line never interrogates, echoes, or asks "are you there". The settings page shows how many threads each room holds and when she last came back, and turning `社交.迟到` off disables late replies entirely. Late replies get their own acceptance spot check: stale, aimed at the wrong person, or repeated all count as failures.

## Energy: the balance is strength

### Three layers

| Layer | Meaning | Data |
| --- | --- | --- |
| Reserve | How much longer she can last | `availableCny / dailyGrantCny` |
| Today's burn | How much strength is already spent today | `spentTodayCny / dailyGrantCny` |
| Circadian rhythm | Whether this hour is in her favor | Local hour |

### Six tiers

| Tier | Condition (G = daily grant) | Proactive | Exploration | Reply |
| --- | --- | --- | --- | --- |
| Very good | Balance ≥ 1.5G and under 40% used today | Normal | Allowed | Normal |
| Normal | Balance ≥ 0.8G | Normal | Allowed | Normal |
| A bit tired | Balance ≥ 0.4G or over 60% used today | Halved | None | Shorter |
| Tired | Balance ≥ 0.15G | None | None | One line is enough |
| Very tired | Balance ≥ 0.05G | None | None | Very short |
| Empty | Below 0.05G | None | None | Acknowledgment only |

Late night (23:00 to 06:00) lowers every tier by one, recovering in the morning. When today's burn exceeds a full day's grant, the tier drops once more, never below “empty”.

Energy affects only group chats and background behavior, never the owner's private chat: when the owner talks to her she answers as usual; what is saved is wasted judging and repeated context, not the owner's room.

### Action costs

Estimated against the factory price table (`deepseek-flash` at peak, per million tokens: input ¥2, cache read ¥0.04, output ¥8):

| Action | Typical tokens | Estimated cost |
| --- | --- | --- |
| Judge one batch | 1,500 input / 200 output | About ¥0.005 |
| Reply one turn | 6,000 input (70% cache hits) / 300 output | About ¥0.006 |
| Explore one message | Same as judging | About ¥0.005 |
| Mood judging | 800 input / 50 output | About ¥0.002 |
| Memory distillation | 4,000 input / 600 output | About ¥0.013 |

A day of 100 judge calls and 20 replies costs about ¥0.7; 100 owner private turns add about ¥0.6. Normal use stays under ¥10, and what actually makes the ledger run away is three things: judging every batch with a zero cooldown, re-feeding the same reply context, and missing the cache.

### Money-saving list

1. **Leave the judge cooldown alone**: the factory default still adds no wait; as energy drops to “a bit tired”, “tired”, and “very tired”, the system imposes judge floors of 15, 30, and 60 seconds, so a tired fish judges less often and accumulates messages for the next round. A larger manual setting still wins.
2. **Skip low signal**: three or more pure stickers, pure punctuation, or repeatedly pasted short lines that do not call her are recorded without judging, at zero calls.
3. **Cache first**: persona, room rules, and fixed protocol go first in the prompt; character cards and time-sensitive content go last; the judge prompt for one room stays byte-stable, and a cache read is fifty times cheaper than input.
4. **Short acknowledgments skip the reply model**: the judge model hands back a short reaction, or an echo or sticker is used.
5. **Context by thread**: carry only the latest six messages in the same thread as this batch, not a fixed twenty; images travel only when mentioned.
6. **Separate the judge from the reply**: judging always uses a cheap model at a low reasoning tier; replies inherit the owner's high tier only when she is called directly, and use the default otherwise.
7. **Budget exploration**: below “normal” energy there is no exploration; the exploration quota is capped per hour and never mixes with the proactive quota.
8. **Batch background work**: mood, distillation, and chapter summaries each get their own quota and never compete with chat; whatever exceeds its daily cap rolls over rather than retrying at a lower tier.

## Owner tendency: one sentence into real behavior

The owner writes one paragraph in settings, and it only counts after three steps: raw text → `compileTendency` → a set of dimensions that each declare where they land. The same text always compiles to the same policy, and the settings preview and the runtime injection use that one result, so “this is how she will understand it” is checkable.

| Dimension | Example phrases | Landing | How it takes effect |
| --- | --- | --- | --- |
| More or less talk | stay quiet / be lively | existing knobs | proactive quota ×0.6/×1.5, judge threshold +0.06/−0.06, per-batch attention ×0.75/×1.25 |
| Longer or shorter | keep it short / explain fully | per-round prompt | one line appended to the reply-turn guidance |
| More or less humor | fewer jokes / more jokes | existing knob / per-round prompt | less = the humor layer idles; more = prompt |
| Send stickers | fewer stickers / more stickers | per-round prompt | never hard-trimmed, so an explicitly requested sticker survives |
| Save stickers | save more stickers / stop saving | existing knob | auto-save daily cap 40 / 4 / 0; default 12 |

A prompt alone is not enough for three reasons: words cannot pass the code gates (“save more” still hits the daily cap), long text is diluted inside the 12k persona, and longer preferences get ignored more easily. So dimensions that can land on a knob multiply or add onto the existing mechanism instead of appending yet another paragraph.

The priority order is fixed:

| Priority | Who decides | Example |
| --- | --- | --- |
| 1 | Safety, privacy, law, platform / group rules, budget, permissions | never reveal the owner's private matters; never exceed the budget |
| 2 | Explicit QQ hard switches | study stickers off, dry run, quiet hours, balance floor, master switch |
| 3 | Owner tendency | stay quiet, save more stickers |
| 4 | Factory / custom persona | the whole 12k persona |
| 5 | Group feel, mood, style matching | following this room's way of speaking |

Writing “be lively” never turns a judge's `reply=false` into `reply`; quiet hours, the balance floor, dry run, group rules, and privacy are unaffected. “Stay quiet” adds one hard gate on the main path: an ordinary message the judge marked as reply is only watched when confidence falls below the threshold; being called, private chat, questions about her, and affinity checks are still forced through.

Conflicts are resolved deterministically: within a dimension the later clause wins, and within one clause negation wins (“don't save more” is not pre-empted by “save more”). A non-empty text with no recognized clause is not dropped: the raw text still injects as a preference prompt and is marked `unmatched`.

## Creation mode

Some tendencies cannot land through knobs or prompts — “use kaomoji”, “collect group members' images too”, “reply after saving”. Those requests go to the local creation mode so it can change this one fish's code in the source repository instead of pretending a sentence already took effect.

`GET /dsh-fish-mind/creation` produces a deterministic brief: the owner's raw text, recognized landings, unrecognized clauses, code locations (QQ judging / joining / stickers live in `fish/plugins/dsh-qq-bridge/lib/host.js`, the fish brain in `fish/plugins/dsh-fish-mind`), the tests to add, and hard constraints — do not touch safety, privacy, the legal red line, budget, permissions, dry run, or group-rule code; do not read or write `DSH_HOME`; do not commit or push; prefer a deterministic rule over another prompt; affect only this fish.

It counts as a source checkout only when `fish/bundle/package.json` and `fish/plugins/dsh-fish-mind/lib/index.js` both exist under `process.cwd()`; a packaged build only offers a copyable brief and states that this version has no source, so changes cannot be compiled in. Opening creation mode goes through `workspace.startSession(undefined, { agentPreset: 'cordis', prompt, clearPreviousDraft: false })`: the brief only fills an editable draft, is never auto-sent, and never overwrites the owner's existing draft.

Code changes travel with the repository and the installer, not with the memory archive; configuration and tendency travel with export. The permission layer stops writes to the running kernel but cannot stop edits to a source repository — this relies on explicit instructions plus the owner reviewing the diff, and does not pretend to be a sandbox.

## Portable configuration

Export no longer carries memory alone: configuration rides in `manifest.configs` (`mydearfish.fish-configs` v1) through a whitelist, while zip entries and `ARCHIVE_VERSION` stay unchanged, so an older 大肥鱼 still imports a new package and simply ignores the configs.

| File | Carried | Never carried / forced on import |
| --- | --- | --- |
| Fish brain `config.json` | mode, injection, retention, sizes, episodes, recall, chapters, working, inner life, humor, phrases, backup | budget allowance, developer mode, permissions |
| `tendency.json` | full text | — |
| Custom persona | only when the owner changed it | the rest of the profile patch |
| Mood / QQ / speak-up / TTS / Bilibili configs | whitelisted preferences, models, wording, pacing, keywords | credentials, account or group numbers, target sessions, NapCat address, local paths, DM uid |

Import applies configuration first, then writes birth settings and mood names, and forces outbound channels off: QQ master switch off, social paused in dry run, proactive talk off, Bilibili auto-comment / reply / DM off. One broken file is only skipped with a warning and never blocks the memory import; local originals are backed up to `import-backup-<time>/configs/` before applying. The whitelist is maintained on purpose: a newly added secret field stays out of the package until someone adds it to the registry.

## Other features: requests raised in other sessions

| Request | Current state | Next step |
| --- | --- | --- |
| Owner gender female / male / unspecified, never guessed | The pronoun version shipped; being upgraded to a gender field | Follow the in-progress birth-identity change |
| A sticker alone counts as a reply | Done in 0.2.87 | Keep |
| Collect stickers automatically and learn by scene | Done in 0.2.87; private chats collect since 0.2.89 | Keep |
| Native quote, ellipses never split a sentence | Done in 0.2.85 / 0.2.86 | Keep |
| Recognize being addressed by name | Only replies and @ | Added this round |
| Per-room off / listen-only / less mingling / resting | Done | Keep |
| Silent learning, volume, person attitudes | Done | Keep |
| Balance priced at official peak and off-peak rates | Done | Keep |
| Automatic backups, install-directory data | Done | Keep |
| Mood and proactive talk in groups | Mood skips social rooms; proactive talk excludes social rooms | 0.2.91 made mood read-only in social rooms; proactive talk still excludes them |
| Multi-group concurrency cost | Only the global quota | Adds energy and judge cooldowns this round |
| Overlong sessions, failure recovery | Compression threshold, reset route, and consecutive-failure pause done | Keep |
| White text in dark-theme dropdowns | All five fish pages carry dark option backgrounds: QQ bridge, speak-up, fish-mind, mood, and Bilibili; the TTS page has no dropdown | Done |
| Recognizing people in images, sticker ownership | md5 and sender markers in place; private-chat saving, renaming, sending by number, duplicate detection, and honesty about a missing number all have tests | Done |

## Acceptance

| Metric | Threshold | How to measure |
| --- | --- | --- |
| Judge calls | No more than once per 20 seconds within one continuous conversation | Diagnostic log |
| Daily model spend | Under ¥1 per group and under 60% of the daily grant overall | Ledger |
| Group speech ratio | Her messages stay under 15% of group messages | Ledger statistics |
| Wrong interjections | Proactively joining someone else's conversation no more than 3 times a week | Spot check |
| Answered questions | She never re-answers a question someone else answered; spot checks find zero | Spot check |
| Energy tiers | All six tiers visible in diagnostics and behavior matches the table | Unit tests + logs |
| Owner private chat | Reply quality and latency unaffected by lower energy | Comparison |
| Late replies | Stale, aimed at the wrong person, or repeated all count as failures; at most three threads per room at once | Spot check + settings page |

## Implementation order

1. Done (0.2.88): the energy module and ledger status, name-based addressee detection in QQ, the energy line in group prompts, the new judge-cooldown default, and low-signal skipping.
2. Done (0.2.90): room ledger, rung-1 short acknowledgments, and dropping messages someone else already answered; the ledger is scoped to the whole room, with thread grouping deferred to the next round.
3. Done (0.2.92): the ledger groups by reply strand; replies and judgments fill the quoted strand first, then top up the budget with recent words.
4. Done (0.2.93): social battery and rhythm jitter between consecutive sends.
5. Done (0.2.94): the repair turn.
6. Done: page-by-page audit of settings dropdowns and the private-chat sticker path. All five fish pages carry dark option backgrounds, the TTS page has no dropdown, and settings pages of non-fish plugins are outside this plugin's scope; saving, renaming, sending by number, deduplicating stickers, and being honest about a missing number all have private-chat test coverage.
7. Done (0.2.96–0.2.97): the first two steps of time continuity — a message she wanted to answer but that cooldown, battery, quota, quiet hours, or a busy room held back becomes an open thread, and she adds a line once the room has been quiet for a while; threads persist to local `qq-bridge-threads.json`, survive restarts within the same day, and the `迟到分钟` cap rises to 360 so they can cross hours. Next-day callbacks wait for a later round.
8. Done (0.2.99): owner tendency compiles from one paragraph into five dimensions; those that land on a knob multiply or add directly, and the rest go to a creation-mode brief; export carries whitelisted configuration while older versions still import; the settings page keeps only the outer "tendency" layer, with the factory persona and collection prompts folded into a collapsed advanced section.

Each round runs the plugin tests and `pnpm run test:docs` before committing and pushing; files another session is editing are never overwritten.

## New configuration

| Key | Default | Effect |
| --- | --- | --- |
| `社交.低信号跳过` | true | Skip judging when a batch is all stickers, echoes, or very short acknowledgments |
| `社交.短应` | true | Allow the judge model to return a short reaction without a separate reply call |
| `社交.精力` | true | Whether the allowance affects group proactive talk, judging, exploration, and length |
| `社交.电量` | true | Whether recent per-room speech lowers the proactive quota |
| `社交.重说` | true | Whether a "?" or "didn't catch that" triggers a direct rephrase without another judgment |
| `社交.迟到` | true | Whether a message blocked by cooldown, quota, quiet hours, or a busy room is kept as an open thread for a later line |
| `社交.迟到分钟` | 10 | How long a thread waits before she comes back to it (up to 360); three times this delay or a day change drops it |
| `社交.挂起上限` | 3 | How many threads one room holds at once; the oldest is pushed out first |

`判断冷却秒` keeps its value (default 0); the energy floor only raises the effective wait and never rewrites the configured value. The owner tendency is in neither table: its raw text lives in `fish-mind/tendency.json` and writes neither the QQ config nor the fish-brain `config.json`.
