# Na Lata! — quiz cultural multiplayer

Jogo de adivinhação em português do Brasil, inspirado na dinâmica do PopSauce (JKLM): a cada rodada aparece uma **imagem, frase, sequência de emojis ou descrição**, e quem identificar primeiro a pessoa, personagem, filme, música, meme ou lugar ganha mais pontos.

> Projeto independente, sem ligação com o JKLM. Nome, logo e arte são próprios do jogo.

## Como rodar

Requer Node.js 22 ou mais novo.

```bash
npm install
npm start
```

Abra `http://localhost:3000`, escolha um apelido e clique em **Criar sala**. O código de 4 letras (e o link na aba 🏠) serve para chamar outras pessoas.

- **Mesma rede (Wi‑Fi de casa):** o servidor mostra no terminal um endereço como `http://192.168.0.10:3000`. Quem estiver na mesma rede entra por ele.
- **Pela internet:** é preciso publicar o servidor em um serviço que aceite WebSocket (Render, Railway, Fly.io, uma VPS…) ou usar um túnel (`cloudflared`, `ngrok`). Isso depende de configuração externa e não está automatizado aqui.
- **Sozinho:** entre no jogo e clique em **▶ Começar agora**. Com 2 ou mais jogadores (configurável) a partida começa sozinha.

Variáveis opcionais: `PORT` (padrão 3000), `HOST` (padrão `0.0.0.0`) e `DATA_DIR` (outra pasta de perguntas).

## Como funciona uma partida

1. Os jogadores entram na sala e clicam em **Entrar no jogo** (quem não entra assiste).
2. Após uma contagem, cada rodada mostra o desafio e um cronômetro. Respostas são digitadas na barra de baixo; dá para chutar quantas vezes quiser (ou só uma, conforme a regra).
3. Quando o tempo acaba — ou todos acertam — a resposta oficial é revelada, com curiosidade, fonte e crédito da imagem.
4. No fim aparece o resumo: pontos, acertos, erros, perguntas sem resposta, taxa de acerto, tempo médio, melhores categorias e a lista de perguntas com as respostas oficiais.

### Pontuação (1 a 10 por rodada)

- **10 pontos** para o primeiro jogador a acertar.
- Depois do primeiro acerto, começa a contar o tempo: os próximos ganham de **9 até 1**, caindo de forma proporcional ao tempo decorrido desde o primeiro acerto (não pela posição). Respostas próximas no tempo recebem pontuações próximas.
- **1 ponto** é o mínimo para um acerto dentro do tempo; erro ou falta de resposta vale **0**. Não há pontos negativos.
- O intervalo de redução (padrão 10 s) e a curva (`linear` ou `acelerada`) são configuráveis — o intervalo no painel de regras, a curva em `src/core/config.js`.
- **Pistas** descontam pontos (padrão 1 por pista), sem deixar um acerto abaixo de 1.
- O tempo oficial é sempre o do servidor: a resposta vale pelo horário em que o servidor a recebeu.

### Modos de jogo

| Modo | Como funciona |
|---|---|
| Clássico | Número fixo de rodadas (padrão 10: 3 fáceis, 4 médias, 2 difíceis, 1 especialista, da mais fácil à mais difícil). |
| Corrida de pontos | Rodadas sem fim até alguém atingir o objetivo (padrão 100 pontos). |
| Sobrevivência | Não acertou a tempo, perde uma vida. A dificuldade sobe a cada 4 rodadas. Ganha quem sobreviver. |
| Especialista | Só perguntas difíceis e de especialista, valendo o dobro. |

**Partidas temáticas / por categoria:** use o filtro de etiquetas (∪ união, ∩ interseção, ∖ exclusão) em qualquer modo — ex.: só `Futebol e Esportes`, ou `brasil` ∩ `anos 90`, ou tudo menos `especialista`.

### Regras configuráveis (aba ⚙️, só quem lidera a sala, entre partidas)

