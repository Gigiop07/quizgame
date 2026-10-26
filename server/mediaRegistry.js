// Endereços temporários para as imagens das perguntas.
// O navegador recebe /m/<token aleatório>, nunca o nome do arquivo nem o id da pergunta,
// para que a URL não entregue a resposta.

import { randomBytes } from 'node:crypto';

export class MediaRegistry {
  constructor({ ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  register(file) {
    this.prune();
    const token = randomBytes(12).toString('hex');
    this.entries.set(token, { file, expiresAt: this.now() + this.ttlMs });
    return token;
  }

  resolve(token) {
    const entry = this.entries.get(token);
    if (!entry || entry.expiresAt < this.now()) return null;
    return entry.file;
  }

  prune() {
    const now = this.now();
    for (const [token, entry] of this.entries) if (entry.expiresAt < now) this.entries.delete(token);
  }
}
