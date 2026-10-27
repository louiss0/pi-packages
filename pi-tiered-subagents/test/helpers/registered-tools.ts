import { vi } from "vitest";
import subagentsExtension from "../../extensions/index";

/** A tool definition as Pi hands it back, read structurally by contract tests. */
type RegisteredTool = any;

/**
 * The tools the extension actually hands Pi, keyed by registered name.
 *
 * Parent-tool contract tests read these rather than a removed definition
 * wrapper, so they protect what a Pi installation installs.
 */
export function registeredTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerMessageRenderer: vi.fn(),
    registerTool: vi.fn((tool: RegisteredTool) => tools.set(tool.name, tool)),
    registerCommand: vi.fn(),
    on: vi.fn(),
    events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    exec: vi.fn(),
    getAllTools: vi.fn((): { name: string }[] => []),
    getActiveTools: vi.fn((): string[] => []),
  } as unknown as Parameters<typeof subagentsExtension>[0];

  subagentsExtension(pi);
  return tools;
}

/** One registered tool, failing loudly when the extension did not install it. */
export function registeredTool(name: string): RegisteredTool {
  const tool = registeredTools().get(name);
  if (!tool) throw new Error(`the extension did not register ${name}`);
  return tool;
}
