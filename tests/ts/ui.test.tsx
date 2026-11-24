import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApprovalCard, LiveView, Markdown, MessageView, MicIcon, MicWave, Orb, Reasoning, StatusLine, Typing } from "../../src/ui";
import { backend } from "./mocks/decky-api";
import { ev } from "./fixtures";

describe("Orb", () => {
  it("renders twelve rays and the phase class", () => {
    const { container } = render(<Orb phase="idle" level={0} size={30} />);
    expect(container.querySelectorAll("line")).toHaveLength(12);
    expect(container.querySelector(".cv-spark-idle")).toBeTruthy();
    expect((container.firstChild as HTMLElement).style.width).toBe("30px");
  });
  it("pulses with the microphone level while recording", () => {
    const { container } = render(<Orb phase="recording" level={1} size={20} />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.style.transform).toBe("scale(1.3)");
    expect(container.querySelector("line")!.getAttribute("stroke-width")).toBe("8");
  });
  it("caps the level at 1 and does not scale when not recording", () => {
    const loud = render(<Orb phase="recording" level={9} size={20} />).container.querySelector("svg") as SVGElement;
    expect(loud.style.transform).toBe("scale(1.3)");
    const idle = render(<Orb phase="thinking" level={1} size={20} />).container.querySelector("svg") as SVGElement;
    expect(idle.style.transform).toBe("");
    expect(idle.style.opacity).toBe("1");
  });
  it("is slightly dimmer when idle", () => {
    const svg = render(<Orb phase="idle" level={0} size={20} />).container.querySelector("svg") as SVGElement;
    expect(svg.style.opacity).toBe("0.95");
  });
});

describe("MicWave and Typing", () => {
  it("draws eight bars whose height follows the level", () => {
    const quiet = render(<MicWave level={0} />).container.querySelectorAll("i");
    expect(quiet).toHaveLength(8);
    expect((quiet[0] as HTMLElement).style.height).toBe("4px");
    const loud = render(<MicWave level={1} />).container.querySelectorAll("i");
    expect(parseInt((loud[2] as HTMLElement).style.height)).toBe(4 + 16);
  });
  it("Typing renders three dots", () => {
    expect(render(<Typing />).container.querySelectorAll(".cv-dots span")).toHaveLength(3);
  });
});

describe("Markdown", () => {
  it("renders plain lines, blank gaps, bullets and headings", () => {
    const { container } = render(<Markdown text={"# Title\nhello\n\n- one\n* two\n  - nested"} />);
    expect(container.querySelector(".cv-h")!.textContent).toBe("Title");
    expect(container.querySelectorAll(".cv-gap")).toHaveLength(1);
    const text = container.textContent!;
    expect(text).toContain("• one");
    expect(text).toContain("• two");
    expect(text).toContain("• nested");
  });
  it("renders inline code and bold", () => {
    const { container } = render(<Markdown text={"use `ls -la` and **be careful** now"} />);
    expect(container.querySelector("code.cv-code-i")!.textContent).toBe("ls -la");
    expect(container.querySelector("b")!.textContent).toBe("be careful");
  });
  it("leaves lone markers and unfinished markup as text", () => {
    const { container } = render(<Markdown text={"a `` b ** c"} />);
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("a `` b ** c");
  });
  it("renders fenced blocks, dropping the language tag", () => {
    const { container } = render(<Markdown text={"before\n```bash\necho hi\n```\nafter"} />);
    expect(container.querySelector("pre.cv-pre")!.textContent).toBe("echo hi");
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });
  it("keeps a code block without a language intact and survives an unterminated fence", () => {
    const a = render(<Markdown text={"```\nplain\n```"} />).container.querySelector("pre")!;
    expect(a.textContent).toBe("plain");
    const b = render(<Markdown text={"text ```\nopen block"} />).container.querySelector("pre")!;
    expect(b.textContent).toBe("open block");
  });
});

