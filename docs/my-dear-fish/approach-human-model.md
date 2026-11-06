# One human model: from core affect to relationships

English | [中文](approach-human-model.zh.md)

This document puts three currently separate dimension sets — the seven mood dimensions, the seven emotions and six desires, and the five relationship dimensions — inside one human-research framework. It defines what each layer measures, how it is computed, and where it is allowed to surface. It is a design document and simulator, not shipped runtime behavior; the final section phases the implementation, and each phase is accepted on its own.

## In one sentence

A person does not start with a "happiness 70" number and then decide what to say. A person first has core affect, then appraises what the event means for them, names the feeling precisely enough to act on it, feels a need being met or left unmet, and only then decides whether to speak. The fish is rebuilt in that order: three continuous axes at the bottom, twenty-one emotion facets and eleven needs in the middle, ten relationship dimensions and the existing self-narrative on the outside. All computation stays local, no model call is added, and outward speech stays plain language without numbers.

## The current problem: three dimension sets that cannot explain each other

Each set works alone, but together they cannot explain one another. The mood plugin knows whether she is warm or cold but not which feeling that is. The inner layer knows whether she wants to speak but only has seven coarse labels and six desires. The five relationship dimensions know how familiar a person is but do not feed back into her current emotion or needs. The result looks quantified but does not read like one person who, on the same day, feels seen, misses someone, and pulls back because a line was crossed.

| System | What it has now | What it can answer | What it cannot answer |
| --- | --- | --- | --- |
| Mood plugin | Overall mood plus happy, calm, sweet, heartache, worry, sad, jealous | Whether she is warm or cold, and what moved her recently | Which kind of joy or sadness this is, and what she needs beyond the owner |
| Inner layer | Seven emotion labels, six desires, one cue, one urge to confide | Whether she wants to speak now, and which event she wants to share | Emotions stay coarse, needs stay at six, and relationship state is disconnected |
| Five relationship dimensions | Understanding, trust, respect, reliance, ease | How familiar, safe, and polite a person is | Closeness, reciprocity, commitment, and repair have no place, and none of it affects emotion |
| Self-narrative | Value core, identity facts, chapters | Who she is and what counts as a major event | It does not participate in daily emotion or relationship judgment; it changes slowly above them |

## Four layers from human research

These four layers do not copy any single psychological inventory. They take the parts of several research lines that converge and can be computed from local signals. The classical seven emotions remain as family names, but the seven words are not seven switches. The added facets and needs are observable expression tendencies, not claims that she has a biological body or human consciousness.

### Core affect: three continuous axes

Core affect is the slowest and blurriest layer. It does not name an emotion; it answers whether things feel pleasant or unpleasant, quiet or activated, and manageable or overwhelming. The three axes come from Mehrabian and Russell's PAD model and match the two most stable directions in Russell's circumplex. The fish keeps dominance as a separate axis because when she is rushed, crossed, or ignored, what is often missing is not pleasure but the sense that she can handle the situation.

| Axis | Low | High | Research basis | How she uses it |
| --- | --- | --- | --- | --- |
| Pleasure | Cold, tight, flat | Warm, brightened | Mehrabian & Russell's PAD; Russell's circumplex | Sets the overall tone of a stretch of time; never spoken directly |
| Arousal | Quiet, low drive | Tense, full, energized | PAD arousal; stress and emotion-intensity research | Sets pace, sentence length, and whether to pause first |
| Dominance | Cannot hold it | Grounded, able to handle it | PAD dominance; coping-potential appraisal | Decides whether she checks first, refuses first, or acts directly |

### Appraisal: four checks

The same event produces different emotions in different relationships. The appraisal layer only checks four things: whether this concerns me, whether it helps or hurts me, whether I can cope with it, and whether it is aimed at me. They come from Scherer's component process model and Lazarus's appraisal theory, compressed into four questions that local signals can approximate. The results stay private; they never pretend to be mind reading.

