// src/results/report.js
// Arma el objeto que se publica con Results.set().
// Es el contrato con el orquestador Python: cualquier cambio de forma
// requiere coordinar el cambio del otro lado.

const os = require('os');

// Título de la pestaña en el panel de NDP.
// Results.set soporta actualización parcial reusando el mismo título,
// que es lo que permitiría el reporte progresivo más adelante.
const TITLE = 'ChannelCheck';

// Construye el objeto de reporte.
//
// @param channelResults array de { channel, checks }
// @param meta           { completed, requestedChecks }
function build(channelResults, meta = {}) {
  const summary = summarize(channelResults);

  return {
    // "passed" indica que LA SONDA hizo su trabajo, no que los canales
    // estén bien. Un canal fallido es un hallazgo; solo una ejecución
    // interrumpida marca passed en false.
    // Esto le permite a Python distinguir "reintentar la ejecución"
    // de "hay un problema en el canal".
    passed: meta.completed !== false,

    probe: os.hostname(),
    startedAt: meta.startedAt,
    finishedAt: new Date().toISOString(),

    // Checks que Python pidió, para que pueda detectar si alguno
    // fue ignorado por ser desconocido en esta versión del script.
    requestedChecks: meta.requestedChecks || [],

    summary,
    results: channelResults,

    // Formato legible en el panel de NDP. Python ignora este campo.
    data: buildPanelData(channelResults, summary)
  };
}

// Conteos agregados. Python puede recalcularlos, pero tenerlos acá
// evita que cada consumidor los derive por su cuenta.
function summarize(channelResults) {
  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let retried = 0;

  for (const entry of channelResults) {
    for (const name of Object.keys(entry.checks)) {
      const check = entry.checks[name];
      if (check.status === 'ok') ok++;
      else if (check.status === 'fail') fail++;
      else if (check.status === 'skipped') skipped++;
      if (check.retried) retried++;
    }
  }

  return {
    channels: channelResults.length,
    checksOk: ok,
    checksFailed: fail,
    checksSkipped: skipped,
    checksRetried: retried
  };
}

// Tabla para el panel visual de NDP. Una fila por canal y check
// que no haya salido ok — así el panel muestra solo lo que requiere
// atención en vez de repetir los resultados buenos.
function buildPanelData(channelResults, summary) {
  const rows = [];

  for (const entry of channelResults) {
    for (const name of Object.keys(entry.checks)) {
      const check = entry.checks[name];
      if (check.status === 'ok') continue;

      rows.push({
        Canal: entry.channel,
        Nombre: entry.channelName || '-',
        Check: name,
        Estado: check.status,
        Motivo: check.reason || '-',
        Reintentado: check.retried ? 'sí' : 'no'
      });
    }
  }

  const data = [
    {
      type: 'text',
      title: 'Resumen',
      text: `Canales verificados: ${summary.channels}\n`
          + `Checks OK: ${summary.checksOk}\n`
          + `Checks fallidos: ${summary.checksFailed}\n`
          + `Checks omitidos: ${summary.checksSkipped}\n`
          + `Con reintento: ${summary.checksRetried}`
    }
  ];

  if (rows.length > 0) {
    data.push({
      type: 'table',
      title: 'Hallazgos',
      data: rows
    });
  }

  return data;
}

// Publica el reporte en NDP.
async function publish(channelResults, meta) {
  const report = build(channelResults, meta);

  try {
    await Results.set(TITLE, report);
    logger.info(`[report] publicado — ${report.summary.checksFailed} fallidos, ${report.summary.checksSkipped} omitidos`);
  } catch (err) {
    logger.error(`[report] error publicando: ${err}`);
  }

  return report;
}

module.exports = { TITLE, build, publish, summarize };