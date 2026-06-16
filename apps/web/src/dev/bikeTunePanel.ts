import { BIKE_TUNE, type BikeSpriteTune } from "../shared/bike";

/**
 * TEMPORARY dev-only bike-sprite tuning panel (P5.6 — REMOVE BEFORE LAUNCH).
 * Hidden by default; toggle with the `B` key or show on load with `?biketune=1`.
 * Sliders mutate the live BIKE_TUNE object, which drawBike reads every frame, so
 * the 3-piece sprite re-fits instantly while riding. COPY VALUES yields the
 * object body to paste back into BIKE_TUNE (shared/bike.ts). No physics/logic
 * change — it only exposes the existing render constants.
 */

interface SliderSpec {
  key: keyof BikeSpriteTune;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: SliderSpec[] = [
  { key: "FRAME_WIDTH_M", min: 2, max: 10, step: 0.05 },
  { key: "FRAME_OFFSET_X", min: -2, max: 2, step: 0.01 },
  { key: "FRAME_OFFSET_Y", min: -2, max: 2, step: 0.01 },
  { key: "SPRITE_ROTATION_OFFSET", min: -0.5, max: 0.5, step: 0.005 },
  { key: "FRONT_WHEEL_DIAMETER_M", min: 0.3, max: 2, step: 0.01 },
  { key: "REAR_WHEEL_DIAMETER_M", min: 0.3, max: 2, step: 0.01 },
  { key: "FRONT_WHEEL_OFFSET_X", min: -1, max: 1, step: 0.01 },
  { key: "FRONT_WHEEL_OFFSET_Y", min: -1, max: 1, step: 0.01 },
  { key: "REAR_WHEEL_OFFSET_X", min: -1, max: 1, step: 0.01 },
  { key: "REAR_WHEEL_OFFSET_Y", min: -1, max: 1, step: 0.01 },
];

const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();

function valuesText(): string {
  const lines = SLIDERS.map((s) => `  ${s.key}: ${fmt(BIKE_TUNE[s.key])},`);
  return `// paste into BIKE_TUNE (apps/web/src/shared/bike.ts)\n{\n${lines.join("\n")}\n}`;
}

/**
 * Install the panel (hidden) + the `B` toggle. Call once at startup. Inert until
 * toggled, so it ships dark; remove the call before launch.
 */
export function mountBikeTunePanel(): void {
  if (document.getElementById("bike-tune-panel")) return;

  const panel = document.createElement("div");
  panel.id = "bike-tune-panel";
  panel.style.cssText = [
    "position:fixed",
    "top:8px",
    "right:8px",
    "z-index:9999",
    "width:300px",
    "max-height:90vh",
    "overflow:auto",
    "background:rgba(5,8,14,0.92)",
    "border:1px solid #2a3a4a",
    "border-radius:8px",
    "padding:10px 12px",
    "font:11px/1.4 monospace",
    "color:#cfe",
    "display:none",
  ].join(";");

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
    <b style="color:#5ad8a6">BIKE TUNE</b>
    <span style="color:#6a8">[B] to toggle · dev-only</span>
  </div>`;
  for (const s of SLIDERS) {
    const v = BIKE_TUNE[s.key];
    html += `<div style="margin:6px 0">
      <div style="display:flex;justify-content:space-between">
        <span>${s.key}</span><span id="bt-val-${s.key}">${fmt(v)}</span>
      </div>
      <input type="range" id="bt-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" style="width:100%">
    </div>`;
  }
  html += `<button id="bt-copy" style="width:100%;margin:8px 0 6px;padding:6px;background:#5ad8a6;color:#04110b;border:0;border-radius:5px;font:700 11px monospace;cursor:pointer">COPY VALUES</button>
    <textarea id="bt-out" readonly style="width:100%;height:150px;background:#02060a;color:#9fb;border:1px solid #243;border-radius:5px;font:10px/1.3 monospace"></textarea>`;
  panel.innerHTML = html;
  document.body.appendChild(panel);

  const out = panel.querySelector<HTMLTextAreaElement>("#bt-out")!;
  const refreshOut = (): void => {
    out.value = valuesText();
  };
  refreshOut();

  for (const s of SLIDERS) {
    const input = panel.querySelector<HTMLInputElement>(`#bt-${s.key}`)!;
    const val = panel.querySelector<HTMLSpanElement>(`#bt-val-${s.key}`)!;
    input.addEventListener("input", () => {
      const n = Number(input.value);
      BIKE_TUNE[s.key] = n; // live — drawBike picks it up next frame
      val.textContent = fmt(n);
      refreshOut();
    });
  }

  const copyBtn = panel.querySelector<HTMLButtonElement>("#bt-copy")!;
  copyBtn.addEventListener("click", () => {
    out.select();
    void navigator.clipboard?.writeText(valuesText()).catch(() => {
      /* clipboard may be blocked — the textarea is selected for manual copy */
    });
    const prev = copyBtn.textContent;
    copyBtn.textContent = "copied! ✓";
    window.setTimeout(() => (copyBtn.textContent = prev), 1000);
  });

  const setVisible = (show: boolean): void => {
    panel.style.display = show ? "block" : "none";
  };
  if (new URLSearchParams(location.search).get("biketune") === "1") setVisible(true);

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "b") return;
    const el = document.activeElement;
    // Don't hijack `b` while typing in a field (login, tx sig, etc.).
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    setVisible(panel.style.display === "none");
  });
}
