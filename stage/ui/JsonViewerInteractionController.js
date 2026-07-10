import { fitStagePreviewToSelection, updateStagePreviewSelection } from '../render/StageThreePreviewRenderer.js';
import { clipSummary, createNextClipState } from '../render/StagePreviewClipTools.js';
import { createNextVisibilityState, isRefHiddenByVisibility } from '../render/StagePreviewVisibilityTools.js';
import { parseJsonViewerTags, serializeJsonViewerTags } from './JsonViewerTagXml.js';
import { parseSelectedGeometryMasterFile } from '../../enrichment/selected-geometry-master-parser.js';

/**
 * Wires Stage JSON viewer commands to renderer state.
 * Parameters: shell handles, mutable tab state, and bound renderer callbacks.
 * Outputs: cleanup and canvas tag-capture handlers used by the tab renderer.
 * Fallback: commands with no loaded model update status instead of throwing.
 */

const TOOL_ACTIONS = { 'tool-select': 'select', 'tool-orbit': 'orbit', 'tool-pan': 'pan' };
const VIEW_ACTIONS = { 'view-iso': 'iso', 'view-top': 'top', 'view-front': 'front', 'view-side': 'side' };
const VISIBILITY_ACTIONS = { 'hide-selection': 'hide', 'unhide-selection': 'unhide', 'isolate-selection': 'isolate', 'show-all': 'show-all' };
const CLIP_ACTIONS = new Set(['clip-box-selection', 'clip-box-model', 'clip-plane', 'clip-clear']);

