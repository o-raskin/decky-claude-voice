import { act, render } from "@testing-library/react";
import { backend } from "./mocks/decky-api";
import { makeState } from "./fixtures";
import type { State } from "../../src/api";

/** Renders an element with the backend answering get_state with `state`, and waits for the first load. */
export async function mount(el: any, state: Partial<State> | null = {}, extra: Record<string, (...a: any[]) => any> = {}) {
  let current = makeState(state ?? {});
  backend.on("get_state", () => current);
  for (const [k, v] of Object.entries(extra)) backend.on(k, v);
  const r = render(el);
  await settle();
  return {
    ...r,
    setState: async (next: Partial<State>) => {
      current = makeState(next);
      await act(async () => {
        const { pokeState } = await import("../../src/api");
        pokeState();
        await Promise.resolve();
      });
    },
  };
}

export const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

export const q = (root: ParentNode, sel: string) => root.querySelector(sel) as HTMLElement;
export const qa = (root: ParentNode, sel: string) => Array.from(root.querySelectorAll(sel)) as HTMLElement[];
export const byText = (root: ParentNode, sel: string, text: string) => qa(root, sel).find((e) => e.textContent?.includes(text)) as HTMLElement;
