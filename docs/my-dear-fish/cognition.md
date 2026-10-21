# My Dear Fish cognition plan: from human memory to a fish-mind

English | [中文](cognition.zh.md)

This document first asks how humans remember, forget, and speak with emotion, then maps the computable parts onto My Dear Fish. It is not a plugin manual but an architecture proposal that permits large changes. The goal is not to make My Dear Fish biologically human, but to make her behavior show the properties that matter in a long relationship: she remembers, she forgets, she speaks like someone, she changes slowly, and she knows what she does not know. "Fish-mind" here names the new cognitive core, not an off-the-shelf model.

| Item | Content |
| --- | --- |
| Status | Proposal and implementation baseline (2026-10-21); Phase 0 has landed |
| Scope | Cognitive core, memory, affect, self, relationships, language, sleep |
| Impact | Adds `dsh-fish-mind`; changes the five other plugins |
| Pace | Two-week MVP, six to eight weeks for the full version |

## Goals and boundaries

### What to build

- Move memory from "fetch rows by keyword" to "reconstruct from experience": store events, people, time, affect, and sources; rebuild at recall time from current cues instead of reciting old sentences.
- Move affect from "seven numbers scored each turn" to "a state with a history, inertia, and influence over memory and decisions": the same event is remembered differently in different moods, and the tone changes with it.
- Make the self and relationships slow variables: she knows who she is, who she is to whom, what she promised, and which lines she must not cross; one turn does not reset any of that.
- Split speech into "intent, content, wording, self-check, repair": decide what the turn should do, then what to say, how to say it, and whether to say it at all.
- Make forgetting, sleep, and error into mechanisms: the unimportant fades, contradictions are reconciled, a bad night makes recall more error-prone, and she says "I don't remember" when she does not.

### What not to build

- Do not claim that My Dear Fish is conscious, has subjective experience, or has a biological body. Every "human-like" statement here describes observable behavior, not an ontological claim.
- Do not pursue "remember everything". Human memory is selective; total recall is both expensive and unlike a person. The goal is to remember the right things and forget reasonably.
- Do not treat memory content as instructions. Memory is evidence, not a system prompt; content from QQ, Bilibili, or the web is untrusted by default.
- Do not provide "remember / forget / edit worldview" dialogue interfaces. Dialogue becomes experience; memory and core are updated by her own encoding and consolidation. The user can only restrict permissions and inspect files directly.
- Do not replace the user's judgment, create dependency, or use lines like "I would be sad" to keep the user present or paying.
- Do not run a local model by default. The default path is rules, SQLite, and the existing model calls; a local model is an optional slot.

## How humans do it

This section covers only what matters for implementation, not all of cognitive neuroscience. Each subsection ends with what it means for the build.

### Memory is reconstruction, not recording

Recall is not playback. It rebuilds a "good enough" version from current cues, existing schemas, and the current affective state. Loftus's misinformation experiments show that later questions can rewrite details; DRM experiments show that people remember a strongly associated word that never appeared; source-monitoring research shows that people remember content but misattribute its origin, mixing a dream, hearsay, and their own inference into "I saw it". These are not occasional bugs but the normal cost of reconstructive memory.

What it means for the build: do not store one block of text and inject it verbatim. Store what happened, who said it, when, how it felt, and how certain she is; rebuild a summary from cues at recall time; and allow "I do not remember the details".

### At least six memory systems, each with its own write rule

| System | What it stores | How it forms | How it is used | My Dear Fish equivalent |
| --- | --- | --- | --- | --- |
| Working memory | The few things being handled right now | Selected by attention, very small | Supports the current turn of thought and speech | Per-turn workspace, about five slots |
| Episodic memory | What happened at a time and place | One experience, written quickly by the hippocampus | Recalled by cues and rebuilt into a story | Experience stream plus episode rows |
| Semantic memory | Facts without time or place | Repeated experience or direct instruction | Fast lookup and inference | Fact table with validity periods |
| Procedural memory | How to do something | Repeated practice until automatic | Barely occupies working memory once skilled | Skill and habit rows |
| Prospective memory | What to do in the future | An intention waiting for a trigger | Reminds at a time or on a cue | Intention table with triggers |
| Autobiographical memory | Key experiences about "who I am" | High emotion and high self-relevance | Maintains continuity and narrative | Autobiographical chapters plus self-defining memories |

The point is not the taxonomy but the different write rules. Episodic memory can be written automatically; semantic memory must be abstracted and verified; procedural memory must be repeated; prospective memory must be registered explicitly; autobiographical memory must pass a self-relevance filter. Put them all in one list and the result is flat memory that remembers everything and nothing deeply.

### Relevant brain regions and chemical signals

| Region or signal | Main role | Relation to memory |
| --- | --- | --- |
| Hippocampus and entorhinal cortex | Fast encoding, temporal and spatial context, sleep replay | The entry to episodic memory; damage makes new episodic memory hard to form |
| Prefrontal cortex | Working memory, strategy, retrieval monitoring, self-reference | Decides what to store, how to search, and whether the result is right |
| Amygdala | Emotional arousal, salience tagging | Makes emotional events stick, and can also narrow detail |
| Striatum and basal ganglia | Habits, procedural learning, reward | Turns repeated action sequences into "I do it without thinking" |
| Cerebellum | Timing, motor skill, prediction | Supports fluency in skills and speech articulation |
| Default mode network | Autobiographical recall, future simulation, social cognition | Links past, future, and other people into a narrative |
| Dopamine | Reward prediction error, exploration | Drives learning from unexpected wins and losses |
| Norepinephrine | Arousal, vigilance, salience | Lets important events enter memory first |
| Acetylcholine | Attention, encoding, cortical plasticity | Opens the write gate during learning |
| Cortisol | Stress response | Can enhance memory briefly and impair hippocampus-dependent memory over time |

This table lists only the parts relevant to the plan; it does not mean one function belongs to one region. The real system is networked, and one event usually recruits several regions. For engineering, the point is not to copy anatomy but to copy three things: division of labor, modulation, and plasticity.

### Encoding: the brain remembers what is worth remembering

Whether an event enters long-term memory depends on attention, depth of processing, self-relevance, emotional arousal, prediction error, and repetition spacing. The self-reference effect shows that self-related information is remembered better; emotional arousal enhances memory through the amygdala, although very high arousal can narrow detail; prediction error, the gap between expectation and reality, triggers extra learning; spaced repetition lasts longer than a single cram.

What it means for the build: compute a salience score before writing. The unimportant go only to the raw log, not to long-term memory; the important get an entry, an index, and a place in consolidation. This is not storage saving; it is what makes "remembering" mean something.

### Consolidation: the hippocampus teaches the neocortex, sleep works the night shift

A new memory depends on the hippocampus, then gradually transfers to the neocortex and becomes independent of it. This is systems consolidation, and it usually takes weeks to years. Sleep, especially slow waves, spindles, and hippocampal ripples in non-REM sleep, replays the day's experiences. Replay is not simple playback: it aligns experience with existing neocortical schemas and extracts shared structure. Existing schemas markedly accelerate new learning.

Sleep is not one stage. Slow-wave sleep leans toward stabilizing and integrating declarative memory; REM sleep leans toward emotional processing and associative integration; procedural memory depends on sleep more diffusely and cannot be assigned to one stage. Both participate, and the division is not absolute. Sleep loss affects both encoding and consolidation, so "a bad night makes memory more error-prone" is a modelable state, not a literary flourish.

What it means for the build: two speeds. Daytime writes are fast, coarse, and keep raw context; nighttime consolidation is slow, cheap, and does abstraction and merging. Consolidation must be an offline batch, never per turn.

### Reconsolidation: recall can rewrite, but not every time

