import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ask, micToggle } from "../../src/actions";
import { useClaudeState } from "../../src/api";
import { backend } from "./mocks/decky-api";
import { makeState } from "./fixtures";

const game = { name: "G", appid: 9 };

describe("micToggle", () => {
  it("passes target, game and quote to the backend and returns its answer", async () => {
    backend.on("toggle_recording", () => "started");
    expect(await micToggle(makeState(), game, "new", "quoted")).toBe("started");
    expect(backend.called("toggle_recording")).toEqual([["new", game, "quoted"]]);
  });
  it("defaults to the current chat and no quote", async () => {
    backend.on("toggle_recording", () => "stopped");
    expect(await micToggle(makeState(), null)).toBe("stopped");
    expect(backend.called("toggle_recording")).toEqual([["current", null, ""]]);
  });
  it("refreshes the state right away and again after 400 ms", async () => {
    vi.useFakeTimers();
    let n = 0;
    backend.on("get_state", () => (n++, makeState()));
    backend.on("toggle_recording", () => "started");
    renderHook(() => useClaudeState());
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    const before = n;
    await act(async () => {
      await micToggle(makeState(), null);
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(n).toBe(before + 1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    expect(n).toBe(before + 2);
  });
});

describe("ask", () => {
  it("sends the prompt with no quote and returns the backend promise", async () => {
    backend.on("send_text", () => true);
    expect(await ask("how is the battery", game, "c2")).toBe(true);
    expect(backend.called("send_text")).toEqual([["how is the battery", game, "c2", ""]]);
  });
  it("defaults to the current chat", async () => {
    await ask("x", null);
    expect(backend.called("send_text")[0][2]).toBe("current");
  });
  it("refreshes the state 150 ms later", async () => {
    vi.useFakeTimers();
    let n = 0;
    backend.on("get_state", () => (n++, makeState()));
    renderHook(() => useClaudeState());
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    const before = n;
    await act(async () => {
      ask("x", null);
      await vi.advanceTimersByTimeAsync(149);
    });
    expect(n).toBe(before);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2)));
    expect(n).toBe(before + 1);
  });
});
