import type { Screen } from "../router";
import { startPlayground, type PlaygroundHandle } from "../playground/loop";

/** The tuning playground, mounted under the router at #/playground. */
export function createPlaygroundScreen(): Screen {
  let handle: PlaygroundHandle | null = null;
  return {
    mount(root) {
      handle = startPlayground(root);
    },
    unmount() {
      handle?.unmount();
      handle = null;
    },
  };
}
