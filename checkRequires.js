// checkRequires.js
// Verificación previa: todo lo que un archivo usa de otro módulo tiene
// que estar importado. Un olvido no falla al cargar el archivo, sino
// recién cuando el check pasa por esa línea, a veces horas después.

const path = require('path');

const FILES = [
  'launcher.js',
  'src/checks/live.js',
  'src/checks/epg.js',
  'src/checks/startOver.js',
  'src/checks/catchup.js'
];

// Nombres que vienen de otros módulos y se usan en los checks
const SYMBOLS = ['REASONS', 'reasonFromMediaResult', 'measure'];

// Quita comentarios, para no contar un nombre que solo aparece ahí
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

// Nombres importados con const { a, b } = require(...)
function importedNames(source) {
  const names = new Set();
  const re = /const\s*\{([^}]*)\}\s*=\s*require\(/g;
  let match;

  while ((match = re.exec(source))) {
    match[1]
      .split(',')
      .map(s => s.split(':')[0].trim())
      .filter(Boolean)
      .forEach(n => names.add(n));
  }

  return names;
}

async function main() {
  logger.level = 'info';
  let problems = 0;

  for (const file of FILES) {
    const source = stripComments(String(await fs.readFile(path.join(__dirname, file))));
    const imported = importedNames(source);

    const missing = SYMBOLS.filter(symbol => {
      const used = new RegExp(`\\b${symbol}\\s*[.(]`).test(source);
      return used && !imported.has(symbol);
    });

    if (missing.length > 0) {
      problems++;
      logger.error(`[verificar] ${file}: usa sin importar → ${missing.join(', ')}`);
    } else {
      logger.info(`[verificar] ${file}: OK`);
    }
  }

  logger.info(`[verificar] ${problems === 0 ? 'todo correcto' : `${problems} archivo(s) con problemas`}`);
  return { problems };
}

module.exports = main();