// src/device/logcat.js
// Lectura del logcat del deco.
//
// Guarda solo las líneas útiles:
//   - "go to channel: st-..." → a qué canal se zapeó
//   - "onPlaybackEvent(...)"  → modo, estado y URL de la reproducción
// El logcat emite ~90 eventos por segundo; el resto se descarta al llegar.
//
// Las consultas usan una marca (mark) en vez de fechas: el orden de
// llegada es confiable y no depende de la zona horaria del campo dte.
//
// Regla clave: cada evento reporta el estado del reproductor EN EL MOMENTO
// del evento. Al zapear, los primeros eventos todavía describen lo que se
// estaba reproduciendo; la reproducción nueva empieza después de un evento
// con state[Stopped].

const MAX_ENTRIES = 3000;
const POLL_MS = 200;

function pick(text, regex) {
  const m = text.match(regex);
  return m ? m[1] : undefined;
}

// Extrae los campos de un evento de reproducción.
function parsePlayback(line) {
  const event = pick(line, /event\[([^\]]*)\]/);
  if (!event) return null;

  const type = pick(line, /type\[([^\]]*)\]/);
  const url = pick(line, /playbackUrl\[([^\]]*)\]/) || '';
  const position = Number(pick(line, /[{,]position\[(-?\d+)\]/));

  return {
    kind: 'playback',
    event,
    type: type && type !== 'null' ? type : null,
    state: pick(line, /state\[([^\]]*)\]/) || null,
    url,
    // securelive / securestartover / securecatchup
    host: pick(url, /^https?:\/\/(secure[a-z]+)\./) || null,
    // Número de la URL (/2277/): identifica al canal en los tres modos
    serviceId: pick(url, /\.net\/(\d+)\//) || null,
    // Milisegundos reproducidos dentro del programa
    position: Number.isFinite(position) ? position : null
  };
}

class Logcat {
  constructor() {
    this.entries = [];
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

  // Posición actual. Las consultas solo miran lo que llegue después.
  mark() {
    return this.seq;
  }

  onLog(event) {
    const line = event && event.pyd;

    // Descarte rápido: las líneas útiles son todas de la app
    if (!line || line.indexOf('entel.') === -1) return;

    let entry;
    const channelId = pick(line, /go to channel:\s*(st-\d+)/);

    if (channelId) {
      entry = { kind: 'channel', channelId };
    } else if (line.indexOf('onPlaybackEvent') !== -1) {
      entry = parsePlayback(line);
    }

    if (!entry) return;

    entry.seq = ++this.seq;
    entry.receivedAt = Date.now();
    this.entries.push(entry);

    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
  }

  since(mark) {
    return this.entries.filter(e => e.seq > mark);
  }

  // Espera el primer "go to channel" posterior a la marca.
  // Devuelve { status: 'ok' | 'wrong' | 'none', channelId }
  async waitForChannel(mark, expectedId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const next = this.since(mark).find(e => e.kind === 'channel');
      if (next) {
        const ok = !expectedId || next.channelId === expectedId;
        return { status: ok ? 'ok' : 'wrong', channelId: next.channelId };
      }
      await sleep(POLL_MS);
    }

    return { status: 'none' };
  }

  // Lo que se estaba reproduciendo al momento de zapear: el primer evento
  // con modo y URL posterior a la marca, antes del reset.
  outgoingAfter(mark) {
    for (const e of this.since(mark)) {
      if (e.kind !== 'playback') continue;
      if (e.state === 'Stopped') return null;
      if (e.type && e.url) return e;
    }
    return null;
  }

  // El LIVE que arranca tras el zapeo: el primer Started con URL después
  // del último reset. Si hubo varios intentos de zapeo, el último reset
  // es el del intento que llegó.
  incomingLiveAfter(mark) {
    const events = this.since(mark).filter(e => e.kind === 'playback');

    let lastReset = -1;
    events.forEach((e, i) => {
      if (e.state === 'Stopped') lastReset = i;
    });
    if (lastReset === -1) return null;

    for (let i = lastReset + 1; i < events.length; i++) {
      const e = events[i];
      if (e.state === 'Started' && e.type === 'LiveTvOtt' && e.url) return e;
    }
    return null;
  }

  // Último LIVE con URL posterior a la marca, reinicio o no.
  lastLiveAfter(mark) {
    const events = this.since(mark);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'playback' && e.state === 'Started' && e.type === 'LiveTvOtt' && e.url) {
        return e;
      }
    }
    return null;
  }

  // Espera el LIVE que queda tras el zapeo y devuelve su número.
  //
  // Caso normal: el reproductor se reinicia (evento Stopped) y el LIVE
  // nuevo llega después.
  //
  // Caso sin reinicio: al zapear al mismo LIVE que ya se reproducía, el
  // deco no reinicia el reproductor. Si el logcat queda quietMs en
  // silencio sin mostrar un reset, se toma el LIVE vigente: como el zapeo
  // ya confirmó el canal, ese LIVE es el del canal.
  async waitForIncomingLive(mark, timeoutMs, quietMs = 3000) {
    const start = Date.now();

    while (true) {
      const found = this.incomingLiveAfter(mark);
      if (found) return Object.assign({}, found, { restarted: true });

      const events = this.since(mark).filter(e => e.kind === 'playback');
      const hadReset = events.some(e => e.state === 'Stopped');
      const lastArrival = events.length > 0 ? events[events.length - 1].receivedAt : start;
      const now = Date.now();

      if (!hadReset && now - lastArrival >= quietMs) {
        const current = this.lastLiveAfter(mark);
        return current ? Object.assign({}, current, { restarted: false }) : null;
      }

      if (now - start >= timeoutMs) return null;
      await sleep(POLL_MS);
    }
  }
}

module.exports = Logcat;