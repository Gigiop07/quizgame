// Conexão WebSocket com reconexão automática e sincronia de relógio com o servidor.
// O tempo oficial das rodadas é sempre o do servidor; o navegador só estima a diferença
// entre os relógios para mostrar a contagem regressiva certa.

export class ServerClock {
  constructor() {
    this.samples = [];
    this.offset = 0;
  }

  /** Amostra de ping/pong: servidor respondeu `serverTime` para um ping enviado em `sentAt`. */
  addSample(sentAt, serverTime, receivedAt = Date.now()) {
    const rtt = receivedAt - sentAt;
    this.samples.push({ rtt, offset: serverTime - (sentAt + rtt / 2) });
    this.samples = this.samples.sort((a, b) => a.rtt - b.rtt).slice(0, 5);
    // as amostras de menor latência são as mais confiáveis
    const best = this.samples.slice(0, 3).map((s) => s.offset).sort((a, b) => a - b);
    this.offset = best[Math.floor(best.length / 2)];
  }

  /** Usado antes do primeiro pong: aproxima pela hora enviada junto com o estado. */
  roughSync(serverNow) {
    if (this.samples.length === 0) this.offset = serverNow - Date.now();
  }

  now() {
    return Date.now() + this.offset;
  }
}

export class Connection {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.clock = new ServerClock();
    this.socket = null;
    this.hello = null;
    this.retries = 0;
    this.pingTimer = null;
    this.closedByUser = false;
  }

  connect(hello) {
    this.hello = hello;
    this.closedByUser = false;
    this.open();
  }

  open() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.socket = socket;
    this.onStatus?.('connecting');

    socket.addEventListener('open', () => {
      this.retries = 0;
      this.onStatus?.('open');
      this.send(this.hello);
      this.startPings();
    });
    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        this.clock.addSample(msg.clientTime, msg.serverTime);
        return;
      }
      if (msg.t === 'state') this.clock.roughSync(msg.serverNow);
      this.onMessage(msg);
    });
    socket.addEventListener('close', (event) => {
      this.stopPings();
      if (this.closedByUser || event.code === 4004) {
        this.onStatus?.('closed');
        return;
      }
      this.onStatus?.('reconnecting');
      const delay = Math.min(8000, 500 * 2 ** this.retries++);
      setTimeout(() => this.open(), delay);
    });
  }

  /** Atualiza os dados de reconexão (ex.: token recebido do servidor). */
  updateHello(changes) {
    this.hello = { ...this.hello, ...changes };
  }

  send(msg) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  startPings() {
    this.stopPings();
    let burst = 0;
    const ping = () => this.send({ t: 'ping', clientTime: Date.now() });
    ping();
    // algumas amostras rápidas no início, depois uma a cada 10 s
    this.pingTimer = setInterval(() => {
      ping();
      if (++burst === 4) {
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(ping, 10_000);
      }
    }, 400);
  }

  stopPings() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  close() {
    this.closedByUser = true;
    this.socket?.close();
  }
}