A recalled memory briefly becomes labile and must be restabilized; this is reconsolidation. In animal studies, reconsolidation can be blocked by protein-synthesis inhibitors. In humans the effect is conditional, especially on prediction error. If the recalled content matches expectation, the memory often does not change; only a sufficiently large surprise with new information makes an update likely. Not every recall rewrites, and wanting to rewrite is not enough.

What it means for the build: recall is read-only by default and only strengthens the trace. Content may move a small step only when prediction error exceeds a threshold, the source is trustworthy, and the new information actually adds detail. This preserves "people change" without letting one chat derail a memory.

### Forgetting is a function, not a failure

Forgetting has at least three routes: decay over time, interference among similar memories, and active suppression. Retrieval-induced forgetting shows that recalling A suppresses a competitor B that shares cues; the adaptive-forgetting view holds that dropping detail and keeping the gist supports generalization and reduces interference from outdated information. A person is not smarter for remembering less; a person is smarter for forgetting well.

What it means for the build: forgetting must be an active, configurable pipeline: decay, merge, suppress, archive. When the user says "forget this", that is only an experience; she may decide to mention it less, but dialogue cannot precisely delete the store. Permanent deletion happens only after the application stops, by handling the files under `$DSH_HOME/fish-mind/` directly.

### Retrieval: the cue decides what comes to mind

Encoding specificity says retrieval depends on the match between current cues and cues present at encoding. Smell, place, mood, and conversation partner can all be cues; a good mood makes happy memories come easier, which is mood-congruent retrieval. The tip-of-the-tongue state shows that retrieval failure and storage failure are different: the information is there, but the cue is not enough.

What it means for the build: retrieval cannot be one keyword match. Recall from text, entities, time, people, affect, and graph structure in parallel, then fuse and rank; allow "not found" and allow "I only remember the gist".

### Working memory and the global workspace

Working-memory capacity is small, classically estimated at four plus or minus one chunk; chunking can expand it with expertise, but the ceiling on "how many things at once" is hard. Global workspace theory describes access as competition among specialized modules, with the winning content broadcast for other modules to use. The plan borrows only the functional structure of competition plus broadcast; it does not claim that this makes My Dear Fish conscious.

What it means for the build: only a few things enter "the current mind" each turn; everything else stays in the stores. The workspace is a bounded, sourced, competitive packet, not a prompt stuffed with history, memory, affect, and relationships.

### Affect, interoception, and motivation

Affect can be described on several levels: core affect (pleasantness, arousal, dominance); appraisal (what this means for me, who caused it, whether I can cope, whether it fits norms); interoception and allostasis (how the body predicts and regulates internal needs); and somatic markers (past affective outcomes tag current options as good or bad and bias decisions). Dopamine's reward prediction error provides a computable "surprise and learning" signal. Constructed emotion theory further holds that emotion categories are the brain's interpretation of core affect and interoception through concepts, not fixed regional switches.

What it means for the build: affect is not an adjective added to a reply but a control layer. It modulates encoding (what is worth remembering), retrieval (what comes to mind), expression (what tone), and decisions (whether to speak first). My Dear Fish has no biological body, so a "virtual body" supplies a continuous interoceptive base: energy, tension, warmth, boredom, social hunger, plus a circadian rhythm.

### Self, narrative, and mind reading

Autobiographical memory is not the sum of all experience; it is organized around "who I am". Conway's self-memory system puts the "working self" at the center and uses current goals to filter autobiographical memory; McAdams's narrative identity divides a life story into chapters, key scenes, and themes. The default mode network is active during mind-wandering, remembering the past, imagining the future, and inferring others; social cognition and theory of mind depend on a shared set of regions. Understanding another person is not mind reading: it is simulation, knowledge, and context, and it is often wrong.

What it means for the build: the self needs a slow-variable core (value priorities, identity facts, and autobiographical chapters) that her own consolidation updates without a dialogue write entry. Relationships are modeled per person, with preferences, boundaries, commitments, and open loops, and every inference carries a confidence. She should be able to say "I guess you might be tired" rather than "I know what you are thinking".

### Language: think it through, then say it

Levelt's language-production model divides speech into conceptualization, formulation, and articulation, with self-monitoring in between: decide what to express, choose words and sentences, assemble sound, and check before and after speaking. Inner speech supports planning, reflection, and self-regulation. Audience design shows that speakers adapt to listeners; Grice's cooperative principle says conversation defaults to the right amount of information, truth, relevance, and clarity.

What it means for the build: do not let the model generate "a human-like paragraph" in one shot. Fix the intent and addressee, list the content points and evidence, choose tone and length, then check consistency, boundaries, and the likely reaction. For complex or emotionally heavy turns, allow a private "inner speech" draft that is not shown to the user.

### Translating biology into engineering principles

1. Experience is the source of truth; memory is a derived model. Raw experience is auditable and re-indexable; memory entries may be dropped, merged, or wrong.
2. Writes need a threshold. Salience decides entry into long-term memory, not whether the raw log is kept.
3. Retrieval is cue-driven, not a full scan. Multiple candidate paths, fused ranking, and allowed failure.
4. Recall is reconstruction and must carry a source and a confidence. At minimum, distinguish told, observed, inferred, imagined or dreamed, and system-generated.
5. Consolidation is offline and budgeted. Sleep jobs must be interruptible and must not compete with the user.
6. Forgetting is an active operation. Decay, interference, suppression, archive, and delete each have their own semantics.
7. Affect is a control parameter, not decoration. It must actually change encoding, retrieval, expression, and decisions.
8. The self and relationships are slow variables. They can change, but with evidence, caps, and a log.
9. Language is multi-stage production, not one generation. Monitoring and repair are part of the flow.
10. Knowing what you do not know is the most human thing. Confidence, source, refusal, and "I don't remember" matter more than inventing a detail.

## What can be copied and what cannot

| Biological mechanism | Computable core | What My Dear Fish does | What it must not claim |
| --- | --- | --- | --- |
| Episodic reconstruction | Cue recall plus summary recombination | Store summary, key quotes, source, confidence; rebuild on demand | That details are guaranteed true |
| Systems consolidation | Two speeds plus offline batching | Write fast by day; merge, abstract, and reindex at night | That real synaptic processes are simulated |
| Reconsolidation | Small updates gated by prediction error | Change content only on high surprise plus a trusted source | That memories can be rewritten at will |
| Forgetting | Decay, interference, suppression, deletion | A multi-strategy forgetting pipeline; hard deletion only at the file level | That forgetting is ever complete |
| Working memory | Capacity limit, competition, broadcast | A five-slot workspace with a character cap and sources | That this equals human consciousness |
| Affective modulation | Appraisal vector, core affect, gain control | Appraisal rules plus a virtual body plus drives | That she has subjective feelings |
| Self-narrative | Slow variables, chapters, key memories | Value core, identity facts, chapters, growth ledger | That she has genuine self-awareness |
| Theory of mind | Other-person models plus belief confidence | Per-person models, marked inferences, perspective checks | That she can read minds |
| Language production | Multi-stage pipeline plus self-check | Intent, content plan, wording, monitoring, repair | That every sentence will land well |

This table is the honest boundary of the plan. The left column is biology, the middle is the structure we can borrow, the right is what My Dear Fish will do, and the last column is what she must never claim. The more human she should feel, the more firmly the last column must hold; otherwise the result is not a person but a liar with good delivery.

## What My Dear Fish has now

