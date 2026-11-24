import { vi } from "vitest";

/** Fake Decky backend: tests register handlers per python method name and read the recorded calls. */
export const backend = {
  handlers: {} as Record<string, (...args: any[]) => any>,
  calls: [] as { name: string; args: any[] }[],
  reset() {
    this.handlers = {};
    this.calls = [];
  },
  on(name: string, fn: (...args: any[]) => any) {
    this.handlers[name] = fn;
  },
  called(name: string) {
    return this.calls.filter((c) => c.name === name).map((c) => c.args);
  },
};

export function callable<_A extends any[], R>(name: string) {
  return async (...args: any[]): Promise<R> => {
    backend.calls.push({ name, args });
    const h = backend.handlers[name];
    if (!h) return undefined as any;
    return h(...args);
  };
}

export const definePlugin = (fn: any) => fn;
export const routerHook = { addRoute: vi.fn(), removeRoute: vi.fn() };
