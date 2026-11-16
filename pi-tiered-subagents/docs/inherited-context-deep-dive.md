# What I mean by the inherited-context fork

> **Status.** This is a discussion document, not a specification, not an ADR,
> and not a claim that the implementation is finished. It exists to write down,
> precisely and at length, what I mean when I say "the fork", what I mean when I
> say "turn budgets are gone", and — most importantly — what I mean by the three
> findings the review labelled **implemented but wrong**. Those three are left
> open for a later conversation. Nothing here authorises a code change.

---

## 1. The claim, in one paragraph

`inherit_context: true` used to mean: *render the parent's conversation into a
Markdown string and prepend that string to the child's first prompt*. I mean
something structurally different now: *copy the completed portion of the
parent's session tree into the child's session, as real session entries, before
the child takes its first turn*. The child does not read a description of the
parent's conversation; it continues a branch of it. That is the whole point.
The flattening was not merely inefficient — it destroyed the distinction
between "a tool ran and produced this output" and "an assistant once said that
a tool ran and produced this output", and it made parent-to-child prefix reuse
impossible in the one case where it could have paid: identical message
structure on the same model.

## 2. Vocabulary I am using

| Term | What it is | What it is not |
| --- | --- | --- |
| **Parent branch** | The ordered list of entries from the root to the parent session's current leaf, as `SessionManager.getBranch()` reports it in memory. | A `.jsonl` file on disk. A rendered transcript. |
| **Completed portion** | The parent branch minus the turn step that is still in flight. | "Everything except the last message" — see §7.2. |
| **Uncommitted step** | The assistant message whose tool call is `subagent(...)`, together with any tool results produced for that same message before the child was created. | A completed assistant turn. A user message. |
| **Inherited context** | The sanitized, re-chained completed portion, captured at request time and held on `ParentSnapshot.parentBranch`. | A string. A prompt prefix. A summary. |
| **Fork boundary** | The point where inherited history ends and the child's own turns begin. | A turn number. A token count. |
| **Child-only transcript** | The projection a reader sees: `getConversation()`, `agentMessages`, `get_subagent_result(verbose)`, the TUI viewer, and released-session file snapshots. | The raw `AgentSession.messages` array, which necessarily contains the inherited history. |

The last row is the crux. There is **one** session and **two** legitimate
projections of it. The model must see inherited history plus its own turns; the
operator and the parent must see only the child's own turns. Any design that
confuses "the session's history" with "the child's transcript" will be wrong
somewhere.

## 3. The invariant I am actually trying to hold

> For a child created with `inherit_context: true`, the model-visible prefix is
> byte-faithful to the parent's completed conversation, and every outward-facing
> view contains exactly the turns produced after the fork boundary.

"Byte-faithful" is deliberately strong and I do not claim the current code
achieves it — that is exactly what §7 is about. But it is the direction. Two
corollaries:

1. **Queued children inherit the state at request time, not at slot-open
   time.** This is why `captureLaunchInputs()` in `src/runtime.ts` captures the
   branch for *every* launch even though `Subagents.prepareLaunch()` in
   `src/service/subagents.ts` attaches it only when the resolved definition asks
   for it. Definition loading is asynchronous; by the time we know whether the
   child inherits context, the parent may have moved on. I accept the cost of
   cloning an unused branch as the price of a single, consistent capture point
   (ARCHITECTURE-SPEC stories 15 and 16). This is a deliberate trade-off, not
   an oversight — but it is a trade-off worth revisiting.

2. **No parent file is read and no intermediate fork file is written.** Nico's
   `defaultContext: fork` opens the parent `.jsonl` and calls
   `createBranchedSession(leafId)`, which writes a `forks/*.jsonl`. I mean
   "Nico's strategy without the file making": capture from the in-memory tree,
   sanitize in memory, and seed the child's `SessionManager` through its public
   `append*` API before `createAgentSession` runs. The child still writes its
   own `tasks/<id>.jsonl` — that file is its own `outputFile`, needed for the
   transcript viewer after the retention sweep releases the live session.

## 4. What "turn budgets are gone" actually means

