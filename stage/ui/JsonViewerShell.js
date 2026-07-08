import { iconSvg } from './JsonViewerToolIcons.js';
import * as THREE from 'three';

/**
 * Builds the Stage JSON viewer UI shell.
 * Parameters: the tab root element that owns the viewer DOM.
 * Outputs: stable DOM handles for file loading, command routing, panels, and status updates.
 * Fallback: controls stay visible even before a model is loaded; actions report status in the renderer.
 */

const QUALITY_LABELS = [['full', 'Full'], ['medium', 'Medium'], ['light', 'Light'], ['skeleton', 'Skeleton'], ['hidden', 'Hidden']];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(className, text, action) {
  const node = el('button', className, text);
  node.type = 'button';
  if (action) node.dataset.action = action;
  return node;
}

function iconButton(icon, label, action, title) {
  const node = button('json-viewer-tool-btn', '', action);
  node.title = title;
  node.setAttribute('aria-label', title);
  node.innerHTML = `<span class="json-viewer-tool-icon">${iconSvg(icon)}</span><span>${label}</span>`;
  return node;
}

function statusChip(text) {
  const node = el('span', 'json-viewer-status-chip', text);
  return node;
}

function addOptions(select) {
  for (const [value, text] of QUALITY_LABELS) {
    const option = el('option', '', text);
    option.value = value;
    select.appendChild(option);
  }
}

function commandGroup(label, buttons) {
  const group = el('section', 'json-viewer-command-group');
  group.setAttribute('aria-label', `${label} tools`);
  group.append(el('span', 'json-viewer-command-label', label));
  const row = el('div', 'json-viewer-command-buttons');
  row.append(...buttons);
  group.append(row);
  return group;
}

function filterButton(label, filter, active) {
  const node = button(`json-viewer-filter-chip${active ? ' is-active' : ''}`, label, '');
  node.dataset.componentFilter = filter;
  return node;
}