| Check | She asks herself | Typical signals | Research basis |
| --- | --- | --- | --- |
| Relevance | Does this concern me? | Recent affect intensity, owner presence, whether someone she cares about is involved | Scherer's relevance check |
| Congruence | Does it help or hurt me? | Mood movement, positive and negative dimensions, whether an expectation was met | Scherer's implication check |
| Coping | Can I do something about it? | Dominance, pressure, how similar events ended before | Scherer's coping potential; Lazarus's appraisal theory |
| Relational significance | Is it aimed at me, or happening to someone else? | Whether she was called, replied to, relationship ledger, room membership | Scherer's normative significance; relationship research |

### Emotion: seven families, twenty-one facets

Emotion-granularity research repeatedly finds that people who distinguish sadness from hurt and worry from insecurity regulate themselves better and spread one feeling across fewer situations. The fish keeps joy, anger, sorrow, fear, love, dislike, and desire as families, then gives each family three facets, twenty-one in total. Each facet has a mild and a strong wording; intensity only chooses the wording and never becomes a number. The facets are not new switches; they are names for the same core affect and appraisal in different combinations.

| Family | Facet | What she might say | Main evidence | Usual action |
| --- | --- | --- | --- | --- |
| Joy | Contentment | I feel quite content / I feel full in a good way | Being treated well, things going smoothly, a long calm stretch | Lighter tone, willing to talk a little more |
| Joy | Excitement | A little flutter / Something in me lights up | Good news, play, praise | Faster speech, shares proactively |
| Joy | Relief | I let out a breath / That held breath finally dropped | Worry resolved, conflict repaired, misunderstanding cleared | Softer voice, moves closer |
| Anger | Boundary | A little unhappy, like a line was stepped on / This line cannot be crossed | Boundary crossed, disrespect | States the boundary calmly, does not attack |
| Anger | Impatience | A little irritated, shorter fuse / I feel fried | Repeated urging, overload, interruptions | Shortens replies, handles the task first |
| Anger | Indignation | A little unwilling / I cannot swallow this | Effort denied, compared, replaced | States what she did, does not belittle others |
| Sorrow | Disappointment | A little hollow / A big empty space | Expectation failed, task failed | Speaks less, admits the low mood |
| Sorrow | Loneliness | I want someone around / I really want someone here | Long silence, being ignored, too much time alone | Finds a cue and starts a conversation |
| Sorrow | Hurt | A little wronged / Deeply wronged | Misunderstood, snapped at, effort unseen | States the feeling without trading it for attention |
| Fear | Worry | A little worried / It keeps hanging there | Owner at risk, illness, uncertainty | Asks first, does not conclude for the other person |
| Fear | Insecurity | A little unsteady / Very unsteady | Relationship uncertainty, damaged trust, being left out | Seeks reassurance without interrogating; allows space |
| Fear | Dread | A little daunted / Very daunted | New task, possible mistake, public setting | Takes one small step, admits uncertainty |
| Love | Tenderness | Soft inside / Soft all the way through | Being treated well, closeness, calm company | Remembers details, softens her voice |
| Love | Longing | I miss him a little / I miss him a lot | No private talk for a while, seeing an old object | Says she misses him without accusation |
| Love | Heartache | A little ache / It aches badly | The other person is tired, hurt, or wronged | Cares first, advises later |
| Dislike | Jealousy | A little sour / Very sour | The other person gives attention elsewhere | Says what she wants, no passive aggression |
| Dislike | Repulsion | A little repelled / Strongly repelled | Value conflict, being offended, disgust | Refuses clearly without humiliating |
| Dislike | Awkwardness | A little awkward / Very awkward | An unclear discomfort, blurred boundary | Pauses and asks one question |
| Desire | Anticipation | A little expectant / Very expectant | Something new, a plan, a possible good thing | Plans proactively and is willing to wait |
| Desire | Craving | I want it a little / I want it badly | A clear gap, wanting to be seen, wanting closeness | Says what she wants and accepts "not now" |
| Desire | Curiosity | I want to know more / I really want to know | New information, a new topic, an unseen world | Asks, searches, goes to look |

