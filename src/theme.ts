export const CSS = `
.cv-root, .cv-full {
  --c: #D97757; --bg: #1f1e1d; --panel: #2b2a28; --panel2: #36332f; --text: #ece9e2; --dim: #a09b92;
  --line: rgba(255,255,255,.09); --danger: #e5534b; --ok: #8fbf6f;
  color: var(--text);
}
@keyframes cv-spin { to { transform: rotate(360deg) } }
@keyframes cv-pulse { 0%,100% { opacity: .5; transform: scale(.92) } 50% { opacity: 1; transform: scale(1) } }
@keyframes cv-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
@keyframes cv-caret { 50% { opacity: 0 } }
@keyframes cv-dots { 0%,80%,100% { opacity: .25 } 40% { opacity: 1 } }

/* Claude spark */
.cv-spark { display: inline-block; flex: none; line-height: 0; }
.cv-spark svg { display: block; transition: transform .12s ease-out; }
.cv-spark-thinking svg { animation: cv-spin 6s linear infinite; }
.cv-spark-transcribing svg { animation: cv-pulse 1.1s ease-in-out infinite; }

/* shared text */
.cv-status { font-size: 14px; font-weight: 600; }
.cv-sub { font-size: 11.5px; color: var(--dim); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-gamechip { display: inline-block; margin-top: 5px; padding: 1px 9px; border-radius: 999px; font-size: 11px; color: var(--dim); border: 1px solid var(--line); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-err { background: rgba(229,83,75,.13); border: 1px solid rgba(229,83,75,.45); color: #f3c7c3; border-radius: 4px; padding: 7px 10px; font-size: 12px; margin: 6px 0; }
.cv-hint { font-size: 11px; color: var(--dim); }

/* messages: Claude-like, assistant has no bubble */
.cv-msg { display: flex; gap: 10px; margin: 12px 0; animation: cv-in .18s ease-out; }
.cv-msg-user { justify-content: flex-end; }
.cv-user-b { max-width: 82%; background: var(--panel2); border-radius: 4px; padding: 8px 12px; font-size: 13px; line-height: 1.45; word-break: break-word; }
.cv-ai-b { flex: 1; min-width: 0; font-size: 13.5px; line-height: 1.55; word-break: break-word; }
.cv-time { font-size: 10px; color: var(--dim); margin-top: 3px; }
.cv-tool { font-family: monospace; font-size: 11px; color: var(--dim); margin: 4px 0 4px 32px; padding-left: 8px; border-left: 2px solid var(--line); word-break: break-all; }
.cv-think { margin: 8px 0 8px 32px; font-size: 12px; color: var(--dim); }
.cv-think-b { margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--c); font-style: italic; white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: hidden; }
.cv-dots span { display: inline-block; width: 5px; height: 5px; margin: 0 2px; border-radius: 50%; background: var(--dim); animation: cv-dots 1.1s infinite; }
.cv-dots span:nth-child(2) { animation-delay: .15s } .cv-dots span:nth-child(3) { animation-delay: .3s }
.cv-caret::after { content: "●"; font-size: 9px; margin-left: 4px; color: var(--c); animation: cv-caret .9s steps(1) infinite; }

/* markdown-lite */
.cv-md > div > div { margin: 1px 0; } .cv-gap { height: 7px; } .cv-h { font-weight: 700; margin-top: 4px; }
.cv-code-i { background: rgba(255,255,255,.09); border-radius: 4px; padding: 0 5px; font-family: monospace; font-size: 12px; }
.cv-pre { background: #161514; border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; margin: 6px 0; font-family: monospace; font-size: 11.5px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow: hidden; }

/* approvals */
.cv-appr { border-radius: 4px; padding: 10px 12px; margin: 8px 0; background: var(--panel); border: 1px solid var(--c); animation: cv-in .18s ease-out; }
.cv-appr-danger { border-color: var(--danger); }
.cv-appr-h { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.cv-badge { font-size: 10px; padding: 1px 8px; border-radius: 999px; background: var(--danger); color: #fff; font-weight: 700; }
.cv-diff-old, .cv-diff-new { padding: 4px 8px; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 90px; overflow: hidden; margin-top: 4px; border-radius: 4px; }
.cv-diff-old { background: rgba(229,83,75,.14); border-left: 3px solid var(--danger); }
.cv-diff-new { background: rgba(143,191,111,.13); border-left: 3px solid var(--ok); }

/* buttons / chips / pills */
.cv-chip { font-size: 12px !important; padding: 8px 12px !important; min-width: 0 !important; width: auto !important; }
.cv-mic { background: var(--c) !important; color: #1f1e1d !important; }
.cv-mic-rec { background: #fff !important; color: var(--c) !important; }
.cv-mic-busy { background: var(--panel2) !important; color: var(--text) !important; }
.cv-icon-btn { width: 48px !important; min-width: 48px !important; flex: none; padding: 0 !important; display: flex !important; align-items: center; justify-content: center; font-size: 17px; }
.cv-statusline { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px 0; color: var(--dim); font-size: 12px; animation: cv-in .18s ease-out; }
.cv-cap { font-size: 10px; color: var(--dim); margin: 2px 0 -2px 2px; letter-spacing: .3px; }
.cv-sidesettings { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--line); }
.cv-wave { display: flex; align-items: center; justify-content: center; gap: 3px; height: 20px; }
.cv-wave i { display: block; width: 4px; border-radius: 2px; background: var(--c); transition: height .1s; }
.cv-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cv-chips-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }

/* panel */
.cv-prev { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; font-size: 12.5px; line-height: 1.5; }
.cv-prevbox { padding: 8px 10px; border-left: 2px solid var(--c); background: var(--panel); border-radius: 4px; margin: 4px 0; }
.cv-prev-dim { color: var(--dim); font-size: 11.5px; margin-bottom: 3px; }
.cv-voicerow { display: flex; gap: 8px; }
/* panel hero */
.cv-hero { display: flex; align-items: center; gap: 12px; padding: 8px 4px 10px; }

/* fullscreen */
.cv-full { position: fixed; top: 40px; left: 0; right: 0; bottom: 0; overflow: hidden; z-index: 5; display: grid; grid-template-columns: 196px minmax(0, 1fr); font-size: 13px; background: var(--bg); }
.cv-side { display: flex; flex-direction: column; min-height: 0; padding: 10px 8px 46px 12px; background: #191817; border-right: 1px solid var(--line); }
.cv-brand { display: flex; align-items: center; gap: 8px; margin: 2px 0 10px 2px; font-size: 16px; font-weight: 700; letter-spacing: .2px; }
.cv-chatlist { flex: 1; min-height: 0; overflow-y: auto; margin: 8px 0; }
.cv-chatrow { display: block !important; width: 100% !important; min-width: 0 !important; text-align: left !important; padding: 7px 10px !important; margin: 3px 0 !important; background: transparent !important; font-size: 12.5px; }
.cv-chatrow.active { background: var(--panel) !important; }

.cv-chatrow-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-chatrow-s { font-size: 10px; color: var(--dim); }
.cv-main.cv-typing { padding-bottom: 46vh; }
.cv-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 8px 16px 46px 16px; }
.cv-head { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.cv-head-t { font-size: 14px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-scrollwrap { flex: 1; min-height: 0; position: relative; }
.cv-scrollwrap > div { height: 100%; }
.cv-scrollin { padding: 4px 8px 4px 0; }
.cv-scroll { flex: 1; min-height: 0; overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; padding: 4px 6px 4px 0; }
.cv-composer { display: flex; align-items: stretch; gap: 8px; padding-top: 8px; }
.cv-empty { text-align: center; padding: 22px 10px 8px; }
.cv-empty h2 { margin: 10px 0 2px; font-size: 20px; font-weight: 600; } .cv-empty p { color: var(--dim); margin: 0 0 14px; font-size: 12.5px; }
.cv-fmsg { border-radius: 4px; }
.cv-fmsg-focus { box-shadow: inset 3px 0 0 var(--c); background: rgba(255,255,255,.035); }
.cv-slim { width: 36px !important; min-width: 36px !important; height: 30px !important; font-size: 14px !important; }
.cv-scrollwrap, .cv-scrollwrap * { user-select: text !important; -webkit-user-select: text !important; }
.cv-scrollwrap ::selection { background: rgba(217,119,87,.45); }
.cv-main { position: relative; }
.cv-selbar { position: absolute; z-index: 12; top: 62px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 5px; background: var(--panel); border: 1px solid var(--c); border-radius: 4px; box-shadow: 0 6px 18px rgba(0,0,0,.5); animation: cv-in .15s ease-out; }
.cv-ctx { position: fixed; z-index: 30; display: flex; flex-direction: column; gap: 4px; padding: 5px; width: 220px; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; box-shadow: 0 8px 22px rgba(0,0,0,.55); }
.cv-sel-btn { min-width: 0 !important; width: auto !important; padding: 6px 12px !important; font-size: 12px !important; }
.cv-ctx .cv-sel-btn { width: 100% !important; text-align: left !important; }
.cv-sel-ask { background: var(--c) !important; color: #1f1e1d !important; }
.cv-chatrow-t { font-size: 13px; }
.cv-chatrow.gpfocus, .cv-chatrow:focus { background: #e9e6df !important; color: #1f1e1d !important; }
.cv-chatrow.gpfocus .cv-chatrow-s, .cv-chatrow:focus .cv-chatrow-s { color: #5a554d; }
.cv-sel-btn { white-space: nowrap !important; }
.cv-msgbtn { display: block !important; width: 100% !important; min-width: 0 !important; height: auto !important; padding: 0 !important; margin: 0 !important; text-align: left !important; background: transparent !important; border: none !important; box-shadow: none !important; color: var(--text) !important; font-size: inherit !important; line-height: inherit !important; font-weight: inherit !important; border-radius: 4px !important; }
.cv-msgbtn.gpfocus, .cv-msgbtn:focus { background: rgba(255,255,255,.045) !important; box-shadow: inset 3px 0 0 var(--c) !important; color: var(--text) !important; }
.cv-mic.gpfocus, .cv-mic:focus, .cv-root .gpfocus .cv-mic { filter: brightness(1.2); box-shadow: 0 0 0 3px #f4efe6 !important; }
.cv-mic-rec.gpfocus, .cv-mic-rec:focus { box-shadow: 0 0 0 3px var(--c) !important; }
.cv-icon-btn.gpfocus, .cv-icon-btn:focus { box-shadow: 0 0 0 3px #f4efe6 !important; }
@keyframes cv-rise { 0% { opacity: 0; transform: translateY(18px) scale(.88) } 60% { opacity: 1; transform: translateY(-3px) scale(1.03) } 100% { opacity: 1; transform: none } }
@keyframes cv-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(2px) } }
.cv-tobottom { position: absolute !important; right: 22px; bottom: 112px; z-index: 9; width: auto !important; min-width: 0 !important; padding: 6px 14px !important; border-radius: 999px !important; display: flex !important; align-items: center; gap: 8px; font-size: 12px !important;
  background: var(--c) !important; color: #1f1e1d !important; box-shadow: 0 6px 18px rgba(0,0,0,.5); animation: cv-rise .32s cubic-bezier(.2,.9,.3,1.2); }
.cv-tobottom svg { animation: cv-bob 1.2s ease-in-out infinite; }
.cv-tobottom.gpfocus, .cv-tobottom:focus { box-shadow: 0 0 0 3px #f4efe6, 0 6px 18px rgba(0,0,0,.5) !important; }
.cv-main.cv-typing .cv-tobottom { bottom: calc(46vh + 70px); }
.cv-ctxrow { display: flex; align-items: center; gap: 6px; padding-top: 6px; animation: cv-in .18s ease-out; }
.cv-ctxchip { flex: 1; min-width: 0 !important; display: flex !important; align-items: center; gap: 10px; text-align: left !important; padding: 5px 10px !important; font-size: 12px !important; background: var(--panel) !important; border-left: 3px solid var(--c) !important; border-radius: 4px !important; }
.cv-ctx-k { font-weight: 700; color: var(--c); flex: none; }
.cv-ctx-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dim); }
.cv-quote { font-size: 11px; color: var(--dim); border-left: 2px solid var(--c); padding-left: 7px; margin-bottom: 4px; }
.cv-scrollin { max-width: 760px; margin: 0 auto; padding: 4px 10px 4px 10px !important; }
.cv-msgbtn { padding: 2px 16px 2px 16px !important; margin: 2px 0 !important; }
.cv-msgbtn.gpfocus, .cv-msgbtn:focus { box-shadow: inset 3px 0 0 var(--c) !important; border-radius: 6px !important; }
.cv-scrollwrap .cv-ai-b, .cv-scrollwrap .cv-user-b { max-width: 100%; }
.cv-scrollwrap .cv-user-b { max-width: 78%; }
.cv-tool, .cv-think { margin-left: 48px; margin-right: 16px; }
`;
