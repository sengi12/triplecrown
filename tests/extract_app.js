#!/usr/bin/env node
// Extract the <script> block from ff_projections.html into check.js for testing.
const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2] || path.join(__dirname, '..', 'ff_projections.html');
if (!fs.existsSync(htmlPath)) {
  console.error(`Usage: node extract_app.js <path-to-ff_projections.html>`);
  console.error(`  File not found: ${htmlPath}`);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const lastScript = html.rfind ? html.lastIndexOf('<script>') : html.lastIndexOf('<script>');
const start = html.indexOf('>', lastScript) + 1;
const end = html.lastIndexOf('</script>');
const js = html.substring(start, end);

const outPath = path.join(__dirname, 'check.js');
fs.writeFileSync(outPath, js);
console.log(`Extracted ${js.length.toLocaleString()} chars → ${outPath}`);
