import {
  isDevelopmentExtensionRuntime,
  notifyWhenUsingDevelopmentExtension,
  resetDevelopmentExtensionNotice,
} from "./runtime";

describe("shared/runtime", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetDevelopmentExtensionNotice();
  });

  it("detects development mode from a runtime env flag", () => {
    vi.stubEnv("PI_RESOURCE_DEV", "1");

    expect(isDevelopmentExtensionRuntime()).toBe(true);
  });

  it("notifies once per extension when the extension is running from development sources", () => {
    vi.stubEnv("PI_RESOURCE_DEV", "1");
    const notify = vi.fn();
    const ctx = { ui: { notify } };

    notifyWhenUsingDevelopmentExtension("agent-manager", ctx);
    notifyWhenUsingDevelopmentExtension("agent-manager", ctx);
    notifyWhenUsingDevelopmentExtension("skill-manager", ctx);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(
      1,
      "agent-manager is running in development mode. Nothing is being saved.",
      "warning",
    );
    expect(notify).toHaveBeenNthCalledWith(
      2,
      "skill-manager is running in development mode. Nothing is being saved.",
      "warning",
    );
  });

  it("stays quiet when development mode is disabled", () => {
    vi.stubEnv("PI_RESOURCE_DEV", "0");
    const notify = vi.fn();

    notifyWhenUsingDevelopmentExtension("agent-manager", { ui: { notify } });

    expect(notify).not.toHaveBeenCalled();
  });
});