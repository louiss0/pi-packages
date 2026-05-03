# Tests that are failing

- None. `pnpm test` passes with 72 passing tests.

# What bugs are present

- The agent creation form may still have minor rendering issues during typing.
- The development-mode warning behavior was updated recently and should be smoke-tested manually in pi to confirm the activation notice appears once per extension with the filename-based name.

# What to do next

- Manually verify the `agent-manager`, `skill-manager`, and `prompt-manager` development-mode warnings inside pi.
- Confirm each warning appears on activation, includes the extension filename, and says that nothing is being saved.
- Review PR #12 and merge it if the manual verification looks correct.
- If the agent creation form still shows rendering artifacts, reproduce them and add a focused regression test before changing the form renderer again.
