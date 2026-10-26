// Resumo final de uma partida, calculado a partir das rodadas jogadas.
//
// Critérios:
//   - "respondidas" = rodadas em que o jogador enviou ao menos uma resposta (certa ou errada);
//   - taxa de acerto = acertos / respondidas (null se não respondeu nenhuma);
//   - rodadas canceladas (mídia não carregou para o jogador) e rodadas interrompidas
//     ficam fora de todas as estatísticas;
//   - tempo médio = média do tempo até o acerto, só entre os acertos.

import { OUTCOME } from './round.js';

const average = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);

/**
 * @param {object} p
 * @param {import('./round.js').Round[]} p.rounds
 * @param {Map<string, object>} p.players estado dos jogadores na partida
 * @param {object} p.mode
 * @param {string} p.reason motivo do fim
 * @param {(categoryId: string) => string} [p.categoryLabel]
 */
export function buildMatchResults({ rounds, players, mode, reason, categoryLabel = (id) => id }) {
  const played = rounds.filter((r) => !r.aborted && r.closedAt !== null);

  const ranking = [...players.values()].map((player) => {
    const outcomes = played.map((r) => ({ round: r, outcome: r.outcomeOf(player.id) })).filter((x) => x.outcome);
    const valid = outcomes.filter((x) => x.outcome.status !== OUTCOME.CANCELLED);
    const count = (status) => valid.filter((x) => x.outcome.status === status).length;
    const correct = count(OUTCOME.CORRECT);
    const wrong = count(OUTCOME.WRONG);
    const unanswered = count(OUTCOME.UNANSWERED);

    const byCategory = new Map();
    for (const { round, outcome } of valid) {
      const entry = byCategory.get(round.question.category) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (outcome.status === OUTCOME.CORRECT) entry.correct += 1;
      byCategory.set(round.question.category, entry);
    }
    const bestCategories = [...byCategory]
      .filter(([, e]) => e.correct > 0)
      .map(([category, e]) => ({ category, label: categoryLabel(category), ...e, rate: e.correct / e.total }))
      .sort((a, b) => b.rate - a.rate || b.correct - a.correct)
      .slice(0, 3);

    return {
      id: player.id,
      name: player.name,
      score: player.score,
      correct,
      wrong,
      unanswered,
      cancelled: outcomes.length - valid.length,
      answered: correct + wrong,
      accuracy: correct + wrong > 0 ? correct / (correct + wrong) : null,
      avgResponseMs: average(valid.filter((x) => x.outcome.timeMs !== null).map((x) => x.outcome.timeMs)),
      hintsUsed: valid.reduce((s, x) => s + x.outcome.hintsUsed, 0),
      bestStreak: player.bestStreak,
      lives: mode.end === 'lives' ? player.lives : null,
      eliminatedAtRound: player.eliminatedAtRound,
      bestCategories,
    };
  });

  ranking.sort(compareRanking(mode));
  ranking.forEach((entry, i) => {
    const prev = ranking[i - 1];
    entry.rank = prev && compareRanking(mode)(prev, entry) === 0 ? prev.rank : i + 1;
  });

  const questions = played.map((r) => ({
    number: r.index + 1,
    id: r.question.id,
    category: r.question.category,
    categoryLabel: categoryLabel(r.question.category),
    difficulty: r.question.difficulty,
    prompt: r.question.prompt,
    answer: r.question.answers[0],
    perPlayer: Object.fromEntries(
      [...r.players.keys()].map((id) => {
        const { status, points, timeMs, hintsUsed } = r.outcomeOf(id);
        return [id, { status, points, timeMs, hintsUsed }];
      }),
    ),
  }));

  return { reason, mode: mode.id, roundsPlayed: played.length, ranking, questions };
}

function compareRanking(mode) {
  if (mode.end === 'lives') {
    // quem sobreviveu mais tempo fica na frente; empate decidido pelos pontos
    const survived = (e) => (e.eliminatedAtRound === null ? Infinity : e.eliminatedAtRound);
    return (a, b) => survived(b) - survived(a) || b.score - a.score;
  }
  return (a, b) => b.score - a.score;
}