export function createJsonViewerInteractionController(handles, state, api) {
  const onToolbarClick = (event) => {
    const explodeBtn = event.target?.closest?.('[data-explode-axis]');
    if (explodeBtn) {
       const axis = explodeBtn.dataset.explodeAxis;
       handles.explodeAxisGroup.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.explodeAxis === axis));
       api.setExplodeAxis(axis);
       return;
    }
    const action = event.target?.closest?.('[data-action]')?.dataset?.action; if (!action) return;
    if (action === 'open-stage-json') return handles.fileInput.click();
    if (action === 'open-rvm') return handles.rvmFileInput.click();
    if (action === 'download-stage-model' || action === 'export-stage') return api.downloadStageModel();
    if (action === 'export-selection' || action === 'export-selection-element') return api.downloadSelectionJson('element');
    if (action === 'export-selection-node') return api.downloadSelectionJson('node');
    if (action === 'export-converter-json') return api.downloadConverterJson();
    if (action === 'export-snapshot') return api.downloadSnapshot();
    if (action === 'undo' || action === 'redo') return api.restoreHistory(action);
    if (action === 'load-sample') return api.loadSample();
    if (action === 'show-diagnostics') return setPanel('diagnostics', api);
    if (action === 'clear-selection') return clearSelection(state, api);
    if (action === 'toggle-left-panel' || action === 'toggle-right-panel') return togglePanel(handles, action);
    if (action.startsWith('enrich-')) return handleEnrichmentAction(action, state, api);
    if (applyVisibilityAction(action, state, api)) return;
    if (CLIP_ACTIONS.has(action)) return applyClipAction(action, state, api);
    if (handleTagAction(action, handles, state, api)) return;
    if (action.startsWith('multi-select-')) {
      const mode = action.replace('multi-select-', '');
      if (mode === 'all') {
        const visibleCheckboxes = Array.from(handles.hierarchyList.querySelectorAll('.json-viewer-tree-checkbox')).filter(cb => cb.closest('.json-viewer-tree-item').style.display !== 'none');
        state.selectedKeys = new Set(visibleCheckboxes.map(cb => `${cb.dataset.checkType}:${cb.dataset.checkId}`));
      } else if (mode === 'clear') {
        state.selectedKeys = new Set();
      } else if (mode === 'hide') {
        if (!state.selectedKeys?.size) return;
        state.selectedKeys.forEach(key => {
          const [type, id] = key.split(':');
          state.visibility = createNextVisibilityState(state.visibility, 'hide', { type, id });
        });
      } else if (mode === 'show') {
        if (!state.selectedKeys?.size) return;
        state.selectedKeys.forEach(key => {
          const [type, id] = key.split(':');
          state.visibility = createNextVisibilityState(state.visibility, 'unhide', { type, id });
        });
      } else if (mode === 'fit') {
        if (!state.selectedKeys?.size) return;
        const refs = Array.from(state.selectedKeys).map(key => { const [type, id] = key.split(':'); return { type, id }; });
        api.applyPreviewSelection(refs);
        return api.runPreviewCommand('fit-selection');
      }
      api.syncPreviewTools(); api.renderSidePanels(); return;
    }
    if (action === 'apply-quality') {
      const q = handles.qualityOverrideSelect.value;
      if (q === 'hidden') {
        if (!state.selectedKeys?.size) return;
        state.selectedKeys.forEach(key => {
          const [type, id] = key.split(':');
          state.visibility = createNextVisibilityState(state.visibility, 'hide', { type, id });
        });
        api.syncPreviewTools(); api.renderSidePanels();
      } else {
        if (!state.selectedKeys?.size) return;
        state.selectedKeys.forEach(key => {
          const [type, id] = key.split(':');
          state.qualityOverrides = state.qualityOverrides || {};
          state.qualityOverrides[`${type}:${id}`] = q;
        });
        api.applyQualityOverrides();
      }
      return;
    }
    if (action === 'toggle-drawer') {
      const drawer = handles.bottomDrawer;
      const isCollapsed = drawer.classList.contains('is-collapsed');
      drawer.classList.toggle('is-collapsed', !isCollapsed);
      event.target.innerHTML = isCollapsed ? '▼' : '▲';
      return;
    }
    if (action === 'search-open') return api.openSearch();
    if (action === 'search-reindex') return api.reindexSearch();
    if (action === 'fit' || action === 'reset' || action === 'fit-selection') return api.runPreviewCommand(action);
    if (TOOL_ACTIONS[action]) return api.setActiveTool(action);
    if (action === 'tool-box-select') return api.toggleBoxSelect();
    if (action === 'tool-marquee') return api.toggleMarquee();
    if (action === 'tool-measure') return api.toggleMeasure();
    if (action === 'toggle-ortho') return api.toggleOrtho();
    if (VIEW_ACTIONS[action]) return api.applyViewPreset(action);
    if (action === 'view-prev') return api.stepViewHistory('prev');
    if (action === 'view-next') return api.stepViewHistory('next');
    if (action === 'explode-reset') return api.resetExplode();
  };
  const onNavInput = (event) => {
    if (event.target.dataset.action === 'explode-factor') {
      api.setExplode(event.target.value / 100);
    }
  };
  const onFileChange = (event) => { const file = event.target.files?.[0]; if (file) api.loadStageFile(file); };
  const onRvmFileChange = (event) => { const file = event.target.files?.[0]; if (file) api.loadRvmFile(file); };
  const onTagFileChange = (event) => { const file = event.target.files?.[0]; if (file) importTagsFile(file, handles, state, api); handles.tagFileInput.value = ''; };
  const onQualityChange = () => api.changeQuality(handles.qualitySelect.value);
  const onColorByChange = () => api.changeColorBy(handles.colorBySelect.value);
  const onTreeClick = (event) => {
    const toggle = event.target.closest?.('[data-visibility-toggle-type]');
    if (toggle) return toggleObjectVisibility(state, { type: toggle.dataset.visibilityToggleType, id: toggle.dataset.visibilityToggleId }, api);
    const tagRow = event.target.closest?.('[data-tag-row-type]');
    if (tagRow) { state.selectedRef = { type: tagRow.dataset.tagRowType, id: tagRow.dataset.tagRowId }; return startTagCapture(state, api); }
    const row = event.target.closest?.('[data-ref-type][data-ref-id]'); if (!row) return;
    api.applyPreviewSelection({ type: row.dataset.refType, id: row.dataset.refId });
    if (state.previewRenderer) fitStagePreviewToSelection(state.previewRenderer, state.model, state.selectedRef);
  };
  const onTreeChange = (event) => {
    const cb = event.target.closest('.json-viewer-tree-checkbox'); if (!cb) return;
    const type = cb.dataset.checkType; const id = cb.dataset.checkId; const key = `${type}:${id}`;
    if (!state.selectedKeys) state.selectedKeys = new Set();
    const isChecked = cb.checked;
    
    // Cascading logic to children
    const item = cb.closest('.json-viewer-tree-item');
    if (item) {
      const depth = parseInt(item.style.getPropertyValue('--json-tree-depth')) || 0;
      const checkboxes = [cb];
      let next = item.nextElementSibling;
      while (next) {
        const nextDepth = parseInt(next.style.getPropertyValue('--json-tree-depth')) || 0;
        if (nextDepth <= depth) break;
        const nextCb = next.querySelector('.json-viewer-tree-checkbox');
        if (nextCb) checkboxes.push(nextCb);
        next = next.nextElementSibling;
      }
      for (const box of checkboxes) {
        const k = `${box.dataset.checkType}:${box.dataset.checkId}`;
        if (isChecked) state.selectedKeys.add(k);
        else state.selectedKeys.delete(k);
      }
    } else {
      if (isChecked) state.selectedKeys.add(key);
      else state.selectedKeys.delete(key);
    }
    state.selectedRefs = Array.from(state.selectedKeys).map(k => { const [type, id] = k.split(':'); return { type, id }; });
    state.selectedRef = state.selectedRefs[0] || null;
    if (state.previewRenderer) {
      state.previewRenderer.selectedRefs = state.selectedRefs;
      state.previewRenderer.selectedRef = state.selectedRef;
      // We assume updateStagePreviewSelection is called, but we can call api.applyPreviewSelection instead of manual sync.
    }
    // Actually, calling api.applyPreviewSelection will reset selectedKeys because we haven't updated it yet.
    // Let's just update renderer selection manually or we should change applyPreviewSelection to accept Set.
    // I will call api.applyPreviewSelection with the array.
    api.applyPreviewSelection(state.selectedRefs);
  };
  const onTreeFilter = () => {
    const query = handles.treeFilterInput.value.trim().toLowerCase();
    for (const item of handles.hierarchyList.querySelectorAll('.json-viewer-tree-item')) item.style.display = !query || item.textContent.toLowerCase().includes(query) ? '' : 'none';
  };
  const onShellClick = (event) => {
    const filter = event.target?.closest?.('[data-component-filter]')?.dataset?.componentFilter;
    if (filter) { state.componentFilter = filter; api.renderSidePanels(); }
    const tab = event.target?.closest?.('[data-enrich-tab]')?.dataset?.enrichTab;
    if (tab) { state.enrichment.activeTab = tab; api.renderSidePanels(); return; }
    // Only route actions that are NOT inside the toolbar or navRow (those already have dedicated listeners)
    // This routes viewcube, panel-collapse, enrichment panel and other canvas-area buttons
    if (event.target?.closest?.('.json-viewer-toolbar') || event.target?.closest?.('.json-viewer-command-ribbon')) return;
    const action = event.target?.closest?.('[data-action]')?.dataset?.action;
    if (action) onToolbarClick(event);
  };
  const onShellInput = (event) => {
    const input = event.target?.closest?.('[data-enrich-input]'); if (!input) return;
    const key = input.dataset.enrichInput; const numeric = input.type === 'number';
    state.enrichment[key] = numeric ? Number(input.value) : input.value;
    api.renderSidePanels();
  };
  const onShellChange = (event) => {
    const input = event.target?.closest?.('[data-enrich-master]'); if (!input) return;
    importEnrichmentMaster(input, state, api).catch((error) => status(`Master import failed: ${error?.message || error}`, state, api));
  };
  const onHiddenClick = (event) => {
    const row = event.target?.closest?.('[data-restore-ref-type]'); if (!row) return;
    state.visibility = createNextVisibilityState(state.visibility, 'unhide', { type: row.dataset.restoreRefType, id: row.dataset.restoreRefId });
    api.syncPreviewTools(); api.renderSidePanels();
  };
  const onRightClick = (event) => {
    const panel = event.target?.dataset?.panel; if (panel) return setPanel(panel, api);
    const axis = event.target?.closest?.('[data-clip-axis]')?.dataset?.clipAxis; 
    if (axis) { 
      state.clip = createNextClipState(state.clip, 'axis', { value: axis }); 
      if (state.clip.mode === 'plane') applyClipAction('clip-plane', state, api);
      else api.syncPreviewTools();
      return;
    }
    const focusId = event.target?.closest?.('[data-tag-focus]')?.dataset?.tagFocus; if (focusId) return focusTag(focusId, state, api);
    const toggleId = event.target?.closest?.('[data-tag-toggle]')?.dataset?.tagToggle; if (toggleId) return toggleTagVisibility(toggleId, state, api);
    const deleteId = event.target?.closest?.('[data-tag-delete]')?.dataset?.tagDelete; if (deleteId) return deleteTag(deleteId, state, api);
    const action = event.target?.closest?.('[data-action]')?.dataset?.action; if (action) { event.stopPropagation(); onToolbarClick(event); }
  };
  const onRightInput = (event) => {
    if (event.target?.matches?.('[data-clip-percent], [data-clip-percent-number]')) { state.clip = createNextClipState(state.clip, 'percent', { value: event.target.value }); applyClipAction('clip-plane', state, api); }
    if (event.target?.matches?.('[data-clip-invert]')) { state.clip = createNextClipState(state.clip, 'invert', { value: event.target.checked }); applyClipAction('clip-plane', state, api); }
  };
  const onRightSubmit = (event) => { const form = event.target?.closest?.('[data-tag-draft-form]'); if (form) { event.preventDefault(); saveTagDraft(form, state, api); } };
  const onDrop = (event) => { event.preventDefault(); const file = event.dataTransfer?.files?.[0]; if (!file) return; file.name.toLowerCase().endsWith('.rvm') ? api.loadRvmFile(file) : api.loadStageFile(file); };
  const onDragOver = (event) => event.preventDefault();
  const onKeyDown = (event) => { if (event.key === 'Escape') api.cancelActiveModes(); if (event.ctrlKey && event.key.toLowerCase() === 'z') api.restoreHistory('undo'); if (event.ctrlKey && event.key.toLowerCase() === 'y') api.restoreHistory('redo'); };
  const onShellPointerDown = (event) => startPanelResize(event, handles);
  return { wireEvents: () => wire(handles, { onToolbarClick, onNavInput, onFileChange, onRvmFileChange, onTagFileChange, onQualityChange, onColorByChange, onTreeClick, onTreeChange, onTreeFilter, onShellClick, onShellInput, onShellChange, onShellPointerDown, onHiddenClick, onRightClick, onRightInput, onRightSubmit, onDrop, onDragOver, onKeyDown }), handleTagCanvasClick: (hit) => handleTagCanvasClick(hit, state, api) };
}

