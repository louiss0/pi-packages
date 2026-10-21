import { describe, expect, it, vi } from "vitest";
import { DefinitionErrorReporter } from "#src/agents/report";

describe("DefinitionErrorReporter", () => {
  it("reports an error the parent has not heard about", () => {
    const report = vi.fn();
    new DefinitionErrorReporter(report).reportNew([
      'Two agent definitions normalize to the identifier "reviewer".',
    ]);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]?.[0]).toContain("normalize to the identifier");
  });

  it("does not report the same error twice", () => {
    const report = vi.fn();
    const reporter = new DefinitionErrorReporter(report);
    reporter.reportNew(["broken"]);
    reporter.reportNew(["broken"]);
    expect(report).toHaveBeenCalledOnce();
  });

  it("reports a new error alongside one already reported", () => {
    const report = vi.fn();
    const reporter = new DefinitionErrorReporter(report);
    reporter.reportNew(["first"]);
    reporter.reportNew(["first", "second"]);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1]?.[0]).toContain("second");
    expect(report.mock.calls[1]?.[0]).not.toContain("first");
  });

  it("says nothing when there is no error", () => {
    const report = vi.fn();
    new DefinitionErrorReporter(report).reportNew([]);
    expect(report).not.toHaveBeenCalled();
  });
});