Modo, filtros, rodadas/objetivo/vidas, tipo de pontuação e intervalo de redução, duração (pela dificuldade — 15/20/25/30 s — ou fixa), tentativas ilimitadas ou única, atalhos (apelidos e abreviações), tolerância a erros de digitação, visibilidade dos palpites errados, pistas (quantidade e penalidade) e número de jogadores para começar.

## Arquitetura

```
src/core/          Regras do jogo, sem rede nem arquivos (testáveis isoladamente)
  normalize.js       normalização de texto (acentos, pontuação, artigos)
  answers.js         validação de respostas, apelidos, tolerância a erros, anti-spoiler
  scoring.js         pontuação de 1 a 10, pistas e multiplicador
  stateMachine.js    máquina de estados da rodada e de cada jogador
  round.js           uma rodada: tempo, tentativas, pistas, resultado por jogador
  deck.js            sorteio sem repetição, dificuldade, equilíbrio de categorias
  modes.js           modos de jogo e distribuição de dificuldade
  match.js           a partida: sequência de rodadas, timers, fim de jogo
  results.js         resumo final
  questionBank.js    validação, etiquetas e filtros do banco
  rules.js           regras da sala e seus limites
  config.js          valores padrão (tempos, distribuição, pontuação)
server/            Servidor Node (HTTP + WebSocket)
  index.js           arquivos estáticos, imagens por endereço temporário, WebSocket
  room.js            sala: membros, líder, chat, regras, início automático
  views.js           o que cada cliente pode ver (nada de resposta antes da hora)
  bankLoader.js      lê data/categories.json e data/questions/*.json
public/            Interface (HTML/CSS/JS sem build)
data/
  categories.json    categorias (adicione novas aqui)
  questions/*.json   perguntas, um arquivo por tema
  media/             imagens baixadas do Wikimedia Commons
tools/             validação do banco, verificação de fontes, download de imagens
test/              testes automatizados (node --test)
```

**Fluxo de estados da rodada:** `READY → QUESTION_ACTIVE → (TIME_EXPIRED | ALL_ANSWERED) → ANSWER_REVEALED → ROUND_COMPLETE`.
**De cada jogador:** `QUESTION_ACTIVE → ANSWER_SUBMITTED → ANSWER_CORRECT | ANSWER_INCORRECT`; com tentativas ilimitadas, `ANSWER_INCORRECT → QUESTION_ACTIVE`; sem acertar, `TIME_EXPIRED`; todos terminam em `ANSWER_REVEALED → ROUND_COMPLETE`. Transições fora da tabela lançam erro.

O servidor é a fonte da verdade: tempo, validação e pontuação acontecem nele. O navegador só mostra o estado e sincroniza o relógio (ping/pong) para exibir a contagem certa. A resposta, as pistas não pedidas e o nome do arquivo da imagem nunca são enviados antes da revelação; imagens são servidas em `/m/<token aleatório>`.

## Banco de perguntas

Cada arquivo em `data/questions/` é uma lista de perguntas:

```json
{
  "id": "cin-001",
  "category": "cinema_tv",
  "type": "quote",
  "difficulty": 1,
  "prompt": "De qual franquia é esta frase?",
  "media": { "type": "text", "style": "quote", "text": "Que a Força esteja com você." },
  "answers": ["Star Wars", "Guerra nas Estrelas"],
  "acceptedAliases": ["SW"],
  "rejectedAnswers": [],
  "hints": ["É uma saga de ficção científica.", "Tem cavaleiros com sabres de luz."],
  "explanation": "A frase aparece em vários filmes da saga.",
  "tags": ["internacional", "anos 70"],
  "source": { "url": "https://pt.wikipedia.org/wiki/Star_Wars", "attribution": "Wikipédia — Star Wars" }
}
```

