import { GameCtx, State, pokeState, sendText, toggleRecording } from "./api";

export async function micToggle(_s: State, game: GameCtx, target = "current", quote = ""): Promise<string> {
  const r = await toggleRecording(target, game, quote);
  pokeState();
  setTimeout(pokeState, 400);
  return r;
}

export function ask(prompt: string, game: GameCtx, target = "current") {
  const r = sendText(prompt, game, target, "");
  setTimeout(pokeState, 150);
  return r;
}
