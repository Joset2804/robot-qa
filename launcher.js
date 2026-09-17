// launcher.js
// Punto de entrada. NDP ejecuta este archivo.
//
// Input:
//   { channels: [{ numero, nombre }], checks: ["live","epg",...] }
//
// Por cada canal ejecuta los checks pedidos. Antes de cada check zapea al
// canal para devolver el deco al LIVE, porque un check anterior pudo dejarlo
// en otro estado. La excepción es "live", cuyo zapeo ES el check.

const keys = require('./src/device/keys');
const ui = require('./src/device/ui');
const checks = require('./src/checks');
const report = require('./src/results/report');
const backup = require('./src/results/backup');
const { measure } = require('./src/measurement/mediaOpenWatcher');
const { REASONS } = require('./src/results/reasons');

// Intentos por operación: el original más un reintento de confirmación.
// Filtra glitches momentáneos antes de que lleguen a Python.
const MAX_ATTEMPTS = 2;

// Pausa entre el intento fallido y el reintento, para dar margen a que
// una condición transitoria se resuelva.
const RETRY_DELAY = 2000;

// Espera a que el miniguide muestre el número esperado tras el zapeo.
const ZAP_CONFIRM_TIMEOUT = 8000;

// Margen tras confirmar el canal, para que el video estabilice antes
// de que el check empiece a navegar. Sin esto, un check puede presionar
// teclas sobre un miniguide que todavía se está renderizando.
const ZAP_SETTLE_DELAY = 2500;

async function zapAndConfirm(canal, driver) {
  const expected = String(canal.numero);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await keys.zapToChannel(canal.numero);

    const deadline = Date.now() + ZAP_CONFIRM_TIMEOUT;

    while (Date.now() < deadline) {
      const current = await ui.readChannelNumber(driver);
      if (current && current.trim() === expected) {
        await sleep(ZAP_SETTLE_DELAY);
        return true;
      }
      await sleep(300);
    }

    if (attempt < MAX_ATTEMPTS) {
      logger.warn(`[launcher] canal ${canal.numero} no confirmado — reintentando zapeo`);
      await sleep(RETRY_DELAY);
    }
  }

  return false;
}

// Ejecuta un check con su reintento de confirmación.
// Marca retried:true si hizo falta el segundo intento.
async function runCheck(check, canal, driver) {
  let result;

  logger.info(`[${check.name}] canal ${canal.numero} — iniciando`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await check.module.run(canal, driver);

    if (result.status === 'ok') {
      if (attempt > 1) result.retried = true;
      const extra = result.durationMs ? ` (${result.durationMs}ms)` : '';
      const note = attempt > 1 ? ' tras reintento' : '';
      logger.info(`[${check.name}] canal ${canal.numero} — OK${extra}${note}`);
      return result;
    }

    if (attempt < MAX_ATTEMPTS) {
      logger.warn(`[${check.name}] canal ${canal.numero} — falló (${result.reason}), reintentando`);
      await sleep(RETRY_DELAY);
    }
  }

  result.retried = true;
  logger.error(`[${check.name}] canal ${canal.numero} — FALLÓ (${result.reason})`);
  return result;
}

// Ejecuta todos los checks pedidos sobre un canal.
async function runChannel(canal, selected, reportsLive, driver) {
  const results = {};

  for (const check of selected) {
    // "live" no lleva zapeo previo: su propio zapeo es la medición.
    if (check.name === 'live') {
      results.live = await runCheck(check, canal, driver);
      continue;
    }

    // Los demás necesitan el canal en LIVE. Un check anterior pudo dejar
    // el deco dentro de un Start Over, un CatchUp o una pantalla de detalle.
    const ready = await zapAndConfirm(canal, driver);

    if (!ready) {
      logger.warn(`[${check.name}] canal ${canal.numero} — OMITIDO (canal no disponible)`);
      results[check.name] = {
        status: 'skipped',
        reason: REASONS.CHANNEL_NOT_LIVE
      };
      continue;
    }

    results[check.name] = await runCheck(check, canal, driver);
  }

  // Si Python no pidió "live", su resultado no va al reporte aunque
  // el zapeo se haya ejecutado.
  if (!reportsLive) delete results.live;

  return results;
}

async function main() {
  logger.level = 'info';

  const startedAt = new Date().toISOString();
  const channels = Array.isArray(input.channels) ? input.channels : [];
  const requested = input.checks;

  if (channels.length === 0) {
    logger.error('[launcher] input.channels vacío — nada que verificar');
    return report.publish([], {
      completed: false,
      startedAt,
      requestedChecks: requested || []
    });
  }

  const selected = checks.resolve(requested);
  const reportsLive = checks.reportsLive(requested);

  logger.info(`[launcher] ${channels.length} canal(es), checks: ${selected.map(c => c.name).join(', ')}`);

  await backup.cleanup();

  // La sesión de Appium se crea UNA vez. Crearla tarda ~7s y el miniguide
  // dura ~5, así que recrearla dentro del bucle haría que nunca se lo alcance.
  let driver;
  try {
    driver = await ui.createSession();
  } catch (err) {
    logger.error(`[launcher] no se pudo crear la sesión Appium: ${err}`);
    return report.publish([], {
      completed: false,
      startedAt,
      requestedChecks: requested || []
    });
  }

  const channelResults = [];
  let completed = false;

  try {
    for (let i = 0; i < channels.length; i++) {
      const canal = channels[i];
      logger.info(`[launcher] (${i + 1}/${channels.length}) canal ${canal.numero} — ${canal.nombre || ''}`);

      const checkResults = await runChannel(canal, selected, reportsLive, driver);

      channelResults.push({
        channel: canal.numero,
        channelName: canal.nombre,
        checks: checkResults
      });
    }

    completed = true;

  } catch (err) {
    logger.error(`[launcher] ejecución interrumpida: ${err}`);

  } finally {
    await ui.closeSession(driver);
  }

  await backup.save(channelResults);

  return report.publish(channelResults, {
    completed,
    startedAt,
    requestedChecks: requested || []
  });
}

module.exports = main();