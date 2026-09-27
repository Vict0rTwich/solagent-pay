import confetti from "canvas-confetti";

// The moment a payment lands: a confetti burst in the dashboard's own palette (electric blue, sky, the "paid"
// emerald, amber and cool white) and a two-note chime synthesized with the Web Audio API (no audio files).
// Browser-only; call from effects and event handlers.

const COLORS = ["#2563EB", "#60A5FA", "#34D399", "#FBBF24", "#E8EDF7"];

/** Keys already celebrated on this page, so the dashboard, the checkout and the pay dialog don't all go off at once. */
const celebrated = new Set<string>();

let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  audio ??= new Context();
  return audio;
}

/**
 * Browsers only start audio after the person has interacted with the page. Payments arrive on their own schedule,
 * so this unlocks audio on the first click or key press, ahead of time. Returns the cleanup.
 */
export function primeAudio(): () => void {
  const unlock = () => {
    const context = audioContext();
    if (context?.state === "suspended") void context.resume().catch(() => {});
    if (context?.state === "running") remove();
  };
  const remove = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  return remove;
}

/** C5 then G5, sine, each with a 12 ms attack and an exponential decay, plus a faint octave on top for the "ding". */
export function playChime(): void {
  const context = audioContext();
  if (!context) return;
  if (context.state === "suspended") void context.resume().catch(() => {});

  const master = context.createGain();
  master.gain.value = 0.16;
  master.connect(context.destination);

  const note = (frequency: number, start: number, length: number, level: number) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(level, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(envelope).connect(master);
    oscillator.start(start);
    oscillator.stop(start + length + 0.05);
  };

  const at = context.currentTime + 0.02;
  note(523.25, at, 0.32, 1); // C5
  note(1046.5, at, 0.18, 0.12);
  note(783.99, at + 0.11, 0.62, 1); // G5
  note(1567.98, at + 0.11, 0.3, 0.1);
}

/** Two corner cannons and a burst from the middle. Nothing under prefers-reduced-motion. */
export function fireConfetti(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // An open <dialog> sits in the top layer, above any z-index: draw inside it so the confetti isn't hidden behind it.
  const dialogs = document.querySelectorAll("dialog[open]");
  const host = dialogs[dialogs.length - 1] ?? document.body;
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "2147483647" });
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  const shoot = confetti.create(canvas, { resize: true });
  const base = { colors: COLORS, ticks: 240, gravity: 1.05, scalar: 0.95, disableForReducedMotion: true };
  void Promise.all([
    shoot({ ...base, particleCount: 80, angle: 60, spread: 58, startVelocity: 58, origin: { x: 0, y: 0.92 } }),
    shoot({ ...base, particleCount: 80, angle: 120, spread: 58, startVelocity: 58, origin: { x: 1, y: 0.92 } }),
    shoot({ ...base, particleCount: 60, spread: 110, startVelocity: 32, origin: { x: 0.5, y: 0.35 }, shapes: ["circle"] }),
  ]).finally(() => {
    shoot.reset();
    canvas.remove();
  });
}

/** Confetti and (unless muted) the chime, once per `key` (an invoice's reference) on this page. */
export function celebrate(key: string, { sound }: { sound: boolean }): void {
  if (celebrated.has(key)) return;
  celebrated.add(key);
  fireConfetti();
  if (sound) playChime();
}
