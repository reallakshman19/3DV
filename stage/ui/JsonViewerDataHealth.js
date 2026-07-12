/**
 * Functionality: summarizes enriched stagedJson diagnostics into a compact
 * Data Health ribbon for the viewer evidence panel. Parameters: staged model.
 * Outputs: counts and DOM badges. Fallback: nodes without enrichment are grey
 * and do not masquerade as healthy resolved data.
 */

export function summarizeJsonViewerDataHealth(model) {
  const nodes = Array.isArray(model?.hierarchy?.nodes) ? model.hierarchy.nodes : [];
  const enriched = nodes.filter((node) => node.enrichedAttributes);
  const diagnostics = uniqueDiagnostics(enriched.flatMap((node) => [...(node.diagnostics || []), ...(node.enrichedAttributes?.diagnostics || [])]));
  return Object.freeze({
    totalNodes: nodes.length,
    enrichedNodes: enriched.length,
    resolved: enriched.filter((node) => status(node) === 'resolved' && !blocked(node)).length,
    review: enriched.filter((node) => ['partial', 'review', 'conflict'].includes(status(node))).length,
    blocked: enriched.filter(blocked).length,
    notEnriched: nodes.length - enriched.length,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function renderJsonViewerDataHealth(target, model) {
  const health = summarizeJsonViewerDataHealth(model);
  const section = document.createElement('section');
  section.className = 'json-viewer-data-health-ribbon';
  const title = document.createElement('h2');
  title.className = 'json-viewer-panel-title';
  title.textContent = 'Data Health';
  const badges = document.createElement('div');
  badges.className = 'json-viewer-summary-grid';
  [['GREEN resolved', health.resolved], ['AMBER review', health.review], ['RED blocked', health.blocked], ['GREY not enriched', health.notEnriched]].forEach(([label, value]) => badges.append(badge(label, value)));
  section.append(title, badges);
  if (health.diagnostics.length) section.append(issueSummary(health.diagnostics));
  target.appendChild(section);
}

function badge(label, value) {
  const row = document.createElement('div');
  row.className = 'json-viewer-summary-chip';
  row.title = `${label}: ${value}`;
  const name = document.createElement('span'); name.textContent = label;
  const count = document.createElement('strong'); count.textContent = String(value);
  row.append(name, count);
  return row;
}

function issueSummary(diagnostics) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = `Engineering issues (${diagnostics.length})`;
  const list = document.createElement('ul');
  diagnostics.slice(0, 100).forEach((row) => {
    const item = document.createElement('li');
    item.textContent = `${row.ui?.badge || row.field || 'DATA?'} ${row.severity || 'INFO'}: ${row.message || ''}`;
    list.appendChild(item);
  });
  details.append(summary, list);
  return details;
}

function status(node) {
  return String(node?.enrichedAttributes?.status || node?.enrichedAttributes?.enrichmentConfidence || '').toLowerCase();
}

function blocked(node) {
  return [...(node?.diagnostics || []), ...(node?.enrichedAttributes?.diagnostics || [])].some((row) => String(row?.severity || '').toUpperCase() === 'BLOCKED');
}

function uniqueDiagnostics(rows) {
  return [...new Map(rows.map((row) => [row?.id || JSON.stringify(row), row])).values()];
}
