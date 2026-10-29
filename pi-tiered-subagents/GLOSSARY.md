# Glossary

The vocabulary of this package. The specification
([SPEC.md](docs/SPEC.md)) is the requirement set; this file is the language the
runtime uses.

## Agent definition

The resolved description of one agent: its identifier, label, description,
standing instructions, tool selection, and settings.

A **definition file** is the Markdown document an operator writes to define or
refine an agent: frontmatter for the settings, body for the instructions. A
file is a *layer*, not a definition; the definition is what the layers produce.

The term *agent definition* is used the same way in
[pi-agent-resource](../pi-agent-resource/GLOSSARY.md), where it names the
Markdown document. Here it names the resolved record, and the file is always
called a definition file.

## Identifier

The normalized name of an agent: lowercased and trimmed, so `Reviewer` and
`reviewer` name the same agent. The identifier is what a record carries; the
**display name** is the readable label shown to the parent.

## Layer

One of the three places a definition's values come from: the shipped
specialists, the operator's global files, or the project's files. A later
layer refines an earlier one field by field.

## Not specified, explicit, cleared, empty

The four ways a layer can speak about a field, and the only ones:

| A layer says | The field becomes |
| --- | --- |
| **not specified** (the key is absent) | what the layer below said |
| **explicit** (a value) | that value |
| **cleared** (`null`) | unset — for an optional setting, the automatic choice |
| **empty** (an empty list) | an empty list, not "inherit" |

Lists are never concatenated across layers, and a body is either inherited
(empty) or replaced (non-empty).

## Tool selection

How a definition says what its child may use: **inherit** (the parent's active
tools, captured when the request was made) or **explicit** (a list of tools).
The subagent-management tools are stripped from both, so a child cannot
delegate further.

## Shipped specialist

One of the five roles the package ships: `explore`, `worker`, `reviewer`,
`debug`, `researcher`. A definition file may refine a specialist; it stays a
specialist.

## Family

A model series the package can read: `gpt`, `claude`, `gemini`, `glm`,
`minimax`, `qwen`, `deepseek`, `mimo`. A family has a **naming structure**
(how its ids are written) and, usually, a **ladder** (the profile data).

## Group

The routing vocabulary a family uses: **size** (`gpt`, `claude`, `qwen`) or
**planner-worker** (`gemini`, `minimax`, `glm`, `mimo`, `deepseek`). Each family
belongs to exactly one group.

## Size

A capability label on a size-group tier: **S**, **M**, **L**, or **XL**.
Several tiers may share a size; size is not a version, parameter count, or the
tier's position in the ladder. One size below follows XL → L → M → S, with S
as the floor.
**Equal** means the parent's own size, anchored at its own rung.

## Class

A role-shape label on a planner/worker-group tier: **planner** or **worker**.
A class is not an agent identifier: a reviewer targets planner class while
execution roles target worker class. A family need not offer both classes.

## Tier

One version-independent rung of a family's ladder, such as GPT's `sol` or
Claude's `haiku`, with a size or class label. A tier does not enumerate
releases, providers, or concrete model ids. The family's naming structure
combines a tier with the parent's version to identify a candidate. The unnamed
default line is the tier with the empty name.

## Profile

The data that describes a family's group and ordered, version-independent
tiers with their size or class labels. A profile contains no version
catalogue, concrete model ids, provider priorities, or version fallback links.
It is read, never executed: it holds no matcher, no pattern and no parser.

## Ladder

A family's version-independent tiers in capability order. A role selects a target
size or class within the parent's exact family and version, starting at the
top matching rung (the parent's own rung for Equal) and walking through
eligible cheaper rungs. Versions are never crossed; an exhausted or absent
target, or an unknown family, retains the parent.

## Reasoning level

The effort a child reasons at, chosen after the model: the request's level,
then the definition's, then automatic selection. With known parent effort,
automatic selection takes the next supported non-off rung below it, staying
at the floor; without parent effort, it prefers **medium**, then **low**, then
the lowest supported non-off level. This includes retained models. Unsupported
explicit levels are clamped; a non-reasoning model has no applicable level.

## Parent snapshot

The parent's owned state captured when a request is made: model identity and
capabilities, reasoning effort, active and registered tool names, working
directory, session identity, portable prompt inputs, and the conversation when
the child is to inherit it. Launch-shaping settings are captured with it. A
queued child uses these copied values, not the parent as it is when the child's
slot opens; no live model registry or SDK session is part of the snapshot.

## Definition catalog

The immutable, layered set of definitions used by one launch preparation. Each
request loads a fresh catalog, so concurrent requests cannot change each
other's selection. Selecting an identifier produces an available definition or
an unknown, disabled, or invalid outcome; an invalid identifier never falls
back to a shipped definition.

## Definition diagnostic

A classified explanation of a problem reading or validating agent definitions.
It identifies the kind of problem, the affected agent when known, and the source
layer and file or directory, alongside a human-readable explanation. A diagnostic
about an unreadable scope prevents pretending that the scope is empty; one about
an individual definition invalidates that identifier without disabling unrelated
valid agents. Its category and source remain facts, not information a caller
must recover by parsing prose.

## Prepared launch

The complete execution decision produced by preparation: the selected
definition, exact capabilities, captured parent inputs, model and reasoning
decisions, final turn policy, and child-shaping settings. Acceptance transfers
this plan to the session runtime. Later file or setting edits affect future
requests, not an accepted plan.

## Launch acceptance

The point at which a valid request becomes an identified, manager-owned child
record. Acceptance is not execution success: admission, SDK session creation,
and settling happen later. Expected preparation or ownership failures are
rejections and create no accepted child.

## Session owner

The generation-scoped identity of the parent session that owns accepted
children. A replacement closes acceptance for the old owner before cancelling
and cleaning up its children. Reusing a session id does not reuse its
generation, so stale requests cannot attach to a successor.

## Child session

The package-owned execution contract behind one child. It exposes the behavior
the lifecycle needs without exposing a concrete SDK session across public or
test seams.

## Workspace impact

What a child may change, decided from its **effective tools** — the ones it
will really have, after its definition's override. A child is **read-only**
when every tool it holds is known to only read, and **file-changing**
otherwise: a shell, an editor, and any tool this package has never heard of
all change files.

## Exclusive slot

The one-at-a-time rule for children that may change files, held per working
directory: while one child that may write is running, another waits. The slot
belongs to the directory, not to the parent, so two parents working in the
same directory share it.

This is not the **workspace** a workspace provider prepares for a child (the
directory a child works in, when it is given one of its own): the slot is
about the directory the request was made in.

## Related documents

- [SPEC.md](docs/SPEC.md) — the approved requirements.
- [docs/status.md](docs/status.md) — what is implemented, and what is owed.
- [docs/adr/](docs/adr/) — the decisions this derivative made.
- [docs/decisions/](docs/decisions/) — upstream's decisions, kept for
  provenance.
