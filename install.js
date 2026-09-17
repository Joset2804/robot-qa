// install.js
// NDP no instala automáticamente las dependencias de package.json.
// Este script corre "npm install" en la carpeta del proyecto.
// Se ejecuta una sola vez al desplegar, o cuando cambie package.json.

const { exec } = require('child_process');

async function main() {
  return new Promise((resolve, reject) => {
    exec('npm install', { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        logger.error('[install] error:', stderr);
        reject(error);
      } else {
        logger.info('[install] ok:', stdout);
        resolve();
      }
    });
  });
}

module.exports = main();