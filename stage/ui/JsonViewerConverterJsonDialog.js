import { applyConverterJsonSideload } from '../export/RvmConverterJsonSideload.js';

/**
 * Opens the Conv JSON export dialog.
 * Parameters: base rvm-converter-stage/v1 payload and an export callback.
 * Outputs: enriched payload through onExport. Fallback: Export Without Side-load
 * returns the base payload unchanged.
 */

const PLACEHOLDER = `PSNo|LineNo|BoreMm|E|N|EL|DTXR|CMPSUPGAP|CMPSUPTYPE|SUPPORT_KIND|SUPPORT_TYPE|MDSSUPPTYPE
PS-1234.1|ASIM-1835-6"-S8811941-91261M7-HC-01|150|187821|-1103125|101357|GUIDE PDO-TYPE-603|10mm|PG-B2|GUIDE|GUIDE|GT573`;

function text(value) { return String(value ?? '').trim(); }
function styles(node, value) { node.style.cssText = value; return node; }
function el(tag, attrs) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value);
  }
  return node;
}
function candidateStats(payload) {
  const candidates = payload?.rvmAttContext?.supportCandidates || [];
  const psNo = candidates.filter((candidate) => text(candidate.psNo || candidate.supportTag || candidate.sourceAttrs?.SUPPORT_TAG)).length;
  const lineNo = candidates.filter((candidate) => text(candidate.lineNo || candidate.branchName || candidate.ownerBranchPath)).length;
  return { candidates: candidates.length, psNo, lineNo };
}
function readControls(dialog) {
  const checked = dialog.querySelector('input[name="converter-json-key-mode"]:checked');
  return {
    keyMode: checked?.value || 'psno',
    coordinateToleranceMm: dialog.querySelector('[data-cj-tolerance]')?.value || '25',
    text: dialog.querySelector('[data-cj-text]')?.value || '',
  };
}
function updateSummary(dialog) {
  const payload = dialog._payload;
  if (!payload) return;
  const enriched = applyConverterJsonSideload(payload, readControls(dialog));
  const stats = candidateStats(enriched);
  const side = enriched.supportSideLoad?.diagnostics || {};
  const summary = dialog.querySelector('[data-cj-summary]');
  summary.textContent = `${stats.candidates} candidates | ${side.parsedRows || 0} rows | ${side.matchedRows || 0} matched | ${side.unmatchedRows || 0} unmatched | ${stats.lineNo} with line context`;
  const unmatched = (side.rowDiagnostics || []).filter((row) => !row.matchedCount).slice(0, 6);
  dialog.querySelector('[data-cj-unmatched]').textContent = unmatched.length ? unmatched.map((row) => `row ${row.rowIndex}: ${row.psNo || row.lineNo || 'coordinate'} not matched`).join('\n') : '';
}
function closeDialog(dialog) {
  dialog.setAttribute('aria-hidden', 'true');
  dialog.style.display = 'none';
}
function exportPayload(dialog, includeSideLoad) {
  const payload = includeSideLoad ? applyConverterJsonSideload(dialog._payload, readControls(dialog)) : dialog._payload;
  dialog._onExport?.(payload, includeSideLoad ? payload.supportSideLoad?.diagnostics : { parsedRows: 0, matchedRows: 0, unmatchedRows: 0 });
  closeDialog(dialog);
}

export function openConverterJsonDialog(payload, onExport) {
  let dialog = document.getElementById('json-viewer-converter-json-dialog');
  if (!dialog) dialog = buildDialog();
  dialog._payload = payload;
  dialog._onExport = onExport;
  const stats = candidateStats(payload);
  dialog.querySelector('[data-cj-candidate-count]').textContent = `${stats.candidates} support candidate${stats.candidates === 1 ? '' : 's'}`;
  dialog.querySelector('[data-cj-ps]').checked = stats.psNo > 0;
  dialog.querySelector('[data-cj-coordinate]').checked = stats.psNo === 0;
  dialog.setAttribute('aria-hidden', 'false');
  dialog.style.display = 'flex';
  updateSummary(dialog);
  dialog.querySelector('[data-cj-text]')?.focus();
}

