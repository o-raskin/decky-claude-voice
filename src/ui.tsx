import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";
import { FaMicrophone, FaStop, FaTimes } from "react-icons/fa";
import { Ev, Pending, Phase, phaseLabel, respond, timeOf } from "./api";

/* ---------- Claude spark: reacts to state, no cartoon face ---------- */
const RAYS = [40, 33, 38, 31, 40, 34, 38, 32, 40, 33, 37, 31];

export function Orb({ phase, level, size }: { phase: Phase; level: number; size: number }) {
  const scale = phase === "recording" ? 1 + Math.min(1, level) * 0.3 : 1;
  const opacity = phase === "idle" ? 0.95 : 1;
  return (
    <div className={`cv-spark cv-spark-${phase}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ transform: phase === "recording" ? `scale(${scale})` : undefined, opacity }}>
        {RAYS.map((len, i) => (
          <line
            key={i}
            x1="50" y1={50 - 9} x2="50" y2={50 - len}
            stroke="#D97757" strokeWidth={phase === "recording" ? 8 : 7} strokeLinecap="round"
            transform={`rotate(${i * 30} 50 50)`}
          />
        ))}
      </svg>
    </div>
  );
}

export function MicWave({ level }: { level: number }) {
  const bars = [0.5, 0.8, 1, 0.7, 0.9, 0.6, 0.85, 0.55];
  return (
    <div className="cv-wave">
      {bars.map((b, i) => (
        <i key={i} style={{ height: 4 + Math.round(16 * Math.min(1, level * 1.4) * b) }} />
      ))}
    </div>
  );
}

/* ---------- markdown-lite ---------- */
function inline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return <code key={i} className="cv-code-i">{p.slice(1, -1)}</code>;
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
    return p;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split("```");
  return (
    <div className="cv-md">
      {blocks.map((b, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="cv-pre">{b.replace(/^[a-zA-Z0-9_+-]*\n/, "").trimEnd()}</pre>
        ) : (
          <div key={i}>
            {b.split("\n").map((line, j) => {
              if (/^\s*[-*] /.test(line)) return <div key={j}>• {inline(line.replace(/^\s*[-*] /, ""))}</div>;
              if (/^#+\s/.test(line)) return <div key={j} className="cv-h">{inline(line.replace(/^#+\s*/, ""))}</div>;
              if (line.trim() === "") return <div key={j} className="cv-gap" />;
              return <div key={j}>{inline(line)}</div>;
            })}
          </div>
        ),
      )}
    </div>
  );
}

export function Typing() {
  return (
    <span className="cv-dots">
      <span />
      <span />
      <span />
    </span>
  );
}

const Avatar = () => <div style={{ marginTop: 1 }}><Orb phase="idle" level={0} size={22} /></div>;

/* ---------- reasoning (collapsible) ---------- */
export function Reasoning({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(!!live);
  const toggle = () => setOpen((o) => !o);
  const shown = open || live ? text : "";
  return (
    <Focusable className="cv-think" onActivate={toggle} onClick={toggle}>
      <div>Reasoning {live ? <Typing /> : open ? "▾" : "▸"}</div>
      {shown && <div className="cv-think-b">{shown.length > 800 ? "…" + shown.slice(-800) : shown}</div>}
    </Focusable>
  );
}

/* ---------- messages ---------- */
export function MessageView({ e, showTime }: { e: Ev; showTime: boolean }) {
  if (e.kind === "user")
    return (
      <div className="cv-msg cv-msg-user">
        <div>
          <div className="cv-user-b">
            {e.quote && <div className="cv-quote">{e.quote.length > 90 ? e.quote.slice(0, 90) + "…" : e.quote}</div>}
            {e.text}
          </div>
          {showTime && <div className="cv-time" style={{ textAlign: "right" }}>{timeOf(e.t)}</div>}
        </div>
      </div>
    );
  if (e.kind === "assistant")
    return (
      <div className="cv-msg">
        <Avatar />
        <div className="cv-ai-b">
          <Markdown text={e.text} />
          {showTime && <div className="cv-time">{timeOf(e.t)}</div>}
        </div>
      </div>
    );
  if (e.kind === "thinking") return <Reasoning text={e.text} />;
  if (e.kind === "tool") return <div className="cv-tool">⚙ {e.text}</div>;
  return <div className="cv-err">⚠ {e.text}</div>;
}

export function LiveView({ live, phase, showReasoning }: { live: { text: string; thinking: string }; phase: Phase; showReasoning: boolean }) {
  if (phase !== "thinking") return null;
  return (
    <>
      {showReasoning && live.thinking && <Reasoning text={live.thinking} live />}
      {live.text ? (
        <div className="cv-msg">
          <Avatar />
          <div className="cv-ai-b cv-caret"><Markdown text={live.text} /></div>
        </div>
      ) : null}
    </>
  );
}

/* ---------- approvals ---------- */
export function ApprovalCard({ p }: { p: Pending }) {
  const danger = p.risk === "danger";
  const pv = p.preview || { kind: "other" };
  return (
    <div className={`cv-appr ${danger ? "cv-appr-danger" : ""}`}>
      <div className="cv-appr-h">
        <span style={{ flex: 1 }}>Allow this action?</span>
        {danger && <span className="cv-badge">RISKY</span>}
      </div>
      <div className="cv-sub" style={{ whiteSpace: "normal", wordBreak: "break-all" }}>{pv.path || p.detail}</div>
      {pv.kind === "command" && <pre className="cv-pre">{pv.text}</pre>}
      {pv.kind === "diff" && (
        <>
          {pv.old && <div className="cv-diff-old">− {pv.old}</div>}
          {pv.new && <div className="cv-diff-new">+ {pv.new}</div>}
        </>
      )}
      {(pv.kind === "file" || pv.kind === "other") && pv.text && <pre className="cv-pre">{pv.text}</pre>}
      <Focusable style={{ display: "flex", gap: 8, marginTop: 8 }} flow-children="horizontal">
        <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={() => respond(p.id, true, false)}>Allow</DialogButton>
        {!danger && <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={() => respond(p.id, true, true)}>Allow in this chat</DialogButton>}
        <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={() => respond(p.id, false, false)}>Deny</DialogButton>
      </Focusable>
    </div>
  );
}

export function MicIcon({ phase }: { phase: Phase }) {
  if (phase === "recording" || phase === "thinking") return <FaStop />;
  if (phase === "transcribing") return <FaTimes />;
  return <FaMicrophone />;
}

export function StatusLine({ phase, secs, level }: { phase: Phase; secs: number; level: number }) {
  if (phase === "idle") return null;
  return (
    <div className="cv-statusline">
      <Orb phase={phase} level={level} size={18} />
      <span>{phaseLabel(phase, secs)}</span>
      {phase === "recording" && <MicWave level={level} />}
    </div>
  );
}