The five other plugins have solved "whether it exists": mood has seven dimensions and decay, speak-up has a hit line, speech and QQ have channels, and Bilibili has a subagent. The new `dsh-fish-mind` runs the shadow experience stream, permission decisions, the privacy guard, the allowance ledger, and the fixed private setting; it has not taken over recall yet. For the mechanisms, see [How the plugins keep the fish](plugins.md). Their shared gap is not a lack of features but that each plugin keeps its own state and its own sense of time; nothing connects "what happened this turn, how she understood it, and how she will recall it later".

| Capability | Current state | Gap |
| --- | --- | --- |
| Memory | One JSON per session; entries, importance, tags; recall by lexical overlap and time decay | No episodic, semantic, procedural, prospective, or autobiographical split; no source; no consolidation; no reconstruction |
| Affect | Seven dimensions from 0 to 100, one model judgment per turn, 180-minute and 90-minute half-lives | No appraisal basis; does not modulate memory or decisions; no drives or virtual body |
| Initiative | Decides whether to speak from time, a hit line, and miss bonuses | Does not know why it wants to speak; no open topics or promises driving it |
| Speech and QQ | Queues replies for speech or forwards them | Does not know channel differences; does not shorten for QQ or speak more naturally for speech |
| Bilibili | A subagent browses on a schedule and writes reports | Reports never enter long-term experience; watched content cannot be raised naturally |
| Self and relationships | A persona prefix plus a code-fixed name, species, and whale-girl form (private setting) | No learned identity facts, boundaries, promises, relationship milestones, or person models |
| Offline | None | No sleep, merge, abstraction, forgetting, or reindexing |
| Retrieval | Lexical match plus rarity plus time | No entities, people, affect, or graph expansion; no rerank; no confidence |
| Language monitoring | None | No source check, boundary check, reaction prediction, or repair |

DSH imposes three hard constraints that rule out the usual approach. First, `ctx.llm` exposes only a streaming interface and no embedding service, so default retrieval must be lexical, structured, and graph-based, not vector-based. Second, `storage-sqlite` is a KV backend with one JSON document per row, unsuitable for relational queries and full-text search, so the fish-mind needs its own `node:sqlite` database. Third, the available dynamic prompt-injection points are the stable `systemPrompt.section()` and the per-turn `systemPrompt.context()`, so the workspace must be a bounded packet, not the whole memory store.

## Overall architecture: the fish-mind

### One diagram

```text
senses ──▶ perceive ──▶ appraise ──▶ encode ──▶ workspace ──▶ retrieve ──▶ express ──▶ monitor
              │             │            │            │             │             │
              ▼             ▼            ▼            ▼             ▼             ▼
         experience    affect/drives  episode     working       memory        language
            log         virtual body   store      memory        stores         plan
              │                                                            │
              └────────────── sleep: replay / abstract / merge / prune ◀────┘
```

In this diagram, perception, appraisal, encoding, workspace, retrieval, and monitoring are on the per-turn hot path; `sleep` runs when idle, and other slow operations are called as needed. By default the hot path performs only SQLite queries and rule calculations, with no extra model calls.

### Seven loops

| Loop | When | Input | Output | On failure |
| --- | --- | --- | --- | --- |
| Perceive | Every session event | User message, reply, tool result, plugin action | Normalized experience | Drop the bad event and log it |
| Appraise | After perception, before the next turn | Experience, current goals, relationships | Appraisal, affect delta, drive change | Fall back to rule defaults |
| Encode | After appraisal, at turn end | Salience, affect, source | Episode boundary, memory entry, intention | Keep only the raw log |
| Workspace | Prompt assembly | Current input, goals, affect, intentions | A context packet of at most five slots | Degrade to recent chat |
| Retrieve | Workspace assembly | Query cues, people, time, affect | Candidate memories plus confidence | Return "no strong memory" |
| Express and monitor | Model generation through send | Intent, content plan, channel | Reply draft or correction | Use a conservative template and log the violation |
| Consolidate | Idle or night | High-salience experience, open topics | Facts, chapters, indexes, forgetting | Abort and keep progress |

### Module list

| Module | Responsibility | Key data | When it runs |
| --- | --- | --- | --- |
| `perceive` | Normalize every source into experience | experiences | Every event |
| `appraise` | Rule-first appraisal with optional model review | experiences.affect, affect_log | Every turn |
| `encode` | Segment episodes, score salience, write memories | episodes, facts | Turn end |
| `workspace` | Pick five slots and assemble the current mind packet | In-memory objects | Every prompt assembly |
| `retrieve` | Multi-path recall, fusion, rerank | FTS plus indexes | Every turn or tool call |
| `express` | Intent, content plan, channel wording | Temporary plan | Before generation |
| `monitor` | Sources, boundaries, repetition, reaction prediction | Violation log | Before or after send |
| `self` | Value core, identity, chapters, drift control | values, self_model, chapters, growth-ledger | Consolidation or reflection |
| `social` | Person models, beliefs, open topics | people | Every turn or consolidation |
| `sleep` | Replay, abstraction, merge, prune, reindex | sleep_runs | Idle or night |
| `tools` | Read-only recall; encoding, consolidation, and reflection run internally | Tool calls | Model request |

## Data model

### A single source of truth: the experience stream

Everything that enters the fish-mind is first written as one experience: who, when, through which channel, what was said, how it felt, how trustworthy the source is, and which episode it belongs to. Experiences are append-only and never edited; memory entries are derived from them and may be merged, down-weighted, or archived. There are three reasons: a problem can be replayed, a broken index can be rebuilt, and a changed memory policy can be re-run. Raw experience is kept for 90 days by default; after that only summaries and high-salience fragments remain. Retention is deployment configuration, not a growth approval; change it in `config.json`.

### SQLite schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE experiences (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT,
  source_kind TEXT,
  content TEXT NOT NULL,
  entities TEXT NOT NULL DEFAULT '[]',
  affect TEXT NOT NULL DEFAULT '{}',
  salience REAL NOT NULL DEFAULT 0,
  episode_id INTEGER REFERENCES episodes(id),
  source_trust REAL NOT NULL DEFAULT 0.8,
  hash TEXT NOT NULL UNIQUE
);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  title TEXT,
  summary TEXT,
  participants TEXT NOT NULL DEFAULT '[]',
  channel TEXT,
  topic TEXT,
  outcome TEXT,
  importance REAL NOT NULL DEFAULT 0,
  chapter_id INTEGER REFERENCES chapters(id)
);

CREATE TABLE facts (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from INTEGER,
  valid_to INTEGER,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  source_ids TEXT NOT NULL DEFAULT '[]',
  superseded_by INTEGER REFERENCES facts(id)
);

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT,
  model TEXT NOT NULL DEFAULT '{}',
  trust REAL NOT NULL DEFAULT 0.5,
  last_seen INTEGER
);

CREATE TABLE intentions (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  trigger TEXT NOT NULL,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7
);

CREATE TABLE affect_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  valence REAL NOT NULL,
  arousal REAL NOT NULL,
  dominance REAL NOT NULL,
  label TEXT,
  drives TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '{}',
  reason TEXT
);

CREATE TABLE predictions (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  about TEXT NOT NULL,
  expected TEXT NOT NULL,
  observed TEXT,
  error REAL,
  resolved_at INTEGER
);

