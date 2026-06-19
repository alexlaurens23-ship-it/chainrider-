import { initMusic, isMuted, skipTrack, toggleMuted } from "./music";

/**
 * Fixed-corner music controls: a mute speaker toggle (persisted) + a skip-to-
 * next-track button. Mounted once at startup; also installs the first-gesture
 * audio unlock + route-aware track switching via initMusic().
 */
export function mountMusicControls(): void {
  if (document.getElementById("music-controls")) return;

  const bar = document.createElement("div");
  bar.id = "music-controls";
  bar.style.cssText = [
    "position:fixed",
    "left:10px",
    "bottom:10px",
    "z-index:9000",
    "display:flex",
    "gap:6px",
  ].join(";");

  const mkBtn = (label: string, title: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.style.cssText = [
      "width:34px",
      "height:34px",
      "border-radius:8px",
      "border:1px solid #2a3a4a",
      "background:rgba(5,8,14,0.8)",
      "color:#9fe",
      "font-size:16px",
      "cursor:pointer",
      "line-height:1",
    ].join(";");
    return b;
  };

  const muteBtn = mkBtn("", "Mute / unmute music");
  const skipBtn = mkBtn("⏭", "Next track");
  bar.appendChild(muteBtn);
  bar.appendChild(skipBtn);
  document.body.appendChild(bar);

  const render = (): void => {
    muteBtn.textContent = isMuted() ? "🔇" : "🔊";
    skipBtn.style.opacity = isMuted() ? "0.4" : "1";
  };
  muteBtn.addEventListener("click", () => {
    toggleMuted();
    render();
  });
  skipBtn.addEventListener("click", () => skipTrack());

  initMusic(render);
  render();
}