describe("Reasoning", () => {
  it("is collapsed until activated, then toggles", () => {
    const { container } = render(<Reasoning text="secret thoughts" />);
    expect(container.textContent).toContain("▸");
    expect(container.textContent).not.toContain("secret thoughts");
    fireEvent.click(container.querySelector(".cv-think")!);
    expect(container.textContent).toContain("▾");
    expect(container.textContent).toContain("secret thoughts");
    fireEvent.click(container.querySelector(".cv-think")!);
    expect(container.textContent).not.toContain("secret thoughts");
  });
  it("shows live text with a typing indicator", () => {
    const { container } = render(<Reasoning text="streaming" live />);
    expect(container.textContent).toContain("streaming");
    expect(container.querySelector(".cv-dots")).toBeTruthy();
  });
  it("shows only the last 800 characters of long reasoning", () => {
    const long = "a".repeat(500) + "b".repeat(800);
    const { container } = render(<Reasoning text={long} live />);
    const body = container.querySelector(".cv-think-b")!.textContent!;
    expect(body).toBe("…" + "b".repeat(800));
    const short = render(<Reasoning text={"x".repeat(800)} live />).container.querySelector(".cv-think-b")!.textContent!;
    expect(short).toBe("x".repeat(800));
  });
});

describe("MessageView", () => {
  it("user message with and without quote and time", () => {
    const a = render(<MessageView e={ev("user", "hello")} showTime={false} />).container;
    expect(a.querySelector(".cv-user-b")!.textContent).toBe("hello");
    expect(a.querySelector(".cv-quote")).toBeNull();
    expect(a.querySelector(".cv-time")).toBeNull();
    const b = render(<MessageView e={ev("user", "hello", 1700000000, "quoted text")} showTime />).container;
    expect(b.querySelector(".cv-quote")!.textContent).toBe("quoted text");
    expect(b.querySelector(".cv-time")!.textContent).toMatch(/^\d{2}:\d{2}$/);
  });
  it("truncates a long quote to 90 characters", () => {
    const c = render(<MessageView e={ev("user", "q", 1, "z".repeat(120))} showTime={false} />).container;
    expect(c.querySelector(".cv-quote")!.textContent).toBe("z".repeat(90) + "…");
    const exact = render(<MessageView e={ev("user", "q", 1, "z".repeat(90))} showTime={false} />).container;
    expect(exact.querySelector(".cv-quote")!.textContent).toBe("z".repeat(90));
  });
  it("assistant message renders markdown and optional time", () => {
    const a = render(<MessageView e={ev("assistant", "**hi**")} showTime={false} />).container;
    expect(a.querySelector("b")!.textContent).toBe("hi");
    expect(a.querySelector(".cv-time")).toBeNull();
    expect(a.querySelector(".cv-spark")).toBeTruthy();
    const b = render(<MessageView e={ev("assistant", "x", 1700000000)} showTime />).container;
    expect(b.querySelector(".cv-time")).toBeTruthy();
  });
  it("thinking, tool and error kinds", () => {
    expect(render(<MessageView e={ev("thinking", "t")} showTime={false} />).container.querySelector(".cv-think")).toBeTruthy();
    expect(render(<MessageView e={ev("tool", "Command: ls")} showTime={false} />).container.textContent).toBe("⚙ Command: ls");
    expect(render(<MessageView e={ev("error", "bad")} showTime={false} />).container.textContent).toBe("⚠ bad");
  });
});

describe("LiveView", () => {
  it("renders nothing unless the model is thinking", () => {
    for (const phase of ["idle", "recording", "transcribing"] as const) {
      expect(render(<LiveView live={{ text: "x", thinking: "y" }} phase={phase} showReasoning />).container.innerHTML).toBe("");
    }
  });
  it("shows reasoning and streamed text", () => {
    const c = render(<LiveView live={{ text: "partial", thinking: "pondering" }} phase="thinking" showReasoning />).container;
    expect(c.querySelector(".cv-think")!.textContent).toContain("pondering");
    expect(c.querySelector(".cv-caret")!.textContent).toBe("partial");
  });
  it("hides reasoning when asked and when empty", () => {
    const a = render(<LiveView live={{ text: "t", thinking: "pondering" }} phase="thinking" showReasoning={false} />).container;
    expect(a.querySelector(".cv-think")).toBeNull();
    const b = render(<LiveView live={{ text: "", thinking: "" }} phase="thinking" showReasoning />).container;
    expect(b.innerHTML).toBe("");
  });
});

