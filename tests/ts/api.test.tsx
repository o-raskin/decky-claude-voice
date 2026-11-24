import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../src/api";
import { Router } from "./mocks/decky-ui";
import { backend } from "./mocks/decky-api";
import { makeState } from "./fixtures";

describe("callables", () => {
  const table: [keyof typeof api, string, any[]][] = [
    ["getState", "get_state", []],
    ["toggleRecording", "toggle_recording", ["current", null, "q"]],
    ["startRecording", "start_recording", ["new"]],
    ["stopRecording", "stop_recording", [{ name: "G", appid: 1 }, "q"]],
    ["sendText", "send_text", ["hi", null, "current", ""]],
    ["respond", "respond", ["id", true, false]],
    ["cancel", "cancel", []],
    ["newChat", "new_chat", []],
    ["switchChat", "switch_chat", ["c2"]],
    ["deleteChat", "delete_chat", ["c2"]],
    ["setPref", "set_pref", ["model", "opus"]],
    ["setPanelTarget", "set_panel_target", ["new"]],
    ["refreshModels", "refresh_models", []],
  ];
  it.each(table)("%s calls %s with its arguments", async (fn, name, args) => {
    backend.on(name, () => "result");
    expect(await (api[fn] as any)(...args)).toBe("result");
    expect(backend.called(name)).toEqual([args]);
  });
});

describe("modelOptions", () => {
  it("lists Claude's own models and labels default with the current one", () => {
    const opts = api.modelOptions(makeState());
    expect(opts.map((o) => o.data)).toEqual(["default", "sonnet", "opus"]);
    expect(opts[0].label).toBe("default · sonnet");
    expect(opts[1].label).toBe("sonnet");
  });
  it("labels default plainly when the current model is unknown", () => {
    const opts = api.modelOptions(makeState({ models: { available: ["default", "opus"], current: "" } }));
    expect(opts[0].label).toBe("default");
  });
  it("appends a chosen model that is missing from the list, once", () => {
    const s = makeState({ prefs: { approval: "manual", model: "claude-x-1", effort: "default" } });
    expect(api.modelOptions(s).map((o) => o.data)).toEqual(["default", "sonnet", "opus", "claude-x-1"]);
    const known = makeState({ prefs: { approval: "manual", model: "opus", effort: "default" } });
    expect(api.modelOptions(known)).toHaveLength(3);
  });
  it("does not add an empty model name and does not mutate the state", () => {
    const s = makeState({ prefs: { approval: "manual", model: "", effort: "default" } });
    expect(api.modelOptions(s)).toHaveLength(3);
    expect(s.models.available).toEqual(["default", "sonnet", "opus"]);
  });
});

describe("option tables and labelOf", () => {
  it("has the expected effort levels and modes", () => {
    expect(api.EFFORT_OPTIONS.map((o) => o.data)).toEqual(["default", "low", "medium", "high", "xhigh", "max"]);
    expect(api.MODE_OPTIONS.map((o) => o.data)).toEqual(["manual", "auto"]);
  });
  it("labelOf finds a label or falls back to the value", () => {
    expect(api.labelOf(api.EFFORT_OPTIONS, "max")).toBe("Max (deep)");
    expect(api.labelOf(api.MODE_OPTIONS, "auto")).toBe("Auto-approve");
    expect(api.labelOf(api.MODE_OPTIONS, "other")).toBe("other");
  });
});

describe("quickActionsFor", () => {
  it("offers general actions without a game", () => {
    expect(api.quickActionsFor(null).map((a) => a.label)).toEqual(["Battery", "Load and heat", "Disk space", "Network"]);
  });
  it("offers game actions that mention the game by name", () => {
    const a = api.quickActionsFor({ name: "Elden Ring", appid: 1245620 });
    expect(a.map((x) => x.label)).toEqual(["Optimize game", "FPS and load", "Game crashes", "Battery"]);
    expect(a[0].prompt).toContain('"Elden Ring"');
    expect(a.every((x) => x.prompt.length > 10)).toBe(true);
  });
  it("falls back to a generic game name", () => {
    expect(api.quickActionsFor({ name: "", appid: 7 })[0].prompt).toContain('"the running game"');
  });
});

describe("formatting", () => {
  it("phaseLabel covers every phase", () => {
    expect(api.phaseLabel("recording", 7)).toBe("Listening… 7s");
    expect(api.phaseLabel("transcribing", 0)).toBe("Transcribing…");
    expect(api.phaseLabel("thinking", 0)).toBe("Thinking…");
    expect(api.phaseLabel("idle", 0)).toBe("Ready");
  });
  it("timeOf formats HH:MM", () => {
    expect(api.timeOf(1700000000)).toMatch(/^\d{2}:\d{2}$/);
  });
  it("ago uses now / minutes / hours / days", () => {
    const now = Date.now() / 1000;
    expect(api.ago(now)).toBe("now");
    expect(api.ago(now + 100)).toBe("now"); // clock skew never goes negative
    expect(api.ago(now - 5 * 60)).toBe("5 min");
    expect(api.ago(now - 59 * 60)).toBe("59 min");
    expect(api.ago(now - 3 * 3600)).toBe("3 h");
    expect(api.ago(now - 49 * 3600)).toBe("2 d");
  });
});

