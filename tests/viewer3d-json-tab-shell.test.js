import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [
  'tabs/viewer3d-json-tab.js',
  'tabs/viewer3d-json-tab-renderer.js',
  'stage/ui/JsonViewerShell.js',
  'stage/ui/JsonViewerHierarchyTree.js',
  'stage/ui/JsonViewerPropertiesPanel.js',
  'stage/ui/JsonViewerDiagnosticsPanel.js',
  'stage/ui/RvmUiHandoff.js',
  'stage/ui/RvmStageModelUiSummary.js',
  'stage/export/RvmConverterJsonExport.js',
  'stage/export/RvmConverterJsonSideload.js',
  'stage/ui/JsonViewerConverterJsonDialog.js',
  'stage/worker/StageWorkerClient.js',
  'stage/worker/StageWorkerJob.js',
  'tests/viewer3d-json-tab-shell.test.js',
];
const guardedSourceFiles = files.filter((file) => !file.endsWith('.test.js'));
const blacklist = ['RvmDeferredBridgeLoader', 'RvmSupportGeometryBridge', 'RvmPrimitiveFallbackBridge', 'RvmVisualQualityControlsBridge', 'RvmZoneLodContextBridge', 'BrowserRvmRenderSceneBuilder', 'BrowserRvmCode4ElbowRenderBridge', 'BrowserRvmTransformParser', 'BrowserRvmHierarchyTransformParser', 'indexedDB'];
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

const tabSource = read('tabs/viewer3d-json-tab.js');
const rendererSource = read('tabs/viewer3d-json-tab-renderer.js');
const shellSource = read('stage/ui/JsonViewerShell.js');
const iconsSource = read('stage/ui/JsonViewerToolIcons.js');
const interactionSource = read('stage/ui/JsonViewerInteractionController.js');
const handoffSource = read('stage/ui/RvmUiHandoff.js');
const diagnosticsSource = read('stage/ui/JsonViewerDiagnosticsPanel.js');
const propertiesSource = read('stage/ui/JsonViewerPropertiesPanel.js');
const summarySource = read('stage/ui/RvmStageModelUiSummary.js');
const converterExportSource = read('stage/export/RvmConverterJsonExport.js');
const converterSideloadSource = read('stage/export/RvmConverterJsonSideload.js');
const converterDialogSource = read('stage/ui/JsonViewerConverterJsonDialog.js');
const css = read('tabs/viewer3d-json-tab.css');
const index = read('index.html');
const runtimeSource = read('core/app-standalone-runtime.js');
const combined = [tabSource, rendererSource, shellSource, handoffSource, diagnosticsSource, propertiesSource, summarySource, converterExportSource].join('\n');
const lineLimits = new Map([['tabs/viewer3d-json-tab-renderer.js', 520], ['stage/ui/JsonViewerShell.js', 360]]);

assert.match(combined, /3D Json Viewer/);
assert.match(combined, /Open Stage JSON/);
assert.match(combined, /Load Sample/);
assert.match(shellSource, /Open RVM/);
assert.match(shellSource, /Download RvmStageModel JSON/);
assert.match(shellSource, /Conv JSON/);
assert.match(shellSource, /export-converter-json/);
assert.match(shellSource, /commandGroup\('Exports', \[exportModelButton, exportSelectionButton, exportConverterJsonButton, exportSnapshotButton\]\)/);
assert.match(iconsSource, /converter:/);
assert.match(interactionSource, /export-selection'\) return api\.downloadSelectionJson/);
assert.match(interactionSource, /export-converter-json'\) return api\.downloadConverterJson/);
assert.match(rendererSource, /downloadConverterJson/);
assert.match(rendererSource, /openConverterJsonDialog/);
assert.match(converterExportSource, /rvm-converter-stage\/v1/);
assert.match(converterExportSource, /supportCandidates/);
assert.match(converterExportSource, /att-managed-support-primitive/);
assert.match(converterExportSource, /lineNo/);
assert.match(converterSideloadSource, /rvm-converter-support-sideload\/v1/);
assert.match(converterSideloadSource, /applyConverterJsonSideload/);
assert.match(converterSideloadSource, /GUIDE/);
assert.match(converterSideloadSource, /LINESTOP/);
assert.match(converterDialogSource, /openConverterJsonDialog/);
assert.match(converterDialogSource, /PS No\./);
assert.match(converterDialogSource, /Coordinate/);
assert.match(converterDialogSource, /Export Without Side-load/);
assert.match(handoffSource, /RVM StageModel generated successfully/);
assert.match(handoffSource, /RVM diagnostics only/);
assert.match(handoffSource, /RVM preflight failed/);
assert.match(rendererSource, /deriveRvmStageUiSummary/);
assert.match(rendererSource, /buildStageModelDownload/);
assert.match(rendererSource, /RVM binary selected/);
assert.match(tabSource + rendererSource, /RvmStageModelContract\.js/);
assert.match(rendererSource, /sample-rvm-stage-model-v1\.js/);
assert.match(rendererSource, /StageWorkerClient\.js/);
assert.match(rendererSource, /StageWorkerJob\.js/);
assert.match(rendererSource, /activeJobId/);
assert.match(diagnosticsSource, /Native Code/);
assert.match(shellSource, /rvmFileInput/);
assert.doesNotMatch(shellSource, /openRvmButton\.disabled = true/);
assert.doesNotMatch(shellSource + rendererSource, /Loaded RVM/);
assert.match(runtimeSource, /3D Json Viewer/);

for (const token of blacklist) for (const file of guardedSourceFiles) assert.equal(read(file).includes(token), false, `${file} contains ${token}`);
for (const file of files) { const lineCount = read(file).split('\n').length; assert.ok(lineCount < (lineLimits.get(file) || 300), `${file} has ${lineCount} lines`); }
assert.ok(css.split('\n').length < 300, 'CSS line count must stay under 300');
for (const className of ['json-viewer-shell', 'json-viewer-toolbar', 'json-viewer-evidence-panel', 'json-viewer-summary-panel', 'json-viewer-coverage-table', 'json-viewer-status-strip']) assert.ok(css.includes(className), `CSS missing ${className}`);
for (const token of ['severityCounts', 'fallbackCounts', 'renderKindCounts', 'validation:']) assert.ok(diagnosticsSource.includes(token), `Diagnostics missing ${token}`);
for (const token of ['confidence.geometry', 'confidence.semantic', 'primitive count', 'bboxWorld', 'renderPolicy']) assert.ok(propertiesSource.includes(token), `Properties missing ${token}`);

console.log('3D Json Viewer tab shell certification tests passed');
