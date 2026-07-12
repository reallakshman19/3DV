import { validateRvmStageModel, normalizeRenderQuality, RVM_STAGE_SCHEMA } from '../stage/contracts/RvmStageModelContract.js';
import { createSampleRvmStageModelV1 } from '../stage/samples/sample-rvm-stage-model-v1.js';
import { buildStageRenderPlan, STAGE_RENDER_PLAN_SCHEMA, validateStageRenderPlan } from '../stage/render/StageRenderPlan.js';
import { createRvmBinaryWorkerJob, createStageJsonWorkerJob } from '../stage/worker/StageWorkerJob.js';
import { createStageWorkerClient, disposeStageWorkerClient, runStageWorkerClientJob } from '../stage/worker/StageWorkerClient.js';
import { createStageThreePreviewRenderer, renderStagePreview, disposeStageThreePreviewRenderer, fitStagePreviewToRenderPlan, fitStagePreviewToSelection, resetStagePreview, updateStagePreviewSelection, setStagePreviewSelectionCallback, setStagePreviewBoxSelectCallback, setStagePreviewHoverCallback, setStagePreviewMeasureCallback, setStagePreviewCanvasClickCallback, requestStagePreviewRender, setStagePreviewColorBy, setStagePreviewExplode } from '../stage/render/StageThreePreviewRenderer.js';
import { setStagePreviewCameraMode, setStagePreviewView, pushStagePreviewCameraSnapshot, stepStagePreviewCameraHistory } from '../stage/render/StagePreviewCameraControls.js';
import { setStagePreviewMarqueeActive } from '../stage/render/StagePreviewMarqueeZoom.js';
import { setStagePreviewBoxSelectActive } from '../stage/render/StagePreviewBoxSelect.js';
import { setStagePreviewMeasureActive } from '../stage/render/StagePreviewMeasureTool.js';
import { applyStagePreviewVisibility, createStageVisibilityState, hiddenVisibilityRows, stageRefKey, visibilityStats } from '../stage/render/StagePreviewVisibilityTools.js';
import { applyStagePreviewClip, clipSummary, createStageClipState } from '../stage/render/StagePreviewClipTools.js';
import { renderStagePreviewTags, tagOverlaySummary } from '../stage/render/StagePreviewTagTools.js';
import { createJsonViewerShell } from '../stage/ui/JsonViewerShell.js';
import { renderHierarchyTree } from '../stage/ui/JsonViewerHierarchyTree.js';
import { STAGE_WORKER_FAILURE_ID, STAGE_WORKER_PREFLIGHT_ID, createRvmUiDiagnostics } from '../stage/ui/JsonViewerDiagnostics.js';
import { renderProperties } from '../stage/ui/JsonViewerPropertiesPanel.js';
import { renderEngDataPanel } from '../stage/ui/JsonViewerEngDataPanel.js';
import { renderJsonViewerDataHealth } from '../stage/ui/JsonViewerDataHealth.js';
import { renderDiagnostics } from '../stage/ui/JsonViewerDiagnosticsPanel.js';
import { renderClipPanel, renderHiddenList, renderTagsPanel } from '../stage/ui/JsonViewerToolsPanels.js';
import { renderDrawerContent } from '../stage/ui/JsonViewerBottomDrawer.js';
import { createJsonViewerInteractionController } from '../stage/ui/JsonViewerInteractionController.js';
import { createJsonViewerHistory, pushJsonViewerUndo, undoJsonViewerState, redoJsonViewerState } from '../stage/ui/JsonViewerUndoHistory.js';
import { createJsonViewerEnrichmentState, renderJsonViewerEnrichmentPanel } from '../stage/ui/JsonViewerEnrichmentPanel.js';
import { classifyRvmWorkerResult } from '../stage/ui/RvmUiHandoff.js';
import { buildStageModelDownload, deriveRvmStageUiSummary } from '../stage/ui/RvmStageModelUiSummary.js';
import { buildRvmConverterJsonPayload } from '../stage/export/RvmConverterJsonExport.js';
import { buildJsonViewerSelectionPayload } from '../stage/export/JsonViewerSelectionExport.js';
import { openConverterJsonDialog } from '../stage/ui/JsonViewerConverterJsonDialog.js';

const SAMPLE_SOURCE_NAME = 'sample-rvm-stage-model-v1.js';
const WORKER_URL = new URL('../stage/worker/stage-worker.js', import.meta.url);

