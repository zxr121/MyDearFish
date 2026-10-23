# Memory consolidation cycle

English | [中文](memory-cycle.zh.md)

A companion that remembers everything equally remembers nothing well. The fish already has an experience stream, episodes, and recall, but the step that turns lived time into durable memory ran as one global, model-only job. This page defines the replacement: a cycle with rooms, sleep stages, spaced reactivation, and relevance ranking, sized for one desktop host and the data the fish actually produced in her first two days.

## What the first two days showed

By 2026-10-23 15:10 the live database held about 550 experiences, 26 episodes, 3 active facts, and 0 chapters. Of the 291 group-chat rows, the average row was 799 characters because the bridge batches several QQ messages into one experience. The last 40-row working window contained 25 group rows and 15 assistant rows; owner messages were barely represented. Three consolidation runs had executed, one produced three facts and two decided there was nothing worth keeping. All three facts came from group chatter, and none was scoped to the room that produced it.

The funnel had three structural leaks. The working window was global, so an active group could crowd out the owner's private conversation. The extraction prompt asked only for facts about the owner and herself, so group chatter produced noise while the owner's own conversations could fall outside the window. The cursor advanced even when the model returned nothing, returned no model at all, or failed, so unprocessed material became invisible. There was no nightly pass, no weekly or monthly pass, no review schedule, and no way for recall to strengthen or weaken anything.

## The human timeline, mapped

- Working memory lasts seconds to about half a minute. Here it is the per-room injection of recent verbatim turns, kept at 30 minutes and 12 rows.
- Synaptic consolidation tags an experience within minutes to hours. Here it is a micro pass per room after 20 minutes of quiet or a full backlog.
- Sleep consolidation replays the day. Slow-wave sleep favors declarative facts and gist; REM favors emotional and social integration. Here it is two bounded model calls after 03:30, with catch-up after downtime.
- Systems consolidation spreads a memory over days to weeks. Here it is the 3, 7, 21, and 60 day review schedule.
- Schema integration connects new material to what is already known. Here it is the weekly pass over day chapters, facts, relations, and the self model.
- Reconsolidation rewrites a memory when it is recalled. Here it is a strength and confidence update when recall actually uses an episode or a fact.
- Forgetting is not deletion: the raw stream is kept forever, and relevance ranking (recency, salience, review count) decides what surfaces, not what is removed.

## Rooms before time

Consolidation now runs per room, not per global cursor. A room is the session id with a bridge reset suffix removed, so the group conversation before and after a reset remains one room. The owner's private chat and the owner's DSH sessions share the owner scope; group and friend chats get `social:<session id>`.

Each room has its own cursor in `consolidation_state`. A room becomes eligible when at least two rows are pending and either 20 minutes have passed since its newest row or its backlog exceeds the per-room cap. One micro pass handles at most one room, owner first, so an active group cannot starve the owner and cannot multiply model calls in a single tick.

Group rows are batches, not single messages. The social prompt receives a compressed view: the most salient rows, the newest rows, and clipped text inside a character budget. The prompt asks for facts about participants, their habits, relationships, and agreements, and may return one gist sentence. It must not return facts about the owner's private life, secrets, balances, or addresses.

## Micro-consolidation

The micro pass selects pending rows for one room, scores them by stored salience, recency, and commitment or identity markers, and keeps the newest rows regardless of score. Fine-grained facts are extracted only from that selection; low-salience chatter is left to the extractive chapter tree, which is the gist pathway. The cursor advances only after a successful model answer, including a deliberate empty answer. A missing model, a transport failure, or a parse failure leaves the cursor untouched so the same material is retried instead of silently skipped.

Every fact is written with a scope and with the source experience ids. Owner-scope facts and the social scope of the room are kept apart. The workspace prompt shows a short digest of the facts allowed in that room: owner facts plus social facts in the owner's session, and only that room's social facts elsewhere, so semantic memory can influence a reply without dumping the whole fact table into context.

## Nightly sleep

At 03:30 local time the fish runs two stages for the day that ended. If the host was off, the next start catches up the missed day, up to two days, oldest first.

