// src/results/backup.js
// Respaldo local del reporte en NDJSON.
//
// La fuente de verdad es Python, que recoge los reportes vía API.
// Este archivo existe solo para no perder datos si la API falla.
// Retención de 5 días para no llenar el disco de la sonda.

const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'data');
const PREFIX = 'check_';
const RETENTION_DAYS = 5;

// Nombre de archivo del día actual.
// Se calcula en cada llamada, no una vez al arrancar, para que una
// ejecución que cruce la medianoche escriba en el archivo correcto.
function currentFile() {
  const today = new Date().toISOString().split('T')[0];
  return path.join(DIR, `${PREFIX}${today}.ndjson`);
}

async function ensureDir() {
  try {
    await fs.mkdir(DIR, { recursive: true });
  } catch (err) {
    logger.warn(`[backup] no se pudo crear ${DIR}: ${err}`);
  }
}

// Escribe una línea por canal verificado.
// Un objeto por canal en vez de uno por ejecución, para que el archivo
// sea consultable línea a línea sin parsear estructuras anidadas.
async function save(channelResults, meta = {}) {
  await ensureDir();

  const probe = require('os').hostname();
  const timestamp = new Date().toISOString();

  const lines = channelResults.map(entry => JSON.stringify({
    timestamp,
    probe,
    channel: entry.channel,
    channelName: entry.channelName,
    checks: entry.checks
  })).join('\n') + '\n';

  try {
    await fs.appendFile(currentFile(), lines);
    logger.debug(`[backup] ${channelResults.length} canales guardados`);
  } catch (err) {
    // Un fallo de respaldo no debe afectar la ejecución
    logger.warn(`[backup] no se pudo guardar: ${err}`);
  }
}

// Borra los archivos anteriores a la ventana de retención.
// Se llama al inicio de cada ejecución.
async function cleanup() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  let files;
  try {
    files = await fs.readdir(DIR);
  } catch (err) {
    // El directorio aún no existe — nada que limpiar
    return;
  }

  for (const file of files) {
    if (!file.startsWith(PREFIX) || !file.endsWith('.ndjson')) continue;

    // check_2026-09-13.ndjson → 2026-09-13
    const datePart = file.slice(PREFIX.length, -'.ndjson'.length);
    const fileDate = new Date(datePart);

    if (isNaN(fileDate.getTime())) continue;

    if (fileDate < cutoff) {
      try {
        await fs.unlink(path.join(DIR, file));
        logger.info(`[backup] eliminado ${file}`);
      } catch (err) {
        logger.warn(`[backup] no se pudo eliminar ${file}: ${err}`);
      }
    }
  }
}

module.exports = { save, cleanup, currentFile, RETENTION_DAYS };