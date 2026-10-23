# Context budget and failure recovery

English | [中文](context-budget.zh.md)

A companion session grows with every turn. Two seams keep that growth from turning into silence: compaction has to trigger while requests are still inside the reliable size range, and a failed reply turn has to be visible and recoverable instead of being retried forever against the same oversized session.

## Why the old budget never compacted

`deepseek-flash` and `deepseek-v4-pro` declare a 1,000,000-token context window, and the adapter defaults `maxTokens` to 256,000. Compaction pressure is therefore `min(1,000,000 × 0.8, 1,000,000 − 256,000 − 65,536)`, about 678,000 tokens. A QQ social session that reached roughly 300,000 tokens had never compacted. On 2026-10-23 a reply turn at that size failed as `TRANSPORT` five times in sixteen seconds while a same-second judge call with about 2,900 tokens succeeded; a 237,000-token cold request had succeeded earlier that morning. The structural defect is the unreachable trigger, not a missing retry.

## Trigger and retention

The fish layer sets two compaction defaults: `thresholdRatio: 0.15` and `retainRatio: 0.05`. With the 1,000,000-token window this triggers at 150,000 tokens and keeps about 37,000 tokens of recent surface verbatim; the rest becomes a summary checkpoint. The summarization request itself carries the compactable prefix plus the configured summary output, so it stays below the size that has failed. The declared context window is not changed: it is model capability, while the trigger is deployment policy.

The profile layer applies the same two values so an existing profile picks them up without reinstalling the bundle. A new installation receives them from the fish bundle.

## Resetting one session

An already-oversized session cannot be repaired by compaction: the summarizer would replay the same large prompt that just failed. The QQ bridge exposes `POST /dsh-qq-bridge/session-reset` with a target session id. The route disposes the live agent handle, clears that room's pending batch and failure counters, and records a new suffixed session id in `$DSH_HOME/qq-bridge-sessions.json`. The next message creates a fresh session under the new id; the old session directory stays on disk as a backup. The settings page exposes the same action as a button next to each target.

Session ids remain stable across host restarts because the override file is read when the bridge loads. The private-chat session uses the same mechanism, and a manually pinned `目标会话` is rewritten to the new id when it pointed at the reset session.

## Failure visibility

A reply turn ends with `turn/end` and a reason. The bridge previously handled only `completed` and ignored `error`, leaving one timeout log line after 180 seconds. It now records the failure code and message immediately, increments a per-target consecutive-failure counter, and clears the pending reply. A completed turn clears the counter.

After three consecutive failures on one target the bridge pauses automatic replies for that target for ten minutes, so new messages are buffered instead of being appended to a broken session, and sends one system notice to the owner's private QQ. The notice is operational text prefixed `【大肥鱼·系统】`, not the companion speaking. The state route exposes `故障.连续`, `故障.最后说`, `故障.最后At`, and `故障.暂停到` per target, plus the equivalent main-route failure record. The settings page shows the failure line and offers the reset button.

## Operational notes

The bridge configuration stays at `$DSH_HOME/qq-bridge-config.json`; session overrides live in `$DSH_HOME/qq-bridge-sessions.json`; old sessions remain under the DSH sessions directory. Resetting a room is reversible in the sense that no transcript is deleted, but the next turn starts with no recent local history; the fish's long-term experiences in fish-mind are unaffected.
