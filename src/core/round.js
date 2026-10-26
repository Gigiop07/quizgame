// Uma rodada: uma pergunta, o tempo oficial e o estado de cada jogador.
// Não usa timers — quem chama informa o horário (`now`) de cada evento, sempre do servidor.

import { checkAnswer, MATCH } from './answers.js';
import { scoreCorrectAnswer } from './scoring.js';
import { LIMITS } from './config.js';
import {
  StateMachine,
  ROUND_STATE as R,
  ROUND_TRANSITIONS,
  PLAYER_STATE as P,
  PLAYER_TRANSITIONS,
} from './stateMachine.js';

export const GUESS = Object.freeze({
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  EMPTY: 'empty',
  LATE: 'late', // chegou depois do fim do tempo
  CLOSED: 'closed', // a rodada não está aceitando respostas
  ALREADY_CORRECT: 'already_correct',
  LOCKED: 'locked', // tentativa única já usada
  NOT_PLAYING: 'not_playing',
});

export const OUTCOME = Object.freeze({
  CORRECT: 'correct',
  WRONG: 'wrong',
  UNANSWERED: 'unanswered',
  CANCELLED: 'cancelled', // a mídia não carregou para o jogador e não havia alternativa em texto
});

export class Round {
  /**
   * @param {object} p
   * @param {object} p.question
   * @param {number} p.index posição na partida (0, 1, 2...)
   * @param {string[]} p.playerIds
   * @param {number} p.durationMs
   * @param {object} p.rules regras da sala (attempts, shortcuts, typoTolerance, hints...)
   * @param {number} [p.multiplier]
   * @param {Set<string>} [p.knownAnswers]
   */
  constructor({ question, index, playerIds, durationMs, rules, multiplier = 1, knownAnswers }) {
    this.question = question;
    this.index = index;
    this.durationMs = durationMs;
    this.rules = rules;
    this.multiplier = multiplier;
    this.knownAnswers = knownAnswers;
    this.machine = new StateMachine(ROUND_TRANSITIONS, R.READY);
    this.players = new Map();
    this.startsAt = null;
    this.endsAt = null;
    this.closedAt = null;
    this.firstCorrectAt = null;
    this.firstCorrectId = null;
    this.aborted = false;
    for (const id of playerIds) this.addPlayer(id);
  }

  get state() {
    return this.machine.state;
  }

  get isOpen() {
    return this.machine.is(R.QUESTION_ACTIVE);
  }

  get hintsAvailable() {
    if (!this.rules.hints) return 0;
    return Math.min(this.rules.maxHints, this.question.hints.length);
  }

  start(now) {
    this.machine.to(R.QUESTION_ACTIVE);
    this.startsAt = now;
    this.endsAt = now + this.durationMs;
    for (const p of this.players.values()) p.machine.to(P.QUESTION_ACTIVE);
  }

  /** Entra um jogador (ex.: chegou no meio da partida). */
  addPlayer(id) {
    if (this.players.has(id) || !this.machine.is(R.READY, R.QUESTION_ACTIVE)) return;
    const machine = new StateMachine(PLAYER_TRANSITIONS, P.READY);
    if (this.isOpen) machine.to(P.QUESTION_ACTIVE);
    this.players.set(id, { id, machine, guesses: [], hintsUsed: 0, correctAt: null, points: 0, mediaFailed: false });
  }

  submit(playerId, rawText, now) {
    if (!this.isOpen) return { result: GUESS.CLOSED };
    if (now >= this.endsAt) return { result: GUESS.LATE };
    const player = this.players.get(playerId);
    if (!player) return { result: GUESS.NOT_PLAYING };
    if (player.machine.is(P.ANSWER_CORRECT)) return { result: GUESS.ALREADY_CORRECT };
    if (!player.machine.is(P.QUESTION_ACTIVE)) return { result: GUESS.LOCKED };

    const text = String(rawText ?? '').trim().slice(0, LIMITS.guessLength);
    const check = checkAnswer(this.question, text, {
      shortcuts: this.rules.shortcuts,
      typoTolerance: this.rules.typoTolerance,
      knownAnswers: this.knownAnswers,
    });
    if (check.match === MATCH.EMPTY) return { result: GUESS.EMPTY };

    player.machine.to(P.ANSWER_SUBMITTED);
    player.guesses.push({ text, at: now, correct: check.correct });

    if (check.correct) {
      player.machine.to(P.ANSWER_CORRECT);
      const isFirst = this.firstCorrectAt === null;
      if (isFirst) {
        this.firstCorrectAt = now;
        this.firstCorrectId = playerId;
      }
      player.correctAt = now;
      player.points = scoreCorrectAnswer({
        scoring: this.rules.scoring,
        isFirst,
        msSinceFirst: now - this.firstCorrectAt,
        decaySeconds: this.rules.decaySeconds,
        hintsUsed: player.hintsUsed,
        hintPenalty: this.rules.hintPenalty,
        multiplier: this.multiplier,
      });
      return { result: GUESS.CORRECT, points: player.points, isFirst, match: check.match };
    }

    player.machine.to(P.ANSWER_INCORRECT);
    const retry = this.rules.attempts !== 'single';
    if (retry) player.machine.to(P.QUESTION_ACTIVE);
    return { result: GUESS.INCORRECT, near: check.match === MATCH.NEAR, canRetry: retry };
  }