function wire(handles, events) {
  handles.toolbar.addEventListener('click', events.onToolbarClick); handles.navRow.addEventListener('click', events.onToolbarClick); handles.navRow.addEventListener('input', events.onNavInput); handles.fileInput.addEventListener('change', events.onFileChange); handles.rvmFileInput.addEventListener('change', events.onRvmFileChange); handles.tagFileInput.addEventListener('change', events.onTagFileChange); handles.qualitySelect.addEventListener('change', events.onQualityChange); handles.colorBySelect?.addEventListener('change', events.onColorByChange); handles.hierarchyList.addEventListener('click', events.onTreeClick); handles.hierarchyList.addEventListener('change', events.onTreeChange); handles.hiddenList.addEventListener('click', events.onHiddenClick); handles.treeFilterInput.addEventListener('input', events.onTreeFilter); handles.shell.addEventListener('click', events.onShellClick); handles.shell.addEventListener('input', events.onShellInput); handles.shell.addEventListener('change', events.onShellChange); handles.shell.addEventListener('pointerdown', events.onShellPointerDown); handles.rightPanel.addEventListener('click', events.onRightClick); handles.rightPanel.addEventListener('input', events.onRightInput); handles.rightPanel.addEventListener('change', events.onRightInput); handles.rightPanel.addEventListener('submit', events.onRightSubmit); handles.shell.addEventListener('drop', events.onDrop); handles.shell.addEventListener('dragover', events.onDragOver); document.addEventListener('keydown', events.onKeyDown);
  return () => { handles.toolbar.removeEventListener('click', events.onToolbarClick); handles.navRow.removeEventListener('click', events.onToolbarClick); handles.navRow.removeEventListener('input', events.onNavInput); handles.fileInput.removeEventListener('change', events.onFileChange); handles.rvmFileInput.removeEventListener('change', events.onRvmFileChange); handles.tagFileInput.removeEventListener('change', events.onTagFileChange); handles.qualitySelect.removeEventListener('change', events.onQualityChange); handles.colorBySelect?.removeEventListener('change', events.onColorByChange); handles.hierarchyList.removeEventListener('click', events.onTreeClick); handles.hierarchyList.removeEventListener('change', events.onTreeChange); handles.hiddenList.removeEventListener('click', events.onHiddenClick); handles.treeFilterInput.removeEventListener('input', events.onTreeFilter); handles.shell.removeEventListener('click', events.onShellClick); handles.shell.removeEventListener('input', events.onShellInput); handles.shell.removeEventListener('change', events.onShellChange); handles.shell.removeEventListener('pointerdown', events.onShellPointerDown); handles.rightPanel.removeEventListener('click', events.onRightClick); handles.rightPanel.removeEventListener('input', events.onRightInput); handles.rightPanel.removeEventListener('change', events.onRightInput); handles.rightPanel.removeEventListener('submit', events.onRightSubmit); handles.shell.removeEventListener('drop', events.onDrop); handles.shell.removeEventListener('dragover', events.onDragOver); document.removeEventListener('keydown', events.onKeyDown); };
}

