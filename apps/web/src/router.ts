import { createHomeScreen } from "./screens/home";
import { createMapDetailScreen } from "./screens/mapDetail";
import { createPlaygroundScreen } from "./screens/playground";
import { createRideScreen } from "./screens/ride";

/** A screen owns all DOM it creates inside `root` and tears it down on unmount. */
export interface Screen {
  mount(root: HTMLElement, params: Record<string, string>): void;
  unmount(): void;
}

interface Route {
  /** Path segments; ":name" captures a param. */
  pattern: string[];
  factory: () => Screen;
  /** Game screens lock body scroll (fullscreen canvas); pages scroll. */
  scroll: boolean;
}

const ROUTES: Route[] = [
  { pattern: [], factory: createHomeScreen, scroll: true },
  { pattern: ["map", ":slug", ":period"], factory: createMapDetailScreen, scroll: true },
  { pattern: ["ride", ":trackId"], factory: createRideScreen, scroll: false },
  { pattern: ["playground"], factory: createPlaygroundScreen, scroll: false },
];

function parseHash(): string[] {
  const raw = location.hash.replace(/^#\/?/, "");
  if (raw === "") return [];
  return raw.split("/").filter((s) => s.length > 0);
}

function match(segments: string[]): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < route.pattern.length; i++) {
      const p = route.pattern[i];
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segments[i]);
      else if (p !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function startRouter(root: HTMLElement): void {
  let current: Screen | null = null;

  function navigate(): void {
    const matched = match(parseHash());
    if (!matched) {
      location.hash = "#/";
      return; // hashchange re-fires
    }
    if (current) current.unmount();
    root.replaceChildren();
    document.body.classList.toggle("no-scroll", !matched.route.scroll);
    current = matched.route.factory();
    current.mount(root, matched.params);
  }

  window.addEventListener("hashchange", navigate);
  navigate();
}
