import { DialogButton, Focusable, Menu, MenuGroup, MenuItem, ScrollPanel, TextField, showContextMenu } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaArrowDown, FaArrowUp, FaSlidersH, FaTimes } from "react-icons/fa";
import {
  EFFORT_OPTIONS,
  MODE_OPTIONS,
  ago,
  cancel,
  deleteChat,
  getState,
  labelOf,
  modelOptions,
  newChat,
  pokeState,
  quickActionsFor,
  refreshModels,
  sendText,
  setPref,
  switchChat,
  useClaudeState,
  useGame,
} from "./api";
import { ask, micToggle } from "./actions";
import { CSS } from "./theme";
import { ApprovalCard, LiveView, MessageView, MicIcon, Orb, StatusLine } from "./ui";

/* ---------- per-chat parameters: native Steam context menu (takes gamepad focus by itself) ---------- */
async function openSettings() {
  const s = await getState();
  const pick = (list: { data: string; label: string }[], cur: string, key: string) =>
    list.map((o) => (
      <MenuItem key={o.data} onSelected={() => setPref(key, o.data)}>
        {o.data === cur ? "✓ " : "   "}{o.label}
      </MenuItem>
    ));
  const models = modelOptions(s);
  showContextMenu(
    <Menu label={`Chat settings · ${s.chat.title.slice(0, 30)}`} cancelText="Cancel">
      <MenuGroup label={`Model · ${labelOf(models, s.prefs.model)}`}>{pick(models, s.prefs.model, "model")}</MenuGroup>
      <MenuGroup label={`Thinking · ${labelOf(EFFORT_OPTIONS, s.prefs.effort)}`}>{pick(EFFORT_OPTIONS, s.prefs.effort, "effort")}</MenuGroup>
      <MenuGroup label={`Claude actions · ${labelOf(MODE_OPTIONS, s.prefs.approval)}`}>{pick(MODE_OPTIONS, s.prefs.approval, "approval")}</MenuGroup>
      <MenuGroup label="Delete chat" disabled={s.phase !== "idle"}>
        <MenuItem onSelected={() => deleteChat(s.chat.id)}>Yes, delete this chat</MenuItem>
      </MenuGroup>
    </Menu>,
  );
}