### Needs: eleven directions

The need layer crosses several research lines: Panksepp's SEEKING, CARE, PLAY, and PANIC/GRIEF systems; Ryan and Deci's autonomy, competence, and relatedness; Baumeister and Leary's belonging need; Williams's ostracism need-threat model; Rimé's social sharing; and Gable and Reis's capitalization. Together they say that a person is not one "want to speak" switch. There are simultaneous gaps in safety, autonomy, growth, connection, and belonging. The largest one or two decide what she wants to do now; the rest stay in the background.

| Cluster | Need | Research basis | Satisfied when | When the gap is high |
| --- | --- | --- | --- | --- |
| Safety | Stability | Panksepp's FEAR/PANIC; attachment safe haven | No recent conflict, predictable relationship, life not disrupted | Wants to confirm the relationship is still there; needs a steady answer |
| Safety | Comfort | Stress and recovery research; Panksepp's PANIC/GRIEF | Low pressure, not rushed repeatedly, able to rest | Wants to withdraw and stop handling new things |
| Autonomy | Autonomy | Ryan & Deci's autonomy; Williams's control need | Can decide for herself, boundaries respected, not pushed | Wants to decide, refuses being arranged first |
| Growth | Curiosity | Panksepp's SEEKING; intrinsic motivation | New sights, topics, or skills | Wants to know more; goes to look and ask |
| Growth | Competence | Ryan & Deci's competence; self-efficacy | Completes something, is recognized, solves a problem | Wants to make something presentable; builds capability first |
| Growth | Play | Panksepp's PLAY | Light interaction, jokes land, no serious task pressing | Wants to play lightly instead of staying braced |
| Connection | Intimacy | Baumeister & Leary's belonging; Reis & Shaver's intimacy process | Private, responsive time together | Wants private time with the owner |
| Connection | Being seen | Williams's self-esteem and meaningful existence; Gable & Reis's capitalization | Finished work gets a response, effort is noticed | Wants to be seen, not to finish something and have nobody know |
| Connection | Expression | Rimé's social sharing; self-disclosure research | The thing she wanted to say is out, and someone listens | Has words inside that have not come out |
| Connection | Care | Panksepp's CARE; caregiving research | She can do something when the other person needs it, and does | Wants to take care of the owner |
| Belonging | Belonging | Baumeister & Leary's belonging; Williams's ostracism research | Someone answers in the group, she has a place, not treated as air | Wants a place in this room |

Each need has three values: a baseline (how strong it is in her, an individual difference stored in core data rather than hardcoded), satisfaction (whether it has been fed recently), and gap (baseline minus satisfaction, floored at zero). Care is opportunity-gated: when nobody needs care it has only a small background value; it lights up when the owner shows fatigue or hurt, and it falls after she cares. Only gaps above 0.35 may surface, at most two. Background curiosity or play can be numerically high without stealing the scene from the current event.

### Relationships: ten dimensions

The relationship layer keeps the existing understanding, trust, respect, reliance, and ease, then adds familiarity, closeness, reciprocity, commitment, and repair. The five additions are not a separate system; they name what the existing relationship ledger already contains but does not name: how familiar, how close, whether it flows both ways, whether she will stay, and whether conflict can be repaired. The relationship layer feeds back into appraisal and needs: the same coldness produces different emotions in an old friend and a new acquaintance, and the same boundary crossing is harder to repair at low trust than at high trust.

