import * as Tone from "tone";

/**
 * Procedural synthwave / retrowave soundtrack — everything synthesised in-code
 * via Tone.js, NO audio files. Four generative ~2-minute arrangements:
 *   track 0  — mellow hypnotic menu/lobby (pad + soft arp, no four-floor kick)
 *   track 1  — euphoric ride
 *   track 2  — dark / aggressive ride
 *   track 3  — fast / relentless ride
 * Minor keys, analog saw/square synths, side-chain-pumped bass+pad, 16th arps,
 * four-on-the-floor kick, gated-ish snare, lush pads.
 *
 * Autoplay-safe: nothing starts until the first user gesture; stays silent if the
 * persisted mute pref is set. Master volume ~0.35.
 */

const MASTER_GAIN = 0.35;
const TRACK_MS = 120_000; // ~2 min per arrangement, then auto-advance
const MUTE_KEY = "cr_muted";

// Natural-minor scale (semitones) for leads; minor triad progression for harmony.
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
// i – VI – III – VII (classic synthwave), as semitone triads above the root.
const PROGRESSION = [
  [0, 3, 7],
  [8, 12, 15],
  [3, 7, 10],
  [10, 14, 17],
];

type Mode = "menu" | "ride";

interface TrackConfig {
  bpm: number;
  /** Root MIDI note of the key. */
  root: number;
  drums: boolean;
  kickFour: boolean;
  arpRate: Tone.Unit.Time;
  lead: boolean;
  leadOsc: "sawtooth" | "square";
  /** 0..1 — brightness / drive. */
  intensity: number;
}

const TRACKS: TrackConfig[] = [
  // 0 — menu: mellow, hypnotic
  { bpm: 86, root: 45, drums: false, kickFour: false, arpRate: "8n", lead: false, leadOsc: "sawtooth", intensity: 0.35 },
  // 1 — euphoric
  { bpm: 112, root: 45, drums: true, kickFour: true, arpRate: "16n", lead: true, leadOsc: "sawtooth", intensity: 0.7 },
  // 2 — dark / aggressive
  { bpm: 100, root: 40, drums: true, kickFour: true, arpRate: "16n", lead: true, leadOsc: "square", intensity: 0.85 },
  // 3 — fast / relentless
  { bpm: 126, root: 47, drums: true, kickFour: true, arpRate: "16n", lead: true, leadOsc: "square", intensity: 0.8 },
];

const RIDE_POOL = [1, 2, 3];
const MENU_POOL = [0];

const midiToNote = (m: number): string => Tone.Frequency(m, "midi").toNote();

interface TrackHandle {
  dispose(): void;
}

/** One generative arrangement wired to the shared master bus. */
function buildTrack(cfg: TrackConfig, master: Tone.Gain): TrackHandle {
  const transport = Tone.getTransport();
  transport.bpm.value = cfg.bpm;

  const nodes: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(n: T): T => {
    nodes.push(n);
    return n;
  };

  // FX
  const reverb = keep(new Tone.Reverb({ decay: 4, wet: 0.3 })).connect(master);
  const delay = keep(new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.32, wet: 0.22 })).connect(master);

  // Side-chain pump: an LFO ducks the bass+pad bus on every quarter (the kick).
  const pump = keep(new Tone.Gain(1)).connect(master);
  const pumpLfo = keep(new Tone.LFO({ frequency: "4n", min: 0.45, max: 1, type: "sawtooth" }));
  pumpLfo.connect(pump.gain);
  pumpLfo.start();

  // Pad (lush, through pump + reverb)
  const pad = keep(
    new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
      envelope: { attack: 1.2, decay: 0.4, sustain: 0.8, release: 3 },
    }),
  );
  pad.volume.value = -16;
  pad.connect(pump);
  pad.connect(reverb);

  // Bass (through pump)
  const bass = keep(
    new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 2 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2.6 },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.2 },
    }),
  );
  bass.volume.value = -10;
  bass.connect(pump);

  // Arp (saw/square, delay-soaked)
  const arp = keep(
    new Tone.Synth({
      oscillator: { type: cfg.leadOsc },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.1, release: 0.15 },
    }),
  );
  arp.volume.value = cfg.drums ? -14 : -18;
  arp.connect(delay);
  arp.connect(master);

  // Lead (optional melodic phrases)
  const lead = keep(
    new Tone.Synth({
      oscillator: { type: cfg.leadOsc === "square" ? "square" : "sawtooth" },
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.4 },
    }),
  );
  lead.volume.value = -13;
  lead.connect(delay);
  lead.connect(reverb);

  // Drums
  const kick = keep(new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.05 })).connect(master);
  kick.volume.value = -6;
  const snare = keep(
    new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }),
  );
  snare.volume.value = -16;
  snare.connect(reverb); // gated-ish snare via the shared reverb
  snare.connect(master);
  const hat = keep(
    new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }),
  );
  hat.volume.value = -26;
  hat.connect(master);

  // ── Generative state ──────────────────────────────────────────────────
  let chordIdx = 0;
  let currentChord = PROGRESSION[0];
  let arpStep = 0;
  let beat = 0;
  const rand = (a: number, b: number): number => a + Math.random() * (b - a);

  // Chord changes every bar; light randomisation of the progression order.
  const chordLoop = new Tone.Loop((time) => {
    chordIdx = Math.random() < 0.25 ? Math.floor(Math.random() * PROGRESSION.length) : (chordIdx + 1) % PROGRESSION.length;
    currentChord = PROGRESSION[chordIdx];
    const notes = currentChord.map((s) => midiToNote(cfg.root + s));
    pad.triggerAttackRelease(notes, "1m", time, 0.6);
  }, "1m").start(0);
  nodes.push(chordLoop);

  // Bass: root on 8ths, pumped.
  const bassLoop = new Tone.Loop((time) => {
    const n = midiToNote(cfg.root + currentChord[0] - 12);
    bass.triggerAttackRelease(n, "8n", time, 0.9);
  }, "8n").start(0);
  nodes.push(bassLoop);

  // Arp: cycle the triad up an octave at arpRate.
  const arpLoop = new Tone.Loop((time) => {
    const triad = currentChord;
    const note = midiToNote(cfg.root + triad[arpStep % triad.length] + 12);
    arpStep += 1;
    arp.triggerAttackRelease(note, "16n", time, 0.7);
  }, cfg.arpRate).start(0);
  nodes.push(arpLoop);

  if (cfg.drums) {
    if (cfg.kickFour) {
      const kickLoop = new Tone.Loop((time) => {
        kick.triggerAttackRelease("C1", "8n", time);
      }, "4n").start(0);
      nodes.push(kickLoop);
    }
    // Snare on beats 2 & 4.
    const snareLoop = new Tone.Loop((time) => {
      if (beat % 2 === 1) snare.triggerAttackRelease("16n", time);
      beat += 1;
    }, "4n").start(0);
    nodes.push(snareLoop);
    // Hats on 8ths.
    const hatLoop = new Tone.Loop((time) => {
      hat.triggerAttackRelease("32n", time, rand(0.4, 0.9));
    }, "8n").start(0);
    nodes.push(hatLoop);
  }

  if (cfg.lead) {
    // Occasional melodic phrase from the minor scale.
    const leadLoop = new Tone.Loop((time) => {
      if (Math.random() < 0.4) {
        const deg = MINOR_SCALE[Math.floor(Math.random() * MINOR_SCALE.length)];
        const oct = Math.random() < 0.5 ? 12 : 24;
        lead.triggerAttackRelease(midiToNote(cfg.root + deg + oct), "8n", time, rand(0.5, 0.8));
      }
    }, "2n").start(0);
    nodes.push(leadLoop);
  }

  return {
    dispose() {
      pumpLfo.stop();
      for (const n of nodes) {
        try {
          n.dispose();
        } catch {
          /* already disposed */
        }
      }
    },
  };
}