This was not "delete a knob". A turn budget was a *control*, and removing a
control collapses the meanings of several other things. When I say full
removal, I mean that all of the following ceased to exist as concepts, not just
as configuration:

- **A ceiling** (`max_turns` in the tool schema and in definition frontmatter,
  `defaultMaxTurns` / `wrapUpTurns` in settings, the `limited`/`unlimited`
  `TurnPolicy` union, `TurnBudgetTracker`, `src/lifecycle/turn-limits.ts`).
- **A warning phase** (the `subagents:turn-budget-warning` custom message, the
  `warned` phase, the "wrapped up — after turn-budget warning" status caveat,
  the special warning-coloured success icon).
- **A harness-initiated terminal state** (`aborted` because the ceiling was
  exhausted). `Subagent.complete()` no longer decides `aborted` vs `completed`
  from a budget phase; a run that returns from `session.prompt()` is simply
  completed. This is why several workspace-hold and ask-back tests changed
  character rather than merely changing an expected string.
- **A turn counter** (`↻N`, `↻N≤M`, `Turns: N`, `progress.turns`, the live
  `turnBudget` field on the record, and the serialized `turnBudget` field).
- **A reason to re-decide policy on resume.** "Fresh counter under the captured
  policy" is no longer a requirement; a resume is just another prompt on the
  same session.

What survives: `toolUses`, `tokens` / `lifetimeUsage`, `contextPercent`,
`duration`, `compactionCount`, model and thinking labels, and the ordinary
`completed` / `error` / `stopped` / `aborted` statuses (the last still reachable
through an external stop, not a budget). Old `subagents:record` entries that
carry a `turnBudget` key remain readable — `persisted-record.ts` accepts it as
`v.optional(v.unknown())` and ignores it. That single tolerance is intentional;
everything else named above is gone.

I want to be explicit about one consequence that is easy to miss: **removing
the ceiling removed a guard against a runaway child**. Pi's context window and
auto-compaction, the parent's abort signal, ESC policy, and explicit
`abort(id)` are now the only bounds. If we later discover that a cheap model
can loop forever on a tool that returns the same output, the answer is not to
reintroduce `max_turns`; it is a different kind of control (a deadline, an
unchanged-output detector, a tool-call budget scoped to a specific failure
mode). I would want that argued on its own before anything is added back.

## 5. The boundary problem — the deepest part

There are **two** representations of the fork boundary in the current code, and
they are not the same mechanism:

- **Live session** (`src/lifecycle/subagent-session.ts`): the constructor
  records `inheritedLastMessage = _session.messages.at(-1)`, and
  `ownMessages()` finds that object by identity in `session.messages` and
  slices after it. If compaction rewrites the array so the object is gone, it
  falls back to showing all messages.
- **Released session** (`src/ui/session-navigation.ts`):
  `fileSnapshotSource()` reads the child's `.jsonl`, finds the last
  `custom` entry with `customType === "subagents:fork-boundary"`, slices the
  entries after it, and re-roots the first retained entry's `parentId` to
  `null` before handing them to `buildSessionContext()`.

`src/session/fork.ts` writes that boundary entry with
`appendCustomEntry(FORK_BOUNDARY_ENTRY)` after replaying the branch. The UI
module cannot import the constant from `src/session/fork.ts` — the UI boundary
rule (`scripts/ui-boundary-rule.mjs`) forbids presentation modules importing
execution implementation — so the literal `subagents:fork-boundary` is
duplicated in both files with a cross-reference comment.

Why I am uneasy, and why this belongs in the later conversation:

- The live path is **identity-based and fragile in a specific direction**. If
  Pi ever copies message objects rather than reusing them, `indexOf` fails and
  the fallback shows *all* messages — which re-exposes the parent's history to
  the operator, the exact thing we set out to prevent. The fallback is safe for
  compaction but unsafe for copying.
- The file path is **structural and stable** but depends on `parseSessionEntries`
  recognising the boundary as a `custom` entry, and on the boundary being the
  last such entry in the file. A resume that appends its own `custom` entries
  does not disturb this, but a future writer that appends another
  `subagents:fork-boundary` would.
