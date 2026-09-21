// src/device/zap.js
// Zapeo con confirmación por logcat y reintentos. Lo usan todos los checks.
//
// Por cada intento se mandan los números y se espera el "go to channel".
// Si llega al canal pedido, listo. Si llega a otro o el deco no
// responde, se vuelve a intentar hasta zapAttempts veces.

const keys = require('./keys');
const { measure } = require('../measurement/mediaOpenWatcher');
const { REASONS } = require('../results/reasons');

async function zapTo(canal, ctx, options = {}) {
  const { logcat, config } = ctx;

  for (let attempt = 1; attempt <= config.zapAttempts; attempt++) {
    const tag = `[zap] canal ${canal.numero} (${attempt}/${config.zapAttempts})`;
    const mark = logcat.mark();

    // LIVE mide el zapeo (video y audio estables). Los demás checks
    // solo mandan las teclas.
    let media;
    if (options.measure) {
      media = await measure(() => keys.zapToChannel(canal.numero));
    } else {
      await keys.zapToChannel(canal.numero);
    }

    const channel = await logcat.waitForChannel(mark, canal.id, config.zapConfirmTimeoutMs);

    if (channel.status === 'ok') {
      if (attempt > 1) logger.info(`${tag} llegó al canal correcto`);
      return { ok: true, attempts: attempt, media };
    }

    if (channel.status === 'wrong') {
      logger.warn(`${tag} llegó a ${channel.channelId} en vez de ${canal.id}`);
    } else {
      logger.warn(`${tag} el deco no respondió al zapeo`);
    }
  }

  return { ok: false, reason: REASONS.ZAP_FAILED, attempts: config.zapAttempts };
}

module.exports = { zapTo };