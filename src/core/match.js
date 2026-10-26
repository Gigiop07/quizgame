// Uma partida: sequência de rodadas, tempo oficial, pontuação e fim de jogo.
// É a única camada que muda as regras do jogo; servidor e interface só chamam estes métodos.

import { systemClock } from './clock.js';
import { DURATION_BY_DIFFICULTY, TIMINGS } from './config.js';
import { QuestionDeck } from './deck.js';
import { getMode } from './modes.js';
import { Round, OUTCOME, GUESS } from './round.js';
import { buildMatchResults } from './results.js';

export const MATCH_PHASE = Object.freeze({
  IDLE: 'idle',
  COUNTDOWN: 'countdown', // antes da primeira rodada
  QUESTION: 'question', // pergunta aberta para respostas
  REVEAL: 'reveal', // resposta revelada, aguardando a próxima
  FINISHED: 'finished',
});

export const END_REASON = Object.freeze({
  COMPLETED: 'completed',
  GOAL_REACHED: 'goal_reached',
  LAST_SURVIVOR: 'last_survivor',
  ALL_ELIMINATED: 'all_eliminated',
  OUT_OF_QUESTIONS: 'out_of_questions',
  NO_PLAYERS: 'no_players',
});

export function durationFor(question, rules) {
  const seconds = rules.durationMode === 'fixed' ? rules.duration : DURATION_BY_DIFFICULTY[question.difficulty];
  return seconds * 1000;
}

export class Match {
  /**
   * @param {object} p
   * @param {import('./questionBank.js').QuestionBank} p.bank
   * @param {object[]} p.questions perguntas permitidas pelos filtros
   * @param {object} p.rules
   * @param {{id: string, name: string}[]} p.players
   * @param {object} [p.clock] { now, setTimeout, clearTimeout }
   * @param {() => number} [p.rng]
   * @param {Set<string>} [p.seen] perguntas já vistas pela sala
   * @param {(event: object) => void} [p.onChange]
   * @param {object} [p.timings]
   */
  constructor({ bank, questions, rules, players, clock = systemClock, rng = Math.random, seen, onChange, timings }) {
    this.bank = bank;
    this.rules = rules;
    this.mode = getMode(rules.mode);
    this.clock = clock;
    this.rng = rng;
    this.onChange = onChange ?? (() => {});
    this.timings = { ...TIMINGS, ...timings };
    this.deck = new QuestionDeck(questions, { rng, seen });
    this.plan = this.mode.plan ? this.mode.plan(rules) : null;
    this.totalRounds = this.plan ? Math.min(this.plan.length, this.deck.size) : null;
    this.players = new Map();
    this.startedWith = players.length;
    for (const p of players) this.addPlayer(p.id, p.name);
    this.rounds = [];
    this.phase = MATCH_PHASE.IDLE;
    this.phaseEndsAt = null;
    this.endReason = null;
    this.results = null;
    this.timer = null;
  }

  get current() {
    return this.rounds.at(-1) ?? null;
  }

  get isRunning() {
    return this.phase !== MATCH_PHASE.IDLE && this.phase !== MATCH_PHASE.FINISHED;
  }

  /** Jogadores que ainda participam (não saíram nem foram eliminados). */
  activeIds() {
    return [...this.players.values()].filter((p) => !p.left && !p.eliminated).map((p) => p.id);
  }

  start() {
    if (this.phase !== MATCH_PHASE.IDLE) return;
    this.setPhase(MATCH_PHASE.COUNTDOWN, this.timings.countdownMs);
    this.schedule(() => this.nextRound(), this.timings.countdownMs);
    this.emit('started');
  }

