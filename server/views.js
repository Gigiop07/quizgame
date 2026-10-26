// Monta o estado que cada cliente recebe. Cada jogador vê só o que pode ver:
// a resposta só aparece na revelação, as pistas só para quem pediu, e os palpites
// errados dos outros só quando a sala permite.

import { DIFFICULTY_LABELS, TYPE_LABELS } from '../src/core/config.js';
import { MATCH_PHASE } from '../src/core/match.js';
import { describeRules } from '../src/core/rules.js';
import { getMode } from '../src/core/modes.js';

export function buildState(room, viewerId) {
  const viewer = room.members.get(viewerId);
  const players = room.playerMembers();
  return {
    t: 'state',
    serverNow: room.clock.now(),
    room: {
      code: room.code,
      leaderId: room.leaderId,
      rules: room.rules,
      summary: describeRules(room.rules),
      modeDescription: getMode(room.rules.mode).description,
      poolSize: room.poolSize(),
      totalQuestions: room.bank.size,
      phase: room.match ? 'playing' : 'waiting',
      autoStartAt: room.autoStartAt,
      playersNeeded: Math.max(0, room.rules.minPlayers - room.connectedPlayers().length),
      spectators: room.members.size - players.length,
    },
    self: viewer && {
      id: viewer.id,
      name: viewer.name,
      isPlayer: viewer.isPlayer,
      isLeader: viewer.id === room.leaderId,
    },
    players: players.map((m) => playerView(room, m, viewerId)),
    match: room.match ? matchView(room, viewerId) : null,
    results: room.match ? null : room.lastResults,
  };
}

function playerView(room, member, viewerId) {
  const view = {
    id: member.id,
    name: member.name,
    connected: member.connected,
    isLeader: member.id === room.leaderId,
    score: 0,
  };
  const match = room.match;
  const state = match?.players.get(member.id);
  if (!state) return view;
  view.score = state.score;
  if (match.mode.end === 'lives') {
    view.lives = state.lives;
    view.eliminated = state.eliminated;
  }
  const round = match.current;
  const showRound = round && (match.phase === MATCH_PHASE.QUESTION || match.phase === MATCH_PHASE.REVEAL);
  if (showRound && round.players.has(member.id)) {
    const outcome = round.outcomeOf(member.id);
    view.round = { status: round.playerStatus(member.id), points: outcome.points };
    const canSeeGuess = room.rules.showGuesses || member.id === viewerId;
    if (canSeeGuess && outcome.lastWrongGuess && view.round.status !== 'correct') {
      view.round.lastGuess = outcome.lastWrongGuess;
    }
  }
  return view;
}

function matchView(room, viewerId) {
  const match = room.match;
  const round = match.current;
  const view = {
    mode: match.mode.id,
    modeName: match.mode.name,
    multiplier: match.mode.multiplier,
    phase: match.phase,
    phaseEndsAt: match.phaseEndsAt,
    roundNumber: round ? round.index + 1 : 0,
    totalRounds: match.totalRounds,
    scoreGoal: match.mode.end === 'score' ? room.rules.scoreGoal : null,
    question: null,
    me: null,
    reveal: null,
  };
  if (!round || (match.phase !== MATCH_PHASE.QUESTION && match.phase !== MATCH_PHASE.REVEAL)) return view;

  view.question = questionView(room, round);
  if (round.players.has(viewerId)) {
    const status = round.playerStatus(viewerId);
    const outcome = round.outcomeOf(viewerId);
    view.me = {
      status,
      points: outcome.points,
      hints: round.hintsShownTo(viewerId),
      canAnswer: match.phase === MATCH_PHASE.QUESTION && (status === 'pending' || status === 'wrong'),
      singleAttempt: room.rules.attempts === 'single',
    };
  }
  if (match.phase === MATCH_PHASE.REVEAL) view.reveal = revealView(room, round);
  return view;
}

function questionView(room, round) {
  const q = round.question;
  const category = room.bank.categoryById.get(q.category);
  return {
    number: round.index + 1,
    category: q.category,
    categoryLabel: category?.label ?? q.category,
    categoryEmoji: category?.emoji ?? '❓',
    difficulty: q.difficulty,
    difficultyLabel: DIFFICULTY_LABELS[q.difficulty],
    type: q.type,
    typeLabel: TYPE_LABELS[q.type],
    prompt: q.prompt,
    media: mediaView(q.media, room.mediaToken),
    startsAt: round.startsAt,
    endsAt: round.endsAt,
    durationMs: round.durationMs,
    hintsAvailable: round.hintsAvailable,
  };
}

function mediaView(media, token) {
  if (media.type === 'image') {
    if (media.unavailable || !token) {
      return { type: 'text', style: 'clue', text: media.fallbackText ?? '', fallback: true };
    }
    return {
      type: 'image',
      src: `/m/${token}`,
      alt: media.alt,
      reveal: media.reveal ?? null,
      fallbackText: media.fallbackText ?? null,
    };
  }
  if (media.type === 'none') return { type: 'none' };
  return { type: media.type, style: media.style ?? null, text: media.text };
}

function revealView(room, round) {
  const q = round.question;
  const correct = [...round.players.keys()].filter((id) => round.playerStatus(id) === 'correct');
  const firstName = round.firstCorrectId ? room.match.players.get(round.firstCorrectId)?.name : null;
  return {
    answer: q.answers[0],
    alternatives: q.answers.slice(1, 4),
    explanation: q.explanation ?? null,
    source: q.source ?? null,
    credit: q.media.type === 'image' ? (q.media.credit ?? null) : null,
    firstCorrect: round.firstCorrectId
      ? { id: round.firstCorrectId, name: firstName, timeMs: round.firstCorrectAt - round.startsAt }
      : null,
    correctCount: correct.length,
    playerCount: round.players.size,
  };
}
