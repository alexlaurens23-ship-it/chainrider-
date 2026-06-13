import { startRouter } from "./router";

const app = document.getElementById("app");
if (!app) throw new Error("missing #app root");
startRouter(app);
