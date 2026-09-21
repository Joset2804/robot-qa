// src/checks/epg.js
// Verifica que el canal tenga título de programa en el miniguide.
//
// Por intento: esperar que el miniguide del zapeo se cierre, abrirlo con
// OK y leer el título. Si no se logra leer nada, se reintenta hasta
// epgReadAttempts veces: un miniguide que no abre o que tarda en mostrar
// el título es un problema de la UI, no del EPG del canal.
//
// No mide video ni audio.

const keys = require('../device/keys');
const ui = require('../device/ui');
const { REASONS } = require('../results/reasons');

const NAME = 'epg';

// Textos con los que el deco indica que no hay guía.
// Se comparan en minúsculas; se incluye la variante sin tilde.
const NO_EPG_TEXTS = ['sin información', 'sin informacion'];

// Máximo de espera a que el miniguide del zapeo se cierre solo
const HIDE_TIMEOUT = 10000;

// Máximo de espera a que el miniguide aparezca tras presionar OK
const SHOW_TIMEOUT = 5000;

// Pausa entre un intento de lectura y el siguiente
const READ_RETRY_DELAY = 1000;

// Un intento de lectura. Devuelve { title } si leyó algo (aunque sea
// vacío), o { reason } si no llegó a leer.
async function readOnce(driver) {
  // Con el miniguide abierto, el OK lo cerraría en vez de abrirlo
  const hidden = await ui.waitMiniguideHidden(driver, HIDE_TIMEOUT);
  if (!hidden) return { reason: REASONS.MINIGUIDE_STUCK };

  await keys.ok();

  const visible = await ui.waitMiniguideVisible(driver, SHOW_TIMEOUT);
  if (!visible) return { reason: REASONS.MINIGUIDE_TIMEOUT };

  const title = await ui.readProgramTitle(driver);
  if (title === undefined) return { reason: REASONS.TITLE_NOT_FOUND };

  return { title: title.trim() };
}

async function attempt(canal, driver, ctx) {
  const maxReads = ctx.config.epgReadAttempts;
  let last;

  for (let i = 1; i <= maxReads; i++) {
    last = await readOnce(driver);

    // Leyó un título o "Sin información": respuesta válida, se termina
    if (last.title) {
      const noEpg = NO_EPG_TEXTS.includes(last.title.toLowerCase());

      if (noEpg) {
        return { status: 'fail', reason: REASONS.NO_EPG, title: last.title, readAttempts: i };
      }
      return { status: 'ok', title: last.title, readAttempts: i };
    }

    const why = last.reason || REASONS.EMPTY_TITLE;
    logger.warn(`[${NAME}] canal ${canal.numero} lectura ${i}/${maxReads} sin título (${why})`);

    if (i < maxReads) await sleep(READ_RETRY_DELAY);
  }

  // El miniguide abrió y el campo existe, pero siempre vino vacío:
  // es el EPG del canal
  if (last.title === '') {
    return { status: 'fail', reason: REASONS.EMPTY_TITLE, title: '', readAttempts: maxReads };
  }

  // No se llegó a leer: problema de la UI, no del canal
  return { status: 'skipped', reason: last.reason, readAttempts: maxReads };
}

async function run(canal, driver, ctx) {
  try {
    return await attempt(canal, driver, ctx);
  } catch (err) {
    logger.error(`[${NAME}] error inesperado en canal ${canal.numero}: ${err}`);
    return { status: 'fail', reason: REASONS.UNEXPECTED_ERROR };
  }
}

module.exports = { NAME, run, attempt };