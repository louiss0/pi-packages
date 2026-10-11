# Agent Resources

Agent resources describe specialists that users can configure for a Pi subagent runtime. The agent manager owns authoring and managing these resources, not executing them.

## Language

**Agent definition**:
A Markdown document containing frontmatter configuration and a specialist's system prompt, interpreted by a particular subagent runtime.
_Avoid_: Subagent session, running agent

**Subagent runtime**:
The installed Pi extension responsible for discovering agent definitions and executing child agents according to its own configuration and permission rules.
_Avoid_: Agent manager

**Agent manager**:
The authoring interface for creating and managing agent definitions intended for a selected subagent runtime; it does not promise cross-runtime conversion or execution equivalence.
_Avoid_: Subagent runner

**Runtime profile**:
The supported frontmatter vocabulary and meaning for one particular subagent runtime, used to interpret an agent definition without translating it into another runtime's contract.
_Avoid_: Universal agent format
