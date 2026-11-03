# Agent Note: Fish settings become two top-level pages with searchable sub-tabs

Status: implemented

English | [中文](2026-11-03-fish-settings-ia.zh.md)

## Problem

The settings modal had twelve flat sections. The fish panes mixed editable settings, read-only state, installation wizards, and troubleshooting logs in one long scroll, while the same fact appeared in two places: Bilibili had both a dedicated page and a schema-generated form, mood repeated the birth-identity names, and the Big Fat Fish memory page repeated mood, people-book, and channel state. QQ's proactive group topics and the proactive-speech page also looked like competing controls, so the owner could not tell which page owned which behavior.

## Decision

Fish settings live under two top-level pages, `Big Fat Fish` and `Where she goes`. `dsh-fish-mind` owns both parent sections and declares the child list slots `settings.fish.tab` and `settings.outside.tab`; the mood, QQ, proactive-speech, and Bilibili plugins register their existing panes into those slots without changing their host APIs. Big Fat Fish has Overview (read-only, default), Who she is, Memory, Mood, Pocket money, and Meme wiki. Where she goes has QQ, Proactive speech, and Bilibili. The remaining top-level pages are Account, General, Models, Agent presets, and Plugin status, so the rail has seven rows.

The shell gains a search field backed by the new client service `ctx.settingsSearch`. Pages register a section id, optional sub-tab id, per-query label and keyword resolvers, and optional effect/read-only tags. A result opens the section and passes `requestedTab` to the active section, which acknowledges it through `takeRequestedTab`; sections without sub-tabs ignore both. The search index is presentation state only.

Duplicates were removed rather than rearranged: Bilibili calls `settings.configure({ auto: false })` and the Plugins page now respects `autoGenerate === false`; mood's owner and self names are read-only and follow birth identity; Big Fat Fish Memory no longer renders mood, people-book, or channel blocks; the people book lives only under QQ. Copy now names each boundary, including QQ's "speak first in groups" versus session-level proactive speech, account balance versus pocket money, and the default model versus per-feature model overrides. Every fish settings page starts with what it can set, non-immediate blocks carry a restart tag, long pages expose section anchors, and fish booleans are two-segment 开/关 pills.

## Verification

`pnpm run test:fish` covers the parent and child registrations, the default Overview tab, the read-only mood names, and the pill controls. `pnpm run test:gui` covers the search service, search result matching, the shell store's `openAt`/`takeRequestedTab`, the plugin-manager `autoGenerate` gate, and the native page copy. `DSH_SNAPSHOT=refresh pnpm run test:web` refreshes the settings ARIA goldens; the replayed run must pass. Manual verification opens every top-level page and sub-tab in the desktop build, including a search result that lands on a sub-tab.

## Alternatives considered

**Keep the twelve flat sections and add group headers.** This preserves every page but leaves Bilibili and identity duplication intact and keeps the longest panes as single pages. The owner asked for similar pages to share one tab.

**Put fish settings in their own window.** A second settings surface would remove the app-level tabs from the fish rail but split search, onboarding, and navigation into two shells. Sub-tabs keep one shell while reducing the rail.

**Add keyword fields to the generic list-slot options.** Slot options persist only id, order, label, and priority; search also needs effect tags, read-only mode, and per-query resolvers. A client service keeps that data out of the framework slot core.

## Consequences

`dsh-fish-mind` is now the fish settings shell: disabling it removes both fish top-level pages and leaves the child registrations waiting. That is acceptable because the fish bundle treats the mind as a hard dependency, and it is documented in the fish settings guide. Switching top-level pages still unmounts the active pane, so unsaved drafts can be lost; sub-tabs keep visited panes mounted. Search finds pages and sub-tabs, not individual fields, so a long page still needs its section anchors.
