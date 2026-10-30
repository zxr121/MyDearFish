# A Group-Friend Twin From Real Chat Records

English | [中文](approach-group-friend-clone.zh.md)

She has given her consent. The goal is a correctable profile built from the group chat records she authorized, generating replies by retrieving her own words: private rehearsal first, deployment into the group later. No model fine-tuning, and no promise of an exact copy — the bar is that friends notice the difference while ordinary group members do not.

## The corpus already on disk

Measured 2026-10-30 after merging four local SnowLuma message stores and deduplicating by message fingerprint:

| Item | Count |
| --- | --- |
| Messages in the target group | 7,026 |
| Her messages | 402 (384 text segments, 35 images, 75 quote replies) |
| Message length | median 10 characters, 90% within 23 |
| Coverage | 2026-10-22 10:15 through 2026-10-30 11:17, eight active days |

The fish mind's experience stream holds a copy of the same window with fewer fields; it only fills in reply-chain context. The corpus stays under the local `data/` directory and never enters the repository.

## Gaps and acquisition routes

Earlier records are not on this machine: collection began when the bot joined the group. Three routes:

| Route | Coverage | Cost | Trade-off |
| --- | --- | --- | --- |
| A. She exports her own QQ records | Everything since she joined | One export from QQ's message manager (txt or mht) into `data/clone/raw/` | Preferred; clear authorization, complete at once |
| B. Tulpa MCP | History already on her machine | Start Tulpa and extend the existing importer with group allowlists | Fallback; nothing listens on port 18777 here |
| C. Continuous collection by the bridge | From today onward | Zero | Required, so future history is never missing |

Use A with C: backfill the past from her export, and let the bridge archive everything from today on; the merger deduplicates by fingerprint.

## Why not fine-tuning

- 402 messages over eight days teach verbal tics, not personality; once the setting changes, a fine-tuned model only repeats itself.
- The DeepSeek API offers no persona fine-tuning; local fine-tuning needs a GPU and a deployment, and the maintenance outweighs the gain.
- A profile plus retrieval is readable, editable, and updated incrementally each week; cost follows tokens, and a model change requires no retraining.

## Three layers

### Corpus layer

`data/clone/<qq>/messages.jsonl`: one message per line, keeping time, room, sender, group card, text segments, reply target, and message fingerprint. The merger only reads SnowLuma's SQLite stores, deduplicates by fingerprint, and writes back to none of them.

### Profile layer

- `style.json`: quantitative features — message length distribution, image share, quote-reply share, active hours, burst timing, @ and emoji use.
- `style.md`: qualitative profile — verbal tics, particles, punctuation habits, memes and fixed phrases, tone differences across people, topic range.
- A cheap model summarizes in batches, processing only new messages; every conclusion cites the source lines so she can correct it.

### Performance layer

Before generating a reply: retrieve three to eight of her similar lines with surrounding context; switch tone by conversation partner; then run another cheap check for "does this sound like her, and does it claim anything she could not know"; rewrite or stay silent when it fails. Unknown matters get "I don't remember", never invention.

## Milestones

| Stage | Deliverable | Acceptance |
| --- | --- | --- |
| M1 | Corpus merger and first profile | Across 20 sampled real messages of hers, the profile explains the word choice and rhythm of at least 15 |
| M2 | Private rehearsal: you and she chat with the twin locally, no second QQ account | Blind test of 20 turns where she or a friend identifies the twin's lines; target is a 60–70% confusion rate, not perfection |
| M3 | Into the group: a second QQ account and a second SnowLuma | One week without a single leak of private chats or out-of-group information |

No shipped plugin changes before M2; the merger and profile are local scripts under `fish/tools/`.

## Privacy and disclosure

- The corpus contains third-party group members' words: local only, never in git, never sent to the group, never handed to third-party APIs.
- The twin does not quote private chats or generate addresses, phone numbers, or accounts; questions outside its knowledge get a direct "I don't know".
- In the group, the nickname or group card states that it is an AI twin. Her consent covers the use of her persona, not letting members mistake the twin for her.

## Acceptance discipline

M1 ships two files and one statistics summary that anyone can check against the source lines; M2 ships a replayable conversation log; M3 starts only after M2 passes the blind test and she confirms again. Any problem at any stage goes back to the profile layer, not patched through prompts.
