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

// Nombre de archivo del día actual.
// Se calcula en cada llamada, no una vez al arrancar, para que una
// ejecución que cruce la medianoche escriba en el archivo correcto.
function currentFile(utcOffset) {
  return path.join(DIR, `${PREFIX}${localTime.localDate(null, utcOffset)}.ndjson`);
}

async function ensureDir() {
  try {
    await fs.mkdir(DIR, { recursive: true });
  } catch (err) {
    logger.warn(`[backup] no se pudo crear ${DIR}: ${err}`);
  }
}

// Guarda un canal. Se llama apenas termina, no al final de la ejecución:
// una pasada del catálogo dura horas, y si se interrumpe no se pierde
// lo ya verificado.
async function saveChannel(entry, utcOffset) {
  await ensureDir();

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    probe: require('os').hostname(),
    channel: entry.channel,
    channelName: entry.channelName,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    checks: entry.checks
  }) + '\n';

  try {
    await fs.appendFile(currentFile(utcOffset), line);
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

module.exports = { saveChannel, cleanup, currentFile, RETENTION_DAYS };