import { mountWalletButton } from "./auth";
import { mountBikeTunePanel } from "./dev/bikeTunePanel";
import { startRouter } from "./router";

const app = document.getElementById("app");
if (!app) throw new Error("missing #app root");
mountWalletButton();
mountBikeTunePanel(); // DEV-ONLY: hidden bike-sprite tuner (toggle B / ?biketune=1). Remove before launch.
startRouter(app);
