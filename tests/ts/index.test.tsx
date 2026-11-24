import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import plugin from "../../src/index";
import { routerHook } from "./mocks/decky-api";
import { backend } from "./mocks/decky-api";
import { makeState } from "./fixtures";
import { mount } from "./helpers";

describe("plugin definition", () => {
  it("registers the full-screen route and exposes panel, title and icon", () => {
    (routerHook.addRoute as any).mockClear();
    const def = (plugin as any)();
    expect(routerHook.addRoute).toHaveBeenCalledTimes(1);
    const [path, component, opts] = (routerHook.addRoute as any).mock.calls[0];
    expect(path).toBe("/claude-voice");
    expect(opts).toEqual({ exact: true });
    expect(def.name).toBe("Claude Voice");
    expect(render(def.titleView).container.textContent).toBe("Claude Voice");
    expect(def.icon).toBeTruthy();
    expect(def.content).toBeTruthy();
    expect(typeof component).toBe("function");
  });

  it("the route and the panel render", async () => {
    backend.on("get_state", () => makeState());
    const def = (plugin as any)();
    const route = (routerHook.addRoute as any).mock.calls.at(-1)[1];
    expect(render(route()).container.querySelector(".cv-side")).toBeNull(); // still loading: no state yet
    expect((await mount(route())).container.querySelector(".cv-side")).toBeTruthy();
    expect((await mount(def.content)).container.querySelector(".cv-hero")).toBeTruthy();
  });

  it("removes the route on dismount", () => {
    const def = (plugin as any)();
    def.onDismount();
    expect(routerHook.removeRoute).toHaveBeenCalledWith("/claude-voice");
  });
});
