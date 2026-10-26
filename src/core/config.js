// Valores padrão do jogo. Ajuste aqui para mudar o ritmo sem mexer na lógica.

export const DIFFICULTY_LABELS = Object.freeze({ 1: 'fácil', 2: 'média', 3: 'difícil', 4: 'especialista' });

export const TYPE_LABELS = Object.freeze({ image: 'imagem', quote: 'frase', emoji: 'emoji', clue: 'pista' });

// Duração de cada desafio (segundos) quando a sala usa "duração pela dificuldade".
export const DURATION_BY_DIFFICULTY = Object.freeze({ 1: 15, 2: 20, 3: 25, 4: 30 });

// Distribuição de dificuldades de uma partida clássica de 10 rodadas.
// Para outras quantidades de rodadas, a proporção é mantida.
export const CLASSIC_DISTRIBUTION = Object.freeze({ 1: 3, 2: 4, 3: 2, 4: 1 });

export const SCORING = Object.freeze({
  maxPoints: 10, // primeiro jogador a acertar
  minPoints: 1, // menor pontuação possível para um acerto dentro do tempo
  curve: 'linear', // 'linear' | 'acelerada' (ver scoring.js)
});

export const TIMINGS = Object.freeze({
  countdownMs: 3000, // contagem antes da primeira rodada
  autoStartMs: 5000, // espera para começar quando há jogadores suficientes
  afterMatchMs: 15000, // pausa após o resultado antes de começar outra partida sozinha
  disconnectGraceMs: 30000, // tempo para reconectar sem perder a pontuação
});

// Não deixar a mesma categoria aparecer mais que isso em sequência (quando houver alternativa).
export const MAX_CATEGORY_STREAK = 2;

export const LIMITS = Object.freeze({
  nameLength: 20,
  guessLength: 100,
  chatLength: 300,
  chatHistory: 100,
});
