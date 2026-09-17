// src/checks/startOver.js
// Verifica que el Start Over reproduzca con video y audio.
//
// Secuencia: asegurar que el miniguide esté visible, RIGHT para mover el
// foco a la opción Start Over, OK para confirmar, y medir el resultado.
//
// A diferencia de epg.js, este check necesita el miniguide ABIERTO.
// Tras el zapeo aparece solo y dura unos segundos, así que puede seguir
// visible o ya haberse cerrado: ensureMiniguide cubre los dos casos.

const keys = require('../device/keys');
const ui = require('../device/ui');
const { measure } = require('../measurement/mediaOpenWatcher');
const { REASONS, reasonFromMediaResult } = require('../results/reasons');

const NAME = 'startOver';

// Espera tras el RIGHT para que el foco se asiente en la opción
// antes de confirmar con OK.
const FOCUS_DELAY = 800;

// Máximo de espera a que el miniguide aparezca tras invocarlo con OK.
const SHOW_TIMEOUT = 5000;

// Deja el miniguide visible, venga del zapeo o haya que invocarlo.
async function ensureMiniguide(driver) {
  if (await ui.isMiniguideVisible(driver)) {
    return true;
  }

  await keys.ok();
  return ui.waitMiniguideVisible(driver, SHOW_TIMEOUT);
}

async function attempt(canal, driver) {
  const visible = await ensureMiniguide(driver);

  if (!visible) {
    return { status: 'fail', reason: REASONS.MINIGUIDE_TIMEOUT };
  }

  // Mover el foco a la opción Start Over
  await keys.right();
  await sleep(FOCUS_DELAY);

  // Confirmar y medir el contenido reiniciado
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