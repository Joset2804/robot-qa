// src/checks/catchup.js
// Verifica que el catchup (programa anterior) reproduzca, del canal
// correcto, con video y audio.
//
//   1. Navegación (hasta navAttempts intentos):
//        esperar el ciclo del miniguide del zapeo
//        LEFT → UP → LEFT → OK, con esperas fijas entre teclas
//        confirmar que apareció el botón "Reproducir"
//      Si no aparece, se zapea al canal y se reintenta.
//   2. OK: empieza el catchup; se mide video y audio
//   3. Dejarlo reproducir catchupPlaySec desde el OK
//   4. Zapeo de salida: el primer evento del logcat reporta lo que se
//      estaba reproduciendo, y el LIVE que llega después trae el número
//      del canal

const keys = require('../device/keys');
const ui = require('../device/ui');
const zap = require('../device/zap');
const miniguide = require('../device/miniguide');
const { measure } = require('../measurement/mediaOpenWatcher');
const { REASONS, reasonFromMediaResult } = require('../results/reasons');

const NAME = 'catchup';

// Máximo de espera al LIVE que llega tras el zapeo de salida
const INCOMING_TIMEOUT_MS = 10000;

// Veredicto a partir de lo que reportó la salida.
//
// Principio: fail solo cuando la salida prueba que se reprodujo el
// catchup del canal correcto y aun así falló el video, el audio o el
// avance. Si la salida no demuestra que estábamos en el lugar correcto,
// es la interfaz: skipped, se reintenta desde el zapeo y no alerta.
function judge(outgoing, incoming, media) {
  if (!outgoing || !incoming) {
    return { status: 'skipped', reason: REASONS.NO_PLAYBACK_LOG };
  }

  const sameNumber = outgoing.serviceId === incoming.serviceId;

  if (outgoing.host === 'securecatchup') {
    if (!sameNumber) {
      return { status: 'skipped', reason: REASONS.WRONG_CHANNEL, retryable: true };
    }

    // Desde acá está confirmado el catchup del canal: los fallos son reales

    if (!(outgoing.position > 0)) {
      return { status: 'fail', reason: REASONS.NO_VIDEO };
    }

    if (!media.ok) {
      return { status: 'fail', reason: reasonFromMediaResult(media) };
    }

    return { status: 'ok' };
  }

  if (outgoing.host === 'securelive') {
    // Siguió en el LIVE del canal: puede ser el servicio o el OK cayó en
    // otro botón, no se puede saber
    if (sameNumber) {
      return { status: 'skipped', reason: REASONS.CATCHUP_NOT_STARTED, retryable: true };
    }
    // En LIVE de otro canal: la navegación cambió de canal
    return { status: 'skipped', reason: REASONS.WRONG_CHANNEL, retryable: true };
  }

  // securestartover u otro: la navegación eligió otra opción
  return { status: 'skipped', reason: REASONS.WRONG_MODE, retryable: true };
}

// Navega hasta la pantalla de detalle del programa anterior.
// Devuelve { ok, attempts, reason? }
async function navigate(canal, ctx) {
  const { driver, config } = ctx;

  for (let attempt = 1; attempt <= config.navAttempts; attempt++) {
    const tag = `[${NAME}] canal ${canal.numero} navegación ${attempt}/${config.navAttempts}`;

    // El primer intento parte del zapeo del launcher. Los siguientes
    // vuelven a zapear: el intento fallido pudo dejar el deco en la guía,
    // en una pantalla de detalle o en otro canal.
    if (attempt > 1) {
      const z = await zap.zapTo(canal, ctx);
      if (!z.ok) return { ok: false, attempts: attempt, reason: z.reason };
    }

    await miniguide.waitCycle(driver, tag);

    // Tiempos fijos, sin consultas a Appium entre teclas: cada consulta
    // retrasa la siguiente tecla y la lista se cierra sola a los ~4 s
    await keys.left();
    await sleep(config.catchupGuideOpenMs);
    await keys.up();
    await sleep(config.catchupStepMs);
    await keys.left();
    await sleep(config.catchupStepMs);
    await keys.ok();

    const screen = await ui.waitDetailScreen(driver, config.catchupDetailTimeoutMs);

    if (screen.play) {
      if (attempt > 1) logger.info(`${tag} llegó a "Reproducir"`);
      return { ok: true, attempts: attempt };
    }

    // Llegó a la pantalla del programa anterior, pero no ofrece
    // reproducirlo: ese programa no tiene catchup. No es un problema
    // de navegación, así que no tiene sentido reintentar.
    if (screen.detail) {
      logger.warn(`${tag} detalle del programa detectado (details_title) pero sin botón "Reproducir": el programa no tiene catchup`);
      return { ok: false, attempts: attempt, noCatchup: true };
    }

    logger.warn(`${tag} no se detectó la pantalla de detalle (sin details_title): la navegación no llegó`);
  }

  return { ok: false, attempts: config.navAttempts, reason: REASONS.PLAY_BUTTON_NOT_FOUND };
}