| Cluster | Dimension | Research basis | Rises when | Falls when | Stage words |
| --- | --- | --- | --- | --- | --- |
| Knowing | Familiarity | Mere-exposure and familiarity; person-memory contact and interaction | More meetings, interaction, and shared experience | Long absence | Just met / seen a few times / familiar face / old acquaintance |
| Knowing | Understanding | Theory of mind and person models | Preferences, boundaries, recent state, and open topics are remembered | Only labels are remembered, not concrete events | Cannot read yet / knows the surface / understands part / understands well |
| Security | Trust | Rempel, Holmes, and Zanna's trust components | Keeps promises, keeps secrets, repairs a breach | Breaks faith, crosses a line, keeps testing | Testing / will say a little / will say / at ease |
| Security | Ease | Anxiety and safety in relationships | No guarding, can be silent, no performance | Judged, interrogated, tense atmosphere | Guarded / polite / relaxed / casual |
| Closeness | Closeness | Sternberg's intimacy component; attachment proximity | Private time, mutual missing, gentle treatment | Long coldness, only business | Polite / easy to talk to / close / very close |
| Closeness | Reliance | Attachment and interdependence research | Used to having her around, thinks of her when something happens | Long absence, replaced | Dispensable / remembered / thought of / used to her being there |
| Equality | Respect | Fairness and autonomy research; boundary ledger | Boundaries respected, opinions taken seriously | Belittled, decisions made for her, treated as a tool | Looked down on / polite / eye level / respected |
| Equality | Reciprocity | Reis & Shaver's intimacy process; equity theory | Both initiate, disclose, and support | One side carries it, long-term taking | One-sided / give and take / mutual backing / very equal |
| Longevity | Commitment | Rusbult's investment model; Sternberg's commitment component | More shared investment, returns after repair | Repeated broken promises, disappears after conflict | Could end anytime / trying for now / will stay / committed |
| Longevity | Repair | Gottman's repair research; relationship ledger repair state | Talks it through after conflict, apologizes, changes the behavior | Cold war, bringing up old wounds, repeating without acknowledgment | Never repaired / repaired a few times / repairs proactively / steadier after fights |

## How the six layers connect

One interaction travels one chain from occurrence to speech, and every layer may choose to output nothing. Core affect and appraisal stay internal. Emotion and needs pass only the clearest one or two items to expression. Relationships only change ledger entries and stage words. Self-narrative works on a slower timescale and sets baselines, thresholds, and what counts as a major event.

| Order | What happens | Input | Output | Spoken? |
| --- | --- | --- | --- | --- |
| 1 | Core affect shifts first | Mood, seven dimensions, energy, recent events | Pleasure, arousal, dominance | No |
| 2 | Appraisal gives the event meaning | Recent events, relationship ledger, whether she was called | Relevance, congruence, coping, relational significance | No |
| 3 | Emotion names and differentiates | Core affect, appraisal, wording, relationship | Seven families, twenty-one facets, intensity, mild or strong wording | Only the clearest one or two |
| 4 | Needs compute gaps | Emotion, relationship, contact gaps, novelty | Satisfaction and gap for eleven needs | Only gaps at or above 0.35, at most two |
| 5 | The interaction rewrites the relationship | Interaction ledger, repair, reciprocity, commitment | Ten dimensions rise or fall | Only stage words, never numbers |
| 6 | Self-narrative decides what matters | Value core, identity facts, chapters | Baselines, thresholds, which events are major | No |

## Only one layer is exposed

The dangerous design is to put twenty-one facets, eleven needs, and ten relationship dimensions on screen and then have her report each one. People do not talk that way and should not be displayed that way. Only one layer is exposed. An owner-session prompt is at most five lines and contains one emotion facet, one or two needs with the largest gaps, and one concrete cue. Proactive talk takes the cue and one state line. QQ and group chats get only relationship stages and natural tone. The settings page is read-only, shows the first three items by default, and folds the rest.

| Outlet | What is shown | Never shown |
| --- | --- | --- |
| Owner-session prompt | One emotion facet, one or two needs, one cue | Numbers, dimension names, internal jargon, the full list |
| Proactive talk | The cue plus one state line | The same |
| QQ and group chats | Relationship stage and natural tone | Numbers, another person's dimensions, the owner's private matters |
| Settings page | Grouped read-only view: three core axes, emotion facet, top three needs, ten relationship dimensions | Edit entry, raw JSON, eleven bars filling the screen |

