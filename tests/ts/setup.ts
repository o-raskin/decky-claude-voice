import * as React from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { backend } from "./mocks/decky-api";
import { Navigation, Router, showContextMenu } from "./mocks/decky-ui";

(window as any).SP_REACT = React;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom gaps used by the plugin
Element.prototype.scrollTo = function (this: any, opts: any) {
  if (opts && typeof opts === "object" && typeof opts.top === "number") this.scrollTop = opts.top;
} as any;
(document as any).execCommand = vi.fn(() => true);

beforeEach(() => {
  backend.reset();
  showContextMenu.mockReset();
  Navigation.CloseSideMenus.mockReset();
  Navigation.Navigate.mockReset();
  Router.MainRunningApp = null;
});

afterEach(() => {
  cleanup();
  delete (window as any).SteamClient;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
