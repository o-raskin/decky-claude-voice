import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Panel } from "../../src/Panel";
import { Navigation, Router } from "./mocks/decky-ui";
import { backend } from "./mocks/decky-api";
import { ev, makeState } from "./fixtures";
import { byText, mount, q, qa } from "./helpers";

const pending = { id: "r1", tool: "Bash", detail: "Command: ls", risk: "normal" as const, preview: { kind: "command", text: "ls" } };

describe("Panel: loading and header", () => {
  it("renders only the shell before the first state arrives", async () => {
    const { container } = await mount(<Panel />, {}, { get_state: () => new Promise(() => {}) });
    expect(q(container, ".cv-root")).toBeTruthy();
    expect(q(container, ".cv-hero")).toBeNull();
  });
  it("shows the chat title in the header", async () => {
    const { container } = await mount(<Panel />);
    expect(q(container, ".cv-status").textContent).toBe("Claude");
    expect(q(container, ".cv-sub").textContent).toBe("Chat one");
  });
  it("shows the running game instead of the chat title", async () => {
    Router.MainRunningApp = { appid: 1, display_name: "Hades" };
    const { container } = await mount(<Panel />);
    expect(q(container, ".cv-sub").textContent).toBe("Hades");
  });
});

describe("Panel: chat target", () => {
  const chats = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, title: `Chat ${i}`, updated: 1, count: 0, active: i === 0 }));

  it("lists New chat plus the eight latest chats", async () => {
    const { container } = await mount(<Panel />, { chats });
    const opts = qa(container, ".dropdown button").map((b) => b.getAttribute("data-opt"));
    expect(opts).toEqual(["new", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
    expect(q(container, ".dropdown").getAttribute("data-label")).toBe("Send to");
  });
  it("shows the selected chat in the button", async () => {
    const { container } = await mount(<Panel />, { chats, panel_target: "c3" });
    expect(q(container, ".dropdown-value").textContent).toBe("Chat: Chat 3");
    const fresh = await mount(<Panel />, { panel_target: "new" });
    expect(q(fresh.container, ".dropdown-value").textContent).toBe("Chat: New chat");
  });
  it("falls back to New chat when the target is not listed", async () => {
    const { container } = await mount(<Panel />, { chats, panel_target: "c9" });
    expect(q(container, ".dropdown-value").textContent).toBe("Chat: New chat");
  });
  it("choosing a chat saves it as the target", async () => {
    const { container } = await mount(<Panel />, { chats });
    fireEvent.click(q(container, '[data-opt="c2"]'));
    expect(backend.called("set_panel_target")).toEqual([["c2"]]);
  });
  it("is disabled while busy", async () => {
    const idle = await mount(<Panel />);
    expect(q(idle.container, ".dropdown").getAttribute("data-disabled")).toBe("false");
    const busy = await mount(<Panel />, { phase: "thinking" });
    expect(q(busy.container, ".dropdown").getAttribute("data-disabled")).toBe("true");
  });
});

describe("Panel: microphone button", () => {
  it("starts a recording in the chosen target", async () => {
    const { container } = await mount(<Panel />, { panel_target: "c1" }, { toggle_recording: () => "started" });
    const mic = byText(container, "button", "Speak");
    expect(mic.hasAttribute("disabled")).toBe(false);
    Router.MainRunningApp = null;
    fireEvent.click(mic);
    expect(backend.called("toggle_recording")).toEqual([["c1", null, ""]]);
  });
  it("shows the elapsed time and the recording style while recording", async () => {
    const { container } = await mount(<Panel />, { phase: "recording", rec_seconds: 7 });
    const mic = byText(container, "button", "Done · 7s");
    expect(q(mic, ".cv-mic-rec")).toBeTruthy();
  });
  it("is disabled when the Whisper model is missing, with a hint", async () => {
    const { container } = await mount(<Panel />, { model_ready: false });
    expect(byText(container, "button", "Speak").hasAttribute("disabled")).toBe(true);
    expect(container.textContent).toContain("Whisper model not found");
  });
  it("is replaced by Stop while transcribing or thinking", async () => {
    for (const phase of ["transcribing", "thinking"] as const) {
      const { container } = await mount(<Panel />, { phase });
      expect(byText(container, "button", "Speak")).toBeUndefined();
      fireEvent.click(byText(container, "button", "Stop"));
    }
    expect(backend.called("cancel")).toHaveLength(2);
  });
  it("shows backend errors", async () => {
    const { container } = await mount(<Panel />, { error: "recording too short" });
    expect(q(container, ".cv-err").textContent).toBe("recording too short");
    expect(container.textContent).not.toContain("Whisper model not found");
  });
});