function diagnosticCount(state) { const model = state.model?.diagnostics?.messages?.length || 0; const plan = state.renderPlan?.diagnostics?.length || 0; return model + plan + state.validationErrors.length + state.previewDiagnostics.length + state.workerDiagnostics.length; }
function defaultSelection(model) { return model ? { type: 'root', id: model.hierarchy?.rootId || 'node-root' } : null; }
function updateRenderPlan(state) { state.renderPlan = state.model ? buildStageRenderPlan(state.model, state.renderQuality, { qualityOverrides: state.qualityOverrides }) : null; }
function shouldShowZoneDensitySelector(model) {
  const nodeCount = model?.hierarchy?.nodes?.length || 0;
  const componentCount = model?.components?.length || 0;
  const primitiveCount = model?.primitives?.length || 0;
  return primitiveCount > 1500 || nodeCount > 50 || componentCount > 10000;
}
function activatePanel(panel, handles, state) {
  state.activePanel = panel;
  for (const [name, tab, body] of [
    ['properties', handles.propertiesTab, handles.propertiesPanel],
    ['engdata', handles.engDataTab, handles.engDataPanel],
    ['tags', handles.tagsTab, handles.tagsPanel],
    ['clip', handles.clipTab, handles.clipPanel],
    ['diagnostics', handles.diagnosticsTab, handles.diagnosticsPanel],
  ]) {
    tab.classList.toggle('is-active', panel === name);
    body.hidden = panel !== name;
  }
}
function ensureWorkerClient(handles, state) { if (!state.workerClient) state.workerClient = createStageWorkerClient({ workerUrl: WORKER_URL, onMessage: (message) => handleWorkerMessage(message, handles, state) }); return state.workerClient; }
function disposeWorkerClient(state) { disposeStageWorkerClient(state.workerClient); state.workerClient = null; }
function disposePreview(state) { disposeStageThreePreviewRenderer(state.previewRenderer); state.previewRenderer = null; }
function previewDiagnostic(error) { return { severity: 'error', code: 'STAGE_PREVIEW_RENDER_FAILED', message: error?.message || String(error) }; }
function clearLoadedModel(state, sourceName = '') { state.model = null; state.renderPlan = null; state.selectedRef = null; state.selectedRefs = []; state.sourceFileName = sourceName; state.validationErrors = []; state.previewDiagnostics = []; }

function previewText() { return ''; }

function handleWorkerMessage(message, handles, state) {
  const payload = message?.payload || {};
  if (message?.type === 'STAGE_WORKER_START' && payload.jobId && payload.jobId !== state.activeJobId) return;
  addWorkerMessageDiagnostic(message, state);
  
  if (message?.type === 'STAGE_WORKER_PROGRESS') {
    state.statusText = `${payload.phase || 'worker'}: ${payload.message || ''}`;
    if (handles.progressBar) {
      handles.progressBar.style.display = '';
      handles.progressBar.value = payload.percent || 0;
    }
  } else {
    state.statusText = (message?.type || 'STAGE_WORKER_MESSAGE').replace('STAGE_WORKER_', '');
    if (message?.type === 'STAGE_WORKER_END' || message?.type === 'STAGE_WORKER_ERROR') {
      if (handles.progressBar) handles.progressBar.style.display = 'none';
    }
  }
  updateStatus(handles, state);
}

function workerMessageDiagnostic(message) { const payload = message?.payload || {}; return { severity: message?.type === 'STAGE_WORKER_ERROR' ? 'error' : 'info', code: message?.type || 'STAGE_WORKER_MESSAGE', message: payload.message || payload.phase || payload.code || message?.type || 'worker message' }; }
function workerMessageKey(message) { const payload = message?.payload || {}; return [message?.type || '', payload.jobId || '', payload.phase || '', payload.code || '', payload.message || '', payload.percent ?? ''].join('|'); }
function addWorkerMessageDiagnostic(message, state) { const key = workerMessageKey(message); if (state.workerDiagnosticKeys.has(key)) return; state.workerDiagnosticKeys.add(key); state.workerDiagnostics.push(workerMessageDiagnostic(message)); }
function appendWorkerMessages(result, state) { for (const message of result?.messages || []) addWorkerMessageDiagnostic(message, state); }
function ensurePreviewRenderer(handles, state) {
  if (!state.previewRenderer) {
    state.previewRenderer = createStageThreePreviewRenderer(handles.canvasHost);
    state.previewRenderer.onCameraUpdate = (camera) => syncCanvasHUD(handles, camera);
    setStagePreviewSelectionCallback(state.previewRenderer, (ref) => applyPreviewSelection(ref, handles, state));
    setStagePreviewBoxSelectCallback(state.previewRenderer, (refs) => applyPreviewSelection(refs, handles, state));
    setStagePreviewHoverCallback(state.previewRenderer, (point) => updateHoverCoords(handles, point));
    setStagePreviewMeasureCallback(state.previewRenderer, (text) => { handles.measureReadout.hidden = false; handles.measureReadout.textContent = text; });
    setStagePreviewCanvasClickCallback(state.previewRenderer, (hit) => state.controller?.handleTagCanvasClick(hit));
  }
  return state.previewRenderer;
}

function updateHoverCoords(handles, point) {
  handles.coordText.textContent = point ? `XYZ: ${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)}` : 'XYZ: —';
}

function syncCanvasHUD(handles, camera) {
  // Prefer the shell's optimized updater (handles.updateAxisHud) when available
  if (handles.updateAxisHud) { handles.updateAxisHud(camera); return; }
  // Fallback: inline axis rendering
  const canvas = handles.axisCanvas;
  if (!canvas || !camera) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const center = { x: width / 2, y: height / 2 };
  const length = 20;

  const project = (vx, vy, vz) => {
    const m = camera.matrixWorldInverse.elements;
    const x = vx * m[0] + vy * m[4] + vz * m[8];
    const y = vx * m[1] + vy * m[5] + vz * m[9];
    const z = vx * m[2] + vy * m[6] + vz * m[10];
    return { x: center.x + x * length, y: center.y - y * length, z };
  };

  const axes = [
    { label: 'X', color: '#f87171', p: project(1, 0, 0) },
    { label: 'Y', color: '#34d399', p: project(0, 1, 0) },
    { label: 'Z', color: '#60a5fa', p: project(0, 0, 1) },
  ];
  
  axes.sort((a, b) => a.p.z - b.p.z);

  ctx.lineWidth = 2;
  ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const axis of axes) {
    ctx.strokeStyle = axis.color;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(axis.p.x, axis.p.y);
    ctx.stroke();
    
    ctx.fillStyle = axis.color;
    ctx.fillText(axis.label, axis.p.x + (axis.p.x - center.x) * 0.2, axis.p.y + (axis.p.y - center.y) * 0.2);
  }
}


