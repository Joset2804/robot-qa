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
const telegram = require('./src/results/telegram');

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

// Las marcas retryable y final son para que el check le hable al
// launcher; no son datos del resultado y no van al reporte.
function clean(result) {
  delete result.retryable;
  delete result.final;
  return result;
}

function logFinal(check, canal, result) {
  const label = `[${check.name}] canal ${canal.numero}`;

  if (result.status === 'ok') {
    const extra = result.durationMs ? ` (${result.durationMs}ms)` : '';
    const note = result.retried ? ' tras reintento' : '';
    logger.info(`${label} — OK${extra}${note}`);
  } else if (result.status === 'skipped') {
    logger.warn(`${label} — OMITIDO (${result.reason})`);
  } else {
    logger.error(`${label} — FALLÓ (${result.reason})`);
  }
}

async function runCheck(check, canal, ctx) {
  let result;
  let tries = 0;

  const startedAt = new Date().toISOString();

  logger.info(`[${check.name}] canal ${canal.numero} — iniciando`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    tries = attempt;

    // Cada intento arranca desde el LIVE del canal.
    // LIVE no lo necesita: su propio zapeo es la medición.
    if (check.name !== 'live') {
      const z = await zap.zapTo(canal, ctx);

      if (!z.ok) {
        // Primer intento: no se pudo probar → omitido.
        // Reintento: se reporta lo que dio el intento anterior.
        if (!result) {
          result = { status: 'skipped', reason: z.reason, zapAttempts: z.attempts };
        }
        break;
      }

      await sleep(ctx.config.zapSettleMs);
    }

    result = await check.module.run(canal, ctx.driver, ctx);

    // ¿Vale la pena otro intento?
    //   fail normal               → sí
    //   fail con final            → no, ya tuvo su reintento interno
    //   skipped con retryable     → sí, desde el zapeo
    //   skipped normal            → no, el zapeo ya hizo sus intentos
    const retry =
      (result.status === 'fail' && !result.final) ||
      (result.status === 'skipped' && result.retryable);

    if (!retry || attempt === MAX_ATTEMPTS) break;

    const what = result.status === 'fail' ? 'falló' : 'no se pudo ejecutar';
    logger.warn(`[${check.name}] canal ${canal.numero} — ${what} (${result.reason}), reintentando`);
    await sleep(RETRY_DELAY);
  }

  if (tries > 1) result.retried = true;

  result.startedAt = startedAt;
  result.finishedAt = new Date().toISOString();

  clean(result);
  logFinal(check, canal, result);
  return result;
}

async function runChannel(canal, selected, reportsLive, ctx) {
  const results = {};
  const startedAt = new Date().toISOString();

  for (const check of selected) {
    results[check.name] = await runCheck(check, canal, ctx);
  }

  if (!reportsLive) delete results.live;

  return {
    channel: canal.numero,
    channelName: canal.nombre,
    startedAt,
    finishedAt: new Date().toISOString(),
    checks: results
  };
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

      const entry = await runChannel(canal, selected, reportsLive, ctx);

      // Se guarda enseguida: si la ejecución se interrumpe, lo ya
      // verificado queda en disco
      await backup.saveChannel(entry);
      await telegram.alertChannel(entry, input.telegram);
      channelResults.push(entry);
    }

    completed = true;

  } catch (err) {
    logger.error(`[launcher] ejecución interrumpida: ${err}`);

  } finally {
    logcat.stop();
    await ui.closeSession(driver);
  }

  return report.publish(channelResults, Object.assign({ completed }, meta));
}

module.exports = main();