function setPanel(panel, api) { api.setPanel(panel); api.renderSidePanels(); }
function clearSelection(state, api) { api.recordUndo(); state.selectedRef = null; state.selectedRefs = []; state.selectedKeys = new Set(); if (state.previewRenderer) { state.previewRenderer.selectedRef = null; state.previewRenderer.selectedRefs = []; updateStagePreviewSelection(state.previewRenderer, state.model); } state.statusText = 'Selection cleared'; api.renderSidePanels(); }
function applyVisibilityAction(action, state, api) { const command = VISIBILITY_ACTIONS[action]; if (!command) return false; if (!state.model) return status('Visibility: load a model first', state, api); if (command !== 'show-all' && !state.selectedRef) return status('Visibility: select a row or object first', state, api); api.recordUndo(); state.visibility = createNextVisibilityState(state.visibility, command, state.selectedRef); state.statusText = command === 'show-all' ? 'Visibility: show all' : `Visibility: ${command} ${state.selectedRef.type} ${state.selectedRef.id}`; api.syncPreviewTools(); api.renderSidePanels(); return true; }
function toggleObjectVisibility(state, ref, api) { api.recordUndo(); const command = isRefHiddenByVisibility(ref, state.visibility) ? 'unhide' : 'hide'; state.visibility = createNextVisibilityState(state.visibility, command, ref); state.statusText = `${command === 'hide' ? 'Hidden' : 'Unhidden'} ${ref.type} ${ref.id}`; api.syncPreviewTools(); api.renderSidePanels(); }
function applyClipAction(action, state, api) { api.recordUndo(); const command = action === 'clip-clear' ? 'clear' : action.replace('clip-', ''); state.clip = createNextClipState(state.clip, command, { rendererState: state.previewRenderer, model: state.model, selectedRef: state.selectedRef }); state.activePanel = 'clip'; state.statusText = state.clip.mode === 'off' ? 'Clip: off' : clipSummary(state.clip); api.syncPreviewTools(); api.renderSidePanels(); }
function startTagCapture(state, api) { state.tagCapture = state.tagCapture.active ? { active: false, anchor: null } : { active: true, anchor: null }; state.tagDraft = state.tagCapture.active ? state.tagDraft : null; state.activePanel = 'tags'; state.statusText = state.tagCapture.active ? 'Tag: click anchor point' : 'Tag creation cancelled'; api.renderSidePanels(); }
function handleTagCanvasClick(hit, state, api) { if (!state.tagCapture.active) return; if (!hit?.point) return status('Tag: click directly on model geometry', state, api); state.activePanel = 'tags'; if (!state.tagCapture.anchor) { state.tagCapture = { active: true, anchor: hit.point }; state.statusText = 'Tag: anchor set, click label point'; } else { state.tagDraft = { anchor: state.tagCapture.anchor, labelPoint: hit.point, ref: state.selectedRef }; state.tagCapture = { active: false, anchor: null }; state.statusText = 'Tag: draft ready'; } api.syncPreviewTools(); api.renderSidePanels(); }
function saveTagDraft(form, state, api) { if (!state.tagDraft) return; api.recordUndo(); const text = form.querySelector('[data-tag-draft-text]')?.value || 'Manual tag'; const severity = form.querySelector('[data-tag-draft-severity]')?.value || 'info'; state.tags = [...state.tags, { id: `tag-${Date.now()}`, text, severity, ref: state.tagDraft.ref || state.selectedRef, anchor: state.tagDraft.anchor, labelPoint: state.tagDraft.labelPoint }]; state.tagDraft = null; state.statusText = `Tag saved: ${text}`; api.syncPreviewTools(); api.renderSidePanels(); }
function handleTagAction(action, handles, state, api) { if (action === 'tag-create') { startTagCapture(state, api); return true; } if (action === 'tag-view') { state.activePanel = 'tags'; api.renderSidePanels(); return true; } if (action === 'tag-hide-all' || action === 'tag-show-all') { setAllTagsHidden(action === 'tag-hide-all', state, api); return true; } if (action === 'tag-import') { handles.tagFileInput.click(); return true; } if (action === 'tag-export') { exportTags(state, api); return true; } if (action === 'tag-cancel-draft') { state.tagDraft = null; api.renderSidePanels(); return true; } return false; }
function exportTags(state, api) { const xml = serializeJsonViewerTags(state.tags, state.sourceFileName || state.model?.source?.fileName); const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' })); const a = document.createElement('a'); a.href = url; a.download = 'json-viewer-tags.xml'; a.click(); URL.revokeObjectURL(url); state.statusText = `Exported ${state.tags.length} tag(s)`; api.updateStatus(); }
async function importTagsFile(file, handles, state, api) { if (!file) return; api.recordUndo(); const imported = parseJsonViewerTags(await file.text()); state.tags = [...state.tags, ...imported]; state.activePanel = 'tags'; state.statusText = `Imported ${imported.length} tag(s) from ${file.name}`; api.syncPreviewTools(); api.renderSidePanels(); }
function focusTag(id, state, api) { const tag = state.tags.find((item) => item.id === id); if (!tag) return; state.selectedRef = tag.ref || state.selectedRef; state.selectedRefs = state.selectedRef ? [state.selectedRef] : []; if (state.previewRenderer && state.selectedRef) { state.previewRenderer.selectedRef = state.selectedRef; state.previewRenderer.selectedRefs = state.selectedRefs; updateStagePreviewSelection(state.previewRenderer, state.model); fitStagePreviewToSelection(state.previewRenderer, state.model, state.selectedRef); } state.statusText = `Focused tag: ${tag.text || tag.id}`; api.renderSidePanels(); }
function toggleTagVisibility(id, state, api) { api.recordUndo(); state.tags = state.tags.map((tag) => tag.id === id ? { ...tag, hidden: !tag.hidden } : tag); api.syncPreviewTools(); api.renderSidePanels(); }
function setAllTagsHidden(hidden, state, api) { api.recordUndo(); state.tags = state.tags.map((tag) => ({ ...tag, hidden })); state.statusText = hidden ? 'Tags hidden' : 'Tags shown'; api.syncPreviewTools(); api.renderSidePanels(); }
function deleteTag(id, state, api) { api.recordUndo(); state.tags = state.tags.filter((tag) => tag.id !== id); state.statusText = `Deleted tag ${id}`; api.syncPreviewTools(); api.renderSidePanels(); }
function status(text, state, api) { state.statusText = text; api.updateStatus(); return true; }

function togglePanel(handles, action) {
  const side = action === 'toggle-left-panel' ? 'left' : 'right';
  handles.shell.classList.toggle(`is-${side}-collapsed`);
}

function handleEnrichmentAction(action, state, api) {
  if (action === 'enrich-open') state.enrichment.open = true;
  if (action === 'enrich-close') state.enrichment.open = false;
  if (action === 'enrich-fullscreen') state.enrichment.fullscreen = !state.enrichment.fullscreen;
  if (action === 'enrich-run') {
    state.enrichment.lastRun = new Date().toLocaleString();
    if (api.applyEnrichment) api.applyEnrichment();
  }
  if (action === 'enrich-populate') {
    // One-click populate: run headless XML->CII enrichment when a line list is
    // loaded, otherwise open the workflow on the master import tab.
    if (Array.isArray(state.enrichment.masters?.lineList) && state.enrichment.masters.lineList.length) {
      state.enrichment.lastRun = new Date().toLocaleString();
      if (api.applyEnrichment) api.applyEnrichment();
    } else {
      state.enrichment.open = true;
      state.enrichment.activeTab = 'masters';
      state.statusText = 'Populate attributes: import the master line list (and optional piping class / material / weight masters) first';
    }
  }
  if (action === 'enrich-export-config') exportEnrichmentConfig(state);
  api.renderSidePanels();
  return true;
}

async function importEnrichmentMaster(input, state, api) {
  const file = input.files?.[0];
  if (!file) return;
  const kind = input.dataset.enrichMaster;
  const parsed = await parseSelectedGeometryMasterFile(file, kind);
  state.enrichment.masters = { ...(state.enrichment.masters || {}), [kind]: parsed.rows };
  state.enrichment.masterFiles = { ...(state.enrichment.masterFiles || {}), [kind]: { fileName: parsed.fileName, format: parsed.format, rows: parsed.rows.length } };
  state.statusText = `${kind}: ${parsed.rows.length} row(s) loaded`;
  input.value = '';
  api.renderSidePanels();
}

function exportEnrichmentConfig(state) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.enrichment, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'selected-geometry-enrichment-config.json'; a.click();
  URL.revokeObjectURL(url);
}

function startPanelResize(event, handles) {
  const grip = event.target?.closest?.('[data-panel-resize]'); if (!grip) return;
  event.preventDefault();
  const side = grip.dataset.panelResize;
  const startX = event.clientX;
  const initial = side === 'left' ? handles.leftPanel.getBoundingClientRect().width : handles.rightPanel.getBoundingClientRect().width;
  const move = (moveEvent) => {
    const delta = side === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
    const width = Math.max(220, Math.min(560, initial + delta));
    handles.body.style.setProperty(side === 'left' ? '--json-left-width' : '--json-right-width', `${width}px`);
  };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}