function renderPreview(handles, state) {
  const message = previewText(state.renderPlan, state.model); handles.canvasHost.classList.toggle('has-model', Boolean(state.model)); handles.canvasMessage.textContent = message; handles.canvasMessage.hidden = !message;
  if (!state.model || !state.renderPlan) return disposePreview(state);
  try { const preview = ensurePreviewRenderer(handles, state); preview.selectedRef = state.selectedRef; preview.selectedRefs = state.selectedRefs || []; preview.forceFit = state.previewFitPending || preview.forceFit; renderStagePreview(preview, state.model, state.renderPlan); syncPreviewTools(preview, state); applyToolState(handles, state); state.previewFitPending = false; state.previewDiagnostics = []; }
  catch (error) { disposePreview(state); state.previewDiagnostics = [previewDiagnostic(error)]; state.activePanel = 'diagnostics'; handles.canvasMessage.hidden = false; handles.canvasMessage.textContent = 'Preview renderer failed'; }
}

function syncPreviewTools(preview, state) {
  state.visibilityStats = applyStagePreviewVisibility(preview, state.model, state.visibility);
  state.clipResult = applyStagePreviewClip(preview, state.clip);
  renderStagePreviewTags(preview, state.tags, state.tagDraft);
  requestStagePreviewRender(preview);
}

function renderEvidencePanels(handles, state) {
  const summary = deriveRvmStageUiSummary(state.model, state.workerDiagnostics);
  renderSummary(handles.summaryPanel, summary, state.model);
  renderCoverage(handles.coveragePanel, summary.coverage, state.model);
  handles.downloadButton.disabled = !state.model;
}

function renderSummary(target, summary, model) {
  target.replaceChildren();
  const title = document.createElement('h2'); title.className = 'json-viewer-panel-title'; title.textContent = 'StageModel Summary';
  const grid = document.createElement('dl'); grid.className = 'json-viewer-summary-grid';
  for (const [key, value] of [['fileName', summary.source.fileName || '—'], ['kind', summary.source.kind || '—'], ['attAvailable', summary.source.attAvailable], ['schema', model?.schema || RVM_STAGE_SCHEMA], ['nodes', summary.counts.hierarchyNodes], ['primitives', summary.counts.totalPrimitives], ['decoded', summary.counts.decodedPrimitives], ['unsupported', summary.counts.unsupportedPrimitives], ['failed', summary.counts.failedPrimitives], ['parserComplete', summary.parser.parserComplete], ['visualParityClaimed', summary.parser.visualParityClaimed]]) addPair(grid, key, value);
  target.append(title, grid);
}

function renderCoverage(target, rows, model) {
  target.replaceChildren(); const title = document.createElement('h2'); title.className = 'json-viewer-panel-title'; title.textContent = 'Primitive Code Coverage';
  const table = document.createElement('table'); table.className = 'json-viewer-coverage-table'; const body = document.createElement('tbody');
  const header = document.createElement('tr'); for (const text of ['Code', 'Kind', 'Status', 'Count']) { const th = document.createElement('th'); th.textContent = text; header.appendChild(th); } table.appendChild(header);
  for (const row of rows) { const tr = document.createElement('tr'); for (const value of [row.code, row.kind, row.status, row.count]) { const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td); } body.appendChild(tr); }
  table.appendChild(body); target.append(title, table); renderJsonViewerDataHealth(target, model);
}

function addPair(grid, key, value) { const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = key; dd.textContent = String(value); grid.append(dt, dd); }

function updateStatus(handles, state) {
  const model = state.model, summary = deriveRvmStageUiSummary(model, state.workerDiagnostics);
  handles.statusText.textContent = state.statusText; handles.schemaText.textContent = `schema: ${model?.schema || RVM_STAGE_SCHEMA}`; handles.sourceText.textContent = `source: ${state.sourceFileName || model?.source?.fileName || '—'}`;
  handles.nodeText.textContent = `nodes: ${summary.counts.hierarchyNodes}`; handles.componentText.textContent = `components: ${model?.components?.length || 0}`; handles.primitiveText.textContent = `primitives: ${summary.counts.totalPrimitives}`;
  handles.decodedText.textContent = `decoded: ${summary.counts.decodedPrimitives}`; handles.unsupportedText.textContent = `unsupported: ${summary.counts.unsupportedPrimitives}`; handles.failedText.textContent = `failed: ${summary.counts.failedPrimitives}`;
  handles.diagnosticsText.textContent = `diagnostics: ${diagnosticCount(state)}`; handles.qualityText.textContent = `quality: ${state.renderQuality}`; handles.planEntryText.textContent = `plan entries: ${state.renderPlan?.summary?.totalEntries || 0}`; handles.planDiagnosticText.textContent = `render diagnostic: ${state.renderPlan?.summary?.diagnosticOnly || 0}`;
  if (handles.qualitySelect && handles.qualitySelect.value !== state.renderQuality) handles.qualitySelect.value = state.renderQuality;
  handles.selectedText.textContent = state.selectedRefs?.length > 1 ? `selected: ${state.selectedRefs.length}` : state.selectedRef ? `selected: ${state.selectedRef.type} ${state.selectedRef.id}` : 'selected: none';
  handles.objectsText.textContent = `objects: ${(state.renderPlan?.entries || []).filter((entry) => entry.output !== 'hidden').length}`;
  const stats = state.visibilityStats || visibilityStats(state.previewRenderer);
  handles.visibleText.textContent = `visible: ${stats.visible || 0}/${stats.total || 0}`;
  handles.hiddenText.textContent = `hidden: ${state.visibility?.hiddenKeys?.size || stats.hidden || 0}`;
  handles.clipText.textContent = state.clipResult?.summary || clipSummary(state.clip);
  handles.tagText.textContent = `tags: ${tagOverlaySummary(state.tags, state.tagDraft)}`;
  handles.unitsText.textContent = `units: ${model?.source?.units || 'mm'}`;
}