| Campo | Obrigatório | Observação |
|---|---|---|
| `id` | sim | único em todo o banco |
| `category` | sim | id de `data/categories.json` |
| `type` | sim | `image`, `quote`, `emoji` ou `clue` |
| `difficulty` | sim | 1 fácil · 2 média · 3 difícil · 4 especialista |
| `prompt` | sim | diz exatamente o que deve ser digitado |
| `media` | sim | `text` (`style`: `quote`/`clue`), `emoji` ou `image` (`file`, `alt`, `credit`, opcional `fallbackText` e `reveal` `zoom`/`blur`) |
| `answers` | sim | a primeira é a resposta oficial; todas sempre valem |
| `acceptedAliases` | não | apelidos/abreviações; só valem com "Atalhos: Permitir" |
| `rejectedAnswers` | não | parecidas que nunca devem valer por erro de digitação |
| `hints` | não | até 3, da mais vaga à mais clara |
| `explanation`, `tags`, `source` | não | curiosidade, etiquetas livres e fonte |
| `fuzzy` | não | `false` desliga a tolerância a erros nessa pergunta |

**Validação das respostas:** maiúsculas, acentos, pontuação, espaços e artigo inicial ("o", "a", "the"…) são ignorados. A tolerância a erros de digitação é limitada: nada para nomes com menos de 6 letras, 1 erro até 10 letras, 2 acima disso, nunca quando os números diferem e nunca quando o palpite é resposta exata de outra pergunta do banco. Palpites muito próximos recebem só um aviso ("Quase!").

**Adicionar perguntas:** crie ou edite um arquivo em `data/questions/`, depois rode:

```bash
npm run validate:questions
```

```bash
npm run verify:sources
```

O primeiro aponta erros de formato, respostas reveladas no enunciado e imagens faltando, e mostra a distribuição por categoria e dificuldade. O segundo confirma na API da Wikipédia que as páginas citadas existem.

**Imagens:** use apenas arquivos do Wikimedia Commons com licença livre (domínio público, CC0, CC BY, CC BY-SA). Coloque o título do arquivo em `media.commons` e rode:

```bash
npm run fetch:media
```

O script confere a licença, baixa uma miniatura para `data/media/` e grava autor, licença e link em `media.credit` — exibidos quando a resposta é revelada. As imagens incluídas foram depois reduzidas para no máximo 840 px (JPEG), para carregarem rápido no início da rodada; o script só baixa de novo quando o arquivo falta ou quando `media.commons` muda. Se uma imagem sumir, a pergunta usa `fallbackText` (se houver) ou sai do sorteio, e falhas de carregamento no navegador ficam registradas em `logs/media-errors.log`; para o jogador afetado, a rodada não conta nas estatísticas.

**Nova categoria:** adicione `{ "id", "label", "emoji" }` em `data/categories.json` e use o id nas perguntas. Nada na lógica precisa mudar.

## Testes

```bash
npm test
```

Cobrem: respostas certas, erradas, com e sem acento, variações cadastradas, atalhos, respostas vazias, resposta depois do fim do tempo, expiração do tempo, cálculo da pontuação (10 → 1 pelo tempo), penalidade por pistas, ausência de perguntas repetidas, distribuição de dificuldade e de categorias, fim de partida em todos os modos, resultado final, falha de imagem, transições inválidas, banco insuficiente, regras da sala, anti-spoiler no chat, reconexão, partidas simuladas com o banco real em todos os modos e um teste de ponta a ponta com dois clientes WebSocket no mesmo servidor (mesma pergunta, mesmo tempo oficial, placar consistente).

## Limitações conhecidas

- **Salas em memória:** reiniciar o servidor encerra todas as salas. Não há contas nem ranking permanente.
- **Latência:** vale o horário em que o servidor recebe a resposta; quem tem conexão mais lenta chega alguns milissegundos depois.
- **Escala:** um único processo Node atende bem dezenas de salas; para muito mais, seria preciso dividir salas entre servidores.
- **Conteúdo:** as perguntas evitam acontecimentos muito recentes. Revise periodicamente respostas sobre coisas que mudam (clubes de jogadores, recordes, títulos).
- **Fontes da interface:** Quicksand e Lobster vêm do Google Fonts; sem internet, o navegador usa fontes do sistema.
