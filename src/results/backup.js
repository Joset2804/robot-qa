// src/results/backup.js
// Respaldo local del reporte en NDJSON.
//
// La fuente de verdad es Python, que recoge los reportes vía API.
// Este archivo existe solo para no perder datos si la API falla.
// Retención de 5 días para no llenar el disco de la sonda.

const path = require('path');
const localTime = require('../localTime');

const DIR = path.join(__dirname, '..', '..', 'data');
const PREFIX = 'check_';
const RETENTION_DAYS = 5;

async function ensureDir() {
  try {
    await fs.mkdir(DIR, { recursive: true });
  } catch (err) {
    logger.warn(`[backup] no se pudo crear ${DIR}: ${err}`);
  }
}

function fileFor(fileDate) {
  return path.join(DIR, `${PREFIX}${fileDate}.ndjson`);
}

// Guarda un canal en el archivo del día en que EMPEZÓ su pasada.
// run = { id, fileDate }, calculado una vez al arrancar la pasada:
// así una pasada que cruza la medianoche queda entera en un archivo.
async function saveChannel(entry, run) {
  await ensureDir();

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    probe: require('os').hostname(),
    runId: run.id,
    channel: entry.channel,
    channelName: entry.channelName,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    checks: entry.checks
  }) + '\n';

  try {
    await fs.appendFile(fileFor(run.fileDate), line);
  } catch (err) {
    logger.warn(`[backup] no se pudo guardar el canal ${entry.channel}: ${err}`);
  }
}

// Borra los archivos anteriores a la ventana de retención.
// Se llama al inicio de cada ejecución.
async function cleanup(utcOffset) {
  const cutoff = localTime.localDate(
    new Date(Date.now() - RETENTION_DAYS * 86400000),
    utcOffset
  );

  let files;
  try {
    files = await fs.readdir(DIR);
  } catch (err) {
    // El directorio aún no existe — nada que limpiar
    return;
  }

  for (const file of files) {
    if (!file.startsWith(PREFIX) || !file.endsWith('.ndjson')) continue;

    // check_2026-09-22.ndjson → 2026-09-22
    const datePart = file.slice(PREFIX.length, -'.ndjson'.length);

    // Las fechas en yyyy-mm-dd se comparan bien como texto
    if (datePart < cutoff) {
      try {
        await fs.unlink(path.join(DIR, file));
        logger.info(`[backup] eliminado ${file}`);
      } catch (err) {
        logger.warn(`[backup] no se pudo eliminar ${file}: ${err}`);
      }
    }
  }
}

module.exports = { saveChannel, cleanup, fileFor, RETENTION_DAYS };