// ── Engine controller ───────────────────────────────────────────────────────

let master: Tone.Gain | null = null;
let current: TrackHandle | null = null;
let currentTrackIdx = -1;
let mode: Mode = "menu";
let unlocked = false;
let muted = false;
let advanceTimer = 0;
let onMuteChange: (() => void) | null = null;

try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  /* no storage */
}

function poolFor(m: Mode): number[] {
  return m === "ride" ? RIDE_POOL : MENU_POOL;
}

function pickTrack(m: Mode): number {
  const pool = poolFor(m);
  const choices = pool.filter((i) => i !== currentTrackIdx);
  const list = choices.length ? choices : pool;
  return list[Math.floor(Math.random() * list.length)];
}

function startTrack(idx: number): void {
  if (!master) return;
  stopTrack();
  currentTrackIdx = idx;
  current = buildTrack(TRACKS[idx], master);
  Tone.getTransport().start();
  advanceTimer = window.setTimeout(() => startTrack(pickTrack(mode)), TRACK_MS);
}

function stopTrack(): void {
  window.clearTimeout(advanceTimer);
  advanceTimer = 0;
  current?.dispose();
  current = null;
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
}

/** Begin playback for the current mode (no-op if muted or not yet unlocked). */
function play(): void {
  if (!unlocked || muted || !master) return;
  if (!current) startTrack(pickTrack(mode));
}

/** Called once on the first user gesture — unlocks the audio context. */
async function unlock(): Promise<void> {
  if (unlocked) return;
  unlocked = true;
  await Tone.start();
  if (!master) master = new Tone.Gain(MASTER_GAIN).toDestination();
  play();
}

export function setMusicMode(isRide: boolean): void {
  const next: Mode = isRide ? "ride" : "menu";
  if (next === mode) return;
  mode = next;
  if (current) startTrack(pickTrack(mode)); // switch pools
  else play();
}

export function skipTrack(): void {
  if (!unlocked || muted) return;
  startTrack(pickTrack(mode));
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMuted(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (muted) stopTrack();
  else play();
  onMuteChange?.();
  return muted;
}

/** Install the one-shot gesture listeners that unlock + start audio. */
export function initMusic(onChange?: () => void): void {
  onMuteChange = onChange ?? null;
  const gesture = (): void => {
    void unlock();
    window.removeEventListener("pointerdown", gesture);
    window.removeEventListener("keydown", gesture);
  };
  window.addEventListener("pointerdown", gesture);
  window.addEventListener("keydown", gesture);

  // Track route → menu vs ride music.
  const applyRoute = (): void => {
    const h = location.hash;
    setMusicMode(h.startsWith("#/ride/") || h.startsWith("#/replay/"));
  };
  window.addEventListener("hashchange", applyRoute);
  applyRoute();
}