export function createJsonViewerShell(root) {
  root.classList.add('json-viewer-tab-root');
  const shell = el('section', 'json-viewer-shell json-viewer-shell-revamp', '');
  shell.setAttribute('aria-label', '3D Json Viewer');

  const toolbar = el('header', 'json-viewer-toolbar', '');
  const openStageButton = button('json-viewer-button is-primary', 'Open Stage JSON', 'open-stage-json');
  const loadSampleButton = button('json-viewer-button', 'Load Sample', 'load-sample');
  const fileInput = el('input', 'json-viewer-file-input', '');
  fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
  const openRvmButton = button('json-viewer-button', 'Open RVM', 'open-rvm');
  const rvmFileInput = el('input', 'json-viewer-file-input', '');
  rvmFileInput.type = 'file'; rvmFileInput.accept = '.rvm'; rvmFileInput.hidden = true;
  const tagFileInput = el('input', 'json-viewer-file-input', '');
  tagFileInput.type = 'file'; tagFileInput.accept = '.xml,text/xml,application/xml'; tagFileInput.hidden = true;
  const downloadButton = button('json-viewer-button', 'Download RvmStageModel JSON', 'download-stage-model');
  downloadButton.disabled = true;
  const qualityLabel = el('label', 'json-viewer-quality-label', 'Render Quality');
  const qualitySelect = el('select', 'json-viewer-quality-select', '');
  qualitySelect.dataset.action = 'render-quality'; addOptions(qualitySelect); qualityLabel.appendChild(qualitySelect);
  const diagnosticsButton = button('json-viewer-button', 'Diagnostics', 'show-diagnostics');
  
  const colorByLabel = el('label', 'json-viewer-quality-label', 'Color By ');
  const colorBySelect = el('select', 'json-viewer-colorby-select', '');
  colorBySelect.dataset.action = 'color-by';
  for (const [value, text] of [['default','Default'],['componentType','Type'],['lineNo','Line No.'],['status','Status']]) {
    const opt = el('option', '', text); opt.value = value; colorBySelect.appendChild(opt);
  }
  colorByLabel.appendChild(colorBySelect);

  toolbar.append(openStageButton, loadSampleButton, fileInput, openRvmButton, rvmFileInput, tagFileInput, downloadButton, qualityLabel, colorByLabel, diagnosticsButton);

  const navRow = el('div', 'json-viewer-tool-row json-viewer-command-ribbon', '');
  const selectToolButton = iconButton('select', 'Select', 'tool-select', 'Select objects');
  const boxSelectButton = iconButton('boxSelect', 'Box Sel', 'tool-box-select', 'Box select objects');
  const orbitToolButton = iconButton('orbit', 'Orbit', 'tool-orbit', 'Orbit camera');
  const panToolButton = iconButton('pan', 'Pan', 'tool-pan', 'Pan camera');
  const undoButton = iconButton('undo', 'Undo', 'undo', 'Undo last viewer command');
  const redoButton = iconButton('redo', 'Redo', 'redo', 'Redo viewer command');
  const fitButton = iconButton('fit', 'Fit', 'fit', 'Fit all');
  const fitSelectionButton = iconButton('fit', 'Fit Sel', 'fit-selection', 'Fit selected object');
  const isoViewButton = iconButton('orbit', 'ISO', 'view-iso', 'Isometric view');
  const topViewButton = iconButton('top', 'Top', 'view-top', 'Top view');
  const frontViewButton = iconButton('top', 'Front', 'view-front', 'Front view');
  const sideViewButton = iconButton('top', 'Side', 'view-side', 'Side view');
  const orthoToggleButton = iconButton('view', 'Ortho', 'toggle-ortho', 'Toggle orthographic projection');
  const searchOpenButton = iconButton('search', 'Find', 'search-open', 'Find objects');
  const searchReindexButton = iconButton('refresh', 'Index', 'search-reindex', 'Re-index search');
  const hideButton = iconButton('hide', 'Hide', 'hide-selection', 'Hide selected');
  const unhideButton = iconButton('show', 'Unhide', 'unhide-selection', 'Unhide selected');
  const showAllButton = iconButton('show', 'Show All', 'show-all', 'Show all hidden geometry');
  const isolateButton = iconButton('isolate', 'Isolate', 'isolate-selection', 'Show only selected');
  const clearSelectionButton = iconButton('clear', 'Clear Sel', 'clear-selection', 'Clear selection');
  const clipSelectionButton = iconButton('box', 'Sel Box', 'clip-box-selection', 'Clip box from selection');
  const clipModelButton = iconButton('box', 'Model Box', 'clip-box-model', 'Clip box from visible model');
  const clipPlaneButton = iconButton('plane', 'Plane', 'clip-plane', 'Apply clip plane');
  const clipClearButton = iconButton('clear', 'Clip Off', 'clip-clear', 'Clear clipping');
  const tagCreateButton = iconButton('tag', 'Tag', 'tag-create', 'Create two-click tag');
  const tagViewButton = iconButton('view', 'View', 'tag-view', 'Open tag panel');
  const tagHideAllButton = iconButton('hide', 'Hide Tags', 'tag-hide-all', 'Hide all tag labels');
  const tagShowAllButton = iconButton('show', 'Show Tags', 'tag-show-all', 'Show all tag labels');
  const tagImportButton = iconButton('open', 'Import', 'tag-import', 'Import tag XML');
  const tagExportButton = iconButton('export', 'Export', 'tag-export', 'Export tag XML');
  const enrichButton = iconButton('enrich', 'E Work', 'enrich-open', 'Open selected geometry enrichment workflow');
  const exportModelButton = iconButton('export', 'Model', 'export-stage', 'Export StageModel JSON');
  const exportSelectionButton = iconButton('export', 'Sel JSON', 'export-selection', 'Export selected geometry JSON');
  const exportConverterJsonButton = iconButton('converter', 'Conv JSON', 'export-converter-json', 'Export converter-ready RVM+ATT JSON');
  const exportSnapshotButton = iconButton('snapshot', 'Image', 'export-snapshot', 'Export viewport snapshot');
  const marqueeZoomButton = iconButton('fit', 'Marquee', 'tool-marquee', 'Marquee zoom');
  const measureToolButton = iconButton('axis', 'Measure', 'tool-measure', 'Measure distance');
  const measureReadout = el('span', 'json-viewer-measure-readout', ''); measureReadout.hidden = true;
  
  const viewPrevButton = iconButton('undo',  'Prev View', 'view-prev', 'Go to previous camera view');
  const viewNextButton = iconButton('redo',  'Next View', 'view-next', 'Go to next camera view');

  const explodeSlider = el('input', 'json-viewer-explode-slider', '');
  explodeSlider.type = 'range'; explodeSlider.min = '0'; explodeSlider.max = '200';
  explodeSlider.value = '0'; explodeSlider.dataset.action = 'explode-factor';
  const explodeResetBtn = iconButton('clear', 'Reset', 'explode-reset', 'Reset explode to 0');

  const explodeAxisGroup = el('div', 'json-viewer-explode-axis-group', '');
  for (const axis of ['X','Y','Z','↔']) {
    const b = button('json-viewer-explode-axis-btn' + (axis === '↔' ? ' is-active' : ''), axis, '');
    b.dataset.explodeAxis = axis === '↔' ? 'radial' : axis.toLowerCase();
    explodeAxisGroup.appendChild(b);
  }

  navRow.append(
    commandGroup('Navigate', [selectToolButton, boxSelectButton, orbitToolButton, panToolButton, fitButton, fitSelectionButton, marqueeZoomButton, measureToolButton]),
    commandGroup('History', [undoButton, redoButton, viewPrevButton, viewNextButton]),
    commandGroup('Views', [isoViewButton, topViewButton, frontViewButton, sideViewButton, orthoToggleButton]),
    commandGroup('Find', [searchOpenButton, searchReindexButton]),
    commandGroup('Visibility', [hideButton, unhideButton, showAllButton, isolateButton, clearSelectionButton]),
    commandGroup('Clip', [clipSelectionButton, clipModelButton, clipPlaneButton, clipClearButton]),
    commandGroup('Explode', [explodeAxisGroup, explodeSlider, explodeResetBtn]),
    commandGroup('Tags', [tagCreateButton, tagViewButton, tagHideAllButton, tagShowAllButton, tagImportButton, tagExportButton]),
    commandGroup('Enrich', [enrichButton]),
    commandGroup('Exports', [exportModelButton, exportSelectionButton, exportConverterJsonButton, exportSnapshotButton]),
    measureReadout,
  );

  const body = el('div', 'json-viewer-body', '');
  const leftPanel = el('aside', 'json-viewer-left-panel json-viewer-component-panel', '');
  const leftHeader = el('div', 'json-viewer-panel-head', '');
  const leftCollapseButton = iconButton('collapse', 'Left', 'toggle-left-panel', 'Collapse component panel');
  leftCollapseButton.classList.add('json-viewer-panel-collapse');
  leftHeader.append(el('h2', 'json-viewer-panel-title', 'Components'), leftCollapseButton);
  leftPanel.append(leftHeader);
  const treeFilterInput = el('input', 'json-viewer-tree-filter', '');
  treeFilterInput.type = 'search'; treeFilterInput.placeholder = 'Search components, nodes, tags...';
  const componentFilters = el('div', 'json-viewer-filter-row', '');
  componentFilters.append(filterButton('All', 'all', true), filterButton('Components', 'components', false), filterButton('Hidden', 'hidden', false), filterButton('Tagged', 'tagged', false), filterButton('Selected', 'selected', false));
  const hiddenList = el('div', 'json-viewer-hidden-list', '');
  const hierarchyList = el('div', 'json-viewer-hierarchy-list', ''); hierarchyList.setAttribute('role', 'tree');
  const leftResize = el('div', 'json-viewer-panel-resizer is-left', '');
  leftResize.dataset.panelResize = 'left';
  const multiSelectToolbar = el('div', 'json-viewer-multi-select-toolbar', '');
  const selectAllBtn = button('', 'All', ''); selectAllBtn.dataset.action = 'multi-select-all';
  const clearAllBtn = button('', 'Clear', ''); clearAllBtn.dataset.action = 'multi-select-clear';
  const hideSelBtn = button('', 'Hide', ''); hideSelBtn.dataset.action = 'multi-select-hide';
  const showSelBtn = button('', 'Show', ''); showSelBtn.dataset.action = 'multi-select-show';
  const fitSelBtn = button('', 'Fit', ''); fitSelBtn.dataset.action = 'multi-select-fit';
  
  const qualityOverrideSelect = el('select', 'json-viewer-quality-override-select', '');
  for (const [val, label] of [['full', 'Full'], ['medium', 'Medium'], ['light', 'Light'], ['skeleton', 'Skeleton'], ['hidden', 'Hidden']]) {
    const opt = document.createElement('option'); opt.value = val; opt.textContent = label; qualityOverrideSelect.appendChild(opt);
  }
  const applyQualityButton = button('', 'Apply LOD', '');
  applyQualityButton.dataset.action = 'apply-quality';
  
  multiSelectToolbar.append(selectAllBtn, clearAllBtn, hideSelBtn, showSelBtn, fitSelBtn, qualityOverrideSelect, applyQualityButton);

  leftPanel.append(treeFilterInput, componentFilters, multiSelectToolbar, hiddenList, hierarchyList, leftResize);

  const centerPanel = el('main', 'json-viewer-center-panel', '');
  const canvasHost = el('div', 'json-viewer-canvas-host', '');
  canvasHost.setAttribute('aria-label', '3D canvas host placeholder');
  const canvasMessage = el('div', 'json-viewer-canvas-message', '');
  
  const axisHud = el('div', 'json-viewer-axis-hud', '');
  const axisCanvas = document.createElement('canvas');
  axisCanvas.width = 56; axisCanvas.height = 56;
  axisCanvas.className = 'json-viewer-axis-canvas';
  axisCanvas.setAttribute('aria-hidden', 'true');
  axisHud.appendChild(axisCanvas);
  
  const bottomDrawer = el('div', 'json-viewer-bottom-drawer is-collapsed', '');
  const bottomDrawerHeader = el('div', 'json-viewer-drawer-header', '');
  bottomDrawerHeader.innerHTML = '<h3 class="json-viewer-drawer-title">Diagnostics</h3><button class="json-viewer-drawer-toggle" data-action="toggle-drawer">▲</button>';
  const bottomDrawerContent = el('div', 'json-viewer-drawer-content', '');
  bottomDrawer.append(bottomDrawerHeader, bottomDrawerContent);
  
  canvasHost.append(canvasMessage, axisHud);
  centerPanel.append(canvasHost, bottomDrawer);
  
  const viewCubeBar = buildViewCubeBar();
  canvasHost.appendChild(viewCubeBar);

  const rightPanel = el('aside', 'json-viewer-right-panel', '');
  const tabs = el('div', 'json-viewer-right-tabs', '');
  const propertiesTab = button('json-viewer-right-tab is-active', 'Properties', 'right-properties'); propertiesTab.dataset.panel = 'properties';
  const engDataTab = button('json-viewer-right-tab', 'Eng. Data', 'right-engdata'); engDataTab.dataset.panel = 'engdata';
  const tagsTab = button('json-viewer-right-tab', 'Tags', 'right-tags'); tagsTab.dataset.panel = 'tags';
  const clipTab = button('json-viewer-right-tab', 'Clip', 'right-clip'); clipTab.dataset.panel = 'clip';
  const diagnosticsTab = button('json-viewer-right-tab', 'Diagnostics', 'right-diagnostics'); diagnosticsTab.dataset.panel = 'diagnostics';
  const rightCollapseButton = iconButton('collapse', 'Right', 'toggle-right-panel', 'Collapse detail panel');
  rightCollapseButton.classList.add('json-viewer-panel-collapse');
  tabs.append(propertiesTab, engDataTab, tagsTab, clipTab, diagnosticsTab, rightCollapseButton);
  const propertiesPanel = el('div', 'json-viewer-properties-panel', '');
  const engDataPanel = el('div', 'json-viewer-engdata-panel', '');
  const tagsPanel = el('div', 'json-viewer-tags-panel', '');
  const clipPanel = el('div', 'json-viewer-clip-panel', '');
  const diagnosticsPanel = el('div', 'json-viewer-diagnostics-panel', '');
  const rightResize = el('div', 'json-viewer-panel-resizer is-right', '');
  rightResize.dataset.panelResize = 'right';
  rightPanel.append(tabs, propertiesPanel, engDataPanel, tagsPanel, clipPanel, diagnosticsPanel, rightResize);
  body.append(leftPanel, centerPanel, rightPanel);
  const enrichmentPanel = el('div', 'json-viewer-enrichment-panel', '');
  enrichmentPanel.hidden = true;

  const evidenceDetails = el('details', 'json-viewer-evidence-details', '');
  const evidenceSummaryToggle = el('summary', 'json-viewer-evidence-toggle', 'StageModel Summary & Primitive Code Coverage');
  const evidencePanel = el('section', 'json-viewer-evidence-panel', '');
  const summaryPanel = el('div', 'json-viewer-summary-panel', '');
  const coveragePanel = el('div', 'json-viewer-coverage-panel', '');
  evidencePanel.append(summaryPanel, coveragePanel); evidenceDetails.append(evidenceSummaryToggle, evidencePanel);

  const status = el('footer', 'json-viewer-status-strip', '');
  const progressBar = document.createElement('progress');
  progressBar.className = 'json-viewer-progress-bar';
  progressBar.max = 100;
  progressBar.value = 0;
  progressBar.style.display = 'none';
  const statusText = el('span', 'json-viewer-status-text', 'Ready');
  const selectedText = statusChip('selected: none'), objectsText = statusChip('objects: 0'), visibleText = statusChip('visible: 0'), hiddenText = statusChip('hidden: 0'), clipText = statusChip('clip: off'), tagText = statusChip('tags: 0'), coordText = statusChip('XYZ: -'), unitsText = statusChip('units: mm');
  const schemaText = statusChip(''), sourceText = statusChip(''), nodeText = statusChip(''), componentText = statusChip(''), primitiveText = statusChip('');
  const decodedText = statusChip(''), unsupportedText = statusChip(''), failedText = statusChip(''), diagnosticsText = statusChip(''), qualityText = statusChip(''), planEntryText = statusChip(''), planDiagnosticText = statusChip('');
  status.append(progressBar, statusText, selectedText, objectsText, visibleText, hiddenText, clipText, tagText, coordText, unitsText);
  summaryPanel.append(schemaText, sourceText, nodeText, componentText, primitiveText, decodedText, unsupportedText, failedText, diagnosticsText, qualityText, planEntryText, planDiagnosticText);
  shell.append(toolbar, navRow, body, enrichmentPanel, evidenceDetails, status); root.replaceChildren(shell);

  return { shell, toolbar, navRow, body, leftPanel, rightPanel, fileInput, rvmFileInput, tagFileInput, downloadButton, qualitySelect, colorBySelect, diagnosticsButton, hierarchyList, treeFilterInput, hiddenList, summaryPanel, coveragePanel, canvasHost, canvasMessage, axisHud, axisCanvas, updateAxisHud: makeAxisHudUpdater(axisCanvas), bottomDrawer, bottomDrawerContent, enrichmentPanel, propertiesTab, engDataTab, tagsTab, clipTab, diagnosticsTab, propertiesPanel, engDataPanel, tagsPanel, clipPanel, diagnosticsPanel, progressBar, statusText, schemaText, sourceText, nodeText, primitiveText, decodedText, unsupportedText, failedText, componentText, diagnosticsText, qualityText, planEntryText, planDiagnosticText, selectToolButton, boxSelectButton, orbitToolButton, panToolButton, undoButton, redoButton, viewPrevButton, viewNextButton, explodeAxisGroup, explodeSlider, explodeResetBtn, fitButton, fitSelectionButton, isoViewButton, topViewButton, frontViewButton, sideViewButton, orthoToggleButton, searchOpenButton, searchReindexButton, hideButton, unhideButton, showAllButton, isolateButton, clipSelectionButton, clipModelButton, clipPlaneButton, clipClearButton, tagCreateButton, tagViewButton, tagHideAllButton, tagShowAllButton, tagImportButton, tagExportButton, enrichButton, exportModelButton, exportSelectionButton, exportConverterJsonButton, exportSnapshotButton, marqueeZoomButton, measureToolButton, measureReadout, selectedText, objectsText, visibleText, hiddenText, clipText, tagText, coordText, unitsText, qualityOverrideSelect, applyQualityButton };
}

