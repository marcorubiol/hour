// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../static/theme-init.js"),
  "utf8",
);

describe("theme-init: a stale page reloads itself", () => {
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/h/today", reload },
      configurable: true,
    });
    new Function(source)();
  });

  it("reloads when a route module fails to load, once in 30 s", () => {
    const e = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(e);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on a failed module import, not on any other rejection", () => {
    const reject = (reason: unknown) => {
      const e = new Event("unhandledrejection") as Event & { reason: unknown };
      e.reason = reason;
      window.dispatchEvent(e);
    };
    reject(new TypeError("Failed to fetch"));
    expect(reload).not.toHaveBeenCalled();
    reject(new TypeError("Importing a module script failed."));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
