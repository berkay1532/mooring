import { describe, expect, it, vi } from "vitest";

// Regression test for the symlink-safe entrypoint guard: importing the module
// (as vitest does for every test file above) must never trigger `parseAsync`
// — under vitest, `process.argv[1]` is the test runner's own entry script, not
// `dist/index.js`, so the guard's path comparison must resolve to `false` and
// the file's only top-level side effect (the `if (isMainModule) { ... }`
// block) must not run.
describe("entrypoint guard", () => {
  it("does not run parseAsync merely by being imported", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const originalExitCode = process.exitCode;
    try {
      await import("../src/index.js");
      expect(writeSpy).not.toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(originalExitCode);
    } finally {
      writeSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