describe("Panel: approvals", () => {
  it("shows pending approvals", async () => {
    const { container } = await mount(<Panel />, { pending: [pending] });
    expect(container.textContent).toContain("Allow this action?");
    fireEvent.click(byText(container, "button", "Allow"));
    expect(backend.called("respond")[0]).toEqual(["r1", true, false]);
  });
  it("shows no approval section otherwise", async () => {
    const { container } = await mount(<Panel />);
    expect(container.textContent).not.toContain("Allow this action?");
  });
});

describe("Panel: last message preview", () => {
  const caption = (c: HTMLElement) => q(c, ".cv-prev-dim")?.textContent;
  const body = (c: HTMLElement) => q(c, ".cv-prev")?.textContent;

  it("is hidden when there is nothing to show", async () => {
    const { container } = await mount(<Panel />);
    expect(q(container, ".cv-prevbox")).toBeNull();
  });
  it("shows the last assistant reply with markdown stripped", async () => {
    const text = "# Title\n**Bold** and `code`\n```bash\nls\n```";
    const { container } = await mount(<Panel />, { events: [ev("user", "q"), ev("assistant", text)] });
    expect(caption(container)).toBe("Last reply");
    expect(body(container)).toBe("Title\nBold and code\nls");
  });
  it("labels tools as Working and errors as Error", async () => {
    const tool = await mount(<Panel />, { events: [ev("assistant", "a"), ev("tool", "Command: ls")] });
    expect([caption(tool.container), body(tool.container)]).toEqual(["Working", "Command: ls"]);
    const err = await mount(<Panel />, { events: [ev("error", "boom")] });
    expect(caption(err.container)).toBe("Error");
  });
  it("ignores user and reasoning events", async () => {
    const { container } = await mount(<Panel />, { events: [ev("user", "q"), ev("thinking", "t")] });
    expect(q(container, ".cv-prevbox")).toBeNull();
  });
  it("prefers streamed text while the answer is being written", async () => {
    const { container } = await mount(<Panel />, { phase: "thinking", live: { text: "**partial**", thinking: "" }, events: [ev("assistant", "old")] });
    expect([caption(container), body(container)]).toEqual(["Replying", "partial"]);
    expect(container.textContent).toContain("Thinking…");
  });
  it("falls back to the last event while thinking without text yet", async () => {
    const { container } = await mount(<Panel />, { phase: "thinking", events: [ev("assistant", "old")] });
    expect(caption(container)).toBe("Last reply");
  });
  it("ignores streamed text when not thinking", async () => {
    const { container } = await mount(<Panel />, { phase: "idle", live: { text: "stale", thinking: "" } });
    expect(q(container, ".cv-prevbox")).toBeNull();
  });
  it("shows just the status while busy with no preview", async () => {
    const { container } = await mount(<Panel />, { phase: "recording", rec_seconds: 2 });
    expect(q(container, ".cv-prevbox")).toBeNull();
    expect(q(container, ".cv-statusline").textContent).toContain("Listening… 2s");
  });
  it("opens the full-screen chat when tapped", async () => {
    const { container } = await mount(<Panel />, { events: [ev("assistant", "hi")] });
    fireEvent.click(q(container, ".cv-prevbox").parentElement!);
    expect(Navigation.CloseSideMenus).toHaveBeenCalled();
    expect(Navigation.Navigate).toHaveBeenCalledWith("/claude-voice");
  });
});

describe("Panel: quick actions", () => {
  it("offers general actions and sends them to the chosen chat", async () => {
    const { container } = await mount(<Panel />, { panel_target: "c1" });
    expect(container.querySelector('section[data-title="Quick actions"]')).toBeTruthy();
    fireEvent.click(byText(container, ".cv-chip", "Battery"));
    const [prompt, game, target, quote] = backend.called("send_text")[0];
    expect(prompt).toContain("battery");
    expect([game, target, quote]).toEqual([null, "c1", ""]);
  });
  it("offers game actions that carry the game", async () => {
    Router.MainRunningApp = { appid: 5, display_name: "Hades" };
    const { container } = await mount(<Panel />);
    expect(container.querySelector('section[data-title="For this game"]')).toBeTruthy();
    fireEvent.click(byText(container, ".cv-chip", "Optimize game"));
    const [prompt, game] = backend.called("send_text")[0];
    expect(prompt).toContain('"Hades"');
    expect(game).toEqual({ name: "Hades", appid: 5 });
  });
  it("disables the actions while busy", async () => {
    const { container } = await mount(<Panel />, { phase: "thinking" });
    expect(qa(container, ".cv-chip").every((b) => b.hasAttribute("disabled"))).toBe(true);
  });
  it("Open chat navigates to the full screen", async () => {
    const { container } = await mount(<Panel />);
    fireEvent.click(byText(container, "button", "Open chat"));
    expect(Navigation.CloseSideMenus).toHaveBeenCalled();
    expect(Navigation.Navigate).toHaveBeenCalledWith("/claude-voice");
  });
});