  /** Revela a próxima pista só para esse jogador. A penalidade é contada uma vez por pista. */
  useHint(playerId, now) {
    if (!this.rules.hints) return { error: 'disabled' };
    if (!this.isOpen || now >= this.endsAt) return { error: 'closed' };
    const player = this.players.get(playerId);
    if (!player || !player.machine.is(P.QUESTION_ACTIVE)) return { error: 'not_available' };
    if (player.hintsUsed >= this.hintsAvailable) return { error: 'no_more_hints' };
    player.hintsUsed += 1;
    return {
      hint: this.question.hints[player.hintsUsed - 1],
      number: player.hintsUsed,
      remaining: this.hintsAvailable - player.hintsUsed,
    };
  }

  hintsShownTo(playerId) {
    const used = this.players.get(playerId)?.hintsUsed ?? 0;
    return this.question.hints.slice(0, used);
  }

  markMediaFailed(playerId) {
    const player = this.players.get(playerId);
    if (player) player.mediaFailed = true;
  }

  /** Todos os jogadores ativos já acertaram ou não podem mais tentar? */
  allResolved(activeIds) {
    const ids = [...activeIds].filter((id) => this.players.has(id));
    if (ids.length === 0) return false;
    return ids.every((id) => {
      const { machine } = this.players.get(id);
      return machine.is(P.ANSWER_CORRECT) || machine.is(P.ANSWER_INCORRECT);
    });
  }

  /** Fecha as respostas: `reason` = 'time' (tempo esgotado) ou 'all_answered'. */
  close(reason, now) {
    this.machine.to(reason === 'time' ? R.TIME_EXPIRED : R.ALL_ANSWERED);
    this.closedAt = now;
    for (const p of this.players.values()) {
      if (p.machine.is(P.QUESTION_ACTIVE)) p.machine.to(P.TIME_EXPIRED);
    }
  }

  reveal() {
    this.machine.to(R.ANSWER_REVEALED);
    for (const p of this.players.values()) {
      if (p.machine.is(P.READY)) continue;
      p.machine.to(P.ANSWER_REVEALED);
    }
  }

  complete() {
    this.machine.to(R.ROUND_COMPLETE);
    for (const p of this.players.values()) {
      if (p.machine.is(P.ANSWER_REVEALED)) p.machine.to(P.ROUND_COMPLETE);
    }
  }

  /** Interrompe uma rodada em andamento (ex.: todos saíram). Ela não entra no resultado. */
  abort(now) {
    if (this.isOpen) this.close('time', now);
    this.aborted = true;
  }

  outcomeOf(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    let status = OUTCOME.UNANSWERED;
    if (p.correctAt !== null) status = OUTCOME.CORRECT;
    else if (p.mediaFailed && !this.question.media.fallbackText) status = OUTCOME.CANCELLED;
    else if (p.guesses.length > 0) status = OUTCOME.WRONG;
    return {
      status,
      points: p.points,
      timeMs: p.correctAt !== null ? p.correctAt - this.startsAt : null,
      hintsUsed: p.hintsUsed,
      wrongGuesses: p.guesses.filter((g) => !g.correct).length,
      lastWrongGuess: p.guesses.findLast((g) => !g.correct)?.text ?? null,
    };
  }

  /** Estado resumido do jogador para a interface. */
  playerStatus(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    if (p.correctAt !== null) return 'correct';
    if (p.machine.is(P.ANSWER_INCORRECT)) return 'locked';
    if (p.guesses.length > 0) return 'wrong';
    return 'pending';
  }
}
