// ═══════════════════════════════════════════════════════════════════════════
// FFForge Test Mock — shared DOM/browser mocks for headless Node.js testing.
// All test files require this before loading the app code.
// ═══════════════════════════════════════════════════════════════════════════

const elStore = {};
function mkEl(id) {
  if (!elStore[id]) elStore[id] = {
    innerHTML: '', style: {}, textContent: '', value: '',
    classList: { add(){}, remove(){} },
    children: [], appendChild(){}, querySelectorAll: () => []
  };
  return elStore[id];
}

global.document = {
  getElementById: (id) => mkEl(id),
  querySelector: (sel) => {
    // Support slider lookups by data-key
    const m = sel.match(/data-key="([^"]+)"/);
    if (m) return { value: 0, dataset: { col: '#fff', key: m[1] }, style: {} };
    return null;
  },
  querySelectorAll: () => [],
  createElement: () => ({ click(){}, style: {}, appendChild(){} }),
  activeElement: null,
  body: { appendChild(){}, removeChild(){} }
};
global.window = { getSelection: () => ({ removeAllRanges(){}, addRange(){} }) };
global.Chart = function() { return { destroy(){}, update(){}, data: { datasets: [{}] } }; };
global.confirm = () => true;
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.FileReader = function() {};
global.Range = function() {};
global.fetch = () => Promise.reject(new Error('no net'));

// Load the app code from check.js (extracted <script> block from the built HTML).
// The runner extracts this before tests run.
const fs = require('fs');
const path = require('path');
const checkPath = path.join(__dirname, 'check.js');

function loadApp(exports) {
  if (!fs.existsSync(checkPath)) {
    console.error('ERROR: check.js not found. Run extract_app.js first (or use run_tests.sh).');
    process.exit(1);
  }
  const code = fs.readFileSync(checkPath, 'utf8');
  return new Function(code + `return {${exports}};`)();
}

module.exports = { loadApp, mkEl, elStore };