- The two paths can disagree. Live: compaction drops the anchor, so the viewer
  shows summary + child turns. File: the boundary entry is still there, so the
  snapshot shows only post-boundary entries. Whether those two are the same set
  is not proven anywhere.
- A single source of truth would be better — deriving both projections from the
  session manager's boundary entry — but `SubagentSession` deliberately exposes
  only `messages`, not the SDK `SessionManager`, across the `ChildSession` seam
  (the workspace policy forbids leaking concrete foreign class types). Choosing
  between "widen the seam" and "keep two representations in sync" is a real
  architectural decision, not a cleanup.

## 6. What I mean by "we'll talk about implemented but wrong later"

The Spec review had a section labelled **implemented but wrong**. I fixed the
three concrete gaps it named in code, because leaving a known hole in a
committed change felt worse than fixing it. But "fixed the named case" and
"the design is right" are different claims, and I do not want the fixes to be
mistaken for the latter. Here is what I actually mean by each concern, in
depth.

### 6.1 The sanitization surface

**The concern.** Signed Anthropic `thinking` blocks and `redacted_thinking`
blocks are bound to the session that produced them; replaying them into a
different session can fail the provider's signature check. Nico strips them
from forked entries. My first implementation sanitized only
`entry.message.content` and `context_edit.replacement.content` for assistant
messages. `custom_message` entries are replayed as user-role messages by Pi's
`convertToLlm`, and their content arrays were passed through untouched.

**What I fixed.** `sanitizeUnsafeThinkingBlocks` now also filters
`custom_message` content arrays, dropping `redacted_thinking` and any
`thinking` block carrying a signature, regardless of provider metadata (none
is available on a custom message).

**What still bothers me.** I enumerated the surface by entry *type*, and that
is the wrong shape of reasoning. The real question is: *which byte sequences
can reach a provider request?* That includes, at minimum:

| Surface | Currently sanitized? |
| --- | --- |
| `message` → assistant `content[]` | Yes |
| `message` → user `content[]` | No (assumed safe) |
| `message` → `toolResult` `content[]` | No |
| `custom_message` `content[]` | Yes (after the fix) |
| `context_edit.replacement.content` | Yes, only when the target is an assistant |
| `compaction.summary` (free text) | No |
| `branch_summary.summary` (free text) | No |
| `custom` entry `data` | Not model-visible; skipped entirely |

Tool results are the interesting one: a tool can echo anything, including a
payload that looks exactly like a signed thinking block. Compaction and branch
summaries are prose, so a signature inside them is inert — but that is an
argument about *semantics*, not about the parser, and I have not written it
down as an invariant.

