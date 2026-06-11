import { SIM_DT } from "@chainrider/physics";
import { getHealth } from "./net";

const GRID_SPACING_PX = 48;

const canvasEl = document.querySelector<HTMLCanvasElement>("#game");
if (!canvasEl) throw new Error("missing #game canvas");
const renderCtx = canvasEl.getContext("2d");
if (!renderCtx) throw new Error("Canvas2D not supported");
const canvas: HTMLCanvasElement = canvasEl;
const ctx: CanvasRenderingContext2D = renderCtx;

let apiStatus = "api: checking…";

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(0, 229, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += GRID_SPACING_PX) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = 0; y <= h; y += GRID_SPACING_PX) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(224, 255, 255, 0.85)";
  ctx.font = "14px monospace";
  ctx.fillText(`CHAINRIDER — fixed timestep ${SIM_DT.toFixed(5)}s`, 16, 28);
  ctx.fillText(apiStatus, 16, 48);
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  draw();
}

window.addEventListener("resize", resize);
resize();

getHealth()
  .then((health) => {
    apiStatus = `api: ${health.status}`;
    draw();
  })
  .catch(() => {
    apiStatus = "api: offline";
    draw();
  });
