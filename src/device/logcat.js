// src/device/logcat.js
// Lectura del logcat del deco. Por ahora solo guarda las líneas de
// cambio de canal ("go to channel: st-..."), que el zapeo usa para
// confirmar a qué canal llegó.
//
// Las consultas usan una marca (mark) en vez de fechas: el orden de
// llegada es confiable y no depende de la zona horaria del campo dte.

const MAX_ENTRIES = 500;
const POLL_MS = 200;

class Logcat {
  constructor() {
    this.channels = [];
    this.seq = 0;
    this.collector = null;
    this.listener = (event) => this.onLog(event);
  }

  start() {
    this.collector = devices.STB0.logCollectors.Logcat;
    this.collector.on('log', this.listener);
    logger.info('[logcat] suscrito');
  }

  stop() {
    if (!this.collector) return;
    this.collector.removeListener('log', this.listener);
    this.collector = null;
    logger.info('[logcat] desuscrito');
  }

  // Posición actual. waitForChannel solo mira lo que llegue después.
  mark() {
    return this.seq;
  }

  onLog(event) {
    const line = event && event.pyd;

    // El logcat emite ~90 eventos por segundo: descarte rápido
    if (!line || line.indexOf('go to channel') === -1) return;

    const match = line.match(/go to channel:\s*(st-\d+)/);
    if (!match) return;

    this.channels.push({ seq: ++this.seq, channelId: match[1] });
    if (this.channels.length > MAX_ENTRIES) this.channels.shift();
  }

  // Espera el primer "go to channel" posterior a la marca.
  // Devuelve { status: 'ok' | 'wrong' | 'none', channelId }
  async waitForChannel(mark, expectedId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const next = this.channels.find(c => c.seq > mark);
      if (next) {
        const ok = !expectedId || next.channelId === expectedId;
        return { status: ok ? 'ok' : 'wrong', channelId: next.channelId };
      }
      await sleep(POLL_MS);
    }

    return { status: 'none' };
  }
}

module.exports = Logcat;