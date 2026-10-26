import { expect, it } from "vitest";
import {
  duringChildExtensionLoading,
  isChildExtensionLoading,
} from "#src/session/child-extension-scope";

it("isolates overlapping child loading from independent parent discovery", async () => {
  const gate = Promise.withResolvers<void>();
  const child = duringChildExtensionLoading(async () => {
    expect(isChildExtensionLoading()).toBe(true);
    await gate.promise;
    expect(isChildExtensionLoading()).toBe(true);
  });
  expect(isChildExtensionLoading()).toBe(false);
  await duringChildExtensionLoading(async () => {
    await Promise.resolve();
    expect(isChildExtensionLoading()).toBe(true);
  });
  expect(isChildExtensionLoading()).toBe(false);
  gate.resolve();
  await child;
  expect(isChildExtensionLoading()).toBe(false);
});

it("restores the caller scope after loading rejects", async () => {
  await expect(
    duringChildExtensionLoading(async () => {
      await Promise.resolve();
      throw new Error("loader failed");
    }),
  ).rejects.toThrow("loader failed");
  expect(isChildExtensionLoading()).toBe(false);
});
