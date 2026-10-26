// Relógio + agendador. O servidor usa o relógio do sistema; os testes usam ManualClock
// para controlar o tempo sem esperar de verdade.

export const systemClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
});

export class ManualClock {
  constructor(start = 1_000_000) {
    this.time = start;
    this.timers = [];
    this.nextId = 1;
  }

  now() {
    return this.time;
  }

  setTimeout(fn, ms) {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(id) {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  /** Avança o tempo executando, em ordem, os timers que vencerem no caminho. */
  advance(ms) {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }
}
