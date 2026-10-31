# Fish companion runtime

English | [中文](README.zh.md)

This tree is the fish companion that runs on DSH: the plugins, the factory composition, launch and release scripts, and the checks that guard her behavior. Runtime data lives outside this tree in `data/`.

## Layout

- `fish/plugins/` — six Cordis plugins: the fish mind, the QQ bridge, speak-up, the TTS bridge, the Bilibili duty, and the mood.
- `fish/bundle/` — factory composition and the packaging list.
- `fish/launch/` — one-click launch, runtime sync, and release scripts.
- `fish/tests/` — cross-plugin composition snapshots; each plugin keeps its own tests.
- `fish/tools/` — read-only diagnostics: session log reader, doctor, conversation health, and the real-model canary.

## Tests

`pnpm run test:fish` runs the fish-mind unit tests, every plugin smoke suite, the composed prompt-surface snapshots, and the tool tests. It runs on pre-push when fish files change, in the fish packaging workflow, and in the release preflight before a tag is pushed; a failure stops packaging. `pnpm run test:fish:canary` sends fixed owner messages to the real model and compares reply length against a frozen known-good prompt; it needs `DEEPSEEK_API_KEY`, exits non-zero without one, and is meant for nightly or manual runs rather than a release gate.

## Behavior changes

Prompt text, the short-term memory window, and style hints decide what she sees and how she speaks; changing any of them is a behavior change, not a copy edit. Such a change must:

- refresh the composed snapshots with `UPDATE_PROMPT_GOLDEN=1 node --test fish/tests/prompt-surface.test.mjs` and review every diff;
- run the style and room scenarios with a mature owner profile (at least 24 samples), not an empty one;
- keep the room isolation matrix green: QQ rooms never leak into the owner window, and the owner's private words never enter group or friend views;
- run the real-model canary when prompt wording changes, and re-freeze the known-good baseline only after accepting the new behavior.

[Post-mortem 0005](../docs/postmortem/0005-fish-companion-short-reply-regression.md) records how the 2026-10 reply regression passed every check that existed at the time.
