// src/device/zap.js
// Zapeo con confirmación por logcat y reintentos. Lo usan todos los checks.
//
// Por cada intento:
//   1. Si el deco está en otra app (YouTube, Netflix) → HOME
//   2. Mandar los números
//   3. Esperar el "go to channel" y comparar con el id del canal
// Si llega a otro canal o el deco no responde, se vuelve a intentar
// hasta zapAttempts veces.

const keys = require('./keys');
const ui = require('./ui');
const { measure } = require('../measurement/mediaOpenWatcher');
const { REASONS } = require('../results/reasons');

// Antes de zapear, el deco tiene que estar donde los números sintonizan.
// Dos casos donde no:
//   - otra app al frente (YouTube, Netflix): no procesa los números
//   - la guía de canales: los números mueven el cursor sin sintonizar
// En ambos se presiona HOME para volver.
// Devuelve { ok, reason? }
async function ensureCanZap(driver, config, tag) {
  const pkg = await ui.currentPackage(driver);
  const outside = !!pkg && pkg !== ui.LAUNCHER_PACKAGE;

  // La guía es parte del launcher: solo se revisa si estamos en él
  const inGuide = !outside && await ui.isGuideOpen(driver);

  if (!outside && !inGuide) return { ok: true };

  const where = outside ? `fuera del launcher (${pkg})` : 'en la guía de canales';
  logger.warn(`${tag} ${where} — presionando HOME`);

  await keys.home();
  await sleep(config.homeRecoveryWaitMs);

  const after = await ui.currentPackage(driver);
  if (after && after !== ui.LAUNCHER_PACKAGE) {
    logger.warn(`${tag} sigue fuera del launcher (${after})`);
    return { ok: false, reason: REASONS.OUTSIDE_LAUNCHER };
  }

  if (await ui.isGuideOpen(driver)) {
    logger.warn(`${tag} sigue en la guía de canales`);
    return { ok: false, reason: REASONS.STUCK_IN_GUIDE };
  }

  return { ok: true };
}

async function zapTo(canal, ctx, options = {}) {
  const { driver, logcat, config } = ctx;
  let reason = REASONS.ZAP_FAILED;

  for (let attempt = 1; attempt <= config.zapAttempts; attempt++) {
    const tag = `[zap] canal ${canal.numero} (${attempt}/${config.zapAttempts})`;

    const ready = await ensureCanZap(driver, config, tag);
    if (!ready.ok) {
      reason = ready.reason;
      continue;
    }

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

    reason = REASONS.ZAP_FAILED;

    if (channel.status === 'wrong') {
      logger.warn(`${tag} llegó a ${channel.channelId} en vez de ${canal.id}`);
    } else {
      logger.warn(`${tag} el deco no respondió al zapeo`);
    }
  }

  return { ok: false, reason, attempts: config.zapAttempts };
}

module.exports = { zapTo };