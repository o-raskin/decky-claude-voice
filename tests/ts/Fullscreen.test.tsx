import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Fullscreen } from "../../src/Fullscreen";
import { Router, propsOf, showContextMenu } from "./mocks/decky-ui";
import { backend } from "./mocks/decky-api";
import { ev, makeState } from "./fixtures";
import { byText, mount, q, qa, settle } from "./helpers";

const sleep = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const chat = (id: string, title: string, active = false, count = 0) => ({ id, title, updated: Date.now() / 1000, count, active });
const convo = [ev("user", "question text", 1), ev("assistant", "answer text", 2), ev("tool", "Command: ls", 3), ev("thinking", "pondering", 4)];

const main = (c: HTMLElement) => propsOf(q(c, ".cv-main"));
const input = (c: HTMLElement) => q(c, ".cv-composer input");
const inputWrap = (c: HTMLElement) => input(c).parentElement!;
const mic = (c: HTMLElement) => q(c, ".cv-composer .cv-mic");
const msgs = (c: HTMLElement) => qa(c, ".cv-msgbtn");
const scroller = (c: HTMLElement) => q(c, ".scrollpanel");
const evt = (button?: number) => ({ detail: { button }, stopPropagation: vi.fn() });

function stubScroll(el: HTMLElement, v: { clientHeight?: number; scrollHeight?: number; scrollTop?: number }) {
  let top = v.scrollTop ?? 0;
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => v.clientHeight ?? 100 });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => v.scrollHeight ?? 1000 });
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (n) => (top = n) });
}
const rect = (el: HTMLElement, top: number, bottom: number) =>
  (el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect);

async function select(node: Node) {
  const g = window.getSelection()!;
  g.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(node);
  g.addRange(r);
  document.dispatchEvent(new Event("selectionchange"));
  await sleep(160);
}
const menuOf = () => render((showContextMenu as any).mock.calls.at(-1)[0]).container;
const menuItem = (c: HTMLElement, text: string) => byText(c, ".menuitem", text);

describe("loading and layout", () => {
  it("renders an empty shell until the first state arrives", async () => {
    const { container } = await mount(<Fullscreen />, {}, { get_state: () => new Promise(() => {}) });
    expect(q(container, ".cv-full")).toBeTruthy();
    expect(q(container, ".cv-side")).toBeNull();
  });
  it("refreshes the model list from Claude when opened", async () => {
    await mount(<Fullscreen />);
    expect(backend.called("refresh_models")).toHaveLength(1);
  });
  it("ignores a failing model refresh", async () => {
    await mount(<Fullscreen />, {}, { refresh_models: () => Promise.reject(new Error("x")) });
  });
  it("lists chats and marks the active one", async () => {
    const { container } = await mount(<Fullscreen />, { chats: [chat("c1", "First", true), chat("c2", "Second")] });
    const rows = qa(container, ".cv-chatrow");
    expect(rows.map((r) => q(r, ".cv-chatrow-t").textContent)).toEqual(["First", "Second"]);
    expect(rows[0].className).toContain("active");
    expect(rows[1].className).not.toContain("active");
    expect(q(rows[0], ".cv-chatrow-s").textContent).toBe("now");
    expect(propsOf(rows[0]).onOKActionDescription).toBe("Open");
  });
  it("New chat button creates a chat", async () => {
    const { container } = await mount(<Fullscreen />);
    fireEvent.click(byText(container, "button", "New chat"));
    expect(backend.called("new_chat")).toHaveLength(1);
  });
  it("blocks chat switching while busy", async () => {
    const { container } = await mount(<Fullscreen />, { phase: "thinking", chats: [chat("c1", "First", true)] });
    expect(qa(container, ".cv-chatrow").every((r) => r.hasAttribute("disabled"))).toBe(true);
    expect(byText(container, "button", "New chat").hasAttribute("disabled")).toBe(true);
  });
  it("shows the chat title, the game chip and the settings summary", async () => {
    Router.MainRunningApp = { appid: 3, display_name: "Hades" };
    const { container } = await mount(<Fullscreen />, { prefs: { approval: "auto", model: "opus", effort: "high" } });
    expect(q(container, ".cv-head-t").textContent).toBe("Chat one");
    expect(q(container, ".cv-gamechip").textContent).toBe("Hades");
    expect(q(container, ".cv-hint").textContent).toBe("opus · high · auto-approve");
  });
  it("summary falls back to the current model, auto effort and ask-me", async () => {
    const a = await mount(<Fullscreen />);
    expect(q(a.container, ".cv-hint").textContent).toBe("sonnet · effort auto · ask me");
    const b = await mount(<Fullscreen />, { models: { available: [], current: "" } });
    expect(q(b.container, ".cv-hint").textContent).toBe("default · effort auto · ask me");
  });
  it("game chip falls back to the app id and is absent without a game", async () => {
    Router.MainRunningApp = { appid: 77 };
    const a = await mount(<Fullscreen />);
    expect(q(a.container, ".cv-gamechip").textContent).toBe("appid 77");
    Router.MainRunningApp = null;
    const b = await mount(<Fullscreen />);
    expect(q(b.container, ".cv-gamechip")).toBeNull();
  });
});

describe("empty chat", () => {
  it("shows the welcome screen with quick actions", async () => {
    const { container } = await mount(<Fullscreen />);
    expect(q(container, ".cv-empty h2").textContent).toBe("How can I help?");
    expect(q(container, ".cv-empty p").textContent).toBe("Speak or type");
    fireEvent.click(byText(container, ".cv-chip", "Disk space"));
    const [prompt, game, target, quote] = backend.called("send_text")[0];
    expect(prompt).toContain("disk");
    expect([game, target, quote]).toEqual([null, "current", ""]);
  });
  it("mentions the running game", async () => {
    Router.MainRunningApp = { appid: 3, display_name: "Hades" };
    const { container } = await mount(<Fullscreen />);
    expect(q(container, ".cv-empty p").textContent).toBe("Running now: Hades");
    fireEvent.click(byText(container, ".cv-chip", "Optimize game"));
    expect(backend.called("send_text")[0][1]).toEqual({ name: "Hades", appid: 3 });
  });
  it("is hidden once there are messages, or while a request runs", async () => {
    const a = await mount(<Fullscreen />, { events: convo });
    expect(q(a.container, ".cv-empty")).toBeNull();
    const b = await mount(<Fullscreen />, { phase: "thinking" });
    expect(q(b.container, ".cv-empty")).toBeNull();
  });
  it("hides the Latest button on an empty chat even when scrolled", async () => {
    const { container } = await mount(<Fullscreen />);
    stubScroll(scroller(container), { scrollTop: 0 });
    fireEvent.scroll(scroller(container));
    expect(q(container, ".cv-tobottom")).toBeNull();
  });
});