function buildDialog() {
  const dialog = styles(el('div', { id: 'json-viewer-converter-json-dialog', 'aria-hidden': 'true' }), 'position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.52);font:13px system-ui,sans-serif;');
  const panel = styles(el('div'), 'width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 36px);overflow:auto;background:#fff;color:#111827;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 22px 56px rgba(15,23,42,.28);');
  const header = styles(el('div'), 'display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-bottom:1px solid #e5e7eb;');
  header.append(styles(el('div', { html: '<strong>Conv JSON</strong><div data-cj-candidate-count style="color:#64748b;margin-top:2px"></div>' }), 'line-height:1.25;'));
  const close = styles(el('button', { type: 'button', text: 'X', title: 'Close' }), 'width:30px;height:30px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;cursor:pointer;');
  header.append(close);
  const body = styles(el('div'), 'display:grid;gap:12px;padding:14px 16px;');
  body.append(controlRow(), textareaBlock(), summaryBlock());
  const footer = styles(el('div'), 'display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e5e7eb;background:#f8fafc;');
  const cancel = button('Cancel', 'secondary');
  const base = button('Export Without Side-load', 'secondary');
  const exportButton = button('Export JSON', 'primary');
  footer.append(cancel, base, exportButton);
  panel.append(header, body, footer);
  dialog.append(panel);
  document.body.appendChild(dialog);
  const refresh = () => updateSummary(dialog);
  dialog.querySelector('[data-cj-text]').addEventListener('input', refresh);
  dialog.querySelector('[data-cj-tolerance]').addEventListener('input', refresh);
  for (const radio of dialog.querySelectorAll('input[name="converter-json-key-mode"]')) radio.addEventListener('change', refresh);
  close.addEventListener('click', () => closeDialog(dialog));
  cancel.addEventListener('click', () => closeDialog(dialog));
  base.addEventListener('click', () => exportPayload(dialog, false));
  exportButton.addEventListener('click', () => exportPayload(dialog, true));
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDialog(dialog); });
  return dialog;
}

function controlRow() {
  const row = styles(el('div'), 'display:flex;flex-wrap:wrap;gap:16px;align-items:center;');
  row.append(styles(el('label', { html: '<input data-cj-ps name="converter-json-key-mode" type="radio" value="psno"> PS No.' }), 'display:flex;gap:6px;align-items:center;'));
  row.append(styles(el('label', { html: '<input data-cj-coordinate name="converter-json-key-mode" type="radio" value="coordinate"> Coordinate' }), 'display:flex;gap:6px;align-items:center;'));
  const tolerance = styles(el('label', { html: 'Tolerance mm <input data-cj-tolerance type="number" min="0" step="1" value="25">' }), 'display:flex;gap:8px;align-items:center;color:#334155;');
  styles(tolerance.querySelector('input'), 'width:80px;padding:5px 7px;border:1px solid #cbd5e1;border-radius:6px;');
  row.append(tolerance);
  return row;
}
function textareaBlock() {
  const wrap = styles(el('div'), 'display:grid;gap:6px;');
  wrap.append(styles(el('label', { text: 'Support side-load table' }), 'font-weight:600;color:#1f2937;'));
  wrap.append(styles(el('textarea', { 'data-cj-text': '', placeholder: PLACEHOLDER, spellcheck: 'false' }), 'width:100%;min-height:230px;resize:vertical;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font:12px Consolas,monospace;box-sizing:border-box;'));
  return wrap;
}
function summaryBlock() {
  const wrap = styles(el('div'), 'display:grid;gap:6px;');
  wrap.append(styles(el('div', { 'data-cj-summary': '' }), 'font-weight:600;color:#0f172a;'));
  wrap.append(styles(el('pre', { 'data-cj-unmatched': '' }), 'margin:0;white-space:pre-wrap;color:#b45309;font:12px Consolas,monospace;'));
  return wrap;
}
function button(label, tone) {
  const primary = tone === 'primary';
  return styles(el('button', { type: 'button', text: label }), `padding:7px 12px;border:1px solid ${primary ? '#2563eb' : '#cbd5e1'};background:${primary ? '#2563eb' : '#fff'};color:${primary ? '#fff' : '#111827'};border-radius:6px;cursor:pointer;`);
}
