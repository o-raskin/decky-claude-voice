import { callable } from "@decky/api";
import { Router } from "@decky/ui";
import { useEffect, useState } from "react";

export type Phase = "idle" | "recording" | "transcribing" | "thinking";
export type Ev = { kind: "user" | "assistant" | "thinking" | "tool" | "error"; text: string; t: number; quote?: string };
export type Preview = { kind: string; text?: string; path?: string; old?: string; new?: string };
export type Pending = { id: string; tool: string; detail: string; risk: "normal" | "danger"; preview: Preview };
export type ChatInfo = { id: string; title: string; updated: number; count: number; active: boolean };
export type Prefs = { approval: "manual" | "auto"; model: string; effort: string };
export type GameCtx = { name: string; appid: number } | null;
export type State = {
  phase: Phase;
  events: Ev[];
  live: { text: string; thinking: string };
  pending: Pending[];
  error: string;
  rec_seconds: number;
  rec_level: number;
  models: { available: string[]; current: string };
  panel_target: string;
  model_ready: boolean;
  prefs: Prefs;
  chat: { id: string; title: string; count: number; has_session: boolean; last: { secs: number; model: string } | null };
  chats: ChatInfo[];
};

export const getState = callable<[], State>("get_state");
export const toggleRecording = callable<[string, GameCtx, string], string>("toggle_recording");
export const startRecording = callable<[string], boolean>("start_recording");
export const stopRecording = callable<[GameCtx, string], boolean>("stop_recording");
export const sendText = callable<[string, GameCtx, string, string], boolean>("send_text");
export const respond = callable<[string, boolean, boolean], boolean>("respond");
export const cancel = callable<[], boolean>("cancel");
export const newChat = callable<[], boolean>("new_chat");
export const switchChat = callable<[string], boolean>("switch_chat");
export const deleteChat = callable<[string], boolean>("delete_chat");
export const setPref = callable<[string, string], boolean>("set_pref");

export const setPanelTarget = callable<[string], boolean>("set_panel_target");
export const refreshModels = callable<[], { available: string[]; current: string }>("refresh_models");

// model names come from Claude itself (`/model`), shown exactly as it lists them
export function modelOptions(s: State) {
  const names = [...s.models.available];
  if (s.prefs.model && !names.includes(s.prefs.model)) names.push(s.prefs.model);
  return names.map((n) => ({ data: n, label: n === "default" && s.models.current ? `default · ${s.models.current}` : n }));
}
export const EFFORT_OPTIONS = [
  { data: "default", label: "Auto" },
  { data: "low", label: "Low (fast)" },
  { data: "medium", label: "Medium" },
  { data: "high", label: "High" },
  { data: "xhigh", label: "XHigh" },
  { data: "max", label: "Max (deep)" },
];

export const MODE_OPTIONS = [
  { data: "manual", label: "Ask me" },
  { data: "auto", label: "Auto-approve" },
];
export const labelOf = (list: { data: string; label: string }[], v: string) => list.find((o) => o.data === v)?.label ?? v;

export type QuickAction = { label: string; prompt: string };
export function quickActionsFor(game: GameCtx): QuickAction[] {
  if (game) {
    const g = game.name || "the running game";
    return [
      { label: "Optimize game", prompt: `"${g}" is running. Check this game's configs and launch options on the Deck and suggest how to improve performance and image quality.` },
      { label: "FPS and load", prompt: `Show CPU and GPU load, temperatures, memory and clocks while "${g}" is running. Short, with a conclusion.` },
      { label: "Game crashes", prompt: `"${g}" crashes or stutters. Check the logs of the last launch and find the likely cause.` },
      { label: "Battery", prompt: "How is the battery: charge, time left, what drains it the most?" },
    ];
  }
  return [
    { label: "Battery", prompt: "How is the battery: charge, time left, what drains it the most?" },
    { label: "Load and heat", prompt: "Show CPU and GPU load, temperatures and memory. Short, with a conclusion." },
    { label: "Disk space", prompt: "Show what takes disk space and shader cache, and suggest a safe cleanup. Delete nothing without my confirmation." },
    { label: "Network", prompt: "Check Wi-Fi and internet: signal, speed, DNS. Find problems if any." },
  ];
}

let poke: (() => void) | null = null;
export const pokeState = () => poke?.(); // refresh the UI state right now (after an action)

export function useClaudeState(): State | null {
  const [s, setS] = useState<State | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: any;
    const tick = async () => {
      let next = 1500;
      try {
        const st = await getState();
        if (!alive) return;
        setS(st);
        next = st.phase === "idle" && st.pending.length === 0 ? 1200 : 350;
      } catch {
        /* backend busy, retry */
      }
      if (alive) timer = setTimeout(tick, next);
    };
    poke = () => {
      clearTimeout(timer);
      tick();
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      poke = null;
    };
  }, []);
  return s;
}

export function useGame(): GameCtx {
  const [g, setG] = useState<GameCtx>(null);
  useEffect(() => {
    const read = () => {
      const a: any = (Router as any).MainRunningApp;
      const next: GameCtx = a?.appid ? { name: String(a.display_name || ""), appid: Number(a.appid) } : null;
      setG((prev) => (prev?.appid === next?.appid && prev?.name === next?.name ? prev : next));
    };
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, []);
  return g;
}

export function phaseLabel(phase: Phase, secs: number): string {
  switch (phase) {
    case "recording":
      return `Listening… ${secs}s`;
    case "transcribing":
      return "Transcribing…";
    case "thinking":
      return "Thinking…";
    default:
      return "Ready";
  }
}

export function timeOf(t: number): string {
  const d = new Date(t * 1000);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ago(t: number): string {
  const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}