describe("conversation", () => {
  it("renders messages as buttons, except reasoning", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    expect(msgs(container)).toHaveLength(3);
    expect(q(container, ".cv-think")).toBeTruthy();
    expect(msgs(container).map((m) => propsOf(m).preferredFocus)).toEqual([false, false, false]); // the last event is reasoning, not a button
    expect(propsOf(msgs(container)[0]).onOKActionDescription).toBe("Copy");
    expect(propsOf(msgs(container)[0]).onOptionsActionDescription).toBe("Actions");
  });
  it("the newest message button takes the pointer by default", async () => {
    const { container } = await mount(<Fullscreen />, { events: [ev("user", "a", 1), ev("assistant", "b", 2)] });
    expect(msgs(container).map((m) => propsOf(m).preferredFocus)).toEqual([false, true]);
  });
  it("shows live streaming, errors and the status line", async () => {
    const { container } = await mount(<Fullscreen />, {
      phase: "thinking", live: { text: "streaming…", thinking: "hmm" }, error: "something failed", events: [ev("user", "q", 1)],
    });
    expect(q(container, ".cv-caret").textContent).toBe("streaming…");
    expect(q(container, ".cv-err").textContent).toBe("something failed");
    expect(q(container, ".cv-statusline").textContent).toContain("Thinking…");
  });
  it("shows pending approvals", async () => {
    const p = { id: "r1", tool: "Bash", detail: "Command: ls", risk: "normal" as const, preview: { kind: "command", text: "ls" } };
    const { container } = await mount(<Fullscreen />, { pending: [p] });
    expect(container.textContent).toContain("Allow this action?");
  });
  it("shows the quote of a user message", async () => {
    const { container } = await mount(<Fullscreen />, { events: [ev("user", "why", 1, "quoted thing")] });
    expect(q(container, ".cv-quote").textContent).toBe("quoted thing");
  });
});

describe("choosing a chat", () => {
  it("opening the active chat puts the pointer on the input field", async () => {
    const { container } = await mount(<Fullscreen />, { chats: [chat("c1", "First", true)], events: convo });
    fireEvent.click(q(container, ".cv-chatrow"));
    expect(document.activeElement).toBe(input(container));
    expect(backend.called("switch_chat")).toHaveLength(0);
  });
  it("opening another chat switches and then moves the pointer to the input", async () => {
    const chats = [chat("c1", "First", true), chat("c2", "Second")];
    const view = await mount(<Fullscreen />, { chats, events: convo });
    fireEvent.click(qa(view.container, ".cv-chatrow")[1]);
    expect(backend.called("switch_chat")).toEqual([["c2"]]);
    expect(document.activeElement).not.toBe(input(view.container));
    await view.setState({ chats: [chat("c1", "First"), chat("c2", "Second", true)], chat: { id: "c2", title: "Second", count: 0, has_session: false, last: null }, events: [] });
    expect(document.activeElement).toBe(input(view.container));
  });
  it("a plain state refresh does not steal the pointer afterwards", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    (q(view.container, ".cv-chatrow") as HTMLElement).focus();
    await view.setState({ events: [...convo] });
    expect(document.activeElement).toBe(q(view.container, ".cv-chatrow"));
  });
});

