// src/device/miniguide.js
// Abrir el miniguide "desde cerrado", con reintentos.
//
// Tras un zapeo el miniguide aparece solo y dura unos segundos. Para
// navegar desde él de forma predecible, se espera a que se cierre y se
// abre de nuevo con OK. Cada paso se confirma con Appium:
//   - si no se cierra → BACK para cerrarlo, y se reintenta
//   - si no se abre tras el OK → se reintenta
// Hasta navAttempts intentos.

const keys = require('./keys');
const ui = require('./ui');
const { REASONS } = require('../results/reasons');

// Máximo de espera a que el miniguide del zapeo se cierre solo
const HIDE_TIMEOUT_MS = 10000;

// Máximo de espera a que aparezca tras presionar OK
const SHOW_TIMEOUT_MS = 5000;

// Pausa entre un intento y el siguiente
const RETRY_PAUSE_MS = 1000;

// Máximo de espera a que aparezca el miniguide del zapeo
const APPEAR_TIMEOUT_MS = 6000;

// Margen tras el cierre, para que termine la animación
const CLOSE_MARGIN_MS = 1000;

// Devuelve { ok, attempts, reason? }
// options.hideTimeoutMs / showTimeoutMs permiten acortar las esperas
// en pruebas; options.tag es el prefijo de los logs.
async function openFresh(driver, config, options = {}) {
  const hideTimeout = options.hideTimeoutMs || HIDE_TIMEOUT_MS;
  const showTimeout = options.showTimeoutMs || SHOW_TIMEOUT_MS;
  const tag = options.tag || '[miniguide]';
  let reason;

  for (let attempt = 1; attempt <= config.navAttempts; attempt++) {
    const hidden = await ui.waitMiniguideHidden(driver, hideTimeout);

    if (!hidden) {
      // Solo se presiona BACK con el miniguide confirmado abierto:
      // así lo cierra y no hace otra cosa en el LIVE
      logger.warn(`${tag} intento ${attempt}/${config.navAttempts}: el miniguide no se cerró — BACK`);
      await keys.back();
      reason = REASONS.MINIGUIDE_STUCK;
      await sleep(RETRY_PAUSE_MS);
      continue;
    }

    await keys.ok();

    if (await ui.waitMiniguideVisible(driver, showTimeout)) {
      if (attempt > 1) logger.info(`${tag} miniguide abierto en el intento ${attempt}`);
      return { ok: true, attempts: attempt };
    }

    logger.warn(`${tag} intento ${attempt}/${config.navAttempts}: el miniguide no abrió`);
    reason = REASONS.MINIGUIDE_TIMEOUT;
    await sleep(RETRY_PAUSE_MS);
  }

  return { ok: false, attempts: config.navAttempts, reason };
}

// El miniguide del zapeo tarda un momento en aparecer. Si solo se espera
// a que "no esté", puede darse por cerrado antes de que aparezca, y las
// teclas siguientes caen sobre él. Se espera verlo aparecer y después
// cerrarse, con un margen para la animación.
async function waitCycle(driver, tag) {
  const appeared = await ui.waitMiniguideVisible(driver, APPEAR_TIMEOUT_MS);
  if (!appeared) {
    logger.info(`${tag} el miniguide no apareció tras el zapeo`);
  }

  const hidden = await ui.waitMiniguideHidden(driver, HIDE_TIMEOUT_MS);
  if (!hidden) {
    logger.warn(`${tag} el miniguide no se cerró — BACK`);
    await keys.back();
    await sleep(RETRY_PAUSE_MS);
  }

  await sleep(CLOSE_MARGIN_MS);
}

module.exports = { openFresh, waitCycle };