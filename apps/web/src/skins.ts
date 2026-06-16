/**
 * Bike skins — pure palette config, no asset files. The renderer reads only
 * primary/secondary/trail hex from the active skin, so a skin is a hex swap.
 * `unlock` is wired for future token-holder skins; all ship 'default' at launch.
 */

export interface Skin {
  id: string;
  name: string;
  /** Main neon (swatch + trail tint fallback). */
  primary: string;
  /** Accent. */
  secondary: string;
  /** Rear light-trail ribbon. */
  trail: string;
  /** The 3 bike pieces (served from public/). All point at the green set for now;
   *  add per-skin coloured PNGs later by swapping these paths. */
  sprites: BikeSprites;
  unlock: "default" | "later";
}

export interface BikeSprites {
  /** Frame + rider, wheels erased (transparent). */
  frame: string;
  /** Front wheel only, centred on its hub, square canvas. */
  wheelFront: string;
  /** Rear wheel only, centred on its hub, square canvas. */
  wheelRear: string;
}

// One green 3-piece set for launch; the per-skin mapping is wired so coloured
// PNG sets can be dropped in later without touching the renderer.
const GREEN: BikeSprites = {
  frame: "/bike-frame.png",
  wheelFront: "/bike-wheel-front.png",
  wheelRear: "/bike-wheel-rear.png",
};

export const SKINS: Skin[] = [
  { id: "mint", name: "MINT", primary: "#5ad8a6", secondary: "#b9ffe4", trail: "#5ad8a6", sprites: GREEN, unlock: "default" },
  { id: "volt", name: "VOLT", primary: "#46c8f0", secondary: "#cdeeff", trail: "#46c8f0", sprites: GREEN, unlock: "default" },
  { id: "ember", name: "EMBER", primary: "#ff7a45", secondary: "#ffd2b0", trail: "#ff7a45", sprites: GREEN, unlock: "default" },
  { id: "magma", name: "MAGMA", primary: "#e23bff", secondary: "#f6c2ff", trail: "#e23bff", sprites: GREEN, unlock: "default" },
];

const STORAGE_KEY = "cr_skin";

/** Skins the player may select (token-gated ones are filtered until unlocked). */
export function availableSkins(): Skin[] {
  return SKINS.filter((s) => s.unlock === "default");
}

export function getActiveSkin(): Skin {
  let id: string | null = null;
  try {
    id = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* private mode / no storage — fall through to default */
  }
  const found = id ? SKINS.find((s) => s.id === id && s.unlock === "default") : undefined;
  return found ?? SKINS[0];
}

export function setActiveSkin(id: string): void {
  const skin = SKINS.find((s) => s.id === id && s.unlock === "default");
  if (!skin) return;
  try {
    localStorage.setItem(STORAGE_KEY, skin.id);
  } catch {
    /* ignore */
  }
}

/**
 * A row of color swatches that sets the active skin and persists it. Reused on
 * the run-complete card and map detail. `onChange` fires with the new skin id.
 */
export function createSkinPicker(onChange?: (id: string) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "skin-picker";
  const active = getActiveSkin().id;
  for (const skin of availableSkins()) {
    const btn = document.createElement("button");
    btn.className = `skin-swatch${skin.id === active ? " active" : ""}`;
    btn.type = "button";
    btn.title = skin.name;
    btn.setAttribute("aria-label", `${skin.name} skin`);
    btn.dataset.skin = skin.id;
    btn.style.background = skin.primary;
    btn.style.boxShadow = `0 0 8px ${skin.primary}`;
    btn.addEventListener("click", () => {
      setActiveSkin(skin.id);
      for (const el of wrap.querySelectorAll(".skin-swatch")) el.classList.remove("active");
      btn.classList.add("active");
      onChange?.(skin.id);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

/** True when the user asked for reduced motion — disable shake + slow-mo. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