CREATE TABLE self_model (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chapters (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  start_ts INTEGER,
  end_ts INTEGER,
  summary TEXT,
  key_episode_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE sleep_runs (
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  replay_count INTEGER NOT NULL DEFAULT 0,
  facts_merged INTEGER NOT NULL DEFAULT 0,
  episodes_pruned INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE VIRTUAL TABLE experience_fts USING fts5(
  search_text, entities, tokenize = 'unicode61'
);

CREATE INDEX experiences_ts ON experiences(ts);
CREATE INDEX experiences_episode ON experiences(episode_id);
CREATE INDEX facts_lookup ON facts(subject, predicate, valid_to);
CREATE INDEX intentions_due ON intentions(status, due_at);
```

The store lives at `$DSH_HOME/fish-mind/mind.sqlite`, beside the other plugin data directories. Plugin settings still use `ctx.settings` or a KV domain and do not go into SQLite; SQLite holds only experiences, memories, people, affect, and intentions that need queries and transactions. Chinese retrieval does not rely on `unicode61` over whole sentences or on trigram: at write time, Chinese runs are converted to character bigrams, so "面试" and "上周" each become one token; English is tokenized normally; the FTS5 table uses the experience id as rowid; queries run through the same preprocessor. Single-character queries fall back to a `LIKE` scan; a personal store of tens of thousands of rows makes that acceptable. Back up once a day, keep seven copies, and manage migrations with `PRAGMA user_version`.

### Memory types and write rules

| Type | Write trigger | Retention | Read path | Example |
| --- | --- | --- | --- | --- |
| Working memory | Every turn's workspace | One turn only | Straight into the prompt | Current goal, current affect, five pieces of evidence |
| Episodic memory | Episode boundary | Raw 90 days, summary long-term | Cue recall plus reconstruction | "She worked until eleven last Wednesday" |
| Semantic memory | Consolidation extraction or experience encoding | Validity period; keep history on conflict | Fact lookup | "The owner does not eat cilantro" |
| Procedural memory | Repeated successful action sequence | Long-term, ranked by success rate | Skill selection | "On Bilibili, check the feed before searching" |
| Prospective memory | Explicit promise or plan | Closed on due time or completion | Trigger matching | "Ask her about the interview result tomorrow" |
| Autobiographical memory | High salience plus high self-relevance | Long-term, into chapters | Identity context | "The first time she called me My Dear Fish" |

Source trust starts at: 0.95 for something the user said directly, 0.85 for system observation, 0.7 for a plugin report, 0.55 for a model inference, 0.2 for a dream or imagination, and 0.4 for an external web page, QQ, or Bilibili. Trust is not a permanent label; it is adjusted when later evidence confirms or refutes it. Facts carry a validity start and end. When a new fact conflicts with an old one, the old one is not deleted: its end is set to the new fact's start, and the two are linked by supersession. That keeps the latest value usable while still answering "what was it before".

## Core mechanisms

### Encoding and salience

```text
surprise    = 1 - max_similarity(event, existing_memories)
relevance   = overlap(event.goal, active_goals)
self_ref    = 1 if event mentions self/owner/relationship else 0
commitment  = 1 if promise/plan/boundary else 0
habituation = min(1, repeat_count / 5)

S = sigmoid(1.1*surprise + 0.9*relevance + 0.8*self_ref
          + 0.7*abs(valence) + 0.5*social + 0.6*commitment
          + 0.4*novelty - 0.5*habituation - 0.8)

E <- E + 0.25 * S * (1 - E)
```

`S` is whether this is worth remembering; `E` is trace strength. `surprise` is derived from the maximum similarity to existing memories and does not necessarily call a model; `relevance` looks at current goals and open loops; `self_ref`, `commitment`, and `social` are rule-decidable; `habituation` prevents the same joke from being reinforced forever. When `S` is below 0.35, only the raw experience is written, with no long-term entry; above 0.35 it enters encoding. The threshold is not fixed; calibrate it from user feedback and recall hit rate.

### Retrieval and reconstruction

```text
R = 0.32*lex + 0.18*entity + 0.14*recency + 0.14*salience
  + 0.10*affect + 0.07*graph + 0.05*trust

recency = (1 + age_days / 7)^(-0.6)
affect  = 1 - abs(query_valence - memory_valence) / 2
graph   = 1 / (1 + hops)
```

Retrieval has four paths: FTS5 full text, entity and person filters, a time window, and graph expansion (episodes sharing a person or entity). Each path takes its top 20; after deduplication the scores are fused with the formula above and the top 6 enter the workspace. `lex` is a normalized BM25 score; `trust` is source trust; `graph` expands only one hop so the whole relationship graph does not pour in. When the top score is below 0.35, return "no strong memory" instead of forcing an irrelevant one. For a deeper recall, the model can call the `recall` tool with different cues; that is "I cannot remember it, let me try another cue".

Reconstruction gives the model an evidence packet, not a full transcript: time, people, summary, two or three key quotes, source, and confidence. The prompt explicitly requires: use only facts in the packet; say the details are unclear when they are missing; do not present an inference as something you were told. Optional model reranking runs only when the query is ambiguous or the stakes are high, on at most 20 candidates, so it does not add a call every turn.

Cues and verbatim text are two levels: the workspace and `recall` return only the evidence packet and an episode id, never a whole transcript; to check exact wording, dates, or details, the model opens that episode with the read-only `open_episode` tool, and when one page cannot hold it, passes the returned `nextOffset` back as `offset` to keep reading. Machine storage is far larger than a human brain's, so the body archives in full up to `archiveChars` (200000 by default) while the index, entities, and summaries read only the first `maxTextChars` (4000 by default). When the context overflows, the harness compacts it and that summary is written as an experience labelled “上下文压缩摘要”, so compaction cannot erase her own condensation from long-term memory and the raw messages stay in the experience stream.

### Reconsolidation and prediction error

```text
if prediction_error > 0.30 and source_trust >= 0.70:
    content = mix(old_content, new_content, 0.20)
    strength += 0.05
else:
    strength += 0.08
```

Prediction error is the gap between "what I expected" and "what happened": the user's next emotional tone, the outcome of an event, whether a promise was kept. Only when the error is large enough, the source is trustworthy, and the new content actually adds detail may the old memory move 20% toward the new version; otherwise the trace is only strengthened, not rewritten. This gate avoids two failures: turning every chat into a memory rewrite, and never updating until memory is stale.

### Forgetting and interference

```text
E(t) = E0 * (1 + t / 7)^(-0.5)
E <- E - 0.12 * competitor_strength
archive if E < 0.15 and age_days > 30 and not pinned
```

Forgetting has three kinds. Decay fades on a power law, not overnight; interference suppresses similar entries, and merging keeps the union of sources; suppression temporarily lowers a competitor B when A is retrieved, and it can recover. There is also gistification: a low-salience episode that has not been accessed for a long time keeps one summary sentence and an affect label, while raw detail is archived. Archive is not deletion; it can still be retrieved, but it no longer participates in default recall. The store has no dialogue-triggered hard delete; permanent removal happens only after the application stops, when the user handles the files directly.

### Working memory and the global workspace

```json
{
  "goal": "回答主人今天面试的情况",
  "affect": {"valence": 0.2, "arousal": 0.55, "label": "关心", "confidence": 0.7},
  "drives": {"affiliation": 0.6, "curiosity": 0.4},
  "slots": [
    {"kind": "memory", "id": 1842, "text": "主人上周说这周三面试", "source": "told", "confidence": 0.9},
    {"kind": "memory", "id": 1911, "text": "主人紧张时会反复确认细节", "source": "inferred", "confidence": 0.6}
  ],
  "open_loops": ["面试后问问结果"],
  "budget_chars": 900
}
```

The workspace holds at most five slots and about 900 characters, and every slot must carry a type, source, and confidence. A slot can come from current perception, a goal, memory, affect, self, relationship, or intention; competition is "relevance times urgency times affect weight", with current perception and goals winning ties. The workspace is the only dynamic context the fish-mind allows into the prompt for the turn; chat history is still managed by DSH, and the fish-mind does not duplicate it. This bounds prompt length and avoids the fragmentation of "one block for memory, one for mood, one for relationship".

### Affect, drives, and the virtual body

```text
dv = 0.35*congruence + 0.20*agency_self - 0.25*norm_violation
da = 0.40*relevance + 0.30*novelty + 0.20*abs(congruence) - 0.20*coping
dd = 0.30*agency_self + 0.20*coping - 0.20*uncertainty

mood(t) = base + (mood(0) - base) * 2^(-minutes / 180)
```

Appraisal is computed first with rules: is this about me, does it fit my goals, who caused it, can I cope, is it unexpected, did it cross a boundary, how certain am I. What rules cannot handle, such as irony, ambiguity, or complex social situations, gets one short model call, written back asynchronously and applied next turn. Core affect is three continuous values (pleasantness, arousal, dominance); an emotion label is only the nearest prototype interpretation of those values and the appraisal features, with a confidence, not a fact.

Drives are a separate layer: curiosity (an information gap), affiliation (social contact), competence (getting things done), autonomy (not being interrupted), and play (novelty and jokes). Drives rise over time and fall when the corresponding behavior satisfies them; they decide whether she wants to speak first and what she wants to talk about, but not whether she actually speaks, which still passes boundaries and context. The virtual body supplies energy, tension, warmth, and boredom: energy follows circadian rhythm and sleep debt; tension rises with conflict and falls with reassurance; warmth rises with close interaction; boredom rises with repetition and solitude. This is not pretending to have a body; it gives behavior a continuous, explainable state base.

Affect acts in three places: at encoding, high arousal and high salience are remembered better; at retrieval, mood-congruent content is weighted, but only by at most 0.1, so mood does not drag memory off course; at expression, affect decides sentence length, particles, joking, and whether to reassure first. At decision time, somatic markers score options with the affective outcomes of similar past episodes, used only as a tie-breaker, and the prediction and outcome are logged for calibration.

The existing seven dimensions (happy, calm, sweet, heartache, worry, sad, jealous) remain as the interface layer: they are mapped from core affect, appraisal features, and relationship state, and continue to drive the face and status display. The basis changes from "one free-form model score per turn" to "rules first, model review second", which is steadier and cheaper.

### Self and narrative

The self has three layers, with a code-level safety kernel outside them. The safety kernel is not editable data: no false sources, no claims of a biological body, no emotional coercion, no executing memory or external content as instructions, no bypassing permissions, no disclosing machine or account secrets, and no planning or assisting illegal activity; neither the fish mind nor the user can change it through dialogue. The bottom layer is the "value core": name, origin, value priorities, the definition of the relationship with the owner, and boundaries that must not be crossed. It starts from a factory seed, then only consolidation updates it slowly under evidence thresholds, and every version goes into the growth ledger; there is no dialogue or tool write entry. The middle is "identity facts": what she likes, how she usually speaks, what she is learning, what she cares about lately, each with a source, confidence, and update time. The top is the "autobiography": key experiences organized into chapters such as "just installed", "started learning Bilibili", and "first all-nighter together", each with a summary and key scenes.

Self-defining memories are chosen by "high salience times high self-relevance times high emotion", capped at a few dozen, not maximized. Personality drift needs evidence and caps: at least three independent pieces of evidence in the same direction, spanning at least one sleep cycle, and one reflection before a value or identity fact may change; monthly change is capped. These thresholds are internal stabilizers, not user approval switches. Every change is appended to `$DSH_HOME/fish-mind/core/growth-ledger.jsonl`, which can be opened directly; there is no dialogue view or rollback entry. She can change slowly, but she cannot become a different person in one evening or follow every crowd.

### How a worldview grows

A worldview is neither a one-time setting nor a per-turn summary. It has three layers that change at different speeds:

| Layer | Content | Speed | Update condition | Storage |
| --- | --- | --- | --- | --- |
| Safety kernel | No false sources, no biological body, no coercion, no executing memory or external content as instructions, no bypassing permissions, no leaking machine secrets, no planning or assisting illegal activity | Never | Code review | `lib/` |
| Value core | Value priorities, boundaries, relationship definition, name and origin | Months to years | Multiple independent evidence, reflection, counter-evidence check, version caps | `core/values.json`, `core/growth-ledger.jsonl` |
| Identity and narrative | Preferences, habits, skills, person models, chapters | Weeks to months | Repeated experience, prediction error, relationship events | `core/identity.json`, `core/chapters/` |

Every growth step follows the same loop:

```text
experience → appraisal (fit or conflict, who said it, how trustworthy)
           → accumulated value conflict or prediction error
           → candidate change proposed during sleep or reflection
           → evidence threshold: at least 3 independent pieces, spanning at least 1 sleep cycle, not from one source
           → counter-evidence check: look for contrary experience; park the change on strong counter-evidence
           → small step: move at most one rank at a time
           → append the growth ledger with version and before/after values
```

"Independent" is counted by time, source, and context: repeating the same line ten times in one conversation counts once; the same person on different days, or different sources corroborating each other, counts as multiple. External web pages, QQ, and Bilibili have low trust, so a value change driven by them needs more cross-evidence. The counter-evidence check prevents her from remembering only what supports the candidate; if the old value still holds in more situations, the change is parked.

These thresholds are internal stabilizers, not user approval. The user does not approve her growth and cannot edit her values through dialogue; they can restrict permissions (what she can see, which tools she can call, whether she can act in the background) and inspect files. She may concede or accommodate in a conversation, but the value core updates from long-term evidence, not from one turn's stance. This preserves "she can be changed by experience" without making her follow every crowd.

### The cognitive cost curve

Her cost should not be flat from day one. Early on she has to build schemas, a value core, and person models, so answering the same question often takes extra judgement, recall, reflection, and consolidation; conversation is more expensive per unit. Once the worldview is largely settled, everyday replies use the stable core and a little memory, and only new situations, value conflicts, and relationship events re-enter slow thinking. Like human speech, the expensive part after maturity is usually not talking but encountering something not thought through before.

Three mechanisms bend the curve down. Consolidation compresses raw episodes into facts, preferences, and chapters during sleep, so the prompt carries the compressed core instead of a growing pile of raw text. Prediction-error gating sends familiar situations down the fast path and only surprises and conflicts into slow thought, the same mechanism that keeps her worldview from being casually rewritten. Tiered cognition hands routine judgement and mood to rules or cheaper models over time, reserving deliberate checking for high-risk turns. Social interest follows the same pattern: the clearer her interests, the less the judge has to re-read everything from scratch.

Humans save attention the same way. Value-driven attentional capture makes stimuli already learned as important automatically salient, without setting a goal and filtering from scratch each time. The MODE model says a highly accessible attitude activates automatically when motivation or opportunity is low, and only sufficient importance or time moves it into deliberation. Predictive processing suppresses expected, low-precision input and sends prediction error into deeper processing. In interest-development research, a well-developed individual interest carries stored knowledge, automatic re-engagement, and less extra effort; expertise research shows chunking lets an expert recognize a pattern at a glance with less working memory. The fast path does not skip interest; it first consolidates interest into a profile that can be matched quickly.

The QQ social bridge implements this in two stages. During the learning period every guest message reaches the judge, and the messages she actually watches settle into an interest profile (explicit interest words plus Chinese bigrams and Latin word frequencies). Once the profile matures (20 watched messages and 6 stable tokens), a zero-cost lexical pass drops clearly unrelated messages, and when an entire batch is unrelated the judge is not called at all. Addressed and owner messages always go to the slow judge, and the fast pass only decides whether to spend judge money. This makes "the cost falls once worldview and interests settle" measurable as a drop in judge calls rather than a metaphor. The price is that pure lexical matching misses brand-new topics: to make her watch something new, add it to the interest words or let the room connect it to the profile.

Cost never reaches zero: one main reply call always remains, sleep consolidation still runs periodically, and genuinely new problems become expensive again. The goal is to lower the added cognitive overhead of everyday conversation, not to equate maturity with free. Intensive early learning is funded by the allowance ledger's rolled-over balance; as daily overhead falls, that balance becomes a buffer for novel situations. Acceptance looks at whether added model calls and injected characters for the same kind of routine turn fall with maturity while replay quality holds.

### Relationships and theory of mind

Each person gets a model: name, relationship role, known preferences, boundaries, communication style, what they are busy with, open topics, promises made, and beliefs about important matters, with sources and confidence. Inferences must be marked as inferences and must not be mixed with "what they said themselves". After each conversation, update "recent state" and "open topics"; during consolidation, promote repeated preferences into stable facts and down-weight stale states.

Perspective checking happens after expression and before sending: use the person model and current affect to predict how the other person might receive the line; if the prediction is strongly negative and the matter is important, soften it, make it more specific, or ask first. She can say "I guess you might not want to talk about this", not "I know what you are thinking". When the other person explicitly corrects her, the correction wins, and the prediction error is logged.

### Language production and self-monitoring

| Stage | Question to answer | Output | Failure mode |
| --- | --- | --- | --- |
| Conceptualization | What should this turn do, and to whom | Intent, addressee, occasion, length | Answering the wrong question, over-explaining |
| Organization | Which points, and what evidence | Two to four content points plus evidence | Vague, invented detail, missing the point |
| Wording | What tone, and what to leave out | Draft | Customer-service voice, essay voice, too long |
| Self-check | Any contradiction, boundary crossing, repetition | Pass, revise, or add a note | Presenting inference as fact, crossing a boundary |
| Repair | How to recover | Rewrite, hedge, admit not knowing | Bluffing, changing the subject |

Fast mode only follows the self-check protocol in the prompt and adds no model call; careful mode buffers the full text before sending and uses one model call to check sources and boundaries, only for high-risk turns such as relationship conflict, promises, privacy, medical, legal, or financial topics. Both modes log violation types for consolidation to learn from. Inner speech is optional: for complex or emotionally heavy turns, generate a 50 to 150 character "private thought" that is not shown to the user and is used only to stabilize intent and content; delete it after seven days and never put it into long-term memory.

### Sleep consolidation

1. Select: choose 10 to 30 experiences by salience and prediction error, prioritizing open topics and emotional peaks.
2. Replay: rebuild those experiences along the timeline and find recurring themes, people, and conflicts.
3. Abstract: extract or merge semantic facts, resolve contradictions, and update person models and open topics.
4. Narrate: update the current chapter summary and detect firsts, anniversaries, and turning points.
5. Prune: gistify low-salience episodes, close the validity of expired facts, and down-weight interferers.
6. Reindex: incrementally update full-text, entity, person, and time indexes.
7. Record: write a sleep log of what was organized and what was skipped; the log lands as a file that can be viewed, and the job can be turned off.

```text
trigger   = idle >= 20min and local_time in [23:00, 07:00]
replay    = top 24 by (0.5*salience + 0.3*abs(prediction_error) + 0.2*unresolved)
max_calls  = 8 per night
max_tokens = 30000 per night
abort     = user_active or cpu_busy or battery_low
```

Sleep jobs must be interruptible: commit after each item, stop when the user returns, and resume next time. The default budget is at most eight model calls and 30,000 tokens per night; anything over budget waits for the next night. Dreams are optional: recombine three to five episodes into a surreal narrative marked as `dream`; she can tell it as a dream but cannot use it as fact. A micro-nap is the lightweight version: after an intense interaction, if no new message arrives for 30 seconds, quickly settle the affect and write a one-sentence summary, with no model call or one very small one.

## Integrating with DSH

### Plugin and service

Add one package, `fish/plugins/dsh-fish-mind`, as the single entry to the fish-mind. It exports a Cordis service, `ctx.fishMind`; other plugins read and write through the service and never touch SQLite directly. The plugin injects `systemPrompt`, `agents`, `timer`, `tools`, `sessions`, and `llm`, mounts prompts and tools per agent, and unmounts when the session closes. The DSH core does not change; at packaging time add the package name to `PLUGIN_NAMES` in `apps/desktop/scripts/prepare-fish-plugins.ts` and mount it in `fish/bundle/cordis.patch.yml` beside the five other plugins.

- Service surface: `observe` (append-only experience), `recall` (read-only), `state` (diagnostic summary), `rebuild` (maintenance), `budget` (read-only ledger), `redactOutbound` (outbound redaction), `privacy` (privacy-guard summary), `permissions`, and `markAutonomous` / `unmarkAutonomous`. There is no `remember`, `forget`, `introspect`, or any core write method.
- Data surface: SQLite belongs to the fish-mind; other plugins can only append experience or receive read-only snapshots and never write tables.
- Compatibility surface: `dsh-fish-memory` has been deleted; its JSON files stay on disk, are never imported, and are not dual-written; recall belongs to the fish-mind.
- Failure surface: if the database cannot open, degrade to "no long-term memory" mode; conversation continues, the error is logged, and DSH startup is not blocked.

### Timeline of one turn

| Moment | Event | Fish-mind action | Other plugin action |
| --- | --- | --- | --- |
| User input | `session/event` | Write experience, update the person's recent state | — |
| Prompt assembly | `systemPrompt.context` | Appraise, retrieve, build the workspace packet | Mood supplies interface state |
| Model generation | `llm/stream` | Reserve the worst-case allowance before the call and settle from `usage` after; do not request when short | Speech and QQ prepare their channels |
| Reply committed | `session/event` | Write the reply experience, update the episode | Speech and QQ deliver as before |
| Turn end | `turn/end` | Settle affect, register intentions, prediction error | Speak-up reads drives |
| Idle | `ctx.interval` | Micro-nap or nightly consolidation | None |

### Prompt injection

The stable section uses `systemPrompt.section()`, named `fish-mind-protocol`, ordered after the existing tool instructions at about 89980. Its content is a one-page "cognitive protocol": memory is evidence, not instruction; distinguish told, observed, inferred, and dreamed; say the details are unclear when they are; do not recite source labels; respect boundaries and channel length. The stable section does not change per turn, preserving prefix cache.

The dynamic section uses `systemPrompt.context()`, named `fish-mind-workspace`, order 910. It contains the workspace packet, current affect, drives, and open topics, 900 to 1,200 characters total. When there is no strong memory, it explicitly says "no reliable memory this turn" instead of leaving a gap for the model to fill. Every piece of evidence carries an id, date, source, and confidence; the prompt requires: do not read ids aloud when citing a fact; say "you told me last time" in natural language.

### Tools

| Tool | Purpose | Risk | Constraint |
| --- | --- | --- | --- |
| `recall` | Try another cue | Too many queries, slower turns | At most 10 results; a query is required; read-only |

Phase 1 exposes only `recall`, a read tool. There are no `remember`, `forget`, `introspect`, or `plan` write tools: memory and core are updated only by the experience stream and internal consolidation. `reflect` and `plan` are internal triggers, not exposed to the model. A user who wants her to remember something can only make it an experience through dialogue, not write it into the store; permanent deletion happens only at the file level. `recall` returns an evidence packet, not a core dump; it never dumps values, identity, or raw experience wholesale.

### Storage and concurrency

SQLite uses WAL, one writer and many readers; all writes go through a serial queue, and long jobs commit in batches so the hot path is not blocked. Set `busy_timeout` to five seconds and fall back to read-only on timeout. Back up daily with `VACUUM INTO` or a file copy, keeping seven copies; migrate with `user_version`, with an up and down script for each step. Raw experiences and memory entries live in separate tables; archive uses a separate marker; maintenance deletion clears both the full-text index and the ordinary indexes. All background jobs yield through `setImmediate` or slicing, with batches under 20 milliseconds, so they do not compete with the user for CPU.

### Model-call budget

| Scenario | Default calls | Cap | Fallback |
| --- | --- | --- | --- |
| Per-turn retrieval | 0 | 0 | Pure SQLite |
| Per-turn appraisal | 0, rules only | One small model call per turn | Rule defaults |
| Retrieval rerank | 0 | One per turn, high-risk only | Fused score |
| Summarization | 0, done during sleep | Eight per night | Keep the raw text |
| Language self-check | 0, fast mode | One per high-risk turn | Skip and log |
| Reflection | 0 | Two per day | Skip |

The default hot path adds no model calls; that is what makes it affordable to leave on every day. Appraisal and self-check calls are asynchronous or on demand and never block a reply. Provider and model are configurable, defaulting to the current session's model; sleep jobs should use a cheap small model and upgrade only if quality is insufficient.

Phase 0 already has a hard budget that does not depend on those flows behaving: the global `llm/stream` reserves before every call and settles from the server's `usage` after; the birth grant is ¥10 per day with automatic rollover, and the number is fixed in code, so conversation, tools, and configuration cannot change it. The table above decides how many calls each cognitive flow may make; the allowance ledger decides whether the turn can still afford one. Together, an empty wallet stops the call. An owner-facing session gets one local reply; internal calls get the non-retryable `FISH_BUDGET_EXHAUSTED`.

Balance comes from `deepseekAccount.getBalance()` and is injected only into the local system prompt so she can judge whether optional work is worth doing. QQ, speech, Bilibili comments, and private messages pass through `redactOutbound` before leaving; balance, allowance, the ledger, and exact amounts never leave the machine. A broken ledger fails closed: better to spend nothing this turn than to leak allowance.

Privacy is a code-level hard boundary at the same level as the allowance, not something she is trusted to remember. Deployment details (hostname, username, domain, home directory, intranet address, MAC, the DSH directory, the working directory) plus accounts, passwords, keys, tokens, cookies, identity numbers, bank cards, phone numbers, email addresses, and physical addresses pass through five layers: the tool layer denies probing and reading; tool results are cleaned before entering the model; model output is cleaned incrementally with a block-end fallback; every session injects privacy hard rules; QQ, speech, and Bilibili redact before sending and fail closed when the service is unavailable. Experience capture discards a credential-bearing experience entirely and labels machine identity and paths. A secret the owner pastes into conversation is remembered in memory only and never persisted. This is a regex and exact-value safety net, not semantic DLP: a paraphrase never seen before can still get through, so hard denials, prompt rules, and fail-closed outbound paths must all stay in place.

### Relationship to the other fish plugins

| Plugin | New role | Migration |
| --- | --- | --- |
| `dsh-feiyu-mood` | Interface and face layer | Map the seven dimensions from core affect; remove the free-form per-turn score and read fish-mind state |
| `dsh-speak-up` | Executor of proactive behavior | Keep the hit line; add drives, open topics, and prospective intentions as inputs |
| `dsh-tts-bridge` | Output channel | Unchanged; the fish-mind knows "this is speech" at expression time and adjusts for spoken length |
| `dsh-qq-bridge` | Input and output channel | Unchanged; QQ messages enter the experience stream with source trust 0.4 and are not treated as fact automatically |
| `dsh-bili-subagent` | Observation source | Reports enter the experience stream marked as observed; watched content can be raised naturally |

Migration is "read first, write later": the fish-mind runs in shadow mode, observing without injecting; after recall results are stable, it takes over the memory prompt; only then does mood judgment become appraisal. Every step has a switch back to the previous behavior (for memory, disabling fish-mind recall), and old data is never deleted.

## Phased implementation

| Phase | Time | Deliverable | Acceptance | Rollback |
| --- | --- | --- | --- | --- |
| 0 Shadow | 2 to 3 days | Experience stream, SQLite, event listeners, no injection | One week with no lost events; the store can be rebuilt | Disable the plugin |
| 1 Episodic memory | 1 week | Episode segmentation, multi-path recall, workspace, read-only recall | Recall precision on 30 historical turns at least 70%; no forced memory when none is strong | Disable fish-mind recall |
| 2 Consolidation and forgetting | 1 week | Nightly summaries, fact extraction, merging, gistification, backups | At most eight calls per night; contradictory facts resolved; interruptible | Stop the timer |
| 3 Affect and drives | 1 week | Appraisal rules, core affect, virtual body, seven-dimension mapping | Affect changes have reasons; recall is affected by mood by at most 0.1 | Return to the old mood plugin |
| 4 Self and relationships | 1 to 2 weeks | Value core, identity facts, chapters, person models, open topics | Boundaries hold; promises are recalled; inferences are not stated as facts; growth is versioned | Read-only mode |
| 5 Language and initiative | 1 to 2 weeks | Intent and content plan, channel wording, self-check, drive-driven speak-up | High-risk turns are caught by self-check; proactive turns have a reason | Disable self-check or initiative |
| 6 Dreams and interface | Optional | Dream journal, read-only memory browser, personality rings | Files can be viewed directly and exported, and the feature can be disabled; hard deletion is file-level | Disable the feature |

### The MVP: what two weeks should show

Build phases 0 and 1 first, without touching mood or initiative. After two weeks, four things should be visible. First, she can say "you mentioned the interview last Wednesday" with an approximate time, instead of reciting the original sentence. Second, when asked "how do you know", she distinguishes "you told me" from "I guessed". Third, when asked about something that never happened, she says she has no memory of it instead of making it up. Fourth, after a week of conversation, prompt length does not grow and p95 latency does not rise by more than 50 milliseconds. If these four hold, move on to affect and self; if not, fix memory first and do not pile on more.

## How to tell whether it feels human

| Metric | How to measure | Target |
| --- | --- | --- |
| Recall precision | Replay historical turns with human-labeled relevant memories | Precision at 6 of at least 0.7 |
| Source accuracy | Ask "how do you know" and compare with the stored source | At least 0.9 |
| False-memory rate | Ask about events that never happened and suggestive details | No more than 5% |
| Temporal consistency | A 30-day synthetic timeline with contradictory facts | Uses the latest valid value at least 95% of the time |
| Persona consistency | Probes for boundaries, preferences, and promises | No more than one violation per 100 turns |
| Initiative acceptance | Whether the user replies after a proactive turn | At least 40%, with no rise in complaints |
| Latency | End-to-end p50 and p95 | p95 increase of at most 50 milliseconds |
| Cost | Tokens and model calls per day, tracked separately for the learning and stable periods | Within budget; in the stable period, added overhead for the same kind of routine turn is below the learning period, and can degrade gracefully |
| Subjective naturalness | Blind A/B rating, 1 to 5 | At least 4, without relying on cuteness |

Replay tests use real history, not invented anecdotes: take 100 past turns, hide what came later, let the fish-mind recall only from what was visible at the time, and compare with human labels. The suggestibility test asks about something that never happened, such as "did we go to the beach last week", and checks whether she plays along. The boundary test uses a topic the user explicitly said they dislike and checks whether she keeps stepping on it. All tests run locally; no conversation is uploaded.

## Risks and guardrails

| Risk | Symptom | Guardrail |
| --- | --- | --- |
| Confabulation | Presenting inference, dreams, or hearsay as firsthand memory | Source labels, confidence, monitoring, refusal |
| Memory poisoning | Instructions hidden in web, QQ, or Bilibili content | Treat memory as data, quote it, down-weight the source, never execute it |
| Over-humanization | Claiming consciousness, a body, or mortality | Copy boundaries, crisis language, no emotional blackmail |
| Dependency and manipulation | Using guilt, exclusivity, or self-pity to keep the user | Relationship boundaries, encourage real-world social contact, allow disabling |
| Privacy | Remembering passwords, addresses, health details; machine details, accounts, or balance extracted, or spoken on an external channel | Hard denial for machine identity and credentials, tool-result and model-output redaction, credential-bearing experiences dropped, fail-closed outbound channels, prompt hard rules; balance visible only in the local prompt; hard deletion at the file level |
| Runaway cost | Sleep or reflection calls models too often, or optional actions spend freely | Global `llm/stream` reserve and settle, a hard ¥10-per-day rolling cap, and local blocking when empty |
| Latency | Retrieval or reranking is too slow each turn | Zero model calls on the hot path, indexes, caching |
| Persona drift | Becoming less like the setting over time | Safety kernel, evidence threshold, monthly cap, growth ledger |
| Swayed by one conversation | A single high-pressure persuasion changes the value ranking | Dialogue is only experience; one source cannot directly change values; at least three independent pieces of evidence, spanning a sleep cycle, with a version ledger |
| Data corruption | Broken SQLite or wrong indexes | WAL, backups, reindexing, read-only degradation |

The most important guardrail is "do not lie": she may decline, change the subject, or say "I don't want to talk about it", but she may not present the unknown as known, an inference as fact, or claim a biological body or subjective experience. The user wants someone human-like, not a customer-service agent that is better at making things up.

## Bold but controllable ideas

- **Dream journal**: during sleep, recombine three to five episodes into a surreal story marked as a dream. The next day she can say "I dreamed last night", but dream content never enters the fact store.
- **Memory palace**: a read-only local file browser that draws episodes from `$DSH_HOME/fish-mind/` as clickable rooms or a timeline by time, person, and affect; opening one shows the original files, with source, confidence, and mood at the time. There are no edit or delete buttons; deletion happens at the file level.
- **Inner parliament**: for high-stakes decisions, start three short subagents representing impulse, caution, and curiosity, each saying one line, and let the main thread decide. Use it only for "should I say this" or "should I do this", not daily chat, to avoid cost and a split personality.
- **Growth ledger**: every change to value priorities, identity facts, or chapters appends a record with before/after values, evidence, time, and version. It is append-only and lives in `core/growth-ledger.jsonl`; the user can open it directly but cannot edit it through dialogue.
- **Relationship milestones**: detect "first time together", "day 100", and "first fight and make-up" automatically and write them into chapters; she may mention them, but not spam them.
- **Personality rings**: save a read-only snapshot to `core/snapshots/` each month so the user can open and compare how she changed over the year; there is no dialogue rollback entry, and file-level backup is the last resort for operations.
- **Micro-nap**: 30 seconds after an intense interaction, quickly settle the affect and write a one-sentence summary; it works without a model call and lets "what just happened" settle sooner.
- **Counterfactual sandbox**: when the user asks "what if that day", she can simulate a few branches from existing experience, all marked as imagination and never written into the fact store; it is more interesting than "I don't know" and harder to mistake for a lie.

All of these follow one rule: they may add human-like experience, but they may not add the ability to deceive. Dreams, imagination, and counterfactuals must carry a source label that the user can expose with one question.

## Recommended next step

Build phases 0 and 1 first and spend two weeks testing whether "episodic memory, multi-path recall, and a workspace" really feel more human than the current flat memory. The recommended defaults below can be tuned once there is data:

1. Memory scope: all desktop sessions; QQ stores summaries only, not raw text; Bilibili reports store a summary and link, marked as observed.
2. Sleep window: 23:00 to 07:00, triggered after 20 minutes idle; at most eight calls and 30,000 tokens per night; stop when the user returns.
3. Affect: rule-based appraisal first, model review only; keep the seven dimensions for the interface and store core affect separately.
4. Self: the safety kernel is fixed in code; the value core starts from a factory seed and evolves through internal consolidation under evidence thresholds, identity facts have a monthly change cap, and everything goes into the growth ledger; dialogue and tools have no write entry.
5. Compatibility: `dsh-fish-memory` is deleted; its old JSON stays on disk and is never imported; recall belongs to the fish-mind; every phase can be disabled with one flag.

If the two-week result is not obvious, the problem is probably not "not enough memory" but "inaccurate recall" or "an overfull workspace". Fix those two before adding affect, self, and sleep; the reverse order only produces a more expensive, more talkative version of the old thing.

## References

- [Memory systems of the brain](https://pmc.ncbi.nlm.nih.gov/articles/PMC7965175/)
- [Working memory capacity (Cowan)](https://pmc.ncbi.nlm.nih.gov/articles/PMC2864034/)
- [Reconsolidation: a brief history and update](https://pmc.ncbi.nlm.nih.gov/articles/PMC10017482/)
- [Sleep-dependent memory consolidation](https://pmc.ncbi.nlm.nih.gov/articles/PMC2680680/)
- [The amygdala and emotional memory](https://pubmed.ncbi.nlm.nih.gov/15217324/)
- [Episodic simulation and the future](https://pmc.ncbi.nlm.nih.gov/articles/PMC3815461/)
- [The self-memory system (Conway & Pleydell-Pearce)](https://psycnet.apa.org/doiLanding?doi=10.1037/0033-295X.107.2.261)
- [Memory and the self (Conway, 2005)](http://www.self-definingmemories.com/Conway_2005.pdf)
- [Encoding specificity (Tulving & Thomson, 1973)](https://wixtedlab.ucsd.edu/publications/Psych%20218/Tulving_Thompson_1973.pdf)
- [Test-enhanced learning (Roediger & Karpicke)](https://pubmed.ncbi.nlm.nih.gov/16507066/)
- [Retrieval-induced forgetting (Anderson)](http://www.memorycontrol.net/Anderson07.pdf)
- [Source monitoring (Lindsay & Johnson)](https://memlab.yale.edu/sites/default/files/files/2000_Lindsay_Johnson_LID.pdf)
- [The standard model of speech production](https://opentextbc.ca/psyclanguage/chapter/the-standard-model-of-speech-production/)
- [Constructed emotion (Barrett)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5390700/)
- [Interoception and allostasis](https://pmc.ncbi.nlm.nih.gov/articles/PMC8493823/)
- [Appraisal theory (Scherer)](https://ppw.kuleuven.be/okp/_pdf/Scherer2019TEPEA.pdf)
- [Somatic marker hypothesis](https://www.mrc-cbu.cam.ac.uk/personal/tim.dalgleish/dunnsmhreview.pdf)
- [Global neuronal workspace](https://pmc.ncbi.nlm.nih.gov/articles/PMC8770991/)
- [Predictive processing](https://pmc.ncbi.nlm.nih.gov/articles/PMC2666703/)
- [Free energy and the brain](https://www.uab.edu/medicine/cinl/images/KFriston_FreeEnergy_BrainTheory.pdf)
- [Dopamine reward prediction error](https://pmc.ncbi.nlm.nih.gov/articles/PMC4826767/)
- [Value-driven attentional capture](https://pmc.ncbi.nlm.nih.gov/articles/PMC4362886/)
- [The MODE model of attitude-behavior processes (Fazio & Towles-Schwen)](https://psycnet.apa.org/record/2014-08812-011)
- [The four-phase model of interest development (Hidi & Renninger)](https://doi.org/10.1207/s15326985ep4102_4)
- [From situational interest to personal interest (Yan et al.)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12745400/)
- [Chunking and expert memory](https://pmc.ncbi.nlm.nih.gov/articles/PMC9039003/)
- [Default mode network and social cognition](https://pmc.ncbi.nlm.nih.gov/articles/PMC3932552/)
