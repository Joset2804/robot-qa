// src/checks/startOver.js
// Verifica que el Start Over reproduzca, del canal correcto, con video y audio.
//
// Por prueba:
//   1. Abrir el miniguide "desde cerrado" (con reintentos)
//   2. RIGHT → OK: empieza el Start Over; se mide video y audio
//   3. Dejarlo reproducir startOverPlaySec desde el OK
//   4. Zapeo de salida al mismo canal: el primer evento del logcat reporta
//      lo que se estaba reproduciendo, y el LIVE que llega después trae el
//      número del canal
//
// El Start Over no siempre emite su propio evento al arrancar: se reporta
// al salir de él. Por eso la verificación se hace a la salida.
//
// Si la salida muestra que seguía en el LIVE, el programa puede haber
// empezado hace muy poco: se completa startOverMinLiveSec desde el inicio
// del check y se repite una vez.

const keys = require('../device/keys');
const zap = require('../device/zap');
const miniguide = require('../device/miniguide');
const { measure } = require('../measurement/mediaOpenWatcher');
const { REASONS, reasonFromMediaResult } = require('../results/reasons');

const NAME = 'startOver';

// Espera tras el RIGHT para que el foco se asiente en Start Over
const FOCUS_DELAY_MS = 800;

// Máximo de espera al LIVE que llega tras el zapeo de salida
const INCOMING_TIMEOUT_MS = 10000;

// Veredicto a partir de lo que reportó la salida.
//
// Principio: fail solo cuando la salida prueba que se reprodujo el
// Start Over del canal correcto y aun así falló el video, el audio o el
// avance. Si la salida no demuestra que estábamos en el lugar correcto,
// es la interfaz: skipped, se reintenta desde el zapeo y no alerta.
function judge(outgoing, incoming, media) {
  if (!outgoing || !incoming) {
    return { status: 'skipped', reason: REASONS.NO_PLAYBACK_LOG };
  }

  const sameNumber = outgoing.serviceId === incoming.serviceId;

  if (outgoing.host === 'securelive') {
    // Seguía en el LIVE del canal: el Start Over no arrancó
    if (sameNumber) return { notStarted: true };
    // En LIVE de otro canal: la navegación cambió de canal
    return { status: 'skipped', reason: REASONS.WRONG_CHANNEL, retryable: true };
  }

  if (outgoing.host !== 'securestartover') {
    // La navegación eligió otra opción
    return { status: 'skipped', reason: REASONS.WRONG_MODE, retryable: true };
  }

  if (!sameNumber) {
    return { status: 'skipped', reason: REASONS.WRONG_CHANNEL, retryable: true };
  }

  // Desde acá está confirmado el Start Over del canal: los fallos son reales

  if (!(outgoing.position > 0)) {
    return { status: 'fail', reason: REASONS.NO_VIDEO };
  }

  if (!media.ok) {
    return { status: 'fail', reason: reasonFromMediaResult(media) };
  }

  return { status: 'ok' };
}

// Una prueba completa de Start Over.
async function tryOnce(canal, ctx, tag) {
  const { driver, logcat, config } = ctx;

  // 1. Miniguide abierto desde cerrado
  const nav = await miniguide.openFresh(driver, config, { tag });
  if (!nav.ok) {
    // retryable: el launcher lo volverá a intentar desde el zapeo
    return { status: 'skipped', reason: nav.reason, retryable: true, navAttempts: nav.attempts };
  }

  // 2. Foco en Start Over → OK, midiendo video y audio
  await keys.right();
  await sleep(FOCUS_DELAY_MS);

  const okAt = Date.now();
  const media = await measure(() => keys.ok());

  // 3. Completar el tiempo de reproducción desde el OK. La medición ocurre
  //    dentro de este tiempo (máximo 18 s), así que no suma espera.
  const remaining = config.startOverPlaySec * 1000 - (Date.now() - okAt);
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

  // La medición solo se reporta si la salida confirmó el Start Over
  if (outgoing && outgoing.host === 'securestartover') {
    result.durationMs = media.durationMs;
    result.soundMs = media.soundMs;
    result.blackMs = media.blackMs;
    result.dynamics = media.dynamics;
  }

  return result;
}

async function attempt(canal, ctx) {
  const checkStart = Date.now();
  const tag = (n) => `[${NAME}] canal ${canal.numero} prueba ${n}`;

  const first = await tryOnce(canal, ctx, tag(1));
  if (!first.notStarted) {
    return Object.assign(first, { startOverTries: 1 });
  }

  // No arrancó: puede ser que el programa recién empezó.
  // Completar startOverMinLiveSec desde el inicio del check y repetir.
  const wait = ctx.config.startOverMinLiveSec * 1000 - (Date.now() - checkStart);
  logger.info(`[${NAME}] canal ${canal.numero} el Start Over no arrancó — esperando ${Math.max(0, Math.round(wait / 1000))} s para repetir`);
  if (wait > 0) await sleep(wait);

  const second = await tryOnce(canal, ctx, tag(2));

  if (second.notStarted) {
    delete second.notStarted;

    return Object.assign(second, {
      status: 'skipped',
      reason: REASONS.STARTOVER_UNAVAILABLE,
      startOverTries: 2
    });
  }

  return Object.assign(second, { startOverTries: 2 });
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