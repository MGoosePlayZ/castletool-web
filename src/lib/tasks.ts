// Cooperative cancel + progress for long jobs (port of CTA's tasks.py).
export class Cancelled extends Error {
  constructor() { super("Cancelled"); this.name = "Cancelled"; }
}

export interface Prog {
  check(): void;
  say(message: string, frac?: number | null): void;
  /** i = items done so far out of n */
  step(i: number, n: number, message?: string): void;
  /** maps this task's inner 0..1 onto a slice of the whole job */
  sub(a: number, b: number): Prog;
}

export class Task implements Prog {
  cancelled = false;
  frac: number | null = null;
  message = "";
  private listeners = new Set<(t: Task) => void>();
  constructor(public label = "", private onMessage?: (m: string) => void) {}
  subscribe(fn: (t: Task) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  emit() { this.listeners.forEach((l) => l(this)); }
  cancel() { this.cancelled = true; this.emit(); }
  check() { if (this.cancelled) throw new Cancelled(); }
  setFrac(f: number | null, message?: string) {
    this.check();
    if (f !== null) this.frac = Math.max(0, Math.min(1, f));
    if (message) { this.message = message; this.onMessage?.(message); }
    this.emit();
  }
  say(message: string, frac: number | null = null) { this.setFrac(frac, message); }
  step(i: number, n: number, message = "") { this.setFrac(n > 0 ? i / n : null, message); }
  sub(a: number, b: number): Prog { return slice(this, a, b); }
}

function slice(root: Task, lo: number, hi: number): Prog {
  const at = (f: number) => lo + (hi - lo) * Math.max(0, Math.min(1, f));
  return {
    check: () => root.check(),
    say: (m, f) => root.setFrac(f === null || f === undefined ? null : at(f), m),
    step: (i, n, m) => root.setFrac(n > 0 ? at(i / n) : null, m),
    sub: (a, b) => slice(root, at(a), at(b)),
  };
}

/** For ops called without a task (previews). */
export const NOOP: Prog = { check() {}, say() {}, step() {}, sub() { return NOOP; } };

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));
