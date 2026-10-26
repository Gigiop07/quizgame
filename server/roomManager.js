// Cria, encontra e remove salas.

import { systemClock } from '../src/core/clock.js';
import { Room } from './room.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I e O, que confundem com 1 e 0
const EMPTY_ROOM_TTL_MS = 60_000;

export function normalizeRoomCode(code) {
  const clean = String(code ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return clean.length === 4 ? clean : null;
}

export class RoomManager {
  constructor({ bank, clock = systemClock, rng = Math.random, timings, media, log } = {}) {
    this.bank = bank;
    this.clock = clock;
    this.rng = rng;
    this.timings = timings;
    this.media = media;
    this.log = log;
    this.rooms = new Map();
  }

  get(code) {
    const normalized = normalizeRoomCode(code);
    return normalized ? this.rooms.get(normalized) : undefined;
  }

  create() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(this.rng() * CODE_LETTERS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room({
      code,
      bank: this.bank,
      clock: this.clock,
      rng: this.rng,
      timings: this.timings,
      media: this.media,
      log: this.log,
      onEmpty: (r) => this.rooms.delete(r.code),
    });
    this.rooms.set(code, room);
    // uma sala criada e nunca usada não fica para sempre na memória
    const handle = this.clock.setTimeout(() => {
      if (room.members.size === 0) this.rooms.delete(code);
    }, EMPTY_ROOM_TTL_MS);
    handle?.unref?.();
    return room;
  }

  closeAll() {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}
