# Being human in groups, filling feature gaps, and the energy budget

English | [中文](approach-human-presence.zh.md)

This document answers three questions: why she still does not feel human in a group, what to change, and how to spend less money while staying natural. The design draws on research into human multi-party conversation; the landing sites are the current code in `dsh-qq-bridge` and `dsh-fish-mind`. Items that are not implemented yet are marked as such, so the plan never reads as the current state.

## In one sentence

Let her actually be present in a group: every message enters a room ledger first, and a graded participation decision (not watching / short acknowledgment / joining / starting) decides what happens next; treat the balance as energy that runs down, so when she is tired she speaks less and shorter instead of mechanically shutting up; the savings come from not re-judging, not re-feeding context, and keeping cache hits, not from flattening replies into perfunctory lines. The next step adds time continuity: when she wants to answer but this is not the moment, the thread stays open and she comes back to it later or the next day, instead of forcing a reply or losing it forever.

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

### Time continuity (next round)

Right now she lives only inside "this batch of messages": a batch arrives, one judgment runs, and within seconds she replies or does not; proactive speech is a dice roll weighted by time and mood. People are not like that. They see a message and answer later, come back with "was busy, what did you say earlier", and the next day ask "how did that interview go". None of this needs a model running in the background; the existing room ledger, fish-mind memory, and proactive quota are enough.

Three steps, with only the small one first:

1. **Keep the thread (0.2.96)**: when judgment picks a message and she has something to say, but cooldown, low battery, quota, quiet hours, or a busy room blocks the moment, she does not force a reply. The message becomes an open thread in the room; listen-only, resting, and closed rooms keep nothing. About ten minutes later, when the room is quiet and she is present again, one cheap judgment decides whether to add a line; that line carries the original words and whatever others said since, and she may naturally say she just saw it without explaining where she was. It shares the proactive quota, holds at most three threads per room, and drops them overnight.
2. **Late replies (later)**: widen open threads from ten minutes to a few hours and persist them with fish-mind so they survive a restart; when she returns she looks at these before deciding which to pick up.
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
7. Next round (0.2.96): step one of time continuity — a message she wanted to answer but that cooldown, battery, quota, quiet hours, or a busy room held back is kept as an open thread, and she adds a line about ten minutes later when the room is quiet; persistence, crossing hours, and next-day callbacks wait for later rounds.

Each round runs the plugin tests and `pnpm run test:docs` before committing and pushing; files another session is editing are never overwritten.

## New configuration

| Key | Default | Effect |
| --- | --- | --- |
| `社交.低信号跳过` | true | Skip judging when a batch is all stickers, echoes, or very short acknowledgments |
| `社交.短应` | true | Allow the judge model to return a short reaction without a separate reply call |
| `社交.精力` | true | Whether the allowance affects group proactive talk, judging, exploration, and length |
| `社交.电量` | true | Whether recent per-room speech lowers the proactive quota |
| `社交.重说` | true | Whether a "?" or "didn't catch that" triggers a direct rephrase without another judgment |

`判断冷却秒` keeps its value (default 0); the energy floor only raises the effective wait and never rewrites the configured value. Keys for the time-continuity round (`社交.迟到`, the per-room thread cap) enter this table once they land; the plan does not write them down as current state.
