import { ButtonItem, DialogButton, Dropdown, Focusable, Navigation, PanelSection, PanelSectionRow } from "@decky/ui";
import { cancel, quickActionsFor, setPanelTarget, useClaudeState, useGame } from "./api";
import { ask, micToggle } from "./actions";
import { CSS } from "./theme";
import { ApprovalCard, MicIcon, Orb, StatusLine } from "./ui";

const plain = (t: string) => t.replace(/```[a-zA-Z0-9_+-]*\n?/g, "").replace(/\*\*/g, "").replace(/`/g, "").replace(/^#+\s*/gm, "").trim();

export function Panel() {
  const s = useClaudeState();
  const game = useGame();
  if (!s) return <div className="cv-root"><style>{CSS}</style></div>;

  const busy = s.phase !== "idle";
  const recording = s.phase === "recording";
  const target = s.panel_target;
  const open = () => {
    Navigation.CloseSideMenus();
    Navigation.Navigate("/claude-voice");
  };
  const targetOptions = [
    { data: "new", label: "New chat" },
    ...s.chats.slice(0, 8).map((c) => ({ data: c.id, label: c.title })),
  ];

  // last thing worth showing: streamed text, then latest assistant/tool/error event
  const lastEv = [...s.events].reverse().find((e) => e.kind === "assistant" || e.kind === "error" || e.kind === "tool");
  let preview = "";
  let caption = "";
  if (s.phase === "thinking" && s.live.text) {
    preview = plain(s.live.text);
    caption = "Replying";
  } else if (lastEv) {
    preview = plain(lastEv.text);
    caption = lastEv.kind === "tool" ? "Working" : lastEv.kind === "error" ? "Error" : "Last reply";
  }
  const actions = quickActionsFor(game);

  return (
    <div className="cv-root">
      <style>{CSS}</style>
      <div className="cv-hero">
        <Orb phase={s.phase} level={s.rec_level} size={26} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="cv-status">Claude</div>
          <div className="cv-sub">{game ? game.name : s.chat.title}</div>
        </div>
      </div>

      <PanelSection>
        <PanelSectionRow>
          <Dropdown
            rgOptions={targetOptions}
            selectedOption={target}
            disabled={busy}
            onChange={(o) => setPanelTarget(o.data)}
            menuLabel="Send to"
            renderButtonValue={() => <span>Chat: {targetOptions.find((o) => o.data === target)?.label ?? "New chat"}</span>}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          {busy && !recording ? (
            <ButtonItem layout="below" onClick={() => cancel()}>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}><MicIcon phase={s.phase} /> Stop</div>
            </ButtonItem>
          ) : (
            <ButtonItem layout="below" disabled={!s.model_ready} onClick={() => micToggle(s, game, target)}>
              <div className={recording ? "cv-mic cv-mic-rec" : "cv-mic"} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, fontSize: 14, padding: "6px 0" }}>
                <MicIcon phase={recording ? "recording" : "idle"} />
                {recording ? `Done · ${s.rec_seconds}s` : "Speak"}
              </div>
            </ButtonItem>
          )}
        </PanelSectionRow>
        {!s.model_ready && <div className="cv-err">Whisper model not found, voice is unavailable.</div>}
        {s.error && <div className="cv-err">{s.error}</div>}
      </PanelSection>

      {s.pending.length > 0 && (
        <PanelSection>
          {s.pending.map((p) => (
            <ApprovalCard key={p.id} p={p} />
          ))}
        </PanelSection>
      )}

      {(preview || busy) && (
        <PanelSection>
          <Focusable onActivate={open} onClick={open}>
            {preview && (
              <div className="cv-prevbox">
                <div className="cv-prev-dim">{caption}</div>
                <div className="cv-prev">{preview}</div>
              </div>
            )}
            <StatusLine phase={s.phase} secs={s.rec_seconds} level={s.rec_level} />
          </Focusable>
        </PanelSection>
      )}

      <PanelSection title={game ? "For this game" : "Quick actions"}>
        <Focusable className="cv-chips" flow-children="grid">
          {actions.map((a) => (
            <DialogButton key={a.label} className="cv-chip" style={{ width: "100%" }} disabled={busy} onClick={() => ask(a.prompt, game, target)}>
              {a.label}
            </DialogButton>
          ))}
        </Focusable>
        <div style={{ height: 8 }} />
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={open}>
            Open chat
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </div>
  );
}
