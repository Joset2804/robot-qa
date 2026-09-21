// src/checks/live.js
// Verifica que el canal emita video y audio al sintonizarlo.
//
// El zapeo se confirma por logcat: si cae en otro canal se reintenta,
// y solo se mide el intento que llegó al canal correcto.

const zap = require('../device/zap');
const { REASONS, reasonFromMediaResult } = require('../results/reasons');

const NAME = 'live';

async function attempt(canal, ctx) {
  const z = await zap.zapTo(canal, ctx, { measure: true });

  // No se llegó al canal: no se pudo probar, no es un fallo del canal
  if (!z.ok) {
    return { status: 'skipped', reason: z.reason, zapAttempts: z.attempts };
  }

  const media = z.media;

  if (media.ok) {
    return {
      status: 'ok',
      zapAttempts: z.attempts,
      durationMs: media.durationMs,
      soundMs: media.soundMs,
      blackMs: media.blackMs,
      dynamics: media.dynamics
    };
  }

  return {
    status: 'fail',
    reason: reasonFromMediaResult(media),
    zapAttempts: z.attempts,
    soundMs: media.soundMs,
    blackMs: media.blackMs,
    dynamics: media.dynamics
  };
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