describe("settings menu (Start)", () => {
  const open = async (c: HTMLElement) => {
    main(c).onMenuButton();
    await settle();
  };
  it("is labelled in the button hints", async () => {
    const { container } = await mount(<Fullscreen />);
    expect(main(container).onMenuActionDescription).toBe("Settings");
  });
  it("shows model, thinking, actions and delete groups with the current values", async () => {
    const { container } = await mount(<Fullscreen />, { prefs: { approval: "auto", model: "opus", effort: "high" }, chat: { id: "c1", title: "A".repeat(40), count: 0, has_session: false, last: null } });
    await open(container);
    const m = menuOf();
    expect(q(m, ".menu").getAttribute("data-label")).toBe(`Chat settings · ${"A".repeat(30)}`);
    expect(q(m, ".menu").getAttribute("data-cancel")).toBe("Cancel");
    const groups = qa(m, ".menugroup").map((g) => g.getAttribute("data-label"));
    expect(groups).toEqual(["Model · opus", "Thinking · High", "Claude actions · Auto-approve", "Delete chat"]);
    const items = qa(m, ".menuitem").map((i) => i.textContent);
    expect(items).toContain("✓ opus");
    expect(items).toContain("   sonnet");
    expect(items).toContain("   default · sonnet");
  });
  it("picking an item saves the preference", async () => {
    const { container } = await mount(<Fullscreen />);
    await open(container);
    const m = menuOf();
    fireEvent.click(menuItem(m, "Max (deep)"));
    fireEvent.click(menuItem(m, "Auto-approve"));
    fireEvent.click(menuItem(m, "opus"));
    expect(backend.called("set_pref")).toEqual([["effort", "max"], ["approval", "auto"], ["model", "opus"]]);
  });
  it("deletes the chat from the menu", async () => {
    const { container } = await mount(<Fullscreen />);
    await open(container);
    const m = menuOf();
    expect(q(m, ".menugroup[data-label='Delete chat']").getAttribute("data-disabled")).toBe("false");
    fireEvent.click(menuItem(m, "Yes, delete this chat"));
    expect(backend.called("delete_chat")).toEqual([["c1"]]);
  });
  it("cannot delete while busy", async () => {
    const { container } = await mount(<Fullscreen />, { phase: "thinking" });
    await open(container);
    expect(q(menuOf(), ".menugroup[data-label='Delete chat']").getAttribute("data-disabled")).toBe("true");
  });
  it("the sliders button opens the same menu", async () => {
    const { container } = await mount(<Fullscreen />);
    fireEvent.click(q(container, ".cv-head .cv-icon-btn"));
    await settle();
    expect(showContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe("the X button (microphone)", () => {
  it("is offered while idle and starts a recording", async () => {
    Router.MainRunningApp = { appid: 3, display_name: "Hades" };
    const { container } = await mount(<Fullscreen />, {}, { toggle_recording: () => "started" });
    expect(main(container).onSecondaryActionDescription).toBe("Microphone");
    await act(async () => void (await main(container).onSecondaryButton()));
    expect(backend.called("toggle_recording")).toEqual([["current", { name: "Hades", appid: 3 }, ""]]);
  });
  it("is hidden while recording, transcribing and thinking", async () => {
    for (const phase of ["recording", "transcribing", "thinking"] as const) {
      const { container } = await mount(<Fullscreen />, { phase });
      expect(main(container).onSecondaryButton).toBeUndefined();
      expect(main(container).onSecondaryActionDescription).toBeUndefined();
    }
  });
  it("is hidden when the Whisper model is missing", async () => {
    const { container } = await mount(<Fullscreen />, { model_ready: false });
    expect(main(container).onSecondaryButton).toBeUndefined();
  });
  it("is hidden while the pointer is on the mic button itself and returns afterwards", async () => {
    const { container } = await mount(<Fullscreen />);
    fireEvent.focus(mic(container));
    expect(main(container).onSecondaryButton).toBeUndefined();
    fireEvent.blur(mic(container));
    expect(main(container).onSecondaryActionDescription).toBe("Microphone");
  });
});

describe("microphone button", () => {
  it("is labelled Record and starts recording", async () => {
    const { container } = await mount(<Fullscreen />, {}, { toggle_recording: () => "started" });
    expect(propsOf(mic(container)).onOKActionDescription).toBe("Record");
    fireEvent.click(mic(container));
    await settle();
    expect(backend.called("toggle_recording")).toHaveLength(1);
  });
  it("is labelled Stop and send while recording", async () => {
    const { container } = await mount(<Fullscreen />, { phase: "recording" });
    expect(propsOf(mic(container)).onOKActionDescription).toBe("Stop and send");
    expect(mic(container).className).toContain("cv-mic-rec");
    expect(mic(container).hasAttribute("disabled")).toBe(false);
  });
  it("is blocked while transcribing or thinking and when the model is missing", async () => {
    for (const phase of ["transcribing", "thinking"] as const) {
      const { container } = await mount(<Fullscreen />, { phase });
      expect(mic(container).hasAttribute("disabled")).toBe(true);
      expect(mic(container).className).toContain("cv-mic-busy");
    }
    const { container } = await mount(<Fullscreen />, { model_ready: false });
    expect(mic(container).hasAttribute("disabled")).toBe(true);
  });
  it("stopping sends the context with the voice message and clears the chip", async () => {
    const view = await mount(<Fullscreen />, { events: convo }, { toggle_recording: () => "stopped" });
    act(() => void propsOf(msgs(view.container)[1]).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    expect(q(view.container, ".cv-ctxchip")).toBeTruthy();
    await view.setState({ phase: "recording", events: convo });
    fireEvent.click(mic(view.container));
    await settle();
    expect(backend.called("toggle_recording")[0][2]).toBe("answer text");
    expect(q(view.container, ".cv-ctxchip")).toBeNull();
  });
  it("starting keeps the context chip for the message that follows", async () => {
    const view = await mount(<Fullscreen />, { events: convo }, { toggle_recording: () => "started" });
    act(() => void propsOf(msgs(view.container)[1]).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    fireEvent.click(mic(view.container));
    await settle();
    expect(q(view.container, ".cv-ctxchip")).toBeTruthy();
  });
});

describe("the B button", () => {
  it("goes back to the chat list from the conversation", async () => {
    const view = await mount(<Fullscreen />, { chats: [chat("c1", "First"), chat("c2", "Second", true)] });
    const e = evt();
    act(() => void main(view.container).onCancelButton(e));
    expect(document.activeElement).toBe(qa(view.container, ".cv-chatrow")[1]);
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(main(view.container).onCancelActionDescription).toBe("Chats");
  });
  it("falls back to the first chat row when none is active", async () => {
    const view = await mount(<Fullscreen />, { chats: [chat("c1", "First"), chat("c2", "Second")] });
    act(() => void main(view.container).onCancelButton(undefined));
    expect(document.activeElement).toBe(qa(view.container, ".cv-chatrow")[0]);
  });
  it("is harmless with no chats at all", async () => {
    const view = await mount(<Fullscreen />, { chats: [] });
    expect(() => main(view.container).onCancelButton({})).not.toThrow();
  });
  it("cancels the recording without sending while recording", async () => {
    const view = await mount(<Fullscreen />, { phase: "recording" });
    expect(main(view.container).onCancelActionDescription).toBe("Cancel recording");
    const e = evt();
    act(() => void main(view.container).onCancelButton(e));
    expect(backend.called("cancel")).toHaveLength(1);
    expect(backend.called("send_text")).toHaveLength(0);
    expect(e.stopPropagation).toHaveBeenCalled();
  });
});

describe("input field and sending", () => {
  it("has a send arrow only when there is text", async () => {
    const { container } = await mount(<Fullscreen />);
    expect(qa(container, ".cv-composer button")).toHaveLength(1);
    fireEvent.change(input(container), { target: { value: "hello" } });
    expect(qa(container, ".cv-composer button")).toHaveLength(2);
    fireEvent.change(input(container), { target: { value: "   " } });
    expect(qa(container, ".cv-composer button")).toHaveLength(1);
  });
  it("sends the text with the game and clears the field", async () => {
    Router.MainRunningApp = { appid: 3, display_name: "Hades" };
    const { container } = await mount(<Fullscreen />, {}, { send_text: () => true });
    fireEvent.change(input(container), { target: { value: "hello" } });
    fireEvent.click(qa(container, ".cv-composer button")[1]);
    await settle();
    expect(backend.called("send_text")).toEqual([["hello", { name: "Hades", appid: 3 }, "current", ""]]);
    expect((input(container) as HTMLInputElement).value).toBe("");
  });
  it("keeps the text when the backend refuses", async () => {
    const { container } = await mount(<Fullscreen />, {}, { send_text: () => false });
    fireEvent.change(input(container), { target: { value: "hello" } });
    fireEvent.click(qa(container, ".cv-composer button")[1]);
    await settle();
    expect((input(container) as HTMLInputElement).value).toBe("hello");
  });
  it("is disabled while a request runs and shows Stop instead of send", async () => {
    const { container } = await mount(<Fullscreen />, { phase: "thinking" });
    expect(input(container).hasAttribute("disabled")).toBe(true);
    fireEvent.click(q(container, ".cv-stop"));
    expect(backend.called("cancel")).toHaveLength(1);
  });
  it("has no Stop button while idle or recording", async () => {
    expect(q((await mount(<Fullscreen />)).container, ".cv-stop")).toBeNull();
    expect(q((await mount(<Fullscreen />, { phase: "recording" })).container, ".cv-stop")).toBeNull();
  });
  it("sends the context chip along with the typed text", async () => {
    const view = await mount(<Fullscreen />, { events: convo }, { send_text: () => true });
    act(() => void propsOf(msgs(view.container)[0]).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    fireEvent.change(input(view.container), { target: { value: "explain" } });
    fireEvent.click(qa(view.container, ".cv-composer button")[1]);
    await settle();
    expect(backend.called("send_text")[0][3]).toBe("question text");
    expect(q(view.container, ".cv-ctxchip")).toBeNull();
  });
});

describe("pointer moves after phase changes", () => {
  it("recording moves the pointer to the mic button", async () => {
    const view = await mount(<Fullscreen />);
    input(view.container).focus();
    await view.setState({ phase: "recording" });
    await sleep(120);
    expect(document.activeElement).toBe(mic(view.container));
  });
  it("sending moves the pointer to Stop, and the end returns it to the input", async () => {
    const view = await mount(<Fullscreen />);
    input(view.container).focus();
    await view.setState({ phase: "thinking" });
    await sleep(120);
    expect(document.activeElement).toBe(q(view.container, ".cv-stop"));
    await view.setState({ phase: "idle" });
    await sleep(120);
    expect(document.activeElement).toBe(input(view.container));
  });
  it("recording to transcribing moves the pointer from the mic to Stop", async () => {
    const view = await mount(<Fullscreen />);
    await view.setState({ phase: "recording" });
    await sleep(120);
    await view.setState({ phase: "transcribing" });
    await sleep(120);
    expect(document.activeElement).toBe(q(view.container, ".cv-stop"));
    await view.setState({ phase: "thinking" });
    await sleep(120);
    expect(document.activeElement).toBe(q(view.container, ".cv-stop"));
  });
  it("does not steal the pointer from the message list or the sidebar", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    msgs(view.container)[0].focus();
    await view.setState({ phase: "thinking", events: convo });
    await sleep(120);
    expect(document.activeElement).toBe(msgs(view.container)[0]);
    await view.setState({ phase: "idle", events: convo });
    await sleep(120);
    expect(document.activeElement).toBe(msgs(view.container)[0]);
  });
  it("takes the pointer when nothing is focused", async () => {
    const view = await mount(<Fullscreen />);
    (document.activeElement as HTMLElement | null)?.blur();
    await view.setState({ phase: "thinking" });
    await sleep(120);
    expect(document.activeElement).toBe(q(view.container, ".cv-stop"));
  });
});

describe("on-screen keyboard", () => {
  const typing = (c: HTMLElement) => !!q(c, ".cv-main.cv-typing");
  const open = (c: HTMLElement) => act(() => void propsOf(inputWrap(c)).onButtonDown({ detail: { button: 1 } }));

  it("lifts the field only after A on it", async () => {
    const { container } = await mount(<Fullscreen />);
    expect(typing(container)).toBe(false);
    act(() => void propsOf(inputWrap(container)).onButtonDown({ detail: { button: 2 } }));
    act(() => void propsOf(inputWrap(container)).onButtonDown({}));
    act(() => void propsOf(inputWrap(container)).onButtonDown({ detail: undefined } as any));
    expect(typing(container)).toBe(false);
    await open(container);
    expect(typing(container)).toBe(true);
  });
  it("also lifts on a touch or mouse click", async () => {
    const { container } = await mount(<Fullscreen />);
    fireEvent.click(input(container));
    expect(typing(container)).toBe(true);
  });
  it("drops back when Steam reports the keyboard dismissed, and calls the original", async () => {
    const orig = vi.fn(() => "orig-result");
    const standalone = vi.fn();
    (window as any).SteamClient = { Input: { ModalKeyboardDismissed: orig, StandaloneKeyboardDismissed: standalone } };
    const { container, unmount } = await mount(<Fullscreen />);
    await open(container);
    expect(typing(container)).toBe(true);
    let r: any;
    act(() => void (r = (window as any).SteamClient.Input.ModalKeyboardDismissed(1, 2)));
    expect(r).toBe("orig-result");
    expect(orig).toHaveBeenCalledWith(1, 2);
    expect(typing(container)).toBe(false);
    await open(container);
    act(() => void (window as any).SteamClient.Input.StandaloneKeyboardDismissed());
    expect(standalone).toHaveBeenCalled();
    expect(typing(container)).toBe(false);
    unmount();
    expect((window as any).SteamClient.Input.ModalKeyboardDismissed).toBe(orig);
    expect((window as any).SteamClient.Input.StandaloneKeyboardDismissed).toBe(standalone);
  });
  it("copes with a missing or partial Steam API", async () => {
    (window as any).SteamClient = { Input: { ModalKeyboardDismissed: vi.fn() } };
    const a = await mount(<Fullscreen />);
    a.unmount();
    (window as any).SteamClient = {};
    const b = await mount(<Fullscreen />);
    b.unmount();
    delete (window as any).SteamClient;
    await mount(<Fullscreen />);
  });
  it("copes with a read-only Steam API", async () => {
    (window as any).SteamClient = { Input: Object.freeze({ ModalKeyboardDismissed: vi.fn() }) };
    const { container } = await mount(<Fullscreen />);
    await open(container);
    expect(typing(container)).toBe(true);
  });
  it("does not restore a function someone else replaced after us", async () => {
    (window as any).SteamClient = { Input: { ModalKeyboardDismissed: vi.fn() } };
    const { unmount } = await mount(<Fullscreen />);
    const other = vi.fn();
    (window as any).SteamClient.Input.ModalKeyboardDismissed = other;
    unmount();
    expect((window as any).SteamClient.Input.ModalKeyboardDismissed).toBe(other);
  });
  it("drops back when the field loses focus or Enter/Escape is pressed, but not on other keys", async () => {
    const { container } = await mount(<Fullscreen />);
    await open(container);
    fireEvent.keyDown(input(container), { key: "a" });
    expect(typing(container)).toBe(true);
    fireEvent.keyDown(input(container), { key: "Enter" });
    expect(typing(container)).toBe(false);
    await open(container);
    fireEvent.keyDown(input(container), { key: "Escape" });
    expect(typing(container)).toBe(false);
    await open(container);
    fireEvent.blur(input(container));
    expect(typing(container)).toBe(false);
  });
  it("B closes only the keyboard while it is up, and goes to the chat list otherwise", async () => {
    const { container } = await mount(<Fullscreen />, { chats: [chat("c1", "First", true)] });
    await open(container);
    const e = evt();
    act(() => void propsOf(inputWrap(container)).onCancelButton(e));
    expect(typing(container)).toBe(false);
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(document.activeElement).not.toBe(q(container, ".cv-chatrow"));
    act(() => void propsOf(inputWrap(container)).onCancelButton(evt()));
    expect(document.activeElement).toBe(q(container, ".cv-chatrow"));
    act(() => void propsOf(inputWrap(container)).onCancelButton(undefined));
  });
  it("drops back when the pointer leaves the field", async () => {
    const { container } = await mount(<Fullscreen />);
    await open(container);
    fireEvent.blur(inputWrap(container));
    expect(typing(container)).toBe(false);
  });
  it("drops back on the first button press after the keyboard (not within 700 ms)", async () => {
    const { container } = await mount(<Fullscreen />);
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await open(container);
    now += 300;
    act(() => void propsOf(q(container, ".cv-full")).onButtonDown({}));
    expect(typing(container)).toBe(true);
    now += 500;
    act(() => void propsOf(q(container, ".cv-full")).onButtonDown({}));
    expect(typing(container)).toBe(false);
    act(() => void propsOf(q(container, ".cv-full")).onButtonDown({}));
  });
  it("drops back when the window gets focus back after losing it", async () => {
    vi.useFakeTimers();
    const { container } = await mount(<Fullscreen />);
    const focus = vi.spyOn(document, "hasFocus");
    await open(container);
    focus.mockReturnValue(true);
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(typing(container)).toBe(true); // never lost focus: still typing
    focus.mockReturnValue(false);
    await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
    expect(typing(container)).toBe(true);
    focus.mockReturnValue(true);
    await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
    expect(typing(container)).toBe(false);
  });
  it("closing when it is not open does nothing", async () => {
    (window as any).SteamClient = { Input: { ModalKeyboardDismissed: vi.fn() } };
    const { container } = await mount(<Fullscreen />);
    act(() => void (window as any).SteamClient.Input.ModalKeyboardDismissed());
    expect(typing(container)).toBe(false);
  });
});

describe("message actions (A and Y)", () => {
  const first = (c: HTMLElement) => msgs(c)[0];
  it("A copies the message", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(container)).onOKButton());
    await settle();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(q(container, ".cv-selbar").textContent).toBe("Copied");
  });
  it("reports a failed copy and falls back to the clipboard API", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    (document.execCommand as any).mockReturnValue(false);
    act(() => void propsOf(first(container)).onOKButton());
    await settle();
    expect(q(container, ".cv-selbar").textContent).toBe("Copy failed");
    const writeText = vi.fn();
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    act(() => void propsOf(first(container)).onOKButton());
    await settle();
    expect(writeText).toHaveBeenCalledWith("question text");
    expect(q(container, ".cv-selbar").textContent).toBe("Copied");
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: () => { throw new Error("denied"); } } });
    act(() => void propsOf(first(container)).onOKButton());
    await settle();
    expect(q(container, ".cv-selbar").textContent).toBe("Copy failed");
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
  });
  it("falls back when execCommand throws", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    (document.execCommand as any).mockImplementation(() => { throw new Error("nope"); });
    act(() => void propsOf(first(container)).onOKButton());
    await settle();
    expect(q(container, ".cv-selbar").textContent).toBe("Copy failed");
  });
  it("the feedback line disappears after 1.5 s", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(container)).onOKButton());
    await settle();
    expect(q(container, ".cv-selbar")).toBeTruthy();
    await sleep(1600);
    expect(q(container, ".cv-selbar")).toBeNull();
  });
  it("Y opens the Actions menu", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(container)).onOptionsButton());
    const m = menuOf();
    expect(q(m, ".menu").getAttribute("data-label")).toBe("Message");
    expect(qa(m, ".menuitem").map((i) => i.textContent)).toEqual(["Ask about this", "Copy", "Insert into input"]);
  });
  it("Ask about this adds a context chip and moves the pointer to the input", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(msgs(container)[1]).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    expect(q(container, ".cv-ctx-k").textContent).toBe("Context");
    expect(q(container, ".cv-ctx-t").textContent).toBe("answer text");
    expect(propsOf(q(container, ".cv-ctxchip")).onOKActionDescription).toBe("Go to message");
    await sleep(100);
    expect(document.activeElement).toBe(input(container));
  });
  it("the chip collapses whitespace and cuts long text to 80 characters", async () => {
    const long = "word  \n  ".repeat(30);
    const { container } = await mount(<Fullscreen />, { events: [ev("assistant", long, 5)] });
    act(() => void propsOf(msgs(container)[0]).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    const t = q(container, ".cv-ctx-t").textContent!;
    expect(t.length).toBe(80);
    expect(t).not.toContain("\n");
  });
  it("Copy from the menu copies the message", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(container)).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Copy"));
    await settle();
    expect(q(container, ".cv-selbar").textContent).toBe("Copied");
    (document.execCommand as any).mockReturnValue(false);
    act(() => void propsOf(first(container)).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Copy"));
    await settle();
    expect(q(container, ".cv-selbar").textContent).toBe("Copy failed");
  });
  it("Insert into input appends the text with a space", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(container)).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Insert into input"));
    expect((input(container) as HTMLInputElement).value).toBe("question text");
    act(() => void propsOf(msgs(container)[1]).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Insert into input"));
    expect((input(container) as HTMLInputElement).value).toBe("question text answer text");
  });
  it("Insert into input cuts very long messages to 1500 characters", async () => {
    const { container } = await mount(<Fullscreen />, { events: [ev("assistant", "x".repeat(3000), 9)] });
    act(() => void propsOf(msgs(container)[0]).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Insert into input"));
    expect((input(container) as HTMLInputElement).value).toHaveLength(1500);
  });
  it("the context chip can be removed", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(container)).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    fireEvent.click(q(container, ".cv-ctxrow .cv-icon-btn"));
    expect(q(container, ".cv-ctxrow")).toBeNull();
  });
  it("the context chip scrolls to the original message and points at it", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(container)).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    stubScroll(scroller(container), { scrollTop: 500 });
    rect(scroller(container), 0, 200);
    rect(first(container), 40, 80);
    fireEvent.click(q(container, ".cv-ctxchip"));
    expect(scroller(container).scrollTop).toBe(500 + 40 - 80); // centred: (200-40)/2
    expect(document.activeElement).toBe(first(container));
  });
  it("tells the user when the original message is gone", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(view.container)).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    await view.setState({ events: [] });
    fireEvent.click(q(view.container, ".cv-ctxchip"));
    expect(q(view.container, ".cv-selbar").textContent).toBe("Original message not found");
  });
  it("centres at the top when the message is taller than the view", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    act(() => void propsOf(first(container)).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    stubScroll(scroller(container), { scrollTop: 10 });
    rect(scroller(container), 0, 100);
    rect(first(container), 20, 520);
    fireEvent.click(q(container, ".cv-ctxchip"));
    expect(scroller(container).scrollTop).toBe(30 + 14); // 30 to the message, then the focus handler reveals its top edge
  });
});

