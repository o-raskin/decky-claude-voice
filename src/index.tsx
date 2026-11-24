import { definePlugin, routerHook } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { FaMicrophone } from "react-icons/fa";
import { Fullscreen } from "./Fullscreen";
import { Panel } from "./Panel";

export default definePlugin(() => {
  routerHook.addRoute("/claude-voice", () => <Fullscreen />, { exact: true });
  return {
    name: "Claude Voice",
    titleView: <div className={staticClasses.Title}>Claude Voice</div>,
    content: <Panel />,
    icon: <FaMicrophone />,
    onDismount() {
      routerHook.removeRoute("/claude-voice");
    },
  };
});