function copyText(text: string, doc: Document) {
  try {
    const ta = doc.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand("copy");
    doc.body.removeChild(ta);
    if (ok) return true;
  } catch {
    /* fall through */
  }
  try {
    const clip = (doc.defaultView?.navigator as any)?.clipboard;
    if (!clip?.writeText) return false; // nothing to copy with: do not claim success
    clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}


/* ---------- chat list row ---------- */
function ChatRow({ c, busy, onPick }: { c: { id: string; title: string; updated: number; count: number; active: boolean }; busy: boolean; onPick: (c: { id: string; active: boolean }) => void }) {
  return (
    <DialogButton className={`cv-chatrow ${c.active ? "active" : ""}`} disabled={busy} onClick={() => onPick(c)} onOKActionDescription="Open">
      <div className="cv-chatrow-t">{c.title}</div>
      <div className="cv-chatrow-s">{ago(c.updated)}</div>
    </DialogButton>
  );
}

const LEFT_PAD = 47; // analog source id of the left trackpad
const PAD_SCROLL = 1; // list pixels per trackpad unit

export function Fullscreen() {
  const s = useClaudeState();
  const game = useGame();
  const [typed, setTyped] = useState("");
  const [ctxMsg, setCtxMsg] = useState<{ t: number; text: string } | null>(null); // "Ask about this" context
  const [atBottom, setAtBottom] = useState(true);
  const [onMicBtn, setOnMicBtn] = useState(false); // pointer is on the mic button itself
  const ready = !!s;
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  const typedAt = useRef(0);
  const sawBlur = useRef(false);
  const openKb = () => {
    typingRef.current = true;
    typedAt.current = Date.now();
    sawBlur.current = false;
    setTyping(true);
  };
  const closeKb = () => {
    if (!typingRef.current) return;
    typingRef.current = false;
    setTyping(false);
  };
  const scrollRef = useRef<HTMLDivElement>(null); // wrapper around Steam's ScrollPanel
  const scroller = (): HTMLElement | null => {
    const w = scrollRef.current;
    const view = w?.ownerDocument.defaultView;
    if (!w || !view) return null;
    for (const el of Array.from(w.querySelectorAll("*")) as HTMLElement[]) {
      const o = view.getComputedStyle(el).overflowY;
      if (o === "auto" || o === "scroll") return el;
    }
    return null;
  };
  const [sel, setSel] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [flash, setFlash] = useState("");
  const stick = useRef(true); // follow new output only while the user is at the bottom
  const signal = s ? `${s.events.length}|${s.live.text.length}|${s.live.thinking.length}|${s.pending.length}|${s.phase}|${typing}` : "";

  useEffect(() => {
    refreshModels().catch(() => {});
  }, []);
  // The on-screen keyboard sends no DOM events. The only reliable close signal is Steam's own
  // "dismissed" call, so wrap it. The UI lives in another window than this plugin's code: wrap both contexts.
  useEffect(() => {
    const view: any = scrollRef.current?.ownerDocument.defaultView;
    const contexts = [window as any, view].filter((c, i, all) => c && all.indexOf(c) === i);
    const undo: (() => void)[] = [];
    for (const ctx of contexts) {
      const input = ctx.SteamClient?.Input;
      if (!input) continue;
      for (const name of ["ModalKeyboardDismissed", "StandaloneKeyboardDismissed"]) {
        const orig = input[name];
        if (typeof orig !== "function") continue;
        const wrapped = function (this: any, ...a: any[]) {
          closeKb();
          return orig.apply(this, a);
        };
        try {
          input[name] = wrapped;
          undo.push(() => {
            if (input[name] === wrapped) input[name] = orig;
          });
        } catch {
          /* read-only API object */
        }
      }
    }
    return () => undo.reverse().forEach((f) => f());
  }, [ready]);
  // closing hints from the field itself (the keyboard's own Done/Enter never reaches us as a button)
  useEffect(() => {
    const doc = scrollRef.current?.ownerDocument;
    const input = doc?.querySelector(".cv-composer input, .cv-composer textarea") as HTMLElement | null;
    if (!input) return;
    const onBlur = () => closeKb();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") closeKb();
    };
    input.addEventListener("blur", onBlur);
    input.addEventListener("keydown", onKey);
    return () => {
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("keydown", onKey);
    };
  }, [ready]);
  // while the keyboard is up, the Steam window loses focus; when it gets it back the keyboard is closed
  useEffect(() => {
    if (!typing) return;
    const doc = scrollRef.current?.ownerDocument;
    const id = setInterval(() => {
      const f = doc ? doc.hasFocus() : true;
      if (!f) sawBlur.current = true;
      else if (sawBlur.current) closeKb();
    }, 250);
    return () => clearInterval(id);
  }, [typing]);
  // selected text inside the conversation -> floating action bar
  useEffect(() => {
    const doc = scrollRef.current?.ownerDocument;
    if (!doc) return;
    let timer: any;
    const onSel = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const g = doc.defaultView?.getSelection() ?? null;
        const text = g ? g.toString().trim() : "";
        const node = g?.anchorNode as Node | null;
        const inside = !!(node && scrollRef.current && scrollRef.current.contains(node));
        setSel(inside && text ? text.slice(0, 2000) : "");
        if (!inside || !text) setMenu(null);
      }, 120);
    };
    doc.addEventListener("selectionchange", onSel);
    return () => {
      clearTimeout(timer);
      doc.removeEventListener("selectionchange", onSel);
    };
  }, [ready]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(""), 1500);
    return () => clearTimeout(id);
  }, [flash]);
  useEffect(() => {
    // scroll only the message list, never the surrounding Steam page
    const el = scroller();
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [signal]);

  const onScroll = () => {
    const el = scroller();
    if (el) {
      stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
      setAtBottom(stick.current);
    }
  };
  useEffect(() => {
    // scroll events do not bubble: listen on the wrapper in the capture phase, natively
    const w = scrollRef.current;
    if (!w) return;
    w.addEventListener("scroll", onScroll, true);
    return () => w.removeEventListener("scroll", onScroll, true);
  }, [ready]);
  // keep the focused message visible inside the list
  const lastDir = useRef(0); // last D-pad / trackpad up (9) or down (10) press
  const reveal = (e: any) => {
    const c = scroller();
    const el = (e?.currentTarget || e?.target) as HTMLElement | undefined;
    if (!c || !el || noReveal.current) return;
    cancelGlide();
    const cr = c.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    // a message taller than the view: when coming from below show its end, otherwise its start
    if (er.height > cr.height && lastDir.current === 9) c.scrollTop += er.bottom - cr.bottom + 6;
    else if (er.height > cr.height || er.top < cr.top) c.scrollTop += er.top - cr.top - 6;
    else if (er.bottom > cr.bottom) c.scrollTop += er.bottom - cr.bottom + 6;
  };
  // Smooth scrolling: every press adds to a target and a frame loop eases the list towards it,
  // so holding the button scrolls continuously.
  const glideRef = useRef<{ target: number; raf: number; view: Window; follow: boolean } | null>(null);
  const noReveal = useRef(false); // set while focus follows the scroll, so focusing does not scroll again
  const cancelGlide = () => {
    const g = glideRef.current;
    glideRef.current = null;
    g?.view.cancelAnimationFrame(g.raf);
  };
  useEffect(() => cancelGlide, []);
  // the focused message follows the scroll: the one that is most on screen
  const followFocus = (c: HTMLElement) => {
    const doc = c.ownerDocument;
    const cr = c.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestOverlap = 0;
    for (const m of Array.from(doc.querySelectorAll(".cv-msgbtn")) as HTMLElement[]) {
      const r = m.getBoundingClientRect();
      const overlap = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
      if (overlap > bestOverlap) {
        best = m;
        bestOverlap = overlap;
      }
    }
    if (best && best !== doc.activeElement) {
      noReveal.current = true;
      best.focus();
      noReveal.current = false;
    }
  };
  const glide = (c: HTMLElement, delta: number, follow: boolean) => {
    const view = c.ownerDocument.defaultView!;
    const base = glideRef.current ? glideRef.current.target : c.scrollTop;
    const target = Math.max(0, Math.min(c.scrollHeight - c.clientHeight, base + delta));
    const tick = () => {
      const g = glideRef.current;
      if (!g) return;
      const diff = g.target - c.scrollTop;
      if (Math.abs(diff) < 1) {
        c.scrollTop = g.target;
        glideRef.current = null;
      } else {
        c.scrollTop += Math.abs(diff) < 4 ? diff : diff * 0.3;
        g.raf = view.requestAnimationFrame(tick);
      }
      if (g.follow) followFocus(c);
    };
    if (glideRef.current) glideRef.current.target = target;
    else {
      glideRef.current = { target, raf: 0, view, follow };
      glideRef.current.raf = view.requestAnimationFrame(tick);
    }
  };
  // D-pad up/down move between messages (Steam's own navigation). Only inside a message that is taller than the
  // view they first scroll its text (a page per tap, continuously while held) until its end or start is on screen.
  const scrollWithin = (dir: number, repeat: boolean): boolean => {
    const c = scroller();
    const cur = (scrollRef.current?.ownerDocument.activeElement as HTMLElement | null)?.closest?.(".cv-msgbtn");
    if (!c || !cur) return false;
    const cr = c.getBoundingClientRect();
    const er = cur.getBoundingClientRect();
    const pending = glideRef.current ? glideRef.current.target - c.scrollTop : 0; // scroll still on its way
    const step = repeat ? Math.max(20, Math.round(cr.height * 0.25)) : Math.max(60, Math.round(cr.height * 0.7));
    const bottom = er.bottom - pending - cr.bottom;
    const top = cr.top - (er.top - pending);
    if (dir === 10 && bottom > 4) {
      glide(c, Math.min(step, bottom + 6), false);
      return true;
    }
    if (dir === 9 && top > 4) {
      glide(c, -Math.min(step, top + 6), false);
      return true;
    }
    return false;
  };

  // Left trackpad: Steam sends its finger position as analog messages [controller, source, _, x, y].
  // Moving the finger scrolls the list by the same distance (like touch scrolling), so it follows the finger smoothly.
  useEffect(() => {
    const view: any = scrollRef.current?.ownerDocument.defaultView ?? window;
    const input = view.SteamClient?.Input;
    if (typeof input?.RegisterForControllerAnalogInputMessages !== "function") return;
    try {
      input.EnableControllerAnalogInputMessages?.(true);
    } catch { /* optional */ }
    let prev: { y: number; t: number } | null = null;
    const reg = input.RegisterForControllerAnalogInputMessages((_c: number, source: number, _f: boolean, x: number, y: number) => {
      if (source !== LEFT_PAD) return;
      if (!x && !y) {
        prev = null; // finger lifted
        return;
      }
      const now = Date.now();
      const c = scroller();
      if (prev && now - prev.t < 200 && c && y !== prev.y) {
        cancelGlide();
        c.scrollTop -= (y - prev.y) * PAD_SCROLL;
        followFocus(c);
      }
      prev = { y, t: now };
    });
    return () => {
      reg?.unregister?.();
      try {
        input.EnableControllerAnalogInputMessages?.(false);
      } catch { /* optional */ }
    };
  }, [ready]);

  // while a request runs the mic is blocked and the pointer sits on Stop; when it ends the pointer returns to the input
  const prevPhase = useRef("idle");
  useEffect(() => {
    const cur = s?.phase ?? "idle";
    const prev = prevPhase.current;
    prevPhase.current = cur;
    const doc = scrollRef.current?.ownerDocument;
    if (!doc || cur === prev) return;
    const ae = doc.activeElement as HTMLElement | null;
    const mine = !!ae?.closest?.(".cv-composer") || ae === doc.body || !ae; // do not steal focus from the message list or sidebar
    if (cur === "recording" && prev === "idle") {
      // recording is a modal action: the pointer goes to the mic button, where A means "stop and send"
      setTimeout(() => (doc.querySelector(".cv-composer .cv-mic") as HTMLElement | null)?.focus(), 80);
      return;
    }
    if ((cur === "transcribing" || cur === "thinking") && (prev === "idle" || prev === "recording") && mine) {
      setTimeout(() => (doc.querySelector(".cv-stop") as HTMLElement | null)?.focus(), 80);
    } else if (cur === "idle" && prev !== "idle" && mine) {
      setTimeout(() => (doc.querySelector(".cv-composer input, .cv-composer textarea") as HTMLElement | null)?.focus(), 80);
    }
  }, [s?.phase]);
  // move gamepad focus into the chat: the input field (not a message)
  const pendingFocus = useRef(false);
  const focusConversation = (): boolean => {
    const doc = scrollRef.current?.ownerDocument;
    if (!doc) return false;
    // land on the input field; the user moves up to the messages on their own
    const target = (doc.querySelector(".cv-composer input, .cv-composer textarea") || doc.querySelector(".cv-composer button")) as HTMLElement | null;
    if (!target) return false;
    target.focus();
    return true;
  };
  const focusChats = () => {
    const doc = scrollRef.current?.ownerDocument;
    const row = (doc?.querySelector(".cv-chatrow.active") || doc?.querySelector(".cv-chatrow")) as HTMLElement | null;
    row?.focus();
  };
  const pickChat = (c: { id: string; active: boolean }) => {
    if (c.active) {
      focusConversation();
      return;
    }
    pendingFocus.current = true;
    switchChat(c.id);
  };
  useEffect(() => {
    if (pendingFocus.current && focusConversation()) pendingFocus.current = false;
  }, [s?.chat.id, s?.events.length]);

  if (!s) {
    return (
      <div className="cv-full" style={{ gridTemplateColumns: "1fr" }}>
        <style>{CSS}</style>
      </div>
    );
  }
  const busy = s.phase !== "idle";
  const empty = s.events.length === 0 && !busy;
  const done = (msg = "") => {
    scrollRef.current?.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
    setSel("");
    setMenu(null);
    if (msg) setFlash(msg);
  };
  const doCopy = () => done(copyText(sel, scrollRef.current!.ownerDocument) ? "Copied" : "Copy failed");
  const doInsert = () => {
    setTyped((cur) => (cur ? cur + " " : "") + sel);
    done("Added to the input");
  };
  const focusInput = () =>
    setTimeout(() => (scrollRef.current?.ownerDocument.querySelector(".cv-composer input, .cv-composer textarea") as HTMLElement | null)?.focus(), 60);
  // "Ask about this" attaches the text as context (a line above the input), it is not pasted into the input
  const addContext = (text: string, t: number | null) => {
    setCtxMsg({ t: t ?? 0, text: text.slice(0, 1500) });
    focusInput();
  };
  const doAsk = () => {
    const g = scrollRef.current?.ownerDocument.defaultView?.getSelection();
    const holder = (g?.anchorNode as any)?.parentElement?.closest?.("[data-cv-t]") as HTMLElement | null;
    const tt = holder ? Number(holder.getAttribute("data-cv-t")) : null;
    const text = sel;
    done();
    addContext(text, tt);
  };
  // jump to the message the context came from and put the pointer on it
  const scrollToMsg = (tt: number) => {
    const doc = scrollRef.current?.ownerDocument;
    const btn = (doc?.querySelector(`[data-cv-t="${tt}"]`) as HTMLElement | null)?.closest(".cv-msgbtn") as HTMLElement | null;
    const c = scroller();
    if (!btn || !c) {
      setFlash("Original message not found");
      return;
    }
    const cr = c.getBoundingClientRect();
    const er = btn.getBoundingClientRect();
    c.scrollTo({ top: c.scrollTop + (er.top - cr.top) - Math.max(0, (cr.height - er.height) / 2), behavior: "smooth" });
    btn.focus();
  };
  // Y on a message: small native menu (uses the current text selection if there is one)
  const messageMenu = (text: string, tt: number) =>
    showContextMenu(
      <Menu label={sel ? "Selected text" : "Message"} cancelText="Cancel">
        <MenuItem onSelected={() => addContext(text, tt)}>Ask about this</MenuItem>
        <MenuItem onSelected={() => setFlash(copyText(text, scrollRef.current!.ownerDocument) ? "Copied" : "Copy failed")}>Copy</MenuItem>
        <MenuItem onSelected={() => setTyped((cur) => (cur ? cur + " " : "") + text.slice(0, 1500))}>Insert into input</MenuItem>
      </Menu>,
    );
  // scroll-down button: back to the newest message, pointer on it
  const toBottom = () => {
    stick.current = true;
    setAtBottom(true);
    const c = scroller();
    c?.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
    setTimeout(() => {
      const msgs = scrollRef.current?.ownerDocument.querySelectorAll(".cv-msgbtn");
      (msgs && (msgs[msgs.length - 1] as HTMLElement | undefined))?.focus();
    }, 250);
  };
  const onMic = async () => {
    const r = await micToggle(s, game, "current", ctxMsg?.text ?? "");
    if (r === "stopped") setCtxMsg(null); // the context went out with the voice message
  };
  // X starts a recording ("Voice input"); stopping is A on the mic button. On the mic button A already records, so no X hint there.
  const micAvailable = s.phase === "idle" && s.model_ready && !onMicBtn;
  const send = async () => {
    stick.current = true;
    const ok = await sendText(typed, game, "current", ctxMsg?.text ?? "");
    pokeState();
    if (ok) {
      setTyped("");
      setCtxMsg(null);
    }
  };
  const summary = [
    s.prefs.model === "default" ? s.models.current || "default" : s.prefs.model,
    s.prefs.effort === "default" ? "effort auto" : s.prefs.effort,
    labelOf(MODE_OPTIONS, s.prefs.approval).toLowerCase(),
  ].join(" · ");

  return (
    <Focusable
      className="cv-full"
      onButtonDown={() => {
        // the keyboard swallows gamepad input; the first button reaching the page afterwards means it is closed
        if (typingRef.current && Date.now() - typedAt.current > 700) closeKb();
      }}
    >
      <style>{CSS}</style>

      <div className="cv-side">
        <div className="cv-brand">
          <Orb phase="idle" level={0} size={24} />
          <span>Claude</span>
        </div>
        <DialogButton disabled={busy} onClick={() => newChat()}>New chat</DialogButton>
        <div className="cv-chatlist">
          {s.chats.map((c) => (
            <ChatRow key={c.id} c={c} busy={busy} onPick={pickChat} />
          ))}
        </div>
      </div>

      <Focusable
        className={`cv-main ${typing ? "cv-typing" : ""}`}
        // X is only offered when it does something: record, or stop and send. Hidden while transcribing or replying.
        onSecondaryButton={micAvailable ? () => onMic() : undefined}
        onSecondaryActionDescription={micAvailable ? "Microphone" : undefined}
        onMenuButton={() => openSettings()}
        onMenuActionDescription="Settings"
        onCancelButton={(e: any) => {
          if (s.phase === "recording") {
            cancel(); // B while recording: throw the recording away, send nothing
            setTimeout(pokeState, 100);
          } else focusChats();
          e?.stopPropagation?.();
        }}
        onCancelActionDescription={s.phase === "recording" ? "Cancel recording" : "Chats"}
      >
        <div className="cv-head">
          <div className="cv-head-t">{s.chat.title}</div>
          {game && <span className="cv-gamechip" style={{ marginTop: 0 }}>{game.name || `appid ${game.appid}`}</span>}
          <DialogButton className="cv-icon-btn cv-slim" onClick={openSettings}>
            <FaSlidersH />
          </DialogButton>
        </div>
        <div className="cv-hint" style={{ margin: "3px 0 0 1px" }}>{summary}</div>

        {(sel || flash) && (
          <div className="cv-selbar">
            {flash ? (
              <span className="cv-hint" style={{ padding: "0 8px" }}>{flash}</span>
            ) : (
              <>
                <DialogButton className="cv-sel-btn" onMouseDown={(e: any) => e.preventDefault()} onClick={doCopy}>Copy</DialogButton>
                <DialogButton className="cv-sel-btn" onMouseDown={(e: any) => e.preventDefault()} onClick={doInsert}>To input</DialogButton>
                <DialogButton className="cv-sel-btn cv-sel-ask" onMouseDown={(e: any) => e.preventDefault()} onClick={doAsk}>Ask Claude</DialogButton>
              </>
            )}
          </div>
        )}
        {menu && sel && (
          <div className="cv-ctx" style={{ left: menu.x, top: menu.y }}>
            <DialogButton className="cv-sel-btn" onClick={doCopy}>Copy</DialogButton>
            <DialogButton className="cv-sel-btn" onClick={doInsert}>Paste into input</DialogButton>
            <DialogButton className="cv-sel-btn cv-sel-ask" onClick={doAsk}>Ask Claude about this</DialogButton>
          </div>
        )}
        <div
          className="cv-scrollwrap"
          ref={scrollRef}
          onContextMenu={(e: any) => {
            if (!sel) return;
            e.preventDefault();
            setMenu({ x: Math.min(e.clientX, (e.view?.innerWidth ?? 800) - 230), y: Math.min(e.clientY, (e.view?.innerHeight ?? 500) - 140) });
          }}
        >
          <ScrollPanel>
          <Focusable
            className="cv-scrollin"
            navEntryPreferPosition={1 as any}
            onGamepadDirection={(e: any) => {
              const dir = e?.detail?.button;
              const doc = scrollRef.current?.ownerDocument;
              if (dir === 9 || dir === 10) {
                lastDir.current = dir;
                if (scrollWithin(dir, !!e?.detail?.is_repeat)) {
                  e.stopPropagation?.();
                  return;
                }
              }
              if (dir === 12) {
                // right from a message goes to the "Latest" button when it is shown
                const b = doc?.querySelector(".cv-tobottom") as HTMLElement | null;
                if (b) {
                  b.focus();
                  e.stopPropagation?.();
                }
              } else if (dir === 10) {
                // down from the newest message goes to the input field (Steam finds no neighbour there)
                const msgs = doc ? Array.from(doc.querySelectorAll(".cv-msgbtn")) : [];
                if (!msgs.length || doc?.activeElement === msgs[msgs.length - 1]) {
                  (doc?.querySelector(".cv-composer input, .cv-composer textarea") as HTMLElement | null)?.focus();
                  e.stopPropagation?.();
                }
              }
            }}
          >
          {empty && (
            <div className="cv-empty">
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Orb phase="idle" level={0} size={48} />
              </div>
              <h2>How can I help?</h2>
              <p>{game ? `Running now: ${game.name}` : "Speak or type"}</p>
              <Focusable className="cv-chips-row" flow-children="horizontal">
                {quickActionsFor(game).map((a) => (
                  <DialogButton key={a.label} className="cv-chip" onClick={() => ask(a.prompt, game)}>
                    {a.label}
                  </DialogButton>
                ))}
              </Focusable>
            </div>
          )}
          {s.events.map((e, i) =>
            e.kind === "thinking" ? (
              <MessageView key={`${e.t}-${i}`} e={e} showTime={false} />
            ) : (
              <DialogButton
                key={`${e.t}-${i}`}
                className="cv-msgbtn"
                {...({ onGamepadFocus: reveal, preferredFocus: i === s.events.length - 1 } as any)}
                onOKActionDescription="Copy"
                onOptionsButton={() => messageMenu(sel || e.text, e.t)}
                onOptionsActionDescription="Actions"
                onOKButton={() => setFlash(copyText(e.text, scrollRef.current!.ownerDocument) ? "Copied" : "Copy failed")}
              >
                <div data-cv-t={e.t}>
                  <MessageView e={e} showTime={false} />
                </div>
              </DialogButton>
            ),
          )}
          <LiveView live={s.live} phase={s.phase} showReasoning={true} />
          {s.error && <div className="cv-err">{s.error}</div>}
          <StatusLine phase={s.phase} secs={s.rec_seconds} level={s.rec_level} />
          </Focusable>
          </ScrollPanel>
        </div>

        {s.pending.map((p) => (
          <ApprovalCard key={p.id} p={p} />
        ))}

        {ctxMsg && (
          <div className="cv-ctxrow">
            <DialogButton className="cv-ctxchip" onClick={() => scrollToMsg(ctxMsg.t)} onOKActionDescription="Go to message">
              <span className="cv-ctx-k">Context</span>
              <span className="cv-ctx-t">{ctxMsg.text.replace(/\s+/g, " ").slice(0, 80)}</span>
            </DialogButton>
            <DialogButton className="cv-icon-btn cv-slim" onClick={() => setCtxMsg(null)}>
              <FaTimes />
            </DialogButton>
          </div>
        )}
        {!atBottom && !empty && (
          <DialogButton
            className="cv-tobottom"
            onClick={toBottom}
            onOKActionDescription="Latest message"
            onGamepadDirection={(e: any) => {
              const b = e?.detail?.button;
              const doc = scrollRef.current?.ownerDocument;
              if (b === 10) {
                // D-pad down: the input field
                (doc?.querySelector(".cv-composer input, .cv-composer textarea") as HTMLElement | null)?.focus();
                e.stopPropagation?.();
                return;
              }
              // D-pad left or up: back to a message in view
              if (b !== 11 && b !== 9) return;
              const c = scroller();
              const msgs = Array.from(doc?.querySelectorAll(".cv-msgbtn") ?? []) as HTMLElement[];
              const cr = c?.getBoundingClientRect();
              const visible = msgs.filter((m) => cr && m.getBoundingClientRect().bottom > cr.top && m.getBoundingClientRect().top < cr.bottom);
              (visible[visible.length - 1] ?? msgs[msgs.length - 1])?.focus();
              e.stopPropagation?.();
            }}
          >
            <FaArrowDown /> Latest
          </DialogButton>
        )}
        <Focusable className="cv-composer" flow-children="horizontal" navEntryPreferPosition={4 as any}>
          <DialogButton
            className={`cv-icon-btn ${s.phase === "recording" ? "cv-mic cv-mic-rec" : busy ? "cv-mic cv-mic-busy" : "cv-mic"}`}
            disabled={(!s.model_ready && s.phase === "idle") || (busy && s.phase !== "recording")}
            onClick={() => onMic()}
            onOKActionDescription={s.phase === "recording" ? "Stop and send" : "Record"}
            {...({ onGamepadFocus: () => setOnMicBtn(true), onGamepadBlur: () => setOnMicBtn(false) } as any)}
          >
            <MicIcon phase={s.phase === "recording" ? "recording" : "idle"} />
          </DialogButton>
          {/* A on the field opens the on-screen keyboard: only then shrink the chat so the field sits above it */}
          <Focusable
            preferredFocus
            noFocusRing
            style={{ flex: 1, minWidth: 0 }}
            onButtonDown={(e: any) => {
              if (e?.detail?.button === 1) openKb();
            }}
            onClickCapture={() => openKb()}
            onCancelButton={(e: any) => {
              if (typing) closeKb(); // B closes the keyboard only
              else focusChats(); // a handler on this element swallows B, so go back to the chat list here
              e?.stopPropagation?.();
            }}
            onGamepadBlur={() => closeKb()}
          >
            <TextField value={typed} disabled={busy} placeholder="Message Claude…" onChange={(e) => setTyped(e.target.value)} />
          </Focusable>
          {busy && s.phase !== "recording" ? (
            <DialogButton className="cv-icon-btn cv-stop" onClick={() => cancel()}>
              <MicIcon phase="thinking" />
            </DialogButton>
          ) : (
            typed.trim() && (
              <DialogButton className="cv-icon-btn" disabled={busy} onClick={send}>
                <FaArrowUp />
              </DialogButton>
            )
          )}
        </Focusable>
      </Focusable>
    </Focusable>
  );
}