describe("text selection", () => {
  const userText = (c: HTMLElement) => q(c, ".cv-user-b").firstChild as Node;

  it("shows the action bar for selected conversation text", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(userText(container));
    expect(qa(container, ".cv-selbar button").map((b) => b.textContent)).toEqual(["Copy", "To input", "Ask Claude"]);
  });
  it("ignores a selection outside the conversation and an empty one", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(q(container, ".cv-head-t").firstChild!);
    expect(q(container, ".cv-selbar")).toBeNull();
    await select(userText(container));
    expect(q(container, ".cv-selbar")).toBeTruthy();
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await sleep(160);
    expect(q(container, ".cv-selbar")).toBeNull();
  });
  it("Copy copies the selection and clears it", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(userText(container));
    fireEvent.mouseDown(byText(container, ".cv-sel-btn", "Copy"));
    fireEvent.click(byText(container, ".cv-sel-btn", "Copy"));
    expect(q(container, ".cv-selbar").textContent).toBe("Copied");
    expect(window.getSelection()!.toString()).toBe("");
  });
  it("reports when copying the selection fails", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    (document.execCommand as any).mockReturnValue(false);
    await select(userText(container));
    fireEvent.click(byText(container, ".cv-sel-btn", "Copy"));
    expect(q(container, ".cv-selbar").textContent).toBe("Copy failed");
  });
  it("To input appends the selection to the field", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    fireEvent.change(input(container), { target: { value: "see:" } });
    await select(userText(container));
    fireEvent.click(byText(container, ".cv-sel-btn", "To input"));
    expect((input(container) as HTMLInputElement).value).toBe("see: question text");
    expect(q(container, ".cv-selbar").textContent).toBe("Added to the input");
  });
  it("To input into an empty field adds no leading space", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(userText(container));
    fireEvent.click(byText(container, ".cv-sel-btn", "To input"));
    expect((input(container) as HTMLInputElement).value).toBe("question text");
  });
  it("Ask Claude attaches the selection as context pointing at its message", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(userText(container));
    fireEvent.click(byText(container, ".cv-sel-btn", "Ask Claude"));
    expect(q(container, ".cv-ctx-t").textContent).toBe("question text");
    stubScroll(scroller(container), { scrollTop: 0 });
    rect(scroller(container), 0, 100);
    rect(msgs(container)[0], 10, 30);
    fireEvent.click(q(container, ".cv-ctxchip"));
    expect(document.activeElement).toBe(msgs(container)[0]);
  });
  it("Ask Claude without a message holder gives a context that cannot be located", async () => {
    const { container } = await mount(<Fullscreen />, { events: [ev("tool", "x", 5)] });
    const g = window.getSelection()!;
    const orphan = document.createElement("span");
    orphan.textContent = "loose text";
    q(container, ".cv-scrollin").appendChild(orphan);
    await select(orphan.firstChild!);
    fireEvent.click(byText(container, ".cv-sel-btn", "Ask Claude"));
    fireEvent.click(q(container, ".cv-ctxchip"));
    expect(q(container, ".cv-selbar").textContent).toBe("Original message not found");
    g.removeAllRanges();
  });
  it("the Y menu uses the selected text and says so", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(userText(container));
    act(() => void propsOf(msgs(container)[1]).onOptionsButton());
    const m = menuOf();
    expect(q(m, ".menu").getAttribute("data-label")).toBe("Selected text");
    fireEvent.click(menuItem(m, "Ask about this"));
    expect(q(container, ".cv-ctx-t").textContent).toBe("question text");
  });
  it("right click with a selection opens a menu next to the pointer", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(userText(container));
    fireEvent.contextMenu(q(container, ".cv-scrollwrap"), { clientX: 5000, clientY: 5000 });
    const menu = q(container, ".cv-ctx");
    expect(menu).toBeTruthy();
    expect(parseInt(menu.style.left)).toBeLessThanOrEqual(800 - 230);
    expect(parseInt(menu.style.top)).toBeLessThanOrEqual(500 - 140);
    fireEvent.click(byText(menu, "button", "Paste into input"));
    expect((input(container) as HTMLInputElement).value).toBe("question text");
    expect(q(container, ".cv-ctx")).toBeNull();
  });
  it("right-click menu: copy and ask", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(userText(container));
    fireEvent.contextMenu(q(container, ".cv-scrollwrap"), { clientX: 10, clientY: 10 });
    fireEvent.click(byText(q(container, ".cv-ctx"), "button", "Copy"));
    expect(q(container, ".cv-selbar").textContent).toBe("Copied");
    await select(userText(container));
    fireEvent.contextMenu(q(container, ".cv-scrollwrap"), { clientX: 10, clientY: 10 });
    fireEvent.click(byText(q(container, ".cv-ctx"), "button", "Ask Claude about this"));
    expect(q(container, ".cv-ctx-t").textContent).toBe("question text");
  });
  it("right click without a selection does nothing special", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    const prevented = !fireEvent.contextMenu(q(container, ".cv-scrollwrap"));
    expect(prevented).toBe(false);
    expect(q(container, ".cv-ctx")).toBeNull();
  });
});