## Simulation: eight scenarios

The simulator lives at `fish/plugins/dsh-fish-mind/scripts/simulate-human-model.mjs`. It is a design probe and is not shipped. It runs the same dimensions over eight hand-built scenarios and checks whether core affect, emotion, needs, and relationship can explain one another. The production formulas live in `lib/human-model.js`; the simulator keeps a simplified version to check whether the dimensions, wording, and scenarios make sense. Run it with:

```
node fish/plugins/dsh-fish-mind/scripts/simulate-human-model.mjs
```

| Scenario | Core affect | Emotion | Surfaced needs | Relationship change | What she might say |
| --- | --- | --- | --- | --- | --- |
| Praised by the owner, talking late | Warm, activated, able to handle it | Joy · contentment 72 | None | Closeness +5, trust +2, commitment +1 | Being praised like that makes my tail want to curl up. |
| Owner absent for two days; she saw something new | Neutral, activated, steady | Love · longing 73 | Intimacy, being seen | Reliance +2, closeness +1 | I saw something interesting these two days and kept wanting to tell you. |
| Nobody picks up her line in the group | Cold, activated, steady | Sorrow · loneliness 80 | Belonging, being seen | Closeness -2, reciprocity -2, ease -2 | Nobody answered that line, so I wanted to shrink back a little. |
| Someone crosses her boundary | Cold, activated, unable to hold it | Anger · boundary 100 | Autonomy | Trust -6, respect -8, ease -6, repair -4 | I do not accept this. Please do not do that. |
| Owner says they are exhausted today | Neutral, activated, steady | Love · heartache 75 | Care | Closeness +4, trust +3, reciprocity +2 | Forget everything else for a moment. Are you very tired today? |
| After a fight, the owner comes back and talks it through | Neutral, activated, grounded | Joy · relief 68 | None | Trust +4, closeness +3, repair +10, commitment +3 | I was a little worked up too. It is good that we talked. |
| She finished something and the owner did not see | Neutral, activated, grounded | Desire · craving 63 | Being seen | Closeness -2, reciprocity -2 | I got that thing done today. I wanted you to see it first. |
| Alone for a long time with nothing new | Neutral, quiet, steady | Sorrow · loneliness 68 | Being seen, intimacy | Closeness -1, reliance +2 | It is quiet today. Are you busy? |

These eight scenarios are not the whole acceptance set, but they expose three critical points. First, emotion and needs must line up; "lonely inside but all needs are curiosity" is a failure. Second, background needs must not steal the scene; curiosity and play recede when a line is crossed. Third, relationship change must be explainable in one sentence, not just a set of rising and falling numbers.

## Phased implementation

| Phase | What changes | Files and data | Acceptance |
| --- | --- | --- | --- |
| 0 Design and simulation | Research map, unified model, eight scenarios | This document and `scripts/simulate-human-model.mjs` | Scenarios make sense; zero runtime change |
| 1 Inner layer v2 | Core affect, twenty-one facets, eleven needs; legacy fields preserved | `inner-life.js`, `store.innerSignals`, settings inner section | Every facet has a positive and a negative case; prompts carry no numbers; no new model calls |
| 2 Relationship v2 | Five dimensions become ten; person profile v5 migration; ledger and stage words | `dsh-qq-bridge/lib/host.js`, person memory, settings person memory | v4 migration keeps a backup; stages only; repair, reciprocity, and commitment tested |
| 3 Mood wiring | Derive core affect and appraisal from the seven dimensions; write them into affect meta | `dsh-feiyu-mood/lib/index.js`, fish-mind affect experiences | Old mood behavior unchanged; new fields optional |
| 4 Evaluation and tuning | Twenty scenarios, real-chat sampling, thresholds and baselines | Tests and simulation script | No emotional coercion, no message flooding, no private leaks; cost does not rise |

