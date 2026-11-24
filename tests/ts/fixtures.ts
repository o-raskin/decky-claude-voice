import type { State } from "../../src/api";

export const makeState = (over: Partial<State> = {}): State => ({
  phase: "idle",
  events: [],
  live: { text: "", thinking: "" },
  pending: [],
  error: "",
  rec_seconds: 0,
  rec_level: 0,
  models: { available: ["default", "sonnet", "opus"], current: "sonnet" },
  panel_target: "new",
  model_ready: true,
  prefs: { approval: "manual", model: "default", effort: "default" },
  chat: { id: "c1", title: "Chat one", count: 0, has_session: false, last: null },
  chats: [{ id: "c1", title: "Chat one", updated: Date.now() / 1000, count: 0, active: true }],
  ...over,
});

export const ev = (kind: any, text: string, t = 1000, quote?: string) => ({ kind, text, t, ...(quote ? { quote } : {}) });