  addPlayer(id, name) {
    const existing = this.players.get(id);
    if (existing) {
      existing.left = false;
      existing.connected = true;
    } else {
      this.players.set(id, {
        id,
        name,
        score: 0,
        connected: true,
        left: false,
        lives: this.mode.end === 'lives' ? this.rules.lives : null,
        eliminated: false,
        eliminatedAtRound: null,
        streak: 0,
        bestStreak: 0,
      });
    }
    if (this.phase === MATCH_PHASE.QUESTION && !this.players.get(id).eliminated) this.current.addPlayer(id);
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player || player.left) return;
    player.left = true;
    if (!this.isRunning) return;
    if (this.activeIds().length === 0) {
      this.finish(END_REASON.NO_PLAYERS);
      return;
    }
    this.closeIfEveryoneAnswered();
    this.emit('player_left');
  }

  setConnected(id, connected) {
    const player = this.players.get(id);
    if (player) player.connected = connected;
  }

  submit(playerId, text) {
    const round = this.current;
    if (this.phase !== MATCH_PHASE.QUESTION || !round) return { result: GUESS.CLOSED };
    const player = this.players.get(playerId);
    if (!player || player.left || player.eliminated) return { result: GUESS.NOT_PLAYING };

    const outcome = round.submit(playerId, text, this.clock.now());
    if (outcome.result === GUESS.CORRECT) player.score += outcome.points;
    if (outcome.result === GUESS.CORRECT || outcome.result === GUESS.INCORRECT) {
      this.emit('guess', { playerId, result: outcome.result });
      this.closeIfEveryoneAnswered();
    }
    return outcome;
  }

  useHint(playerId) {
    if (this.phase !== MATCH_PHASE.QUESTION) return { error: 'closed' };
    const result = this.current.useHint(playerId, this.clock.now());
    if (!result.error) this.emit('hint', { playerId });
    return result;
  }

  reportMediaError(playerId) {
    if (this.phase === MATCH_PHASE.QUESTION || this.phase === MATCH_PHASE.REVEAL) {
      this.current.markMediaFailed(playerId);
    }
  }

  // ——— fluxo interno ———

  nextRound() {
    const reason = this.endCondition();
    if (reason) {
      this.finish(reason);
      return;
    }
    const index = this.rounds.length;
    const difficulty = this.plan ? this.plan[index] : this.mode.nextDifficulty(index, this.rng);
    const question = this.deck.draw(difficulty);
    if (!question) {
      this.finish(END_REASON.OUT_OF_QUESTIONS);
      return;
    }
    const round = new Round({
      question,
      index,
      playerIds: this.activeIds(),
      durationMs: durationFor(question, this.rules),
      rules: this.rules,
      multiplier: this.mode.multiplier,
      knownAnswers: this.bank.knownAnswers,
    });
    this.rounds.push(round);
    round.start(this.clock.now());
    this.phase = MATCH_PHASE.QUESTION;
    this.phaseEndsAt = round.endsAt;
    this.schedule(() => this.closeRound('time'), round.durationMs);
    this.emit('round_started', { questionId: question.id });
  }

  closeIfEveryoneAnswered() {
    if (this.phase === MATCH_PHASE.QUESTION && this.current.allResolved(this.activeIds())) {
      this.closeRound('all_answered');
    }
  }

  closeRound(reason) {
    if (this.phase !== MATCH_PHASE.QUESTION) return;
    this.cancelTimer();
    const round = this.current;
    round.close(reason, this.clock.now());
    round.reveal();
    this.applyRoundEffects(round);
    const revealMs = this.rules.revealSeconds * 1000;
    this.setPhase(MATCH_PHASE.REVEAL, revealMs);
    this.schedule(() => {
      round.complete();
      this.nextRound();
    }, revealMs);
    this.emit('round_closed', { reason });
  }

  applyRoundEffects(round) {
    for (const id of round.players.keys()) {
      const player = this.players.get(id);
      const { status } = round.outcomeOf(id);
      if (status === OUTCOME.CORRECT) {
        player.streak += 1;
        player.bestStreak = Math.max(player.bestStreak, player.streak);
      } else if (status !== OUTCOME.CANCELLED) {
        player.streak = 0;
        if (this.mode.end === 'lives' && !player.eliminated) {
          player.lives -= 1;
          if (player.lives <= 0) {
            player.eliminated = true;
            player.eliminatedAtRound = round.index + 1;
          }
        }
      }
    }
  }

  endCondition() {
    const active = this.activeIds();
    if (this.mode.end === 'lives') {
      const alive = [...this.players.values()].filter((p) => !p.eliminated && !p.left);
      if (alive.length === 0) return END_REASON.ALL_ELIMINATED;
      if (this.startedWith > 1 && alive.length === 1) return END_REASON.LAST_SURVIVOR;
    }
    if (active.length === 0) return END_REASON.NO_PLAYERS;
    if (this.mode.end === 'rounds' && this.rounds.length >= this.totalRounds) {
      // com poucas perguntas para os filtros, a partida fica mais curta em vez de falhar
      return this.totalRounds < this.plan.length ? END_REASON.OUT_OF_QUESTIONS : END_REASON.COMPLETED;
    }
    if (this.mode.end === 'score' && [...this.players.values()].some((p) => p.score >= this.rules.scoreGoal)) {
      return END_REASON.GOAL_REACHED;
    }
    return null;
  }

  finish(reason) {
    if (this.phase === MATCH_PHASE.FINISHED) return;
    this.cancelTimer();
    const round = this.current;
    if (round && round.isOpen) round.abort(this.clock.now());
    this.endReason = reason;
    this.phase = MATCH_PHASE.FINISHED;
    this.phaseEndsAt = null;
    this.results = buildMatchResults({
      rounds: this.rounds,
      players: this.players,
      mode: this.mode,
      reason,
      categoryLabel: (id) => this.bank.categoryLabel(id),
    });
    this.emit('finished', { reason });
  }

  /** Para os timers sem gerar resultado (sala fechada). */
  stop() {
    this.cancelTimer();
  }

  setPhase(phase, durationMs) {
    this.phase = phase;
    this.phaseEndsAt = this.clock.now() + durationMs;
  }

  schedule(fn, ms) {
    this.cancelTimer();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  cancelTimer() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  emit(type, data = {}) {
    this.onChange({ type, ...data });
  }
}