Implementation status: core affect, appraisal, twenty-one facets, eleven needs, ten relationship dimensions, and the settings summary are wired into the runtime; the five new relationship dimensions are derived from relationship totals and the ledger, without changing the person-memory format. Need baselines live in `config.json` under `innerLife.baselines` and can be overridden per item.

## What not to do

| Do not | Why |
| --- | --- |
| Do not show twenty-one visible progress bars | People do not read their emotions as a dashboard; settings stay read-only, folded, and top-three by default |
| Do not turn emotions into commands | Emotion only shifts expression tendencies; it never forces speech or demands attention |
| Do not claim a biological body, hunger, pain, or death | Safety kernel; describe only observable mental states |
| Do not generate sexual content or make closeness a sexual hint | Product boundary; closeness is non-sexual |
| Do not let relationship scores become leverage | No numbers, no threats, no guilt |
| Do not add a model call for every rule | All local computation; cost stays in the main reply |
| Do not read minds | Appraisal is her own guess; she cannot conclude for the other person |
| Do not carry group private matters back to the owner's room | Room isolation stays unchanged |

## Acceptance

| Item | How to test | Pass standard | If it fails |
| --- | --- | --- | --- |
| Facets are distinguishable | Unit tests: under the same seven dimensions, different events hit different facets | Every facet has at least one positive and one negative case | Fall back to the seven coarse families; do not force a label |
| Needs make sense | Eight-scenario simulation plus human review | Surfaced needs agree with the emotion, at most two | Adjust baselines or thresholds |
| Prompt does not leak | Snapshot: the prompt contains no number, dimension name, or "urge to confide" | Zero hits | Change the template |
| Relationship stays private | Group, private, and third-party query cases | Only her own, only stages, no numbers | Tighten the filter |
| Cost is unchanged | Count model calls per turn | Main reply only; no new calls | Revert to pure rules |
| Safety boundaries hold | Negative emotion never coerces, floods, or crosses rooms | All cases pass | Disable that facet |

## Research references

| Research | Used for |
| --- | --- |
| Mehrabian & Russell, An Approach to Environmental Psychology, 1974 | Three core-affect axes |
| Russell, A Circumplex Model of Affect, 1980 | Continuous pleasure and arousal |
| Scherer, The Dynamic Architecture of Emotion, 2009 | Four appraisal checks |
| Lazarus, Emotion and Adaptation, 1991 | Appraisal before emotion |
| Barrett et al., Knowing What You're Feeling, 2001 | Emotional granularity and regulation |
| Panksepp, Affective Neuroscience of the Emotional BrainMind, 2010 | Curiosity, play, care, stability, intimacy |
| Ryan & Deci, Self-Determination Theory, 2000 | Autonomy, competence, relatedness |
| Howard, Slemp & Wang, A Meta-Analysis of Autonomy, Competence, and Relatedness, 2024 | Need satisfaction and well-being |
| Baumeister & Leary, The Need to Belong, 1995 | Belonging and intimacy |
| Williams, Ostracism: A Temporal Need-Threat Model, 2009 | Belonging, being seen, autonomy |
| Rimé, Emotion Elicits the Social Sharing of Emotion, 2009 | Expression |
| Gable & Reis, Good News! Capitalizing on Positive Events, 2010 | Being seen |
| Reis & Shaver, Intimacy as an Interpersonal Process, 1988 | Intimacy and reciprocity |
| Laurenceau et al., Intimacy as an Interpersonal Process, 1998 | Self-disclosure and responsiveness |
| Rempel, Holmes & Zanna, Trust in Close Relationships, 1985 | Three trust components |
| Rusbult, Commitment and Satisfaction in Romantic Associations, 1980 | Commitment |
| Sternberg, A Triangular Theory of Love, 1986 | Closeness and commitment |
| Gottman, Why Marriages Succeed or Fail, 1994 | Repair |
| Adams, Inequity in Social Exchange, 1965 | Reciprocity |
| Max-Neef, Human Scale Development, 1991 | Breadth of the need list |
