import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { speedPoints, scoreCorrectAnswer } from '../src/core/scoring.js';

describe('pontuação de 1 a 10', () => {
  test('primeiro a acertar ganha 10', () => {
    assert.equal(speedPoints({ isFirst: true, decaySeconds: 10 }), 10);
  });

  test('os seguintes perdem pontos pelo tempo desde o primeiro acerto', () => {
    const at = (ms) => speedPoints({ isFirst: false, msSinceFirst: ms, decaySeconds: 10 });
    assert.equal(at(0), 9);
    assert.equal(at(5000), 5);
    assert.equal(at(10_000), 1);
    assert.equal(at(60_000), 1); // nunca abaixo de 1
    for (let ms = 0; ms < 10_000; ms += 250) assert.ok(at(ms) >= at(ms + 250), `não cresce em ${ms}`);
  });

  test('respostas próximas no tempo têm pontuações próximas', () => {
    const a = speedPoints({ isFirst: false, msSinceFirst: 3000, decaySeconds: 10 });
    const b = speedPoints({ isFirst: false, msSinceFirst: 3200, decaySeconds: 10 });
    assert.ok(Math.abs(a - b) <= 1);
  });

  test('o intervalo de redução é configurável', () => {
    assert.equal(speedPoints({ isFirst: false, msSinceFirst: 2000, decaySeconds: 2 }), 1);
    assert.equal(speedPoints({ isFirst: false, msSinceFirst: 2000, decaySeconds: 20 }), 8);
  });

  test('curva acelerada perde pontos mais cedo', () => {
    const linear = speedPoints({ isFirst: false, msSinceFirst: 3000, decaySeconds: 10, curve: 'linear' });
    const fast = speedPoints({ isFirst: false, msSinceFirst: 3000, decaySeconds: 10, curve: 'acelerada' });
    assert.ok(fast < linear);
  });

  test('modo "todos valem o mesmo"', () => {
    assert.equal(scoreCorrectAnswer({ scoring: 'flat', isFirst: false, msSinceFirst: 9000 }), 10);
  });

  test('cada pista desconta a penalidade uma vez, sem passar do mínimo', () => {
    assert.equal(scoreCorrectAnswer({ isFirst: true, hintsUsed: 0, hintPenalty: 1 }), 10);
    assert.equal(scoreCorrectAnswer({ isFirst: true, hintsUsed: 2, hintPenalty: 1 }), 8);
    assert.equal(scoreCorrectAnswer({ isFirst: true, hintsUsed: 3, hintPenalty: 5 }), 1);
    assert.equal(scoreCorrectAnswer({ isFirst: false, msSinceFirst: 20_000, hintsUsed: 3, hintPenalty: 2 }), 1);
  });

  test('multiplicador do modo é aplicado no final', () => {
    assert.equal(scoreCorrectAnswer({ isFirst: true, multiplier: 2 }), 20);
    assert.equal(scoreCorrectAnswer({ isFirst: false, msSinceFirst: 99_000, multiplier: 2 }), 2);
  });
});
