import { DEFAULT_TUNE } from "@chainrider/physics";
import type { BikeTune } from "@chainrider/physics";

type Range = [min: number, max: number, step: number];

/** Slider range per tune key. Every BikeTune key must appear here (type-checked). */
const RANGES: Record<keyof BikeTune, Range> = {
  chassisWidth: [0.8, 2.4, 0.05],
  chassisHeight: [0.2, 0.8, 0.05],
  chassisDensity: [0.2, 20, 0.1],
  chassisFriction: [0, 1, 0.05],
  wheelRadius: [0.2, 0.6, 0.01],
  wheelDensity: [0.1, 5, 0.1],
  wheelFriction: [0, 3, 0.05],
  wheelbase: [1, 2.2, 0.05],
  axleDropY: [0, 0.8, 0.05],
  suspensionHz: [1, 15, 0.5],
  suspensionDamping: [0.05, 1, 0.05],
  maxOmega: [10, 100, 1],
  maxMotorTorque: [0, 150, 1],
  rearBrakeTorque: [0, 150, 1],
  frontBrakeTorque: [0, 50, 1],
  attitudeTorque: [0, 4000, 10],
  attitudeDecay: [0, 0.95, 0.01],
  attitudeMin: [0, 10, 0.5],
  chassisSpinCap: [1, 20, 0.5],
  wheelieRecoveryBoost: [1, 4, 0.1],
  stabilizerStrength: [0, 300, 5],
  stabilizerDamping: [0, 50, 0.5],
  torqueFalloffFloor: [0, 1, 0.05],
  hillAssist: [0, 1, 0.05],
  antiWheelieFloor: [0, 1, 0.05],
  jumpImpulse: [0, 50, 0.5],
  headRadius: [0.08, 0.3, 0.01],
  headOffsetX: [-0.5, 0.5, 0.05],
  headOffsetY: [0.2, 1, 0.05],
  landingToleranceDeg: [5, 80, 1],
  hardLandingImpulse: [1, 200, 1],
  groundFriction: [0, 1.5, 0.05],
  launchSpeedThreshold: [0, 20, 0.5],
  launchBoost: [1, 3, 0.05],
};

const REBUILD_DEBOUNCE_MS = 150;

/** Hand-rolled tune panel: one slider per BikeTune key, live sim rebuild on change. */
export function createPanel(root: HTMLElement, onChange: (tune: BikeTune) => void): void {
  const tune: BikeTune = { ...DEFAULT_TUNE };
  const panel = document.createElement("div");
  panel.className = "panel";

  const title = document.createElement("div");
  title.className = "panel-title";
  title.textContent = "BIKE TUNE";
  panel.appendChild(title);

  let debounce = 0;
  const fireChange = (): void => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => onChange({ ...tune }), REBUILD_DEBOUNCE_MS);
  };

  const sliders: Partial<Record<keyof BikeTune, [HTMLInputElement, HTMLSpanElement]>> = {};
  for (const key of Object.keys(RANGES) as (keyof BikeTune)[]) {
    const [min, max, step] = RANGES[key];
    const row = document.createElement("label");
    row.className = "panel-row";

    const name = document.createElement("span");
    name.className = "panel-name";
    name.textContent = key;

    const value = document.createElement("span");
    value.className = "panel-value";
    value.textContent = String(tune[key]);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(tune[key]);
    slider.addEventListener("input", () => {
      tune[key] = Number(slider.value);
      value.textContent = slider.value;
      fireChange();
    });

    sliders[key] = [slider, value];
    row.append(name, slider, value);
    panel.appendChild(row);
  }

  const reset = document.createElement("button");
  reset.textContent = "Reset tune to defaults";
  reset.addEventListener("click", () => {
    for (const key of Object.keys(RANGES) as (keyof BikeTune)[]) {
      tune[key] = DEFAULT_TUNE[key];
      const entry = sliders[key];
      if (entry) {
        entry[0].value = String(tune[key]);
        entry[1].textContent = String(tune[key]);
      }
    }
    fireChange();
  });
  panel.appendChild(reset);

  root.appendChild(panel);
}
