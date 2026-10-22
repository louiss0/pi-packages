import { describe, expect, it } from "vitest";
import { classifyWorkspaceImpact } from "#src/scheduling/impact";

describe("classifying what a child may change", () => {
  it("reads a child with only reading tools as harmless", () => {
    expect(
      classifyWorkspaceImpact(["read", "grep", "find", "ls", "web_search"]),
    ).toBe("read-only");
  });

  it("reads a child with no tools at all as harmless", () => {
    expect(classifyWorkspaceImpact([])).toBe("read-only");
  });

  it("reads a shell as a writer", () => {
    expect(classifyWorkspaceImpact(["read", "bash"])).toBe("file-changing");
  });

  it("reads an editor as a writer", () => {
    expect(classifyWorkspaceImpact(["read", "write", "edit"])).toBe(
      "file-changing",
    );
  });

  it("reads a tool it has never heard of as a writer", () => {
    // The conservative direction: a tool this package cannot vouch for may
    // change anything, so it takes the exclusive slot.
    expect(classifyWorkspaceImpact(["read", "some_extension_tool"])).toBe(
      "file-changing",
    );
  });

  it("reads a tool whose name merely resembles a reader as a writer", () => {
    expect(classifyWorkspaceImpact(["read", "readdir_write"])).toBe(
      "file-changing",
    );
  });
});
