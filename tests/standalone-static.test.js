const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expectedTabs = [
  "viewer3d",
  "viewer3d-rvm",
  "viewer3d-json"
];
const allowedBareImports = new Set(['three', 'gltf-exporter', 'mdb-reader', 'buffer', 'xlsx']);
const allowedBarePrefixes = ['three/addons/'];
const allowedMissingAssets = new Set(['data/mocks/mock_complex_piping.pcf', 'opt/mock-xml.xml', 'opt/mock-pcf-data.json']);

function fail(message) {
  throw new Error(message);
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function stripQuery(value) {
  return String(value || '').split('?')[0].split('#')[0];
}

function decodeLocalPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isBare(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('/');
}

function resolveRelative(fromRel, specifier) {
  const clean = stripQuery(specifier);
  const base = path.dirname(path.join(root, fromRel));
  return path.resolve(base, clean);
}

function assertInside(absPath, context) {
  const rel = path.relative(root, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail(context + ' escapes app root: ' + rel);
  return rel.replace(/\\/g, '/');
}

function assertLocalRefExists(fromRel, specifier, context) {
  const clean = decodeLocalPath(stripQuery(specifier));
  if (/^(https?:|data:|blob:|#)/i.test(clean)) return;
  if (!clean.startsWith('.') && !clean.startsWith('/')) {
    const rootCandidate = path.resolve(root, clean);
    if (fs.existsSync(rootCandidate)) {
      assertInside(rootCandidate, context);
      return;
    }
  }
  if (isBare(clean)) {
    const allowed = allowedBareImports.has(clean) || allowedBarePrefixes.some((prefix) => clean.startsWith(prefix));
    if (!allowed) fail(context + ' uses unexpected bare import: ' + clean);
    return;
  }
  let absPath = resolveRelative(fromRel, clean);
  let rel = assertInside(absPath, context);
  if (!path.extname(absPath)) {
    const jsPath = absPath + '.js';
    if (fs.existsSync(jsPath)) {
      assertInside(jsPath, context);
      return;
    }
  }
  if (!fs.existsSync(absPath)) {
    if (allowedMissingAssets.has(rel)) return;
    fail(context + ' target is missing: ' + rel);
  }
}

function walk(dirRel) {
  const dir = path.join(root, dirRel);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(dirRel, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function getHtmlAttr(tag, name) {
  const pattern = new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i");
  return tag.match(pattern)?.[2] || null;
}

function moduleScriptTags(html) {
  return [...html.matchAll(/<script\b(?=[^>]*\btype=["']module["'])[^>]*>[\s\S]*?<\/script>/gi)].map((match) => match[0]);
}

const index = read('index.html');
if (!fs.existsSync(path.join(root, '.nojekyll'))) fail('Published site root must include .nojekyll for GitHub Pages static deployment');
if (/Previous cache marker:/i.test(index)) fail('index.html must not keep stale Previous cache marker comments');
if (!/<title>3DV<\/title>/.test(index)) fail('index.html title must match standalone runtime app name 3DV');
if (!/<meta\s+name=["']application-name["']\s+content=["']3DV["']\s*>/i.test(index)) fail('index.html application-name meta must be 3DV');
if (!/<meta\s+name=["']apple-mobile-web-app-title["']\s+content=["']3DV["']\s*>/i.test(index)) fail('index.html apple-mobile-web-app-title meta must be 3DV');

const manifest = JSON.parse(read('site.webmanifest'));
if (manifest.name !== '3DV') fail('site.webmanifest name must be 3DV');
if (manifest.short_name !== '3DV') fail('site.webmanifest short_name must be 3DV');
if (manifest.start_url !== './index.html') fail('site.webmanifest start_url must point to ./index.html');
for (const icon of manifest.icons || []) assertLocalRefExists('site.webmanifest', icon.src, 'site.webmanifest icon');

const moduleTags = moduleScriptTags(index);
const inlineModuleTags = moduleTags.filter((tag) => !getHtmlAttr(tag, 'src'));
if (inlineModuleTags.length) fail('index.html must not use inline module startup scripts; found ' + inlineModuleTags.length);

const moduleScripts = moduleTags.map((tag) => getHtmlAttr(tag, 'src')).filter(Boolean);
if (moduleScripts.length !== 1) fail('Expected one external module script, found ' + moduleScripts.length);
if (index.includes('installViewer3dJsonTab')) fail('3D Json Viewer tab must be owned by the standalone runtime registry, not an inline installer');
assertLocalRefExists('index.html', moduleScripts[0], 'index module script');
for (const match of index.matchAll(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/g)) {
  const href = match[1];
  if (!href.startsWith('//')) assertLocalRefExists('index.html', href, 'index stylesheet/link');
}

const mainPath = stripQuery(moduleScripts[0]).replace(/^\.\//, '');
const main = read(mainPath);
if (!main.includes("import('./core/app.js")) fail('main entrypoint must dynamically import ./core/app.js');
if (!main.includes('.catch(reportStartupError)')) fail('main entrypoint must report startup errors');

const runtime = read('core/app-standalone-runtime.js');
for (const tabId of expectedTabs) {
  if (!runtime.includes("id: '" + tabId + "'")) fail('Missing standalone tab ' + tabId);
}
for (const tabId of ['pcfx-converter', 'rvm-json-pcf']) {
  if (!expectedTabs.includes(tabId) && runtime.includes("id: '" + tabId + "'")) fail('Unexpected standalone tab ' + tabId);
}
if (!runtime.includes('TAB_CHANGE_REQUESTED')) fail('Runtime must listen for tab-change-requested events');
if (!runtime.includes('app:switch-tab')) fail('Runtime must listen for app:switch-tab window events');

const importPattern = /(?:import\s+(?:[^'"()]+?\s+from\s+)?|export\s+[^'"()]+?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
const newUrlPattern = /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
for (const jsFile of walk('').filter((file) => /\.(js|mjs)$/.test(file) && !file.startsWith('tests/') && !file.startsWith('scripts/'))) {
  const text = read(jsFile);
  for (const match of text.matchAll(importPattern)) assertLocalRefExists(jsFile, match[1], jsFile + ' import');
  for (const match of text.matchAll(newUrlPattern)) assertLocalRefExists(jsFile, match[1], jsFile + ' new URL');
}

console.log('Standalone static validation passed for ' + path.basename(root) + ' (' + expectedTabs.join(', ') + ')');
