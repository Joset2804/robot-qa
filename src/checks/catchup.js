// src/checks/catchup.js
// Verifica que el contenido pasado (CatchUp) reproduzca con video y audio.
//
// Es el check con más navegación. Secuencia:
//   LEFT  → abre la guía rápida sobre el LIVE
//   UP    → posiciona en el programa que se emite ahora
//   LEFT  → retrocede al programa anterior
//   OK    → abre la pantalla de detalle del programa
//   OK    → reproduce (acá se mide)
//
// Necesita el miniguide del zapeo CERRADO: con él abierto el primer LEFT
// no abre la guía rápida, simplemente no hace nada.

const keys = require('../device/keys');
const ui = require('../device/ui');
const { measure } = require('../measurement/mediaOpenWatcher');
const { REASONS, reasonFromMediaResult } = require('../results/reasons');

const NAME = 'catchup';

// Máximo de espera a que el miniguide del zapeo se cierre solo.
const HIDE_TIMEOUT = 10000;

// Espera tras cada tecla de navegación para que la UI reaccione.
const NAV_DELAY = 1500;

// Espera tras el primer OK, para que la pantalla de detalle del programa
// cargue su botón de reproducir.
const DETAIL_DELAY = 3000;

// Espera tras el último OK, para que la reproducción se estabilice.
const SETTLE_DELAY = 2000;

async function attempt(canal, driver) {
  // Con el miniguide abierto el LEFT no abre la guía rápida
  const hidden = await ui.waitMiniguideHidden(driver, HIDE_TIMEOUT);

  if (!hidden) {
    return { status: 'fail', reason: REASONS.MINIGUIDE_STUCK };
  }

  // Navegar hasta el programa anterior del canal
  await keys.left();
  await sleep(NAV_DELAY);

  await keys.up();
  await sleep(NAV_DELAY);

  await keys.left();
  await sleep(NAV_DELAY);

  // Abrir el detalle del programa
  await keys.ok();
  await sleep(DETAIL_DELAY);

  // Pausa adicional para que los eventos de video y audio generados por
  // la navegación (LEFT, UP, LEFT, OK) terminen de emitirse antes de
  // arrancar la medición. Sin esto el watcher captura eventos residuales
  // y reporta duraciones inconsistentes entre corridas.
  await sleep(SETTLE_DELAY);

  // Reproducir y medir
  const media = await measure(() => keys.ok());

  if (media.ok) {
    return {
      status: 'ok',
      durationMs: media.durationMs,
      soundMs: media.soundMs,
      blackMs: media.blackMs,
      dynamics: media.dynamics
    };
  }

  return {
    status: 'fail',
    reason: reasonFromMediaResult(media),
    soundMs: media.soundMs,
    blackMs: media.blackMs,
    dynamics: media.dynamics
  };
}

async function run(canal, driver) {
  try {
    return await attempt(canal, driver);
  } catch (err) {
    logger.error(`[${NAME}] error inesperado en canal ${canal.numero}: ${err}`);
    return { status: 'fail', reason: REASONS.UNEXPECTED_ERROR };
  }
}

module.exports = { NAME, run, attempt };