function acceptModel(model, sourceName, state, statusText = `Loaded ${sourceName}`) {
  const validation = validateRvmStageModel(model); state.sourceFileName = sourceName; state.previewDiagnostics = []; state.previewFitPending = true;
  if (!validation.valid) return rejectModel(validation.errors, state); state.model = model; state.selectedRef = defaultSelection(model); state.selectedRefs = state.selectedRef ? [state.selectedRef] : []; state.validationErrors = []; state.activePanel = 'properties'; state.statusText = statusText; 
  import('../stage/render/StagePreviewObjectSearch.js').then(m => { state.searchIndex = m.buildJsonSearchIndex(model); });
  return true;
}
function rejectModel(errors, state) { clearLoadedModel(state); state.validationErrors = errors; state.activePanel = 'diagnostics'; state.statusText = 'Invalid staged model'; return false; }
function renderSidePanels(handles, state) {
  renderHierarchyTree(handles.hierarchyList, state.model, state.selectedRef, state);
  renderProperties(handles.propertiesPanel, state.model, state.selectedRef);
  renderEngDataPanel(handles.engDataPanel, state.model, state.selectedRef);
  renderTagsPanel(handles.tagsPanel, state.tags, state.tagDraft, state.tagCapture, state.sourceFileName);
  renderClipPanel(handles.clipPanel, state.clip, state.clipResult);
  renderDiagnostics(handles.diagnosticsPanel, state.model?.diagnostics, state.validationErrors, state.renderPlan?.diagnostics || [], state.workerDiagnostics);
  renderHiddenList(handles.hiddenList, hiddenVisibilityRows(state.model, state));
  renderJsonViewerEnrichmentPanel(handles.enrichmentPanel, state.model, state.selectedRef, state.enrichment);
  for (const button of handles.shell.querySelectorAll('[data-component-filter]')) button.classList.toggle('is-active', button.dataset.componentFilter === state.componentFilter);
  renderDrawerContent(handles.bottomDrawerContent, state);
  updateStatus(handles, state); activatePanel(state.activePanel, handles, state);
}
function renderAll(handles, state) { renderEvidencePanels(handles, state); renderPreview(handles, state); renderSidePanels(handles, state); }
function applyPreviewSelection(input, handles, state) { 
  if (Array.isArray(input)) { state.selectedRefs = input; state.selectedRef = input[0] || null; } 
  else { state.selectedRef = input; state.selectedRefs = input ? [input] : []; } 
  state.selectedKeys = new Set(state.selectedRefs.map(ref => `${ref.type}:${ref.id}`));
  if (state.previewRenderer) updateStagePreviewSelection(state.previewRenderer, state.model); 
  updateStatus(handles, state); 
  renderSidePanels(handles, state);
  requestAnimationFrame(() => {
    const selected = handles.hierarchyList.querySelector('.json-viewer-tree-row.is-selected');
    selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}
function normalizeSelectionInput(input) { return (Array.isArray(input) ? input : [input]).filter((ref) => ref?.type && ref?.id).map((ref) => ({ type: ref.type, id: ref.id, additive: ref.additive })); }
function selectedLabel(ref) { return `Selected ${ref.type} ${ref.id}`; }
function uniqueRefs(refs) { const out = new Map(); for (const ref of refs) out.set(`${ref.type}:${ref.id}`, { type: ref.type, id: ref.id }); return Array.from(out.values()); }
function toggleSelectionRef(selectedRefs, ref) { const key = `${ref.type}:${ref.id}`; const next = new Map((selectedRefs || []).map((item) => [`${item.type}:${item.id}`, item])); next.has(key) ? next.delete(key) : next.set(key, { type: ref.type, id: ref.id }); return Array.from(next.values()); }

async function applyWorkerResult(result, sourceName, handles, state, mode = 'stage-json') {
  appendWorkerMessages(result, state); if (!result?.ok) return applyWorkerFailure(result, handles, state, mode);
  const handoff = mode === 'rvm-binary' ? classifyRvmWorkerResult(result) : null; const accepted = acceptModel(result.stageModel, sourceName, state, handoff?.statusText || 'Worker accepted Stage JSON');
  
  if (accepted && !state.renderPlan && state.model && shouldShowZoneDensitySelector(state.model)) {
    const { showJsonViewerZoneDensitySelector } = await import('../stage/ui/JsonViewerZoneDensitySelector.js');
    const jobId = state.activeJobId;
    const selection = await showJsonViewerZoneDensitySelector(state.model, { defaultQuality: state.renderQuality, outsideQuality: 'light', selectedQuality: 'full' });
    if (state.activeJobId !== jobId) return;
    state.renderQuality = selection?.quality || state.renderQuality;
    state.qualityOverrides = selection?.qualityOverrides || {};
    state.zoneDensitySelection = selection?.selection || null;
  }
  
  updateRenderPlan(state);

  const planCheck = validateStageRenderPlan(state.renderPlan || result.renderPlan); if (accepted && planCheck.valid && result.renderPlan?.source?.quality === state.renderQuality) state.renderPlan = result.renderPlan;
  if (!planCheck.valid) state.workerDiagnostics.push({ severity: 'warning', code: 'STAGE_WORKER_RENDER_PLAN_FALLBACK', message: planCheck.errors.join('; ') }); if (handoff) state.workerDiagnostics.push(...createRvmUiDiagnostics(result)); renderAll(handles, state);
}
function applyWorkerFailure(result, handles, state, mode = 'stage-json') { appendWorkerMessages(result, state); clearLoadedModel(state, state.sourceFileName); state.validationErrors = result?.validationErrors || []; state.workerDiagnostics.push({ severity: 'error', code: result?.error?.code || 'STAGE_WORKER_FAILED', message: result?.error?.message || 'Stage worker failed' }); appendRvmDiagnostics(result, state, mode); state.activePanel = 'diagnostics'; state.statusText = mode === 'rvm-binary' ? classifyRvmWorkerResult(result).statusText : 'Worker rejected Stage JSON'; renderAll(handles, state); }
function appendRvmDiagnostics(result, state, mode) { if (mode !== 'rvm-binary') return; const context = result?.error?.context || {}; const items = [...(context.preflight?.errors || []), ...(context.preflight?.warnings || []), ...(context.warnings || [])]; for (const item of items) state.workerDiagnostics.push({ severity: 'warning', code: item.code || 'STAGE_RVM_PREFLIGHT_DETAIL', message: item.message || String(item) }); state.workerDiagnostics.push(...createRvmUiDiagnostics(result)); }

function runPreviewCommand(action, handles, state) { 
  if (!state.model || !state.renderPlan || !state.previewRenderer) { state.statusText = `${action} requested - no preview loaded`; return renderAll(handles, state); } 
  pushStagePreviewCameraSnapshot(state.previewRenderer);
  if (action === 'fit') { state.selectedRef ? fitStagePreviewToSelection(state.previewRenderer, state.model, state.selectedRef) : fitStagePreviewToRenderPlan(state.previewRenderer, state.renderPlan); state.statusText = state.selectedRef ? 'Fit applied to selection' : 'Fit applied to preview'; } 
  if (action === 'reset') { resetStagePreview(state.previewRenderer); state.statusText = 'Preview camera reset'; } 
  if (action === 'fit-selection') { fitStagePreviewToSelection(state.previewRenderer, state.model, state.selectedRef); state.statusText = 'Fit applied to selection'; } 
  updateStatus(handles, state); 
}
function restoreHistory(direction, handles, state) { const ok = direction === 'undo' ? undoJsonViewerState(state) : redoJsonViewerState(state); if (!ok) { state.statusText = `${direction}: no command`; return updateStatus(handles, state); } if (state.previewRenderer) { state.previewRenderer.selectedRef = state.selectedRef; state.previewRenderer.selectedRefs = state.selectedRefs || []; updateStagePreviewSelection(state.previewRenderer, state.model); syncPreviewTools(state.previewRenderer, state); } state.statusText = `${direction}: restored`; renderSidePanels(handles, state); }
function loadSample(handles, state) { try { resetToolState(state); state.workerDiagnostics = []; state.workerDiagnosticKeys = new Set(); state.activeJobId = ''; acceptModel(createSampleRvmStageModelV1(), SAMPLE_SOURCE_NAME, state); updateRenderPlan(state); } catch (error) { clearLoadedModel(state, SAMPLE_SOURCE_NAME); state.validationErrors = [`Sample load failed: ${error?.message || error}`]; state.activePanel = 'diagnostics'; state.statusText = 'Sample load failed'; } renderAll(handles, state); }
async function loadStageFile(file, handles, state) { resetForWorkerFile(state, file.name, `reading-file: ${file.name}`); renderAll(handles, state); const text = await file.text(); const fileHash = await hashStageJsonText(file, text); const job = createStageJsonWorkerJob({ text, fileName: file.name, fileSize: file.size, fileHash }); await runWorkerJob(job, handles, state, (result) => applyWorkerResult(result, file.name, handles, state)); handles.fileInput.value = ''; }
async function loadRvmFile(file, handles, state) { resetForWorkerFile(state, file.name, `RVM binary selected: ${file.name}`); renderAll(handles, state); const arrayBuffer = await file.arrayBuffer(); const fileHash = await hashArrayBuffer(file, arrayBuffer, 'rvm-binary'); const job = createRvmBinaryWorkerJob({ arrayBuffer, fileName: file.name, fileSize: file.size, fileHash }); await runWorkerJob(job, handles, state, (result) => applyWorkerResult(result, file.name, handles, state, 'rvm-binary')); handles.rvmFileInput.value = ''; }
function loadQueryArtifact(handles, state) {
  const params = new URLSearchParams(window.location.search || '');
  const stageJson = params.get('stageJson');
  const rvm = params.get('rvm');
  const target = stageJson || rvm;
  if (!target) return;
  const kind = rvm ? 'rvm-binary' : 'stage-json';
  const url = new URL(target, window.location.href);
  if (url.origin !== window.location.origin) { state.statusText = 'Query artifact blocked: cross-origin URL'; renderAll(handles, state); return; }
  state.statusText = `Loading query artifact: ${url.pathname.split('/').pop()}`;
  renderAll(handles, state);
  fetch(url.href)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return kind === 'rvm-binary' ? response.arrayBuffer() : response.text();
    })
    .then((payload) => {
      const name = decodeURIComponent(url.pathname.split('/').pop() || (kind === 'rvm-binary' ? 'query.rvm' : 'query-stage-model.json'));
      if (kind === 'rvm-binary') return loadRvmFile({ name, size: payload.byteLength, arrayBuffer: async () => payload }, handles, state);
      return loadStageFile({ name, size: new TextEncoder().encode(payload).byteLength, text: async () => payload }, handles, state);
    })
    .catch((error) => {
      clearLoadedModel(state, url.pathname);
      state.validationErrors = [`Query artifact load failed: ${error?.message || error}`];
      state.activePanel = 'diagnostics';
      state.statusText = 'Query artifact load failed';
      renderAll(handles, state);
    });
}
function resetForWorkerFile(state, fileName, statusText) { disposeWorkerClient(state); resetToolState(state); clearLoadedModel(state, fileName); state.workerDiagnostics = []; state.workerDiagnosticKeys = new Set(); state.activePanel = 'diagnostics'; state.statusText = statusText; }
function resetToolState(state) { state.visibility = createStageVisibilityState(); state.clip = createStageClipState(); state.clipResult = null; state.visibilityStats = { total: 0, visible: 0, hidden: 0 }; state.tags = []; state.tagDraft = null; state.tagCapture = { active: false, anchor: null }; state.componentFilter = 'all'; state.boxSelectActive = false; state.marqueeActive = false; state.measureActive = false; }
async function runWorkerJob(job, handles, state, applyResult) { state.activeJobId = job.jobId; try { const result = await runStageWorkerClientJob(ensureWorkerClient(handles, state), job); if (state.activeJobId === job.jobId) await applyResult(result); } catch (error) { if (state.activeJobId === job.jobId) applyWorkerFailure({ error: { code: 'STAGE_WORKER_CLIENT_ERROR', message: error?.message || String(error) } }, handles, state, job.kind); } }
async function hashStageJsonText(file, text) { return hashBytes(file, new TextEncoder().encode(text), 'stage-json'); }
async function hashArrayBuffer(file, arrayBuffer, kind) { return hashBytes(file, new Uint8Array(arrayBuffer), kind); }
async function hashBytes(file, bytes, kind) { const cryptoApi = globalThis.crypto?.subtle; if (!cryptoApi) return `sha256-${kind}-${file.name}-${file.size}-${bytes.byteLength}`; const digest = await cryptoApi.digest('SHA-256', bytes); return `sha256-${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`; }
function downloadStageModel(handles, state) { if (!state.model) return; const download = buildStageModelDownload(state.model, state.sourceFileName); const url = URL.createObjectURL(new Blob([download.text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = download.fileName; a.click(); URL.revokeObjectURL(url); state.statusText = `Downloaded ${download.fileName}`; updateStatus(handles, state); }
function downloadSelectionJson(handles, state, mode = 'element') { const refs = selectionRefs(state); const payload = buildJsonViewerSelectionPayload(state.model, state.sourceFileName, refs, mode); downloadBlob(`json-viewer-selection-${mode}.json`, JSON.stringify(payload, null, 2), 'application/json'); state.statusText = `Exported ${payload.selected.length} ${mode} selection item(s)`; updateStatus(handles, state); }
// Converter export seed: accepts viewer handles/state, downloads a schema-stamped JSON payload, and reports a status-only fallback when no model is loaded.
function downloadConverterJson(handles, state) {
  if (!state.model) { state.statusText = 'Converter JSON unavailable: load a model first'; updateStatus(handles, state); return; }
  const refs = state.selectedRefs?.length ? state.selectedRefs : state.selectedRef ? [state.selectedRef] : [];
  const payload = buildRvmConverterJsonPayload({ model: state.model, sourceFileName: state.sourceFileName, selectedRefs: refs });
  openConverterJsonDialog(payload, (finalPayload, sideLoad) => {
    downloadBlob('rvm-converter-stage.json', JSON.stringify(finalPayload, null, 2), 'application/json');
    const candidates = finalPayload.rvmAttContext?.supportCandidates?.length || 0;
    const matched = sideLoad?.matchedRows || 0;
    state.statusText = `Exported converter JSON (${refs.length} selected ref${refs.length === 1 ? '' : 's'}, ${candidates} support candidate${candidates === 1 ? '' : 's'}, ${matched} side-load match${matched === 1 ? '' : 'es'})`;
    updateStatus(handles, state);
  });
}
function downloadSnapshot(handles, state) { const dataUrl = state.previewRenderer?.renderer?.domElement?.toDataURL?.('image/png'); if (!dataUrl) { state.statusText = 'Snapshot unavailable'; return updateStatus(handles, state); } const a = document.createElement('a'); a.href = dataUrl; a.download = 'json-viewer-snapshot.png'; a.click(); state.statusText = 'Exported viewport snapshot'; updateStatus(handles, state); }
function downloadBlob(name, text, type) { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function selectionRefs(state) { return state.selectedRefs?.length ? state.selectedRefs : state.selectedRef ? [state.selectedRef] : []; }

const TOOL_ACTIONS = { 'tool-select': 'select', 'tool-orbit': 'orbit', 'tool-pan': 'pan' };
function setActiveTool(action, handles, state) {
  state.activeTool = TOOL_ACTIONS[action] || 'select';
  state.marqueeActive = false; state.measureActive = false; state.boxSelectActive = false;
  applyToolState(handles, state);
  state.statusText = `Tool: ${state.activeTool}`;
  updateStatus(handles, state);
}
function toggleMarquee(handles, state) {
  state.marqueeActive = !state.marqueeActive; state.measureActive = false; state.boxSelectActive = false;
  applyToolState(handles, state);
  state.statusText = state.marqueeActive ? 'Marquee Zoom: drag a window' : `Tool: ${state.activeTool}`;
  updateStatus(handles, state);
}
function toggleBoxSelect(handles, state) {
  state.boxSelectActive = !state.boxSelectActive; state.marqueeActive = false; state.measureActive = false;
  applyToolState(handles, state);
  state.statusText = state.boxSelectActive ? 'Box Select: drag a window' : `Tool: ${state.activeTool}`;
  updateStatus(handles, state);
}
function toggleMeasure(handles, state) {
  state.measureActive = !state.measureActive; state.marqueeActive = false; state.boxSelectActive = false;
  applyToolState(handles, state);
  if (!state.measureActive) { handles.measureReadout.hidden = true; handles.measureReadout.textContent = ''; }
  state.statusText = state.measureActive ? 'Measure: select first point' : `Tool: ${state.activeTool}`;
  updateStatus(handles, state);
}
function cancelActiveModes(handles, state) {
  state.marqueeActive = false; state.measureActive = false; state.boxSelectActive = false; state.tagCapture = { active: false, anchor: null }; state.tagDraft = null;
  state.enrichment.open = false; handles.measureReadout.hidden = true; handles.measureReadout.textContent = '';
  applyToolState(handles, state); state.statusText = 'Esc: active tools cancelled'; renderSidePanels(handles, state);
}
function applyToolState(handles, state) {
  const cameraMode = state.marqueeActive || state.measureActive || state.boxSelectActive ? 'select' : state.activeTool;
  if (state.previewRenderer) { setStagePreviewCameraMode(state.previewRenderer, cameraMode); setStagePreviewMarqueeActive(state.previewRenderer, state.marqueeActive); setStagePreviewBoxSelectActive(state.previewRenderer, state.boxSelectActive); setStagePreviewMeasureActive(state.previewRenderer, state.measureActive); }
  for (const [button, tool] of [[handles.selectToolButton, 'select'], [handles.orbitToolButton, 'orbit'], [handles.panToolButton, 'pan']]) button.classList.toggle('is-active', !state.marqueeActive && !state.measureActive && !state.boxSelectActive && state.activeTool === tool);
  handles.boxSelectButton.classList.toggle('is-active', state.boxSelectActive);
  handles.marqueeZoomButton.classList.toggle('is-active', state.marqueeActive);
  handles.measureToolButton.classList.toggle('is-active', state.measureActive);
}
const VIEW_ACTIONS = { 'view-iso': 'iso', 'view-top': 'top', 'view-front': 'front', 'view-side': 'side' };
function applyViewPreset(action, handles, state) { 
  if (!state.previewRenderer) return; 
  pushStagePreviewCameraSnapshot(state.previewRenderer);
  setStagePreviewView(state.previewRenderer, VIEW_ACTIONS[action]); 
  state.statusText = `View: ${VIEW_ACTIONS[action]}`; 
  updateStatus(handles, state); 
}

export function renderViewer3DJson(root) {
  const handles = createJsonViewerShell(root);
  const state = { model: null, renderPlan: null, previewRenderer: null, workerClient: null, previewDiagnostics: [], workerDiagnostics: [], workerDiagnosticKeys: new Set(), previewFitPending: false, activeJobId: '', sourceFileName: '', selectedRef: null, selectedRefs: [], validationErrors: [], renderQuality: 'full', qualityOverrides: {}, zoneDensitySelection: null, activePanel: 'properties', statusText: 'Ready', activeTool: 'select', marqueeActive: false, measureActive: false, boxSelectActive: false, projectionMode: 'perspective', searchIndex: [], history: createJsonViewerHistory(), enrichment: createJsonViewerEnrichmentState() };
  resetToolState(state);
  const api = {
    renderSidePanels: () => renderSidePanels(handles, state),
    syncPreviewTools: () => { if (state.previewRenderer) syncPreviewTools(state.previewRenderer, state); },
    updateStatus: () => updateStatus(handles, state),
    setPanel: (panel) => { state.activePanel = panel; },
    loadStageFile: (file) => loadStageFile(file, handles, state),
    loadRvmFile: (file) => loadRvmFile(file, handles, state),
    loadSample: () => loadSample(handles, state),
    downloadStageModel: () => downloadStageModel(handles, state),
    downloadSelectionJson: (mode) => downloadSelectionJson(handles, state, mode),
    downloadConverterJson: () => downloadConverterJson(handles, state),
    downloadSnapshot: () => downloadSnapshot(handles, state),
    recordUndo: () => pushJsonViewerUndo(state),
    restoreHistory: (direction) => restoreHistory(direction, handles, state),
    runPreviewCommand: (action) => runPreviewCommand(action, handles, state),
    setActiveTool: (action) => setActiveTool(action, handles, state),
    toggleBoxSelect: () => toggleBoxSelect(handles, state),
    toggleMarquee: () => toggleMarquee(handles, state),
    toggleMeasure: () => toggleMeasure(handles, state),
    toggleOrtho: () => { 
      if (!state.previewRenderer) return; 
      import('../stage/render/StageThreePreviewRenderer.js').then(m => {
        state.projectionMode = state.projectionMode === 'orthographic' ? 'perspective' : 'orthographic';
        m.setStagePreviewProjection(state.previewRenderer, state.projectionMode);
        handles.orthoToggleButton?.classList.toggle('is-active', state.projectionMode === 'orthographic');
        state.statusText = `Projection: ${state.projectionMode}`;
        updateStatus(handles, state);
      });
    },
    openSearch: () => {
      import('../stage/ui/JsonViewerSearchDialog.js').then(m => {
        m.openSearch(state.searchIndex, (result) => {
          if (result.action === 'fit') {
            applyPreviewSelection(result.ref, handles, state);
            api.runPreviewCommand('fit-selection');
            m.closeSearch();
          } else if (result.action === 'isolate') {
            applyPreviewSelection(result.ref, handles, state);
            const evt = new CustomEvent('click', { bubbles: true });
            handles.isolateButton?.dispatchEvent(evt);
            m.closeSearch();
          } else if (result.action === 'hide') {
            const evt = { target: { closest: () => ({ dataset: { visibilityToggleType: result.ref.type, visibilityToggleId: result.ref.id } }) } };
            // Handled via interaction controller tree click emulation or directly:
            state.visibility = createNextVisibilityState(state.visibility, 'hide', result.ref); 
            api.syncPreviewTools(); api.renderSidePanels();
          } else if (result.action === 'copy') {
            navigator.clipboard.writeText(result.ref.id);
            state.statusText = 'Copied ID: ' + result.ref.id;
            updateStatus(handles, state);
          }
        });
      });
    },
    reindexSearch: () => {
      import('../stage/render/StagePreviewObjectSearch.js').then(m => {
        state.searchIndex = m.buildJsonSearchIndex(state.model);
        state.statusText = 'Re-indexed search';
        updateStatus(handles, state);
      });
    },
    cancelActiveModes: () => cancelActiveModes(handles, state),
    applyViewPreset: (action) => applyViewPreset(action, handles, state),
    applyPreviewSelection: (ref) => applyPreviewSelection(ref, handles, state),
    changeQuality: (quality) => { state.renderQuality = quality; updateRenderPlan(state); renderAll(handles, state); },
    applyQualityOverrides: () => { updateRenderPlan(state); renderAll(handles, state); },
    changeColorBy: (colorBy) => { setStagePreviewColorBy(state.previewRenderer, colorBy); },
    setExplode: (factor) => { if (!state.previewRenderer) return; setStagePreviewExplode(state.previewRenderer, factor); },
    setExplodeAxis: (axis) => { 
      if (!state.previewRenderer) return; 
      state.previewRenderer.explodeAxis = axis; 
      setStagePreviewExplode(state.previewRenderer, state.previewRenderer.explodeFactor || 0); 
    },
    resetExplode: () => { if (!state.previewRenderer) return; setStagePreviewExplode(state.previewRenderer, 0); if (handles.explodeSlider) handles.explodeSlider.value = 0; },
    stepViewHistory: (direction) => { if (!state.previewRenderer) return; stepStagePreviewCameraHistory(state.previewRenderer, direction); },
    applyEnrichment: () => applyEnrichment(handles, state, api),
  };
  state.controller = createJsonViewerInteractionController(handles, state, api);
  handles.qualitySelect.value = state.renderQuality; const cleanup = state.controller.wireEvents(); renderAll(handles, state); loadQueryArtifact(handles, state);
  return () => { cleanup(); disposeWorkerClient(state); disposePreview(state); };
}

function applyEnrichment(handles, state, api) {
  if (!state.model) return;
  api.recordUndo();
  import('../stage/render/StageJsonEnrichmentEngine.js').then(m => {
    const enrichedMap = m.runJsonViewerEnrichment(state.model, state.enrichment);
    
    // Apply to nodes
    if (state.model.hierarchy?.nodes) {
      for (const node of state.model.hierarchy.nodes) {
        if (enrichedMap.has(node.id)) {
          node.enrichedAttributes = enrichedMap.get(node.id);
        }
      }
    }
    
    // Apply to components
    if (state.model.components) {
      for (const comp of state.model.components) {
        if (comp.nodeId && enrichedMap.has(comp.nodeId)) {
          comp.enrichedAttributes = enrichedMap.get(comp.nodeId);
        }
      }
    }
    
    state.enrichment.coverageStats = m.summarizeEnrichmentCoverage(enrichedMap);
    state.statusText = `Enrichment applied: ${state.enrichment.coverageStats.full} full matches`;
    renderAll(handles, state);
  }).catch(err => {
    state.statusText = `Enrichment failed: ${err.message}`;
    renderAll(handles, state);
  });
}
