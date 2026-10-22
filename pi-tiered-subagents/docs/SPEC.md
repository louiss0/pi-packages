# pi-tiered-subagents: family-aware delegation with overridable specialists

> **Later approved architecture specification:** [ARCHITECTURE-SPEC.md](ARCHITECTURE-SPEC.md), published as [issue #9](https://github.com/louiss0/pi-packages/issues/9), supersedes this document where it requires extension-owned trust gating, foreground concurrency exemptions, or inherited programmatic launch semantics. It also defines the agreed captured-launch, session-lifetime, UI-library, and targeted TypeScript/API modernization changes. Unchanged product requirements below remain applicable; the follow-up is a specification, not a claim of completed implementation.

## Problem Statement

Users want to delegate work to specialists without manually choosing an appropriate child model for every task. Inheriting an expensive parent model for every child wastes resources, while hardcoded model pins ignore the user's current session and available model families. Model names, versions, capability tiers, and reasoning controls vary across providers and series; naive suffix parsing, fuzzy selection, or ranking by price cannot reliably express the intended relationships.

The user also wants to understand and evolve an existing implementation rather than ship a renamed port. The starting material is @gotgenes/pi-subagents v25.0.1. Its useful lifecycle functionality should be retained, but its configuration decisions need to become coherent, inspectable, testable, and organized around cohesive objects. Users must be able to override shipped agent definitions without accidentally losing restrictions or copying whole definitions.

The repository currently contains a scaffold, copied upstream source and documentation, and incomplete experimental tier-routing changes. These are starting material, not a finished or authoritative implementation of this specification.

## Solution

Build @code-fixer-23/pi-tiered-subagents as an independent, credited derivative that replaces the original runtime in a session. Preserve established subagent lifecycle functionality while adding five deliberately scoped specialists, layered agent-definition overrides, explicit tool inheritance, family-aware automatic model routing, supported reasoning defaults, capability-based workspace scheduling, and centralized extension settings.

When no model is explicitly selected, identify the parent's family and version, then walk explicitly configured compatible lower tiers until the session can resolve an available target. Family strategies interpret supported naming structures; profiles provide concrete model identities, tier order, and approved version relationships. Unknown families produce a clear error rather than a guess. A recognized family with no eligible lower target retains the parent model and uses a reasoning fallback where applicable.

Explicit model choices require an exact provider/model identity and bypass automatic family routing. Reasoning selection happens after model selection. Non-reasoning models are usable: discard the thinking setting, not the launch. Expose actual resolved decisions in the existing launch/result presentation.

Use @juanibiapina/pi-extension-settings as the single settings backend, including existing operational settings and user-extensible family profiles. Develop incrementally: explain current modules, establish behaviour tests, reproduce suspected bugs, then refactor and fix with separate, reviewable changes.

## User Stories

### Product and continuity

1. As a Pi user, I want a replacement subagent runtime, so that I can use family-aware delegation without running competing orchestrators.
2. As a user, I want familiar spawning, result-retrieval, steering, and resume functionality, so that adopting this runtime does not require learning an unrelated workflow.
3. As a maintainer, I want explicit credit to @gotgenes/pi-subagents and preserved applicable licence notices, so that the derivative's provenance is honest and compliant.
4. As a developer, I want the inherited implementation explained before it is restructured, so that I understand what I am maintaining.
5. As a maintainer, I want confirmed bugs distinguished from structural improvements, so that fixes can be reviewed independently of refactoring.

### Built-in specialists

6. As a parent agent, I want an explore specialist, so that I can delegate locating files and tracing existing behaviour.
7. As a user, I want explore to have read, grep, find, and ls, so that it can investigate structure and content without a general-purpose shell.
8. As a parent agent, I want a reviewer specialist, so that I can obtain an independent assessment of a scoped change.
9. As a user, I want reviewer to have only read, grep, and find as capability tools, so that it cannot directly edit files or execute arbitrary commands.
10. As a reviewer, I want the parent to supply the review scope, requirements, and diff or readable diff artifact, so that I know precisely what to assess.
11. As a reviewer, I want to request missing essential review input, so that I do not imply I inspected changes I never received.
12. As a parent agent, I want a worker specialist, so that I can delegate implementation and validation of a scoped change.
13. As a user, I want worker to inherit the parent's active tools, so that it works with my session's chosen capabilities rather than a hardcoded substitute.
14. As a parent agent, I want a debug specialist, so that investigation can be separated from implementing a production repair.
15. As a user, I want debug to inherit the parent's active tools, so that it can build reproductions, diagnostic tests, and necessary instrumentation.
16. As a user, I want debug to inherit conversation context by default, so that it can use symptoms, attempts, and evidence already discussed.
17. As a user, I want debug to prioritize reproducible evidence and falsifiable hypotheses, so that it does not mistake a plausible theory for a confirmed cause.
18. As a user, I want debug to clean up temporary instrumentation and redact sensitive evidence, so that diagnosis does not leave misleading artifacts or expose secrets.
19. As a parent agent, I want debug to return its diagnosis and recommended repair to me, so that I retain control over whether worker implements a fix.
20. As a parent agent, I want a researcher specialist, so that I can delegate external factual investigation.
21. As a user, I want researcher to list read, grep, find, ls, and web_search, so that it combines local context with web search when its supplying extension is available.
22. As a user, I want researcher not to inherit the parent's entire tool selection, so that an external research task does not automatically gain editing or shell capabilities.
23. As a user, I want researchers to distinguish sourced findings from inference, so that a lack of live search is not disguised as verified research.
24. As a user, I want exactly the five agreed roles shipped initially, so that the defaults are focused rather than an unexamined copy of upstream's role set.

### Agent definitions and selection

25. As a user, I want agent identifiers normalized to lowercase, so that casing does not determine which definition is selected.
26. As a user, I want display names separate from identifiers, so that labels can be readable without changing identity.
27. As a user, I want duplicate normalized identifiers in one scope reported clearly, so that filesystem order cannot silently choose a definition.
28. As a user, I want global definitions layered over shipped defaults and project definitions layered over global definitions, so that personal defaults and project refinements compose.
29. As a user, I want omitted override fields inherited, so that a small override does not discard a built-in specialist's tool restrictions.
30. As a user, I want explicit values to replace inherited values, so that an override has predictable meaning.
31. As a user, I want null to clear inherited optional settings, so that I can remove a fixed model or thinking choice without copying a definition.
32. As a user, I want explicit empty lists to stay empty, so that removing capabilities is not mistaken for inheritance.
33. As an agent author, I want standing instructions in the Markdown body, so that no separate prompt frontmatter property is required.
34. As an agent author, I want an empty body to inherit the existing instructions and a nonempty body to replace them, so that configuration-only overrides remain concise.
35. As a parent agent, I want to choose any enabled definition, so that custom specialists are usable alongside shipped ones.
36. As a user, I want unknown or disabled agent requests rejected rather than redirected to another role, so that my request is not silently changed.
37. As a user, I want project definitions ignored when Pi has not granted project trust, so that opening a repository cannot silently alter my agents' capabilities.

### Tools, context, and execution

38. As an agent author, I want tools: inherit to select the parent's active tools, so that inheritance is explicit and understandable.
39. As an agent author, I want an explicit tool list to replace inheritance, so that a restricted specialist receives only its selected capability tools.
40. As an agent author, I want a new definition with no effective tools selection to default to inheritance, so that it follows the session rather than a separate hardcoded list.
41. As a user, I want inherited subagent-management tools excluded, so that child agents cannot recursively delegate in the first release.
42. As a user, I want built-in read/search tools available in a child independently of the parent's active selection, so that a reviewer can use grep without enabling it in my main session.
43. As a user, I want no new optional-tools syntax or special web integration system, so that ordinary tool lists remain sufficient.
44. As a user, I want all agents except debug to start with fresh conversation context by default, so that delegated tasks remain focused.
45. As a user, I want applicable user and project standing instructions retained separately from conversation history, so that specialists respect my working conventions.
46. As a user, I want child tool guidance derived from the child's real tool selection, so that a restricted specialist is not told to use tools it lacks.
47. As a user, I want parent-only orchestration instructions excluded from children, so that specialists do not mistake themselves for the coordinator.
48. As a user, I want model, thinking, inherited tools, and relevant context captured when a request is made, so that later parent changes do not alter queued work.
49. As a user, I want background execution by default with an explicit foreground option, so that the parent can continue useful work.
50. As a user, I want upstream's background completion and result-delivery behaviour preserved, so that I receive outcomes without a new notification protocol.
51. As a user, I want steering, cancellation, resume, and transcript behaviour preserved, so that ongoing work remains manageable.
52. As a user, I want potentially file-changing children serialized within a shared workspace, so that concurrent children do not compete to modify the same files.
53. As a user, I want scheduling based on effective tools rather than role names, so that overrides cannot accidentally bypass workspace scheduling.
54. As a user, I want shell and unclassified custom tools treated conservatively, so that a tool list is not incorrectly assumed to be read-only.

### Model and reasoning selection

55. As a user, I want a tool-call model override to win over an agent-file model, so that I can deliberately change one launch.
56. As a user, I want an agent-file model to win over automatic routing, so that specialist defaults are honoured.
57. As a user, I want explicit model choices to require exact provider/model identities, so that shorthand does not silently choose a version or provider.
58. As a user, I want unavailable explicit model choices reported consistently, so that neither files nor tool calls silently fall back to a different model.
59. As a user, I want explicit model choices usable without a recognized family profile, so that automatic routing support is not a prerequisite for deliberate selection.
60. As a user, I want automatic routing based on series, version, variant, and tier relationships, so that arbitrary name fragments or prices do not determine the child model.
61. As a user, I want profiles for Claude, Kimi, GPT, MiniMax, Gemini, Qwen, MiMo, and DeepSeek, so that the major agreed series are supported.
62. As a user, I want cross-version compatibility declared explicitly, so that an older or unrelated model is not assumed to be a valid downgrade.
63. As a user, I want the router to walk downward to an available compatible lower tier, so that one unavailable intermediate tier does not stop useful routing.
64. As a user, I want concrete target model IDs ordered by preference, so that routing neither invents IDs nor depends on registry enumeration order.
65. As a user, I want family routing to defer provider access and restrictions to session model resolution, so that it does not impose a separate same-provider policy or invent credentials.
66. As a user, I want an unknown family to produce an automatic-routing error, so that the runtime does not guess a family from price or silently keep the parent model.
67. As a user, I want a recognized family with no available lower target to retain the parent model, so that reasoning fallback can still make delegation economical.
68. As a user, I want reasoning defaults to prefer medium, then low, then the lowest supported non-off level, so that defaults remain useful across different models.
69. As a user, I want reasoning fallback on a retained parent model never to increase effort, so that a cost-saving fallback does not become more expensive.
70. As a user, I want explicit thinking chosen in the tool call to win over the file and then automatic selection, so that per-task choices are respected.
71. As a user, I want unsupported non-off thinking requests clamped to supported levels, so that a specialist is not rejected for a level the chosen model cannot express exactly.
72. As a user, I want a non-reasoning model to remain usable, so that lack of reasoning support does not invalidate an otherwise valid model choice.
73. As a user, I want thinking discarded for non-reasoning models, so that the runtime does not pretend an unsupported setting took effect.
74. As a user, I want actual provider, model ID, thinking applicability, and routing reason visible in launch/result presentation, so that automatic decisions are inspectable.

### Settings, extensibility, and maintainability

75. As a user, I want @juanibiapina/pi-extension-settings to manage both operational settings and family profiles, so that this extension does not invent another settings backend.
76. As a user, I want to override one family without discarding other families, so that project customizations compose with personal settings.
77. As a user, I want each named profile replaced as a whole across layers, so that partial ladder merges cannot create unintended routing relationships.
78. As a user, I want to add family profiles using the same schema as shipped profiles, so that new supported families do not require editing package source merely to add routing data.
79. As a maintainer, I want profiles limited to supported naming structures without user matchers or executable parsers, so that configuration remains data rather than an extension language.
80. As an extension developer, I want tool and programmatic launches to share configuration decisions, so that the two launch paths cannot drift.
81. As a maintainer, I want family-specific strategies behind a small shared interface, so that genuine naming differences are localized.
82. As a maintainer, I want tests to assert behaviour rather than private class structure, so that OOP refactoring remains possible without rewriting tests for every internal change.
83. As a maintainer, I want the rest of the workspace checked against the approved Pi runtime upgrade, so that the new package does not silently break sibling packages.
84. As a user, I want documentation to distinguish inherited behaviour, intentional changes, and unfinished work, so that architectural explanations are trustworthy.

## Implementation Decisions

### Provenance, packaging, and compatibility

- Scaffold and maintain the package using the repository's local generators, package scope, metadata, Nx targets, and root-managed shared dependencies. Stay on main unless explicitly instructed otherwise. Do not introduce package-level scripts or duplicate shared Pi runtime development dependencies.
- Use the already-approved Pi 1.3.0 workspace upgrade as the compatibility baseline and verify affected existing packages. An edited manifest alone does not establish a successful upgrade.
- Credit @gotgenes/pi-subagents v25.0.1 as the immediate source, preserve applicable MIT notices and attribution, and acknowledge inherited upstream provenance accurately. The tools-inherit convention was also informed by Nico's pi-subagents, but this project's semantics differ.
- Treat this package as a replacement runtime, not a second simultaneously enabled orchestrator. Retain familiar model-facing tool names; publish the programmatic service under this package's own identity rather than overwriting the original package's global identity.
- Preserve lifecycle functionality by default. The explicit role, configuration, routing, scheduling, settings, and diagnostic changes in this specification are intentional differences, not an instruction to preserve every upstream quirk.
- Respect existing minimal-core principles: observational lifecycle events remain observational, workspace provision remains separate from execution, and no speculative extension hooks are introduced merely to support a hypothetical consumer.

### Object ownership and shared resolution

- Introduce one shared configuration-resolver object used by both model-facing tool launches and programmatic service launches. Its interface takes the effective request, captured parent inputs, applicable definitions, profiles, and session-resolution collaborators, and returns resolved child configuration plus decision explanations or a clear error.
- The resolver owns definition merging, explicit model/thinking precedence, family routing, tool selection, and role defaults. It does not create SDK sessions, execute agents, render UI, or own notification delivery.
- Keep session construction, execution records, run state, queueing, observation, and UI as separate cohesive objects. Prefer composition and explicit collaborators; retain useful pure internal helpers rather than converting every function into a shallow class.
- Keep shared interfaces structural and local/public where practical. Do not expose concrete foreign classes with private fields across package interfaces.
- Preserve by-value, serializable public records. Add resolved model/thinking selection facts as stable launch decisions rather than exposing live sessions or arbitrary internal state. Preserve the existing distinction between discrete records and live activity reports.

### Agent definitions

- Ship explore, worker, reviewer, debug, and researcher. Do not ship plan or general-purpose as additional defaults.
- Discover global and project Markdown definitions using the established agent-definition locations. Merge shipped definitions, global definitions, then trusted project definitions, with later layers taking precedence field by field.
- Normalize identifiers to lowercase and keep display names separate. Reject duplicate normalized identifiers within the same scope. A cross-scope match is an override, not a duplicate error.
- Omission means inherit; explicit values replace; null clears optional inherited settings; explicit empty lists remain empty. Clearing an optional model or thinking choice restores the applicable automatic selection behaviour. Do not concatenate list values across layers.
- The Markdown body is the specialist's standing instructions. Empty bodies inherit; nonempty bodies replace. Do not introduce a prompt frontmatter property or an implicit prompt-concatenation mode for definition overrides.
- Preserve user control over enablement. Unknown or disabled agent requests must not silently become another role.
- Honour Pi's existing project-trust decision for both project definitions and project settings. Do not bypass trust through direct custom file loading or settings helpers that default to project scope.

### Roles, tools, and instructions

- Explore lists read, grep, find, and ls. Reviewer lists read, grep, and find. Researcher lists read, grep, find, ls, and web_search directly.
- Researcher's web_search entry uses ordinary tool-list behaviour. Do not add optional_tools, integration profiles, alias detection, Firecrawl-specific matching, a mandatory web dependency, or a custom missing-search prerequisite. A listed name does not install or implement a tool. Do not add separate web fetching/retrieval tools automatically.
- Worker and debug use the inherit keyword. The effective selection is the parent's active tools captured at request time, not every configured tool and not a hardcoded built-in list. Strip subagent-management tools unconditionally.
- An explicit list replaces inheritance. Mixed inherit/list forms are not supported. If no definition layer supplies a selection, default to inherit. Empty lists mean no capability tools.
- Built-in tools may be instantiated for children even when inactive in the parent. Extension tools require their actual implementations to be registered and usable in the child. Verify this after extension initialization; copying names is not sufficient evidence of working inheritance.
- Retain existing child-parent communication mechanisms independently of capability-tool lists where upstream already injects them. They do not authorize recursive delegation.
- Reviewer is a non-editing code assessor. Its parent supplies requirements, scope, and a diff or readable diff artifact. It inspects surrounding code and reports actionable findings and uncertainty without claiming it executed checks.
- Worker performs the delegated implementation using inherited capabilities. Its standing instructions require scoped work, evidence of actual validation, and escalation of consequential ambiguities rather than unrelated changes or invented verification.
- Debug owns diagnosis and diagnostic artifacts, not implementing the production repair. Emphasize a repeatable exact-symptom feedback loop, minimization, falsifiable hypotheses, targeted probes, one changed variable at a time, evidence-backed conclusions, secret redaction, and cleanup of temporary instrumentation. If blocked, distinguish missing evidence from a confirmed cause. Return findings to the parent; do not automatically launch worker.
- The debug role's limits are instructions, not a filesystem sandbox, because its diagnostic work requires editing and execution capabilities.
- Researcher returns source-backed findings and distinguishes external evidence from inference. Do not imply live search occurred if the tool was not available or used.
- Fresh conversation is the default except for debug, which inherits parent conversation by default. Keep explicit context controls; do not equate tool inheritance with conversation inheritance.
- Retain applicable user/project standing instructions for every role. Generate tool guidance for the actual child tools and omit parent-only orchestration instructions. Preserve compatible provider-scoped prompt handling from upstream rather than blindly copying the whole parent system prompt; assemble prompt contributions after model resolution when transport behaviour depends on the selected provider.

### Family profiles and model selection

- Precedence is explicit tool-call model, then effective agent-file model, then automatic family routing. There are no model locks and no additional settings-based per-agent model pins.
- Explicit model selections require exact provider/model identity. Parse the provider separately while preserving the remaining model ID, which may itself contain a namespace separator. Resolve exactly or fail. Do not use fuzzy matching, provider assumptions, or cross-provider fallback.
- Explicit selection bypasses family recognition, including for new families the router does not know. Apply thinking handling independently after the explicit model resolves.
- Model identity, display name, series, version, variant/tier, and qualifiers are separate concepts. Do not assume the last number is always a version, all pro or fast suffixes mean the same thing, or hyphen position is uniform across series.
- Initially provide strategy classes for GPT, Claude, Gemini, Kimi, MiniMax, Qwen, MiMo, and DeepSeek behind a shared family-strategy interface. Localize genuine series-specific interpretation there. Keep model releases, tier ladders, target preferences, and version compatibility as profile data rather than subclasses per release.
- User-defined profiles follow the same schema and already-supported naming structures. They must be consumable without authoring a strategy class. Genuinely new naming structures require runtime code support. Do not accept user regexes, wildcard targets, matcher callbacks, parser functions, or executable settings.
- Profiles explicitly enumerate concrete model IDs, their series/version and tier relationships, and permitted cross-version transitions. Do not synthesize nonexistent variants. Preserve meaningful snapshot, specialization, serving, and other qualifiers unless the applicable strategy/profile explicitly defines their relationship.
- Prefer a compatible lower tier at the same version; allow crossing versions only through profile-declared relationships. The requested GPT example is a parent on 6.1 Sol selecting a listed Luna target from an explicitly approved compatible version. Do not generalize that example to every minor-version pair or treat unverified local catalog names as universal vendor facts.
- Walk downward through permitted lower tiers rather than requiring the immediate rung or jumping straight to the cheapest model. Within a target tier/version, try concrete IDs in profile preference order. Continue downward if none are available.
- Family routing is not a provider-routing policy. Use the session's model resolution, credentials, availability, and restrictions to materialize family candidates. Do not independently impose same-provider-only selection, invent credentials, or select an arbitrary provider through fuzzy matching or registry order.
- Unknown parent families produce an automatic-routing error. There is no output-cost ranking fallback. A known family with no compatible available lower target retains the captured parent model and attempts the reasoning fallback.
- Validate profile data and supported naming structures explicitly. The exact settings encoding and profile schema must express the agreed semantics without becoming an executable configuration language. Malformed data must not silently create unrelated routing relationships.

### Thinking selection

- Resolve the child model before reasoning. Precedence is explicit tool-call thinking, then effective agent-file thinking, then automatic selection.
- For reasoning-capable models, automatic defaults prefer medium, then low, then the lowest supported non-off level. Use Pi's reported supported levels/model metadata rather than parsing a display name or assuming uniform support across a series.
- When retaining the parent model because no lower target exists, prefer medium or low only when lower than the parent's captured effort; otherwise choose a supported lower non-off level where possible. Never increase the parent's effort through this fallback. If no lower non-off level exists, retain its effort.
- Clamp unsupported explicit non-off requests using Pi-compatible ordering rather than rejecting an otherwise valid launch. Prevent clamping from silently selecting off for a reasoning-capable model. Do not use a numerical midpoint algorithm.
- Automatic selection never disables reasoning on a reasoning-capable model. Preserve the agreed prohibition on an explicit off request for such models; permitting non-reasoning models is not the same as disabling a capable model's reasoning.
- Non-reasoning models are valid explicit and automatic candidates. Discard/reject the inapplicable thinking setting, not the subagent launch. Represent thinking as not applicable, not as successfully applied medium/low or an arbitrary setting that enables unsupported capability.

### Runtime, scheduling, and settings

- Capture parent model, selected thinking, active tool selection, and relevant prompt/conversation inputs when a request is made. Queued runs retain that snapshot even if the parent later changes. Capture or materialize routing inputs sufficiently to keep the resolved request deterministic; do not silently reroute from a later parent selection if a target cannot start.
- Run all five roles in the background by default while retaining explicit foreground launches. Preserve upstream's completion/result delivery, steering, cancellation, retention, transcript, and resume semantics unless an independently reproduced bug requires a documented fix.
- Permit at most one potentially file-changing child at a time in a shared workspace. Read-only children may run concurrently, subject to existing concurrency limits. Determine classification from effective post-override capabilities, not role names. General-purpose shell, editing, and unclassified custom tools require the exclusive slot.
- This scheduling rule is not a sandbox, does not coordinate unrelated parent/user edits, and does not provide a consistent snapshot to readers while another child writes. Preserve cancellation and resource cleanup while queued, running, resuming, or failing; do not introduce recursion-related scheduling deadlocks.
- Use @juanibiapina/pi-extension-settings as the single backend for existing operational settings and family profiles. Do not add a second custom settings store, profile-path system, or settings-based per-agent model overrides.
- Layer profile overrides by family: shipped defaults, global overrides, then trusted project overrides. Replace each named family profile wholesale; do not erase other families or merge fragments of incompatible ladders. Preserve a distinction between an absent project override and an explicit family replacement when reading layered settings.
- Investigate the settings package's real string-valued interface, registration/load-order requirements, scope handling, and workspace dependency policy before implementation. Hide serialization behind a small adapter; do not change the agreed settings experience or evade extension dependency rules by silently changing package classification.
- Expose the actual resolved provider/model ID, applied thinking or not-applicable state, and decision reason through existing launch/result metadata and UI. These are stable selection facts, not a new command or notification protocol. Do not claim a successful model selection or verification before the runtime has performed it.

## Testing Decisions

### Confirmed testing seams

The user explicitly confirmed two complementary seams: behaviour of the shared configuration resolver, and integration through the existing tool/programmatic launch entry points. Prefer those high-level interfaces rather than creating a new test interface for every class.

- Configuration tests assert effective child configuration, decisions, and errors. They should not inspect private fields, constructor order, class counts, or the internal choice of helpers.
- Launch integration tests exercise the public launch paths and inspect the resulting child session/tool selection and observable records/events. A requested tool-name list alone is not proof that the actual child has the intended tools after extensions initialize.
- Use controllable session/model/settings collaborators at existing seams to make tests deterministic. Keep genuine SDK integration checks where behaviour depends on SDK registration, thinking support, prompt assembly, or tool activation. Avoid tests that merely mock the behaviour being claimed.

### Characterization and prior art

- The copied package currently has no test files. Recover compatible upstream tests from the corresponding source revision where possible, preserve their notices, and add missing characterization coverage before structural refactoring.
- Existing workspace agent-resource tests demonstrate table-driven validation, explicit expected tool-selection behaviours, and ordinary Vitest behaviour assertions. Reuse those testing conventions without treating a different subagent runtime's schema as this runtime's contract.
- Upstream's public service-record policy describes exact assertions on admitted serialized fields and mutation-isolation tests. Preserve that style for by-value snapshots and stable resolved selection facts.
- Treat copied architecture records as evidence of intended upstream behaviour, not proof the local derivative already implements it. Classify deliberate new requirements separately from regression failures.

### Required coverage

- Definition discovery and merging: global/project precedence, trusted/untrusted scopes, normalized names, duplicate errors, disabled/unknown roles, absent versus null versus empty, list replacement, and empty/nonempty instruction bodies.
- Tool selection: inherit versus explicit modes, omitted defaults, no mixed modes, captured active versus all configured tools, recursion exclusions, built-in grep usable in a restricted child without changing parent tools, and actual registration/use of inherited extension tools.
- Exact shipped tool lists, including researcher's literal web_search entry and ordinary missing-tool behaviour without bespoke prerequisites. Do not replace this acceptance criterion with a test that only copies tool names from the parent.
- Both launch entry points produce the same effective role defaults and explicit model/thinking precedence.
- Explicit model resolution: exact identities, model IDs containing namespace separators, rejection of shorthand, unavailable models, no provider fallback, and explicit use of unrecognized families.
- Family routing: fixtures for all eight strategies; concrete target IDs; ordered alternatives; same-version preference; approved cross-version routes; rejection of unapproved relationships; walking past unavailable tiers; unknown-family errors; and recognized-family exhaustion.
- User-added profiles using supported schema/naming structures, named-profile replacement without erasing unrelated families, project-trust enforcement, and refusal to execute user matcher/parser logic.
- Thinking: medium preference, low fallback, lowest non-off fallback, explicit precedence, supported-level clamping, no automatic off, explicit off policy, no increase on retained-parent fallback, non-reasoning models, and truthful not-applicable reporting.
- Request-time snapshots: change parent model, effort, tools, and conversation while a request waits; assert that queued work uses its captured inputs.
- Scheduling: readers can overlap, exclusive children do not overlap in a shared workspace, classification changes after overrides, and cancellation/failure/resume do not leak or bypass the exclusive slot.
- Lifecycle regression: background default, explicit foreground, completion/result retrieval, failures, steering, questions/updates where retained, cancellation, resume eligibility, retention, transcripts, shutdown, provider registration inheritance, and package exclusions.
- Prompt behaviour: applicable user/project rules, fresh versus debug conversation defaults, removal of stale parent tool/orchestration guidance, child-directory context, and retained provider-specific portable inheritance.
- Settings adapter: global/project scopes, trusted-project filtering, per-family layering, defaults, persistence, and registration timing using the selected package's actual behaviour.
- Resolved metadata: correct provider/model ID, thinking applicability, selection reason, and serializable by-value records without exposing live SDK objects.
- Reproduce suspected bugs with a failing test before declaring them fixed. Do not treat compile failures in the unfinished experimental scaffolding as evidence that upstream shipped the same defect.
- Run verification through workspace package-manager-prefixed Nx targets with the daemon disabled, as requested. Include affected sibling-package checks for the Pi runtime upgrade. Keep normal tests credential-free; document any optional live-model smoke checks separately from deterministic acceptance coverage.

## Out of Scope

- A verbatim port or a commitment to preserve upstream's internal layout and every implementation quirk.
- Simultaneous operation with another subagent runtime in the same session.
- A built-in plan agent, an additional general-purpose role, or a manual command-driven agent picker in the first release.
- Nested subagent delegation, automatic debug-to-worker pipelines, or autonomous repair authorization.
- A filesystem sandbox, unrestricted-shell safety guarantees, isolated-worktree orchestration, or coordination of parent/user edits through the child scheduling rule.
- New lifecycle notification protocols, replacement transcript formats, or redesigning steering/resume/cancellation without a demonstrated need.
- Fuzzy explicit model selection, assumed providers, automatic provider fallback for explicit choices, price-based tier inference, or guessing unknown families.
- User-provided matchers, regex routing rules, executable profile configuration, or automatic synthesis of model IDs.
- New optional-tool properties, automatic community web-tool alias discovery, Firecrawl-specific adapters, mandatory web dependencies, and automatically adding fetch or stored-result tools to researcher.
- A separate profile-file settings system, a competing settings backend, or settings-based per-agent model pins.
- Editing the separate agent-manager product to promise universal runtime-profile conversion or authoring compatibility as part of this work.
- Speculative extension hooks, broad inheritance hierarchies, or refactoring every pure function into a class.

## Further Notes

- This specification supersedes earlier experimental proposals in the conversation: full-definition replacement, model locks, a shipped Plan role, fuzzy explicit selection, same-provider-only automatic routing, output-price fallback, optional-tools properties, mandatory researcher web-tool checks, and exclusion of non-reasoning models are not the agreed design.
- The latest researcher decision is deliberately simple: web_search is written directly into its tool list. Earlier proposals for parent-presence filtering and web integration profiles were superseded.
- The existing HTML explanation mixes upstream facts, proposed changes, and incomplete implementation. Update it to match verified behaviour and clearly distinguish inherited source, intentional divergences, outstanding work, and confirmed fixes.
- The approved development order is explanation, characterization, bug reproduction, incremental OOP refactoring, implementation of intentional changes, and verification. Do not resume an incomplete experimental patch blindly or describe the current scaffold as working.
- Build and validate family profiles against trustworthy model information and representative registries. Naming examples and a local cached model catalog are not proof of current vendor availability, pricing, supported reasoning controls, or model equivalence.
- Session model-resolution behaviour across providers and extension-tool recreation must be verified against the installed SDK. Respect existing session policy; do not fill API gaps with arbitrary registry-order choices or silently execute inherited tools against the parent's session context.
- Settings representation is an implementation detail, but the selected package's scope-merging behaviour may require reading global and project layers separately to preserve per-family overrides. Its UI registration requires careful load-order integration. Preserve the repository's package dependency constraints while integrating it.
- Retain relevant upstream architecture principles concerning minimal extension seams, provider-scoped prompt inheritance, directory-resolved project instructions, session-resolved tool guidance, and by-value public records. Document intentional departures rather than treating copied architecture history as fresh decisions for this derivative.
