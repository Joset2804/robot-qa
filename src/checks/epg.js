// src/checks/epg.js
// Verifica que el canal tenga título de programa en el miniguide.
//
// No mide video ni audio — solo lee texto. Por eso no devuelve durationMs.
//
// Secuencia: esperar que el miniguide del zapeo se cierre, invocarlo con OK,
// leer el título. Si se presionara OK con el miniguide abierto se cerraría
// en vez de abrirse.

const keys = require('../device/keys');
const ui = require('../device/ui');
const { REASONS } = require('../results/reasons');

const NAME = 'epg';

// Textos que el deco muestra cuando no hay información de guía.
// Se comparan en minúsculas para no depender de acentos ni mayúsculas.
const NO_EPG_TEXTS = ['sin información', 'sin informacion'];

// Máximo de espera a que el miniguide del zapeo se cierre solo.
const HIDE_TIMEOUT = 10000;

// Máximo de espera a que el miniguide aparezca tras presionar OK.
const SHOW_TIMEOUT = 5000;

// Clasifica el título leído.
function classify(title) {
  if (title === undefined) {
    return { status: 'fail', reason: REASONS.TITLE_NOT_FOUND };
  }

  const trimmed = title.trim();

  if (trimmed.length === 0) {
    return { status: 'fail', reason: REASONS.EMPTY_TITLE, title: '' };
  }

  if (NO_EPG_TEXTS.includes(trimmed.toLowerCase())) {
    return { status: 'fail', reason: REASONS.NO_EPG, title: trimmed };
  }

  return { status: 'ok', title: trimmed };
}

async function attempt(canal, driver) {
  // El miniguide del zapeo tiene que haberse cerrado para poder invocarlo
  const hidden = await ui.waitMiniguideHidden(driver, HIDE_TIMEOUT);

  if (!hidden) {
    return { status: 'fail', reason: REASONS.MINIGUIDE_STUCK };
  }

  await keys.ok();

  const visible = await ui.waitMiniguideVisible(driver, SHOW_TIMEOUT);

  if (!visible) {
    return { status: 'fail', reason: REASONS.MINIGUIDE_TIMEOUT };
  }

  const title = await ui.readProgramTitle(driver);

  return classify(title);
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