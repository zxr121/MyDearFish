# Post-mortem 0005: Fish companion replies collapsed into short fragments

English | [中文](0005-fish-companion-short-reply-regression.zh.md)

Status: resolved

## Executive summary

On 2026-10-26 the fish companion's owner-visible replies fell from 71–105 characters with long reasoning to short fragments with little reasoning, and the owner noticed four days later. Two mechanisms reinforced each other: a style hint began telling her, after enough samples, to stop after a few characters, and the short-term memory window copied her own short replies from QQ rooms into the owner's desktop prompt as `我：…` lines. Every existing test passed because none composed the two plugins, none used a mature style profile, and no check measured behavior or ran in a release gate. Composed prompt snapshots, room and style matrices, a keyless test gate, a real-model canary, version diagnostics, and daily conversation health now cover those gaps.

## Summary

The owner chats with her through QQ, so the QQ bridge attaches a style hint to owner messages. The profile accumulates the owner's sentence length, punctuation, multi-message habits, and favored particles. Once it has at least six samples, the hint scales with the sample count and was teaching her to keep sentences short, split them further, and send two or three messages. That instruction was meant to mirror the owner's pacing, but it also told a companion who otherwise writes full paragraphs to truncate.

In parallel, the fish mind builds a short-term memory window for every session. Its row filter removed rows from other rooms for user messages but not for assistant messages: her own replies are stored with the model source, so replies written inside QQ group and friend rooms entered the owner's desktop window. Those rows carried the room id and appeared as `我：…`.

The two mechanisms formed a positive feedback loop. A QQ reply shortened by the style hint became a short `我：…` fragment in the owner window, and the owner window then showed her a style where she habitually speaks in fragments. The more she used QQ, the more fragments the owner prompt contained.

## Impact

Owner-visible replies dropped from a 71–105 character range to 16–45 characters, and reasoning fell from more than 1,500 characters to 100–400. Daily owner reply medians in the session logs were 65 characters on 2026-10-26, 35 on 2026-10-27, 26 on 2026-10-28, and 33 on 2026-10-29. On 2026-10-30 the owner reported that she only answered with filler and no longer seemed to think.

No memory, credential, or account data was exposed, and no external channel sent anything unintended. The damage was to the companion's personality and to trust: for four days she was not the character the owner had been building.

## Timeline

- Before 2026-10-26, owner replies measured 71–105 characters and reasoning exceeded 1,500 characters.
- From 2026-10-26 15:22, replies shortened as the style profile crossed its activation threshold while QQ samples accumulated.
- From 2026-10-27 to 2026-10-29, daily medians kept falling while short `我：` rows accumulated in the owner window.
- On 2026-10-30, the owner reported the change.
- On 2026-10-31, both mechanisms were identified, the style hint stopped teaching truncation, assistant rows from QQ rooms were excluded from the owner window, and the guardrails below landed.

## Root cause

The style hint was tested as text, not as an instruction with an audience. Tests asserted that a hint was present and that it mentioned completeness; they did not assert that the owner's view never receives sentence-length or splitting instructions. The same hint also served groups and friends, where a different tone is appropriate, so a single string was judged once for all audiences.

The activation threshold hid the defect from ship-day checks. With fewer than six samples the hint is empty; with six it becomes visible and it strengthens as the count approaches 24. Every style fixture used an empty profile, and a manual check on release day therefore saw nothing. The regression appeared only after days of real samples.

The short-term window treated `source` as sufficient proof that a row belonged to another room. For user messages it excluded social sources; for assistant messages it did not, because the model source is also used in the owner's own room. The room id in the session key was available but not consulted for those rows.

No test composed the two plugins. The QQ bridge tests saw a correct style hint; the fish-mind tests saw a correctly filtered user window. The shipped owner prompt, which is the product, existed only at runtime. No keyless or keyed test inspected it, and no release gate ran the fish tests at all.

## Guardrails added

- [Composed prompt snapshots](../../fish/tests/prompt-surface.test.mjs) mount the fish mind and the QQ bridge together, drive owner, group, and friend turns, and pin every prompt section plus the inbound message; owner views reject the four shortening phrases and any QQ room row.
- [The room isolation matrix](../../fish/plugins/dsh-fish-mind/tests/store.test.mjs) covers viewer × room × role × source × age, including reset-suffixed session ids, and fails when a new source is not assigned a destination.
- [The style contract suite](../../fish/plugins/dsh-qq-bridge/tests/风格贴合.mjs) fixes profiles at 0, 5, 6, 24, and 48 samples across audiences and requires the completeness guardrail whenever a hint is emitted.
- [`pnpm run test:fish`](../../scripts/test-fish.mjs) runs every fish suite; pre-push executes it when fish files change, and the packaging workflow and release preflight run it before a tag.
- [The real-model canary](../../fish/tools/conversation-canary.mjs) sends fixed owner messages to the current prompt and to a frozen known-good prompt, and flags a sustained median drop; it needs a key, exits non-zero without one, and stays out of release gating.
- [Doctor](../../fish/tools/doctor.mjs) compares each source plugin's version and `lib/` content hash with the profile's runtime copy and reports the configured and actual model and effort; startup logs one diagnostic line.
- [Conversation health](../../fish/tools/conversation-health.mjs) reads session logs and fish-mind data, reports daily reply and reasoning medians, forbidden hints, missing guardrails, and lone `我：` windows, and alerts on a 40% drop against the prior week.
- [The fish README](../../fish/README.md) defines prompt, memory-window, and style-hint changes as behavior changes with the snapshot, mature-profile, isolation, and canary requirements.

## Lessons

- A prompt is a product surface. Assert what each audience receives, not that a sentence exists somewhere.
- Thresholded and self-reinforcing features need fixtures on both sides of the threshold and in the mature state; a release-day manual check is blind by construction.
- Plugin-local green is not composition green. Mount the shipped set and drive a real inbound message before believing an interaction.
- Behavior needs behavioral evidence. A fake model cannot get worse, so keep a keyed canary and production medians alongside keyless snapshots.
- A test that no gate runs is documentation. Wire the suite into pre-push, packaging, and release before adding more tests.