describe("scrolling and the Latest button", () => {
  it("follows new output while at the bottom", async () => {
    const view = await mount(<Fullscreen />, { events: [ev("user", "a", 1)] });
    stubScroll(scroller(view.container), { scrollHeight: 1234, scrollTop: 0 });
    await view.setState({ events: [ev("user", "a", 1), ev("assistant", "b", 2)] });
    expect(scroller(view.container).scrollTop).toBe(1234);
  });
  it("stops following once the user scrolls up, and shows Latest", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(view.container);
    stubScroll(sc, { scrollHeight: 1000, clientHeight: 100, scrollTop: 100 });
    fireEvent.scroll(sc);
    expect(q(view.container, ".cv-tobottom")).toBeTruthy();
    await view.setState({ events: [...convo, ev("assistant", "new", 9)] });
    expect(sc.scrollTop).toBe(100);
  });
  it("hides Latest again at the bottom", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(view.container);
    stubScroll(sc, { scrollTop: 0 });
    fireEvent.scroll(sc);
    expect(q(view.container, ".cv-tobottom")).toBeTruthy();
    sc.scrollTop = 900;
    fireEvent.scroll(sc);
    expect(q(view.container, ".cv-tobottom")).toBeNull();
  });
  it("Latest scrolls to the newest message and points at it", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(view.container);
    stubScroll(sc, { scrollHeight: 1000, scrollTop: 0 });
    fireEvent.scroll(sc);
    const btn = q(view.container, ".cv-tobottom");
    expect(propsOf(btn).onOKActionDescription).toBe("Latest message");
    fireEvent.click(btn);
    expect(sc.scrollTop).toBe(1000);
    expect(q(view.container, ".cv-tobottom")).toBeNull();
    await sleep(300);
    expect(document.activeElement).toBe(msgs(view.container).at(-1));
  });
  it("D-pad right from the messages goes to Latest when it is shown", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const dir = propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection;
    const none = evt(12);
    dir(none);
    expect(none.stopPropagation).not.toHaveBeenCalled();
    stubScroll(scroller(view.container), { scrollTop: 0 });
    fireEvent.scroll(scroller(view.container));
    const e = evt(12);
    dir(e);
    expect(document.activeElement).toBe(q(view.container, ".cv-tobottom"));
    expect(e.stopPropagation).toHaveBeenCalled();
  });
  it("D-pad down from the newest message goes to the input, from others it does not", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const dir = propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection;
    msgs(view.container)[0].focus();
    const a = evt(10);
    dir(a);
    expect(a.stopPropagation).not.toHaveBeenCalled();
    msgs(view.container).at(-1)!.focus();
    const b = evt(10);
    dir(b);
    expect(document.activeElement).toBe(input(view.container));
    expect(b.stopPropagation).toHaveBeenCalled();
    dir(evt(11));
    dir({ detail: undefined });
  });
  it("D-pad down with no messages goes to the input", async () => {
    const view = await mount(<Fullscreen />);
    const e = evt(10);
    propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection(e);
    expect(document.activeElement).toBe(input(view.container));
  });
  it("Latest: down goes to the input, left/up go to a visible message, right is left alone", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    stubScroll(scroller(view.container), { scrollTop: 0 });
    fireEvent.scroll(scroller(view.container));
    const dir = propsOf(q(view.container, ".cv-tobottom")).onGamepadDirection;
    const down = evt(10);
    dir(down);
    expect(document.activeElement).toBe(input(view.container));
    expect(down.stopPropagation).toHaveBeenCalled();
    rect(scroller(view.container), 0, 100);
    rect(msgs(view.container)[0], 0, 50);
    rect(msgs(view.container)[1], 60, 90);
    rect(msgs(view.container)[2], 200, 250);
    const left = evt(11);
    dir(left);
    expect(document.activeElement).toBe(msgs(view.container)[1]); // the last one that is in view
    expect(left.stopPropagation).toHaveBeenCalled();
    const right = evt(12);
    dir(right);
    expect(right.stopPropagation).not.toHaveBeenCalled();
    rect(msgs(view.container)[0], 500, 550);
    rect(msgs(view.container)[1], 600, 650);
    dir(evt(9));
    expect(document.activeElement).toBe(msgs(view.container)[2]); // nothing in view: the newest
  });
  // animation frames are driven by hand so the smooth scrolling is deterministic
  function frames() {
    const q: Record<number, FrameRequestCallback> = {};
    let n = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => ((q[++n] = cb), n));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => void delete q[id]);
    return {
      pending: () => Object.keys(q).length,
      run: (max = 200) => {
        for (let i = 0; i < max && Object.keys(q).length; i++) {
          const [id, cb] = Object.entries(q)[0];
          delete q[+id];
          cb(0);
        }
      },
    };
  }
  it("down/up inside a message taller than the view scroll its text a page at a time, smoothly", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(view.container);
    stubScroll(sc, { scrollTop: 300, scrollHeight: 2000, clientHeight: 200 });
    rect(sc, 100, 300); // the view is 200 high: a page is 140
    const m = msgs(view.container)[1];
    m.focus();
    sc.scrollTop = 300;
    const fr = frames();
    const dir = propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection;
    rect(m, 120, 700); // the end is far below
    const d1 = evt(10);
    dir(d1);
    expect(d1.stopPropagation).toHaveBeenCalled();
    expect(document.activeElement).toBe(m); // focus stays on the message
    expect(fr.pending()).toBe(1);
    fr.run(1);
    expect(sc.scrollTop).toBeGreaterThan(300); // eased, not a jump
    expect(sc.scrollTop).toBeLessThan(440);
    fr.run();
    expect(sc.scrollTop).toBe(440);
    rect(m, 120, 330); // only 30 left: scroll exactly to the end
    sc.scrollTop = 300;
    dir(evt(10));
    fr.run();
    expect(sc.scrollTop).toBe(336);
    rect(m, 120, 300); // the end is on screen: the focus moves on (left to Steam)
    const d2 = evt(10);
    dir(d2);
    expect(d2.stopPropagation).not.toHaveBeenCalled();
    sc.scrollTop = 300;
    rect(m, -400, 250); // up: the start is above the view
    const u1 = evt(9);
    dir(u1);
    fr.run();
    expect(sc.scrollTop).toBe(160);
    expect(u1.stopPropagation).toHaveBeenCalled();
    sc.scrollTop = 300;
    rect(m, 90, 250); // 10 above the top
    dir(evt(9));
    fr.run();
    expect(sc.scrollTop).toBe(284);
    rect(m, 100, 250); // the start is on screen
    const u2 = evt(9);
    dir(u2);
    expect(u2.stopPropagation).not.toHaveBeenCalled();
  });
  it("holding down scrolls a long message continuously and reaches every part of it", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(view.container);
    stubScroll(sc, { scrollTop: 0, scrollHeight: 3000, clientHeight: 200 });
    rect(sc, 100, 300);
    const m = msgs(view.container)[1];
    m.focus();
    sc.scrollTop = 0;
    const fr = frames();
    const dir = propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection;
    const seen: number[] = [];
    const place = () => rect(m, 100 - sc.scrollTop, 100 - sc.scrollTop + 600); // 3 views tall, moves with the scroll
    for (let i = 0; i < 40; i++) {
      place();
      const e = { detail: { button: 10, is_repeat: i > 0 }, stopPropagation: vi.fn() };
      dir(e);
      if (!e.stopPropagation.mock.calls.length) break; // the end is on screen: focus moves on
      fr.run(2);
      seen.push(sc.scrollTop);
    }
    fr.run();
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(seen.some((v) => v > 150 && v < 350)).toBe(true); // the middle was on screen
    expect(sc.scrollTop).toBe(600 - 200 + 6); // ends with the last line visible
    expect(document.activeElement).toBe(m); // focus never left the message
  });
  it("a chat with short messages keeps Steam's message-to-message navigation", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(view.container);
    stubScroll(sc, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    rect(sc, 100, 300);
    const m = msgs(view.container)[0];
    rect(m, 120, 200);
    m.focus();
    const fr = frames();
    const dir = propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection;
    for (const b of [9, 10]) {
      const e = evt(b);
      dir(e);
      expect(e.stopPropagation).not.toHaveBeenCalled();
    }
    expect(fr.pending()).toBe(0);
  });
  describe("left trackpad", () => {
    const setup = () => {
      let cb: (...a: any[]) => void = () => {};
      const unregister = vi.fn();
      const enable = vi.fn();
      (window as any).SteamClient = {
        Input: { EnableControllerAnalogInputMessages: enable, RegisterForControllerAnalogInputMessages: (f: any) => ((cb = f), { unregister }) },
      };
      return { send: (src: number, x: number, y: number) => cb(15, src, false, x, y), unregister, enable };
    };
    it("the list follows the finger and stops when it lifts or the pad is another one", async () => {
      const pad = setup();
      const view = await mount(<Fullscreen />, { events: convo });
      expect(pad.enable).toHaveBeenCalledWith(true);
      const sc = scroller(view.container);
      stubScroll(sc, { scrollTop: 300, scrollHeight: 2000, clientHeight: 200 });
      const [m0] = msgs(view.container);
      rect(sc, 100, 300);
      rect(m0, 120, 200);
      pad.send(47, 5, 100); // touch down: nothing moves yet
      expect(sc.scrollTop).toBe(300);
      pad.send(47, 5, 70); // finger up by 30: content up by 30
      expect(sc.scrollTop).toBe(330);
      pad.send(47, 5, 80); // finger down by 10
      expect(sc.scrollTop).toBe(320);
      pad.send(47, 5, 80); // not moving
      expect(sc.scrollTop).toBe(320);
      pad.send(48, 5, 10); // another source is ignored
      expect(sc.scrollTop).toBe(320);
      pad.send(47, 0, 0); // lifted
      pad.send(47, 5, 500); // a new touch starts from scratch
      expect(sc.scrollTop).toBe(320);
      pad.send(47, 5, 490);
      expect(sc.scrollTop).toBe(330);
      expect(document.activeElement).toBe(m0); // focus follows the scroll
    });
    it("a long pause starts a new touch, a running glide is dropped, no scroll container is fine", async () => {
      const pad = setup();
      const view = await mount(<Fullscreen />, { events: convo });
      const sc = scroller(view.container);
      stubScroll(sc, { scrollTop: 300, scrollHeight: 2000, clientHeight: 200 });
      rect(sc, 100, 300);
      const now = vi.spyOn(Date, "now");
      now.mockReturnValue(1000);
      pad.send(47, 1, 100);
      now.mockReturnValue(1500); // 500 ms later: a new touch
      pad.send(47, 1, 50);
      expect(sc.scrollTop).toBe(300);
      const fr = frames();
      msgs(view.container)[1].focus();
      sc.scrollTop = 300;
      rect(msgs(view.container)[1], 120, 900); // a tall message: down starts a glide
      propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection(evt(10));
      expect(fr.pending()).toBe(1);
      now.mockReturnValue(1550);
      pad.send(47, 1, 40);
      expect(fr.pending()).toBe(0);
      scroller(view.container).style.overflowY = "visible";
      now.mockReturnValue(1600);
      pad.send(47, 1, 30); // no container: nothing happens
      now.mockRestore();
    });
    it("is unregistered on unmount; tolerates a missing or failing Enable", async () => {
      const pad = setup();
      const a = await mount(<Fullscreen />, { events: convo });
      a.unmount();
      expect(pad.unregister).toHaveBeenCalled();
      expect(pad.enable).toHaveBeenLastCalledWith(false);
      const boom = vi.fn(() => {
        throw new Error("x");
      });
      (window as any).SteamClient = { Input: { EnableControllerAnalogInputMessages: boom, RegisterForControllerAnalogInputMessages: () => undefined } };
      const b = await mount(<Fullscreen />, { events: convo });
      b.unmount();
      expect(boom).toHaveBeenCalled(); // throws on enable and on disable: both are swallowed
      (window as any).SteamClient = { Input: { RegisterForControllerAnalogInputMessages: () => ({}) } };
      (await mount(<Fullscreen />, { events: convo })).unmount();
      (window as any).SteamClient = { Input: {} }; // no analog API at all
      (await mount(<Fullscreen />, { events: convo })).unmount();
    });
  });
  it("a focus change cancels the running glide, unmounting stops it", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(view.container);
    stubScroll(sc, { scrollTop: 300, scrollHeight: 2000, clientHeight: 200 });
    rect(sc, 100, 300);
    const [m0, m1] = msgs(view.container);
    m1.focus();
    sc.scrollTop = 300;
    const fr = frames();
    rect(m1, 120, 900);
    const dir = propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection;
    dir(evt(10));
    expect(fr.pending()).toBe(1);
    rect(m0, 120, 200);
    fireEvent.focus(m0); // reveal: the glide is dropped
    expect(fr.pending()).toBe(0);
    dir(evt(10));
    expect(fr.pending()).toBe(1);
    view.unmount();
    expect(fr.pending()).toBe(0);
  });
  it("up/down scroll nothing when no message has focus", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(view.container);
    stubScroll(sc, { scrollTop: 300 });
    const e = evt(9);
    (document.activeElement as HTMLElement | null)?.blur();
    propsOf(q(view.container, ".cv-scrollin")).onGamepadDirection(e);
    expect(sc.scrollTop).toBe(300);
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });
  it("coming back up into a tall message shows its end, coming down shows its start", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(container);
    stubScroll(sc, { scrollTop: 300 });
    rect(sc, 100, 300);
    const m = msgs(container)[0];
    rect(m, 50, 900); // far taller than the view
    const dir = propsOf(q(container, ".cv-scrollin")).onGamepadDirection;
    dir(evt(9));
    fireEvent.focus(m);
    expect(sc.scrollTop).toBe(300 + 900 - 300 + 6);
    sc.scrollTop = 300;
    dir(evt(10));
    fireEvent.focus(m);
    expect(sc.scrollTop).toBe(300 + 50 - 100 - 6);
  });
  it("focusing a message keeps it inside the visible area", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    const sc = scroller(container);
    stubScroll(sc, { scrollTop: 300 });
    rect(sc, 100, 300);
    const [m0, m1, m2] = msgs(container);
    rect(m0, 50, 90); // above the top
    fireEvent.focus(m0);
    expect(sc.scrollTop).toBe(300 + 50 - 100 - 6);
    sc.scrollTop = 300;
    rect(m1, 280, 340); // below the bottom
    fireEvent.focus(m1);
    expect(sc.scrollTop).toBe(300 + 340 - 300 + 6);
    sc.scrollTop = 300;
    rect(m2, 150, 200); // fully visible
    fireEvent.focus(m2);
    expect(sc.scrollTop).toBe(300);
    rect(m2, 50, 400); // taller than the view
    fireEvent.focus(m2);
    expect(sc.scrollTop).toBe(300 + 50 - 100 - 6);
  });
});