describe("ApprovalCard", () => {
  const base = { id: "r1", tool: "Bash", detail: "Command: ls", risk: "normal" as const };
  const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll("button")).map((b) => b.textContent);

  it("offers Allow, Allow in this chat and Deny for normal requests", () => {
    const { container } = render(<ApprovalCard p={{ ...base, preview: { kind: "command", text: "ls" } }} />);
    expect(buttons(container)).toEqual(["Allow", "Allow in this chat", "Deny"]);
    expect(container.querySelector(".cv-badge")).toBeNull();
    expect(container.querySelector("pre")!.textContent).toBe("ls");
    expect(container.textContent).toContain("Command: ls");
  });
  it("marks risky requests and removes the permanent option", () => {
    const { container } = render(<ApprovalCard p={{ ...base, risk: "danger", preview: { kind: "command", text: "sudo ls" } }} />);
    expect(container.querySelector(".cv-badge")!.textContent).toBe("RISKY");
    expect(container.querySelector(".cv-appr-danger")).toBeTruthy();
    expect(buttons(container)).toEqual(["Allow", "Deny"]);
  });
  it("buttons answer through the backend", () => {
    const { container } = render(<ApprovalCard p={{ ...base, preview: { kind: "command", text: "ls" } }} />);
    const [allow, always, deny] = Array.from(container.querySelectorAll("button"));
    fireEvent.click(allow);
    fireEvent.click(always);
    fireEvent.click(deny);
    expect(backend.called("respond")).toEqual([["r1", true, false], ["r1", true, true], ["r1", false, false]]);
  });
  it("shows a diff with old and new text", () => {
    const { container } = render(<ApprovalCard p={{ ...base, tool: "Edit", preview: { kind: "diff", path: "/f.txt", old: "a", new: "b" } }} />);
    expect(container.querySelector(".cv-diff-old")!.textContent).toBe("− a");
    expect(container.querySelector(".cv-diff-new")!.textContent).toBe("+ b");
    expect(container.textContent).toContain("/f.txt");
  });
  it("omits empty sides of a diff", () => {
    const { container } = render(<ApprovalCard p={{ ...base, preview: { kind: "diff", path: "/f", old: "", new: "" } }} />);
    expect(container.querySelector(".cv-diff-old")).toBeNull();
    expect(container.querySelector(".cv-diff-new")).toBeNull();
  });
  it("shows file and other previews only when they have text", () => {
    const file = render(<ApprovalCard p={{ ...base, preview: { kind: "file", path: "/w", text: "content" } }} />).container;
    expect(file.querySelector("pre")!.textContent).toBe("content");
    const other = render(<ApprovalCard p={{ ...base, preview: { kind: "other", text: "{}" } }} />).container;
    expect(other.querySelector("pre")!.textContent).toBe("{}");
    const empty = render(<ApprovalCard p={{ ...base, preview: { kind: "other" } }} />).container;
    expect(empty.querySelector("pre")).toBeNull();
  });
  it("copes with a missing preview", () => {
    const { container } = render(<ApprovalCard p={{ ...base, preview: undefined as any }} />);
    expect(container.textContent).toContain("Command: ls");
    expect(container.querySelector("pre")).toBeNull();
  });
});

describe("MicIcon and StatusLine", () => {
  it("picks an icon per phase", () => {
    const html = (p: any) => render(<MicIcon phase={p} />).container.innerHTML;
    expect(html("recording")).toBe(html("thinking"));
    expect(html("idle")).not.toBe(html("recording"));
    expect(html("transcribing")).not.toBe(html("idle"));
    expect(html("transcribing")).not.toBe(html("recording"));
  });
  it("StatusLine is empty when idle", () => {
    expect(render(<StatusLine phase="idle" secs={0} level={0} />).container.innerHTML).toBe("");
  });
  it("StatusLine shows the phase text, with a wave only while recording", () => {
    const rec = render(<StatusLine phase="recording" secs={4} level={0.5} />).container;
    expect(rec.textContent).toContain("Listening… 4s");
    expect(rec.querySelector(".cv-wave")).toBeTruthy();
    const thinking = render(<StatusLine phase="thinking" secs={0} level={0} />).container;
    expect(thinking.textContent).toContain("Thinking…");
    expect(thinking.querySelector(".cv-wave")).toBeNull();
  });
});