The slow-wave stage reads the day's episodes, the facts learned that day, and up to eight due review items. It returns a day gist, corrected or merged facts, and a short list of what the day was about. The REM stage reads the day's emotionally salient and social episodes plus the current self model and people notes. It returns an affect reading, a self-model update, relationship notes, and at most two intentions.

Both stages are one model call each. Results are written as consolidation experiences, active facts, `self_model`, `people`, `affect_log`, and `intentions`; the day's top episodes receive their first review date. A stage with no new material is skipped rather than sent as an empty prompt. A failed stage is recorded in `sleep_runs` and retried on the next schedule, and it never marks the day as consolidated.

## Spaced reactivation

Episodes and facts enter a review queue three days after they are first consolidated. A successful review moves the item to 7, 21, and then 60 days. The nightly slow-wave stage carries due items into its prompt as "what should be revisited", and the model is asked whether the old material still holds and whether it connects to recent days. After the stage, due items are marked reviewed, their review count rises, and their next date is scheduled.

Recall is the second review path. When the workspace or the recall tool actually injects an episode or a fact, the store records the recall and its timestamp. Recalled material that is immediately contradicted in conversation is superseded through the normal fact upsert, which is reconsolidation in the literal sense.

## Weekly and monthly integration

The weekly pass runs on Monday at 04:10. It reads seven days of day chapters, active facts, relations, and the current self model, and writes a week gist, self-model refinements, relationship trends, and any intentions worth carrying. The monthly pass runs on the first day of the month at 04:20 and reads the month's chapters and the previous self model. Both are single model calls; both write consolidation experiences and structured rows, not new chapters, because the chapter tree stays extractive and rebuildable.

## Reconsolidation and forgetting

Every episode and fact carries a strength, a recall count, a last-recalled time, and a next-review time. Nightly decay multiplies strength by a half-life: three days for routine short episodes, 14 days for social material, 30 days for the owner's ordinary days, and 90 days for identity facts such as names, roles, and relationships. Recall adds strength back. A memory below the cold threshold after the cold age is flagged cold: it drops out of the review queue and is scored lower in recall, but it is never deleted and can be revived by a later recall or correction.

The decay never touches the experience stream or the imported records. It changes derived ranking fields only. Cold is a ranking state, not a tombstone.

## Configuration and visibility

The new defaults live in `cycle` and in the existing `working` block. Existing profiles receive them without a reinstall because the plugin normalizes defaults on load.

```yaml
working:
  roomRows: 24
  roomChars: 6000
  maxRoomsPerRun: 1
cycle:
  enabled: true
  nightly: { hour: 3, minute: 30, minNewExperiences: 6, catchUpDays: 2 }
  review: { intervals: [3, 7, 21, 60], limit: 8 }
  weekly: { weekday: 1, hour: 4, minute: 10 }
  monthly: { day: 1, hour: 4, minute: 20 }
  maxMicroPerHour: 6
```

There is no decay block. Time affects ranking only: the existing recency weight in recall fusion already handles "recent matters more", and spaced review tracks what has been rehearsed. Nothing is deleted or hidden; the raw stream and all facts stay queryable forever.

The settings page shows the cycle state next to the existing memory block: each room's pending rows and last status, the last micro, slow-wave, REM, weekly, and monthly runs, the number of due reviews, and the review queue depth. Buttons run a nightly pass for the last ended day, run a weekly or monthly pass, and force one micro pass. Everything is read-only except those maintenance actions.

## Backfill and acceptance

On first start after the upgrade, the cycle picks up the rooms with unprocessed rows and catches up the last ended day. For the existing two days this should produce group-scoped facts, a 2026-10-22 day record, a populated review queue, and a non-zero self model, while leaving all 550 raw experiences untouched. Acceptance checks are: no pending room remains stuck after three ticks with a working model; every fact carries a scope and source ids; the nightly run appears once per ended day in `sleep_runs`; recall of a previously injected episode raises its recall count; and a failed stage does not advance the day.

## Limits

Summaries are lossy by design. The nightly gist is one paragraph, not a transcript, and the chapter summaries remain extractive. Facts are a small semantic index, not a replacement for episodes. Social facts are scoped to their room: they never appear in a different room's digest, while the owner's digest may include them. The cycle spends at most two model calls per night, one per week, and one per month, plus bounded micro passes; it keeps working, with cursors intact, when the model or the wallet is unavailable.