async function attempt(canal, ctx) {
  const { logcat, config } = ctx;
  const tag = `[${NAME}] canal ${canal.numero}`;

  // 1. Navegación hasta "Reproducir"
  const nav = await navigate(canal, ctx);
  if (!nav.ok) {
    // Llegó a la pantalla y el programa no ofrece catchup: es un hallazgo
    // del servicio, no de la automatización
    if (nav.noCatchup) {
      return {
        status: 'fail',
        reason: REASONS.NO_CATCHUP_AVAILABLE,
        final: true,
        navAttempts: nav.attempts
      };
    }

    // retryable: el launcher lo volverá a intentar desde el zapeo
    return { status: 'skipped', reason: nav.reason, retryable: true, navAttempts: nav.attempts };
  }

  // 2. Reproducir, midiendo video y audio
  const okAt = Date.now();
  const media = await measure(() => keys.ok());

  // 3. Completar el tiempo de reproducción desde el OK. La medición ocurre
  //    dentro de este tiempo (máximo 18 s), así que no suma espera.
  const remaining = config.catchupPlaySec * 1000 - (Date.now() - okAt);
  if (remaining > 0) await sleep(remaining);

  // 4. Zapeo de salida. La marca va antes: el primer evento posterior
  //    reporta lo que se estaba reproduciendo.
  const mark = logcat.mark();
  const exit = await zap.zapTo(canal, ctx);
  if (!exit.ok) {
    return { status: 'skipped', reason: exit.reason, navAttempts: nav.attempts };
  }

  // Primero el LIVE entrante: cuando llega, el saliente ya está en el buffer
  const incoming = await logcat.waitForIncomingLive(mark, INCOMING_TIMEOUT_MS);
  const outgoing = logcat.outgoingAfter(mark);

  const seen = outgoing
    ? `${outgoing.host} /${outgoing.serviceId}/ position=${outgoing.position}`
    : 'sin evento';
  logger.info(`${tag} salida: ${seen} | canal /${incoming ? incoming.serviceId : '-'}/`);

  const result = Object.assign(judge(outgoing, incoming, media), {
    navAttempts: nav.attempts,
    observedMode: outgoing ? outgoing.host : undefined,
    serviceId: incoming ? incoming.serviceId : undefined,
    position: outgoing ? outgoing.position : undefined
  });

  // La medición solo se reporta si la salida confirmó el catchup
  if (outgoing && outgoing.host === 'securecatchup') {
    result.durationMs = media.durationMs;
    result.soundMs = media.soundMs;
    result.blackMs = media.blackMs;
    result.dynamics = media.dynamics;
  }

  return result;
}

async function run(canal, driver, ctx) {
  try {
    return await attempt(canal, ctx);
  } catch (err) {
    logger.error(`[${NAME}] error inesperado en canal ${canal.numero}: ${err}`);
    return { status: 'fail', reason: REASONS.UNEXPECTED_ERROR };
  }
}

module.exports = { NAME, run, attempt };