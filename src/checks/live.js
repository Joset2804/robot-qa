// src/checks/live.js
// Verifica que el canal emita video y audio al sintonizarlo.
//
// Es el check base: los demás necesitan que el canal esté cargado, así que
// el launcher lo ejecuta siempre primero y omite el resto si este falla.
//
// No usa Appium — solo zapea y escucha los analizadores de la sonda.

const keys = require('../device/keys');
const { measure } = require('../measurement/mediaOpenWatcher');
const { REASONS, reasonFromMediaResult } = require('../results/reasons');

const NAME = 'live';

// Ejecuta el check una vez, sin reintentos.
// El reintento de confirmación lo maneja el launcher.
async function attempt(canal) {
  const media = await measure(() => keys.zapToChannel(canal.numero));

  if (media.ok) {
    return {
      status: 'ok',
      durationMs: media.durationMs,
      soundMs: media.soundMs,
      blackMs: media.blackMs
    };
  }

  return {
    status: 'fail',
    reason: reasonFromMediaResult(media),
    // Se conservan las métricas parciales: si el video estabilizó pero el
    // audio no, durationMs viene vacío pero blackMs sí tiene valor y ayuda
    // a diagnosticar desde el lado de Python.
    blackMs: media.blackMs,
    dynamics: media.dynamics
  };
}

// Punto de entrada del check.
// @param canal  { numero, nombre }
// @param driver sesión Appium — no se usa acá, se recibe por uniformidad
// @returns { status, reason?, durationMs?, ... }
async function run(canal, driver) {
  try {
    return await attempt(canal);
  } catch (err) {
    logger.error(`[${NAME}] error inesperado en canal ${canal.numero}: ${err}`);
    return { status: 'fail', reason: REASONS.UNEXPECTED_ERROR };
  }
}

module.exports = { NAME, run, attempt };