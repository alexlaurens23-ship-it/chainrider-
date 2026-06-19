import { mountMusicControls } from "./audio/controls";
import { mountWalletButton } from "./auth";
import { startRouter } from "./router";

const app = document.getElementById("app");
if (!app) throw new Error("missing #app root");
mountWalletButton();
mountMusicControls(); // procedural synthwave soundtrack (starts on first gesture; mute persisted)
startRouter(app);
