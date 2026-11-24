import { ButtonItem, PanelSection, PanelSectionRow, TextField, staticClasses } from "@decky/ui";
import { callable, definePlugin } from "@decky/api";
import { useEffect, useState } from "react";
import { FaMicrophone } from "react-icons/fa";

type Event = { kind: "user" | "assistant" | "tool" | "error"; text: string; t: number };
type Pending = { id: string; tool: string; detail: string };
type State = {
  phase: "idle" | "recording" | "transcribing" | "thinking";
  events: Event[];
  pending: Pending[];
  error: string;
  rec_seconds: number;
  model_ready: boolean;
  has_session: boolean;
};

const getState = callable<[], State>("get_state");
const startRecording = callable<[], boolean>("start_recording");
const stopRecording = callable<[], boolean>("stop_recording");
const sendText = callable<[string], boolean>("send_text");
const respond = callable<[string, boolean], boolean>("respond");
const cancel = callable<[], boolean>("cancel");
const newChat = callable<[], boolean>("new_chat");

const PHASE: Record<State["phase"], string> = {
  idle: "",
  recording: "Слушаю…",
  transcribing: "Распознаю речь…",
  thinking: "Claude думает…",
};

const box = (bg: string): any => ({
  background: bg,
  borderRadius: 6,
  padding: "6px 8px",
  margin: "4px 0",
  fontSize: 12,
  lineHeight: 1.35,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
});

const STYLE: Record<Event["kind"], any> = {
  user: box("rgba(217,119,87,0.25)"),
  assistant: box("rgba(255,255,255,0.08)"),
  tool: { ...box("transparent"), opacity: 0.6, fontSize: 11, fontFamily: "monospace" },
  error: box("rgba(220,50,50,0.3)"),
};

function Content() {
  const [s, setS] = useState<State | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const st = await getState();
        if (alive) setS(st);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!s) return <PanelSection>Загрузка…</PanelSection>;
  const busy = s.phase !== "idle";

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          {s.phase === "recording" ? (
            <ButtonItem layout="below" onClick={() => stopRecording()}>
              ⏹ Готово ({s.rec_seconds} с)
            </ButtonItem>
          ) : (
            <ButtonItem layout="below" disabled={busy || !s.model_ready} onClick={() => startRecording()}>
              🎤 Говорить
            </ButtonItem>
          )}
        </PanelSectionRow>
        {!s.model_ready && <div style={box("rgba(220,160,50,0.3)")}>Модель Whisper не найдена</div>}
        {PHASE[s.phase] && s.phase !== "recording" && <div style={{ fontSize: 12, opacity: 0.8 }}>{PHASE[s.phase]}</div>}
        {s.error && <div style={STYLE.error}>{s.error}</div>}
      </PanelSection>

      {s.pending.length > 0 && (
        <PanelSection title="Нужно подтверждение">
          {s.pending.map((p) => (
            <div key={p.id}>
              <div style={{ ...box("rgba(220,160,50,0.25)"), fontFamily: "monospace", fontSize: 11 }}>{p.detail}</div>
              <PanelSectionRow>
                <ButtonItem layout="below" onClick={() => respond(p.id, true)}>✅ Разрешить</ButtonItem>
              </PanelSectionRow>
              <PanelSectionRow>
                <ButtonItem layout="below" onClick={() => respond(p.id, false)}>❌ Отклонить</ButtonItem>
              </PanelSectionRow>
            </div>
          ))}
        </PanelSection>
      )}

      <PanelSection title="Разговор">
        {s.events.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>Нажмите «Говорить» и задайте вопрос.</div>}
        {s.events.slice(-30).map((e, i) => (
          <div key={i} style={STYLE[e.kind]}>
            {e.kind === "tool" ? "⚙ " : ""}
            {e.text}
          </div>
        ))}
      </PanelSection>

      <PanelSection title="Управление">
        <PanelSectionRow>
          <TextField label="Ввести текстом" value={typed} disabled={busy} onChange={(e) => setTyped(e.target.value)} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !typed.trim()}
            onClick={async () => {
              if (await sendText(typed)) setTyped("");
            }}
          >
            Отправить текст
          </ButtonItem>
        </PanelSectionRow>
        {busy && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => cancel()}>Остановить</ButtonItem>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy || (!s.has_session && s.events.length === 0)} onClick={() => newChat()}>
            Новый разговор
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => ({
  name: "Claude Voice",
  titleView: <div className={staticClasses.Title}>Claude Voice</div>,
  content: <Content />,
  icon: <FaMicrophone />,
}));
