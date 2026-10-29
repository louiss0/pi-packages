# 1.0.0 (2026-10-29)

### 🚀 Features

- **pi-tiered-subagents:** support XL model routing ([8e66ea2](https://github.com/louiss0/pi-packages/commit/8e66ea2))
- **pi-tiered-subagents:** route dynamically by parent version ([#11](https://github.com/louiss0/pi-packages/pull/11))
- **pi-tiered-subagents:** modernize record types and validation ([#11](https://github.com/louiss0/pi-packages/pull/11))
- **pi-tiered-subagents:** keep routing within the parent version ([2325693](https://github.com/louiss0/pi-packages/commit/2325693))
- **pi-tiered-subagents:** route models by agent role ([#10](https://github.com/louiss0/pi-packages/pull/10))
- **pi-tiered-subagents:** complete lifecycle and API modernization ([29ad856](https://github.com/louiss0/pi-packages/commit/29ad856))
- **pi-tiered-subagents:** story 101 — exhaustive discriminated union handling via assertNever sentinel ([4711935](https://github.com/louiss0/pi-packages/commit/4711935))
- **sdk-adapter:** localize SDK model/reasoning details (story 41) ([989eec9](https://github.com/louiss0/pi-packages/commit/989eec9))
- ⚠️  **pi-tiered-subagents:** complete story 16 single capture + story 85 session-ended ([3f476a0](https://github.com/louiss0/pi-packages/commit/3f476a0))
- ⚠️  **pi-tiered-subagents:** asynchronous launch acceptance with launch/run ([75417e8](https://github.com/louiss0/pi-packages/commit/75417e8))
- **pi-tiered-subagents:** capture exact child tool capabilities ([e57b79a](https://github.com/louiss0/pi-packages/commit/e57b79a))
- **pi-tiered-subagents:** own prepared model decisions ([11e2147](https://github.com/louiss0/pi-packages/commit/11e2147))
- **pi-tiered-subagents:** capture the parent's model as an owned identity ([ab5727b](https://github.com/louiss0/pi-packages/commit/ab5727b))
- **pi-tiered-subagents:** capture child-shaping settings with the launch ([dd5d896](https://github.com/louiss0/pi-packages/commit/dd5d896))
- **pi-tiered-subagents:** route both launch doors through one preparation authority ([20f8cc3](https://github.com/louiss0/pi-packages/commit/20f8cc3))
- **pi-tiered-subagents:** tie every launch to the session that asked ([3a0066e](https://github.com/louiss0/pi-packages/commit/3a0066e))
- **pi-tiered-subagents:** resolve the turn budget once, as a closed policy ([482c103](https://github.com/louiss0/pi-packages/commit/482c103))
- ⚠️  **pi-tiered-subagents:** one concurrency cap for every run ([e7cb410](https://github.com/louiss0/pi-packages/commit/e7cb410))
- ⚠️  **pi-tiered-subagents:** remove extension-owned project-trust gating ([8a90d0e](https://github.com/louiss0/pi-packages/commit/8a90d0e))
- **pi-tiered-subagents:** carry the resolved launch decision onto records ([eb00f42](https://github.com/louiss0/pi-packages/commit/eb00f42))
- **pi-tiered-subagents:** resolve both spawn doors through one resolver ([1546f27](https://github.com/louiss0/pi-packages/commit/1546f27))
- **pi-tiered-subagents:** do not inherit the harness's own text ([44674e7](https://github.com/louiss0/pi-packages/commit/44674e7))
- **pi-tiered-subagents:** keep the settings in the shared store ([afb6c17](https://github.com/louiss0/pi-packages/commit/afb6c17))
- **pi-tiered-subagents:** let one child at a time change the workspace ([56b0f69](https://github.com/louiss0/pi-packages/commit/56b0f69))
- **pi-tiered-subagents:** choose the reasoning level after the model ([26edcb9](https://github.com/louiss0/pi-packages/commit/26edcb9))
- **pi-tiered-subagents:** choose the child's model by exact name or one tier down ([fe17b0d](https://github.com/louiss0/pi-packages/commit/fe17b0d))
- **pi-tiered-subagents:** add the model-selection domain ([97103fc](https://github.com/louiss0/pi-packages/commit/97103fc))
- **pi-tiered-subagents:** add the agent-definition domain and ship five specialists ([bc8b48c](https://github.com/louiss0/pi-packages/commit/bc8b48c))
- **pi-tiered-subagents:** publish the service under this package's identity ([74ac32a](https://github.com/louiss0/pi-packages/commit/74ac32a))
- **pi-tiered-subagents:** import the upstream runtime and its test suite ([07af043](https://github.com/louiss0/pi-packages/commit/07af043))

### 🩹 Fixes

- **pi-tiered-subagents:** retain upstream MIT notice ([0bbf14f](https://github.com/louiss0/pi-packages/commit/0bbf14f))
- **pi-tiered-subagents:** preserve definition diagnostics ([694bddd](https://github.com/louiss0/pi-packages/commit/694bddd))
- **pi-tiered-subagents:** skip non-conversation messages ([2a36db8](https://github.com/louiss0/pi-packages/commit/2a36db8))
- **pi-tiered-subagents:** lower child reasoning effort ([344f27e](https://github.com/louiss0/pi-packages/commit/344f27e))
- **pi-tiered-subagents:** stabilize SDK and lifecycle boundaries ([070bb31](https://github.com/louiss0/pi-packages/commit/070bb31))
- **pi-tiered-subagents:** read the project's own file, and write only that layer ([bc4a456](https://github.com/louiss0/pi-packages/commit/bc4a456))
- **pi-tiered-subagents:** answer the review of the shared settings backend ([8560081](https://github.com/louiss0/pi-packages/commit/8560081))
- **pi-tiered-subagents:** answer the review of the workspace scheduling ([18f69f3](https://github.com/louiss0/pi-packages/commit/18f69f3))
- **pi-tiered-subagents:** answer the review of the model increments ([54ac57f](https://github.com/louiss0/pi-packages/commit/54ac57f))
- **pi-tiered-subagents:** answer the review of the definitions increment ([e33398a](https://github.com/louiss0/pi-packages/commit/e33398a))
- **pi-tiered-subagents:** follow Pi's packaging rules and the review findings ([e189101](https://github.com/louiss0/pi-packages/commit/e189101))

### ⚠️  Breaking Changes

- **pi-tiered-subagents:** complete story 16 single capture + story 85 session-ended  ([3f476a0](https://github.com/louiss0/pi-packages/commit/3f476a0))
- **pi-tiered-subagents:** asynchronous launch acceptance with launch/run  ([75417e8](https://github.com/louiss0/pi-packages/commit/75417e8))
  SubagentsService.spawn and SpawnOptions.foreground are
  removed with no compatibility alias. Callers must await launch/run and
  branch on the discriminated result.
- **pi-tiered-subagents:** one concurrency cap for every run  ([e7cb410](https://github.com/louiss0/pi-packages/commit/e7cb410))
- **pi-tiered-subagents:** remove extension-owned project-trust gating  ([8a90d0e](https://github.com/louiss0/pi-packages/commit/8a90d0e))

### ❤️ Thank You

- openhands