**The deeper question.** Should sanitization be a *property of the replay
function* ("everything that becomes an LLM content block passes through one
filter") rather than a switch over entry types? If yes, `seedInheritedBranch`
and `captureParentBranch` both need to agree about which entries produce
content blocks, and the two modules currently disagree about what an entry
*is* (one uses `Record<string, unknown>`, the other a `BranchRecord`). I would
rather discuss that than keep adding cases.

### 6.2 The cut boundary

**The concern.** The requirement was: cut **only** the uncommitted trailing
assistant message (the step that called `subagent`) and any partial tool
results belonging to it, while **keeping** the parent's triggering user prompt
and any earlier completed assistant + tool-result steps from the same turn —
"the debug info is important". My first implementation returned
`entries.slice(0, lastAssistantIdx)`, which discards *everything* after that
index, including trailing metadata and, more importantly, is phrased as a
position rather than as a property of the in-flight turn.

**What I fixed.** The filter now removes the assistant entry at
`lastAssistantIdx` and only trailing `message`/`toolResult` entries; other
trailing entries survive and `stripLabelsAndRechain()` re-chains their
`parentId` to the new leaf. There is a test pinning this.

**What still bothers me.** The cut is decided by "the last assistant message in
the whole branch has tool calls whose ids are not all present among trailing
tool results". That heuristic has holes:

- **A completed final answer as the last assistant.** If the parent's last
  assistant message has no tool calls, no cut happens — correct. But if a
  `custom_message` or `usage` entry is appended *after* a completed assistant
  turn and the assistant had tool calls whose results appear before it, the
  `trailingResults` slice still sees those results and may wrongly conclude
  "uncommitted". The check counts *trailing* results, not results belonging to
  *that* message.
- **Parallel tool calls.** A parent turn can issue `read` and `subagent` in the
  same assistant message. `read` may have returned before the child was
  created, `subagent` has not. The requirement says keep the completed steps —
  but both results are children of the *same* assistant message. Cutting the
  assistant entry necessarily orphans the `read` result. My implementation
  discards it. Preserving it would mean rewriting the assistant message to
  remove only the `subagent` tool call, which is a different and much more
  invasive operation: it changes a message the provider has already seen, and
  therefore destroys the exact prefix we are trying to reuse.
- **Nested delegation.** If a child itself forks, the same rule applies one
  level down; nothing in the capture knows about depth.
- **What "in flight" means is not observable from the branch alone.** It is a
  fact about the parent's currently executing tool call. Capturing it from
  entry shape is inference. A cleaner design would pass the in-flight
  `toolCallId` from the tool boundary into the capture, so the cut is exact
  rather than guessed.

**The deeper question.** Is the invariant "keep completed steps from the same
turn" compatible with "byte-faithful prefix"? I suspect not, and I would rather
say so explicitly than keep a heuristic that mostly works. If they conflict,
which one wins — the debug evidence or the cache prefix? My instinct is the
debug evidence, because the prefix rarely pays anyway (different model tier,
different tool array, Anthropic's tools-first cache key), but that is a
judgement I want to make with you, not inside a helper.

### 6.3 Replay fidelity

**The concern.** The child `SessionManager` is fresh. Replaying entries through
`appendMessage` / `appendCustomMessageEntry` / `appendCompaction` /
`appendContextEdit` / `appendCustomEntry` generates **new ids and new
timestamps**. Any reference inside a replayed entry must therefore be remapped:
`compaction.firstKeptEntryId`, `context_edit.targetId`. My first implementation
dropped `branch_summary` entries entirely, even though Pi maps them into model
context.

**What I fixed.** `seedInheritedBranch` keeps a `replayedIds` map, remaps
`firstKeptEntryId` and `targetId`, and replays `branch_summary` as a custom
message carrying the summary text (the SDK exposes no public
`appendBranchSummary`, so an exact `branchSummary`-role message cannot be
appended).

**What still bothers me.** Replaying as a `custom_message` changes the *role*
and the *shape* of that context. Pi's `createBranchSummaryMessage` wraps the
summary in a `BRANCH_SUMMARY_PREFIX` / `SUFFIX` envelope and gives it the
`branchSummary` role; my version is a user-role custom message with the bare
summary text. The information survives, but the model sees a different kind of
message. The same is true of `compaction`: `appendCompaction` reproduces the
entry, but its `systemMessage` snapshot is recomputed from the projection at
replay time, not copied from the parent.

More generally, `replayEntry` currently divides the world into "replayed" and
"skipped metadata" (`model_change`, `thinking_level_change`, `usage`,
`session_info`, `custom`, `label`, unknown). Skipping `model_change` and
`thinking_level_change` is intentional — those are launch decisions, and
replaying them would let the parent's model override role-aware routing.
Skipping `usage` is intentional — it would double-count the parent's tokens on
the child's record. But `custom` entries can carry extension state that a
child extension expects to find, and `session_info` carries the session name.
Neither is model context, so neither belongs in the fork's *conversation* —
but "not model context" and "not needed" are different claims.

**The deeper question.** Is the fork a *conversation* fork or a *session*
fork? The name says session, the implementation says conversation-only. If it
is conversation-only, `Inherited context` in `GLOSSARY.md` should say so, and
the skipped entry types should be an explicit, documented allowlist rather
than a `default:` branch. If it is a session fork, we need a different seeding
mechanism that preserves ids — which the public `SessionManager` API does not
offer without writing files.

## 7. Other tensions I am carrying, for completeness

These came out of the Standards review and are judgement calls, not defects:

- **Opaque entry types.** `InheritedBranchEntry` is
  `Readonly<Record<string, unknown> & { type: string }>`, with local
  `ContentBlock`, `MessageRecord`, `MutableBranchEntry`, `BranchRecord` shapes.
  `structuredClone` plus `asString → ""` / `asNumber → 0` silently fabricate
  values for missing fields. Pi's JSONL is untyped at our boundary, so some
  opacity is unavoidable; but the code currently has no name for "a session
  entry", even though `GLOSSARY.md` names "Inherited context". A small local
  vocabulary would make the two modules stop disagreeing.
- **A duplicated capture path.** `runtime.buildSnapshot(inheritContext)` and
  `buildParentSnapshot(ctx, inheritContext)` can still capture a branch, but no
  production caller passes `true`; only `test/runtime.test.ts` and
  `test/lifecycle/parent-snapshot.test.ts` exercise that path. Production uses
  `captureLaunchInputs()`. Two capture sites for one concept is confusing even
  though both produce the same value. I left it because removing a public
  method is a bigger decision than this change warranted.
- **The duplicated boundary literal**, forced by the UI boundary rule (§5).
- **The timeout bump** in `test/runtime-loader/session-switch-veto.test.ts`
  (30s → 90s). Those four tests start real SDK sessions; on this machine two
  of them exceed 30s under the configured `maxWorkers: 2`. With 90s all four
  pass. This is a stability adjustment, not evidence about the fork, and I
  would rather it be reviewed as such than silently kept.

## 8. Questions to settle later

1. Is the fork a conversation fork or a session fork? (§6.3)
2. Should sanitization be one filter applied to every replayed content block,
   or a per-entry-type switch? (§6.1)
3. When "keep completed steps from the in-flight turn" conflicts with
   "byte-faithful prefix", which wins? (§6.2)
4. Should the in-flight `toolCallId` be passed explicitly from the tool
   boundary so the cut is exact instead of inferred? (§6.2)
5. Should the child-only boundary have one source of truth, and if so is
   widening the `ChildSession` seam to expose the session manager acceptable?
   (§5)
6. Is cloning the parent branch for every launch (including fresh-context
   launches) acceptable, or should the request carry a cheap hint that lets us
   skip it without losing request-time capture semantics? (§3)
7. Do we want any replacement control for a runaway child, or do context
   window + compaction + explicit abort suffice? (§4)
8. Should `GLOSSARY.md` gain entries for *Fork boundary*, *Inherited context
   entry*, and *Child-only transcript*, and should this decision get an ADR?
   (You explicitly declined an ADR earlier; I am re-raising it only because the
   boundary representation is a hard-to-reverse choice.)

## 9. What I deliberately did not do

- I did not write an ADR (your explicit instruction: "Confirm seams (no new
  ADR)").
- I did not rewrite the historical architecture documents or decision records
  (`docs/architecture/architecture.md`, `docs/architecture/history/*`,
  `docs/decisions/*`, `CHANGELOG.md`). They describe earlier implementations;
  `docs/status.md` and `docs/ARCHITECTURE-SPEC.md` now carry prominent notes
  saying the turn-budget sections are history.
- I did not reintroduce any turn-count display, even a passive one.
- I did not change the model routing, reasoning, or family-profile work that
  was already in the tree; that is a separate change and was committed alongside
  this one only because you chose a single commit.
- I did not claim the three "implemented but wrong" concerns are settled. The
  named cases are patched and pinned by tests; the underlying design questions
  in §6 are open.

## 10. Where to look

| Concern | File |
| --- | --- |
| Capture, cut, re-chain, sanitize | `src/session/context.ts` |
| Replay into a fresh session manager | `src/session/fork.ts` |
| Request-time capture | `src/runtime.ts`, `src/service/subagents.ts` |
| Seeding before session creation | `src/lifecycle/create-subagent-session.ts` |
| Live child-only projection | `src/lifecycle/subagent-session.ts` |
| Released child-only projection | `src/ui/session-navigation.ts` |
| Legacy record tolerance | `src/persisted-record.ts` |
| Vocabulary | `GLOSSARY.md` (Parent snapshot, Inherited context, Prepared launch) |
| Current-state note | `docs/status.md` |
