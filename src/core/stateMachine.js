// Máquina de estados mínima: só permite as transições declaradas na tabela.

export class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`Transição inválida: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class StateMachine {
  /**
   * @param {Record<string, string[]>} transitions estado → estados seguintes permitidos
   * @param {string} initial
   */
  constructor(transitions, initial) {
    if (!(initial in transitions)) throw new Error(`Estado inicial desconhecido: ${initial}`);
    this.transitions = transitions;
    this.state = initial;
    this.history = [initial];
  }

  can(next) {
    return (this.transitions[this.state] ?? []).includes(next);
  }

  to(next) {
    if (!this.can(next)) throw new InvalidTransitionError(this.state, next);
    this.state = next;
    this.history.push(next);
    return next;
  }

  is(...states) {
    return states.includes(this.state);
  }
}

// Estados da rodada (vistos por todos).
export const ROUND_STATE = Object.freeze({
  READY: 'READY',
  QUESTION_ACTIVE: 'QUESTION_ACTIVE',
  TIME_EXPIRED: 'TIME_EXPIRED',
  ALL_ANSWERED: 'ALL_ANSWERED', // todos já acertaram ou esgotaram as tentativas
  ANSWER_REVEALED: 'ANSWER_REVEALED',
  ROUND_COMPLETE: 'ROUND_COMPLETE',
});

const R = ROUND_STATE;
export const ROUND_TRANSITIONS = Object.freeze({
  [R.READY]: [R.QUESTION_ACTIVE],
  [R.QUESTION_ACTIVE]: [R.TIME_EXPIRED, R.ALL_ANSWERED],
  [R.TIME_EXPIRED]: [R.ANSWER_REVEALED],
  [R.ALL_ANSWERED]: [R.ANSWER_REVEALED],
  [R.ANSWER_REVEALED]: [R.ROUND_COMPLETE],
  [R.ROUND_COMPLETE]: [],
});

// Estados de cada jogador dentro de uma rodada.
export const PLAYER_STATE = Object.freeze({
  READY: 'READY',
  QUESTION_ACTIVE: 'QUESTION_ACTIVE',
  ANSWER_SUBMITTED: 'ANSWER_SUBMITTED',
  ANSWER_CORRECT: 'ANSWER_CORRECT',
  ANSWER_INCORRECT: 'ANSWER_INCORRECT',
  TIME_EXPIRED: 'TIME_EXPIRED',
  ANSWER_REVEALED: 'ANSWER_REVEALED',
  ROUND_COMPLETE: 'ROUND_COMPLETE',
});

const P = PLAYER_STATE;
export const PLAYER_TRANSITIONS = Object.freeze({
  [P.READY]: [P.QUESTION_ACTIVE],
  [P.QUESTION_ACTIVE]: [P.ANSWER_SUBMITTED, P.TIME_EXPIRED],
  [P.ANSWER_SUBMITTED]: [P.ANSWER_CORRECT, P.ANSWER_INCORRECT],
  // com tentativas ilimitadas volta para QUESTION_ACTIVE; com tentativa única espera a revelação
  [P.ANSWER_INCORRECT]: [P.QUESTION_ACTIVE, P.ANSWER_REVEALED],
  [P.ANSWER_CORRECT]: [P.ANSWER_REVEALED],
  [P.TIME_EXPIRED]: [P.ANSWER_REVEALED],
  [P.ANSWER_REVEALED]: [P.ROUND_COMPLETE],
  [P.ROUND_COMPLETE]: [],
});