const VIEW_CUBE_DEFS = [
  { action: 'view-iso',   title: 'Isometric view',    icon: cubeIsoSvg(),     label: 'ISO',   active: true },
  { action: 'view-top',   title: 'Top view',           icon: cubeTopSvg(),     label: 'TOP'   },
  { action: 'view-front', title: 'Front view',         icon: cubeFrontSvg(),   label: 'FRONT' },
  { action: 'view-side',  title: 'Right view',         icon: cubeSideSvg(),    label: 'SIDE'  },
  { divider: true },
  { action: 'fit',        title: 'Fit all',            icon: cornersSvg(),     label: 'Fit'   },
  { action: 'fit-selection', title: 'Fit selection',   icon: fitSelSvg(),      label: 'FitSel'},
];

function buildViewCubeBar() {
  const bar = document.createElement('nav');
  bar.className = 'json-viewer-viewcube-bar';
  bar.setAttribute('aria-label', 'View shortcuts');
  for (const def of VIEW_CUBE_DEFS) {
    if (def.divider) { const sep = document.createElement('hr'); sep.className = 'json-viewer-viewcube-sep'; bar.appendChild(sep); continue; }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'json-viewer-viewcube-btn' + (def.active ? ' is-active' : '');
    btn.dataset.action = def.action;
    btn.title = def.title;
    btn.setAttribute('aria-label', def.title);
    btn.innerHTML = `${def.icon}<span class="json-viewer-sr">${def.label}</span>`;
    bar.appendChild(btn);
  }
  return bar;
}

