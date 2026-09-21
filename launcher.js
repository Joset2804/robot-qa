// launcher.js
// Punto de entrada. NDP ejecuta este archivo.
//
// Por cada canal ejecuta los checks pedidos, con LIVE siempre primero.
// Antes de cada check que no sea LIVE se zapea al canal para devolver
// el deco al LIVE, porque el check anterior pudo dejarlo en otro estado.

const ui = require('./src/device/ui');
const zap = require('./src/device/zap');
const Logcat = require('./src/device/logcat');
const checks = require('./src/checks');
const report = require('./src/results/report');
const backup = require('./src/results/backup');
const config = require('./src/config');

// Intentos por check: el original más uno de confirmación.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY = 2000;

// LIVE va primero: mide el tiempo de zapeo, y eso solo se puede medir
// llegando desde otro canal. Si otro check zapeara antes al mismo canal,
// el zapeo de LIVE no tendría transición que medir.
function liveFirst(selected) {
  return selected
    .filter(c => c.name === 'live')
    .concat(selected.filter(c => c.name !== 'live'));
}

async function runCheck(check, canal, ctx) {
  let result;

  logger.info(`[${check.name}] canal ${canal.numero} — iniciando`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Cada intento arranca desde el LIVE del canal. Sin esto, el reintento
    // partiría del estado en que lo dejó el intento anterior: dentro de
    // un catchup, en pausa o en otro canal.
    // LIVE no lo necesita: su propio zapeo es la medición.
    if (check.name !== 'live') {
      const z = await zap.zapTo(canal, ctx);

      if (!z.ok) {
        // Primer intento: no se pudo probar → omitido.
        // Reintento: ya hubo un fallo real antes, se reporta ese.
        if (result) break;
        logger.warn(`[${check.name}] canal ${canal.numero} — OMITIDO (${z.reason})`);
        return { status: 'skipped', reason: z.reason, zapAttempts: z.attempts };
      }

      await sleep(ctx.config.zapSettleMs);
    }

    result = await check.module.run(canal, ctx.driver, ctx);

    if (result.status === 'ok') {
      if (attempt > 1) result.retried = true;
      const extra = result.durationMs ? ` (${result.durationMs}ms)` : '';
      logger.info(`[${check.name}] canal ${canal.numero} — OK${extra}`);
      return result;
    }

    // Un skipped viene del zapeo, que ya hizo sus propios intentos
    if (result.status === 'skipped') {
      logger.warn(`[${check.name}] canal ${canal.numero} — OMITIDO (${result.reason})`);
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

async function runChannel(canal, selected, reportsLive, ctx) {
  const results = {};

  for (const check of selected) {
    results[check.name] = await runCheck(check, canal, ctx);
  }

  if (!reportsLive) delete results.live;

  return results;
}

async function main() {
  logger.level = 'info';

  const startedAt = new Date().toISOString();
  const cfg = config.load();
  const channels = Array.isArray(input.channels) ? input.channels : [];
  const requested = input.checks;
  const meta = { startedAt, requestedChecks: requested || [] };

  if (channels.length === 0) {
    logger.error('[launcher] input.channels vacío — nada que verificar');
    return report.publish([], Object.assign({ completed: false }, meta));
  }

  const withoutId = channels.filter(c => !c.id).map(c => c.numero);
  if (withoutId.length > 0) {
    logger.warn(`[launcher] canales sin id — no se puede confirmar el zapeo: ${withoutId.join(', ')}`);
  }

  const selected = liveFirst(checks.resolve(requested));
  const reportsLive = checks.reportsLive(requested);

  logger.info(`[launcher] ${channels.length} canal(es), checks: ${selected.map(c => c.name).join(', ')}`);

  await backup.cleanup();

  const logcat = new Logcat();
  logcat.start();

  let driver;
  try {
    driver = await ui.createSession();
  } catch (err) {
    logger.error(`[launcher] no se pudo crear la sesión Appium: ${err}`);
    logcat.stop();
    return report.publish([], Object.assign({ completed: false }, meta));
  }

  const ctx = { driver, logcat, config: cfg };
  const channelResults = [];
  let completed = false;

  try {
    for (let i = 0; i < channels.length; i++) {
      const canal = channels[i];
      logger.info(`[launcher] (${i + 1}/${channels.length}) canal ${canal.numero} — ${canal.nombre || ''}`);

      const checkResults = await runChannel(canal, selected, reportsLive, ctx);

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
    logcat.stop();
    await ui.closeSession(driver);
  }

  await backup.save(channelResults);

  return report.publish(channelResults, Object.assign({ completed }, meta));
}

module.exports = main();