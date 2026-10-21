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

A model series the package can read: `gpt`, `claude`, `gemini`, `kimi`,
`minimax`, `qwen`, `deepseek`, `mimo`. A family has a **naming structure**
(how its ids are written) and, usually, a **ladder** (the profile data).

## Tier

One rung of a family's ladder: a version's line of models, such as GPT's
`sol` or Claude's `haiku`. A tier has concrete model ids, most preferred
first. The version's default model — the one whose id names no tier — is the
tier with the empty name.

## Profile

The data that describes a family's ladder: its versions, each version's tiers,
the concrete ids of each tier, and the rungs a tier may cross to. A profile is
read, never executed: it holds no matcher, no pattern and no parser.

## Ladder

A family's versions and tiers in capability order, with the cross-version
links. The router walks down it: the tiers below the parent's, then the
approved links.

## Parent snapshot

The parent's state captured when a request is made: the model, the model
registry, the active tool names, the working directory, the prompt, and the
conversation when the child is to inherit it. A queued child runs with the
snapshot, not with the parent as it is when the child's slot opens.

## Related documents

- [SPEC.md](docs/SPEC.md) — the approved requirements.
- [docs/status.md](docs/status.md) — what is implemented, and what is owed.
- [docs/adr/](docs/adr/) — the decisions this derivative made.
- [docs/decisions/](docs/decisions/) — upstream's decisions, kept for
  provenance.
