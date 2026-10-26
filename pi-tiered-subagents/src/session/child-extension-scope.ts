import { AsyncLocalStorage } from "node:async_hooks";

// Pi's source loader and the host can instantiate separate module copies.
// Share only this explicit execution scope, not a process-wide child flag.
const key = Symbol.for(
  "@code-fixer-23/pi-tiered-subagents:child-extension-scope",
);
const globals = globalThis as Record<symbol, unknown>;
const scope = (globals[key] ??=
  new AsyncLocalStorage<boolean>()) as AsyncLocalStorage<boolean>;

export function duringChildExtensionLoading<T>(load: () => T): T {
  return scope.run(true, load);
}

export function isChildExtensionLoading(): boolean {
  return scope.getStore() === true;
}