function svgIcon(body) {
  return `<svg class="json-viewer-viewcube-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
function cubeIsoSvg()   { return svgIcon('<polygon points="12 3.8 19 7.7 12 11.7 5 7.7" fill="rgba(116,201,255,.22)"/><polygon points="5 7.7 12 11.7 12 20 5 16" fill="rgba(88,166,255,.16)"/><polygon points="19 7.7 12 11.7 12 20 19 16" fill="rgba(255,199,96,.14)"/>'); }
function cubeTopSvg()   { return svgIcon('<polygon points="6 8 12 4 18 8 12 12" fill="rgba(116,201,255,.22)"/><path d="M6 8v6l6 4 6-4V8" opacity=".6"/><path d="M12 12v6" opacity=".4"/>'); }
function cubeFrontSvg() { return svgIcon('<rect x="6" y="7" width="12" height="10" rx="1.5" fill="rgba(116,201,255,.22)"/><path d="M8 10h8M8 14h8" opacity=".5"/>'); }
function cubeSideSvg()  { return svgIcon('<polygon points="8 6 17 9 17 18 8 15" fill="rgba(116,201,255,.22)"/><path d="M8 6l-2 3v9l2-3M6 9l9 3" opacity=".5"/>'); }
function cornersSvg()   { return svgIcon('<path d="M7 4H4v3M17 4h3v3M7 20H4v-3M17 20h3v-3"/><rect x="8" y="8" width="8" height="8" rx="1.5" opacity=".5"/>'); }
function fitSelSvg()    { return svgIcon('<rect x="6" y="6" width="12" height="12" rx="2" opacity=".5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".5"/>'); }

const AXIS_DEFS = [
  { dir: new THREE.Vector3( 1, 0, 0), label: 'X', color: '#f87171', negColor: '#7f3535' },
  { dir: new THREE.Vector3( 0, 1, 0), label: 'Y', color: '#34d399', negColor: '#1a6b4a' },
  { dir: new THREE.Vector3( 0, 0, 1), label: 'Z', color: '#60a5fa', negColor: '#2d527e' },
];

function makeAxisHudUpdater(canvas) {
  const ctx = canvas.getContext('2d');
  const cx = 28, cy = 28, radius = 20;
  return function updateAxisHud(camera) {
    ctx.clearRect(0, 0, 56, 56);
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke();
    
    const projected = AXIS_DEFS.map(({ dir, label, color, negColor }) => {
      const v = dir.clone().applyQuaternion(camera.quaternion);
      return { x: v.x * radius + cx, y: -v.y * radius + cy, z: v.z, label, color, negColor };
    });
    
    const allAxes = [
      ...projected.map(a => ({ ...a, positive: false, drawX: cx - (a.x - cx), drawY: cy - (a.y - cy) })),
      ...projected.map(a => ({ ...a, positive: true,  drawX: a.x, drawY: a.y })),
    ].sort((a, b) => (a.positive ? a.z : -a.z) - (b.positive ? b.z : -b.z));
    
    for (const axis of allAxes) {
      const col = axis.positive ? axis.color : axis.negColor;
      const r = axis.positive ? 5 : 3;
      ctx.strokeStyle = col; ctx.lineWidth = axis.positive ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(axis.drawX, axis.drawY); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(axis.drawX, axis.drawY, r, 0, Math.PI * 2); ctx.fill();
      if (axis.positive) {
        ctx.fillStyle = '#f0f8ff'; ctx.font = 'bold 9px ui-monospace,Consolas,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(axis.label, axis.drawX + (axis.drawX - cx) * 0.28, axis.drawY + (axis.drawY - cy) * 0.28);
      }
    }
  };
}