describe("useClaudeState", () => {
  const tickMs = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const setup = () => {
    vi.useFakeTimers();
    const calls = { n: 0 };
    return calls;
  };

  it("starts empty and fills in the first state", async () => {
    vi.useFakeTimers();
    backend.on("get_state", () => makeState({ error: "e" }));
    const { result } = renderHook(() => api.useClaudeState());
    expect(result.current).toBeNull();
    await tickMs(1);
    expect(result.current?.error).toBe("e");
  });

  it("polls every 1.2 s while idle and every 0.35 s while busy or waiting for approval", async () => {
    const calls = setup();
    let st = makeState();
    backend.on("get_state", () => (calls.n++, st));
    renderHook(() => api.useClaudeState());
    await tickMs(1);
    expect(calls.n).toBe(1);
    await tickMs(1100);
    expect(calls.n).toBe(1);
    await tickMs(150);
    expect(calls.n).toBe(2);
    st = makeState({ phase: "thinking" });
    await tickMs(1200);
    expect(calls.n).toBe(3);
    await tickMs(350);
    expect(calls.n).toBe(4);
    st = makeState({ pending: [{ id: "a", tool: "Bash", detail: "", risk: "normal", preview: { kind: "other" } }] });
    await tickMs(350);
    expect(calls.n).toBe(5);
    await tickMs(350);
    expect(calls.n).toBe(6);
  });

  it("retries after 1.5 s when the backend is busy", async () => {
    const calls = setup();
    let fail = true;
    backend.on("get_state", () => {
      calls.n++;
      if (fail) throw new Error("busy");
      return makeState({ error: "back" });
    });
    const { result } = renderHook(() => api.useClaudeState());
    await tickMs(1);
    expect(result.current).toBeNull();
    fail = false;
    await tickMs(1400);
    expect(calls.n).toBe(1);
    await tickMs(150);
    expect(calls.n).toBe(2);
    expect(result.current?.error).toBe("back");
  });

  it("pokeState refreshes immediately and restarts the timer", async () => {
    const calls = setup();
    backend.on("get_state", () => (calls.n++, makeState()));
    renderHook(() => api.useClaudeState());
    await tickMs(1);
    await tickMs(1000);
    expect(calls.n).toBe(1);
    await act(async () => {
      api.pokeState();
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(calls.n).toBe(2);
    await tickMs(1100);
    expect(calls.n).toBe(2); // the old timer was cancelled
    await tickMs(150);
    expect(calls.n).toBe(3);
  });

  it("stops polling and ignores late answers after unmount", async () => {
    const calls = setup();
    let release: (s: any) => void = () => {};
    backend.on("get_state", () => {
      calls.n++;
      return new Promise((r) => (release = r));
    });
    const { result, unmount } = renderHook(() => api.useClaudeState());
    await tickMs(1);
    unmount();
    await act(async () => {
      release(makeState({ error: "late" }));
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current).toBeNull();
    expect(calls.n).toBe(1);
    expect(() => api.pokeState()).not.toThrow(); // nothing mounted: no-op
    expect(calls.n).toBe(1);
  });

  it("a failure after unmount does not reschedule", async () => {
    const calls = setup();
    let fail: () => void = () => {};
    backend.on("get_state", () => {
      calls.n++;
      return new Promise((_, rej) => (fail = () => rej(new Error("x"))));
    });
    const { unmount } = renderHook(() => api.useClaudeState());
    await tickMs(1);
    unmount();
    await act(async () => {
      fail();
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(calls.n).toBe(1);
  });
});

describe("useGame", () => {
  it("is null when nothing runs", () => {
    const { result } = renderHook(() => api.useGame());
    expect(result.current).toBeNull();
  });

  it("reports the running game and follows changes", () => {
    vi.useFakeTimers();
    Router.MainRunningApp = { appid: "1245620", display_name: "Elden Ring" };
    const { result } = renderHook(() => api.useGame());
    expect(result.current).toEqual({ name: "Elden Ring", appid: 1245620 });
    Router.MainRunningApp = { appid: 2, display_name: "Hades" };
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current).toEqual({ name: "Hades", appid: 2 });
    Router.MainRunningApp = null;
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current).toBeNull();
  });

  it("keeps the same object while nothing changes and tolerates a missing name", () => {
    vi.useFakeTimers();
    Router.MainRunningApp = { appid: 3 };
    const { result } = renderHook(() => api.useGame());
    const first = result.current;
    expect(first).toEqual({ name: "", appid: 3 });
    act(() => void vi.advanceTimersByTime(4000));
    expect(result.current).toBe(first);
  });

  it("stops polling on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => api.useGame());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