describe("edge cases", () => {
  it("finds a scroll container that uses overflow: scroll", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    scroller(view.container).style.overflowY = "scroll";
    stubScroll(scroller(view.container), { scrollTop: 0 });
    fireEvent.scroll(scroller(view.container));
    expect(q(view.container, ".cv-tobottom")).toBeTruthy();
  });
  it("does nothing when there is no scroll container yet", async () => {
    const view = await mount(<Fullscreen />, { events: convo });
    scroller(view.container).style.overflowY = "visible";
    fireEvent.scroll(scroller(view.container));
    expect(q(view.container, ".cv-tobottom")).toBeNull();
    fireEvent.focus(msgs(view.container)[0]); // reveal has no container: no crash
    act(() => void propsOf(msgs(view.container)[0]).onOptionsButton());
    fireEvent.click(menuItem(menuOf(), "Ask about this"));
    fireEvent.click(q(view.container, ".cv-ctxchip"));
    expect(q(view.container, ".cv-selbar").textContent).toBe("Original message not found");
    await view.setState({ events: [...convo, ev("assistant", "more", 9)] }); // auto-scroll tolerates it too
  });
  it("keeps the right-click menu inside a real window", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(q(container, ".cv-user-b").firstChild!);
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 9000, clientY: 9000 });
    Object.defineProperty(e, "view", { value: { innerWidth: 1000, innerHeight: 700 } });
    fireEvent(q(container, ".cv-scrollwrap"), e);
    const menu = q(container, ".cv-ctx");
    expect(parseInt(menu.style.left)).toBe(1000 - 230);
    expect(parseInt(menu.style.top)).toBe(700 - 140);
  });
  it("the selection bar buttons do not steal focus from the selection", async () => {
    const { container } = await mount(<Fullscreen />, { events: convo });
    await select(q(container, ".cv-user-b").firstChild!);
    for (const b of qa(container, ".cv-selbar button")) {
      expect(fireEvent.mouseDown(b)).toBe(false); // default prevented
    }
  });
});
