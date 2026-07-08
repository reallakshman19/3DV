/**
 * Parses and applies Conv JSON support side-load rows.
 * Parameters: rvm-converter-stage/v1 payload plus PS/coordinate keyed table text.
 * Outputs: a cloned payload with supportSideLoad diagnostics and enriched
 * rvmAttContext.supportCandidates. Fallback: unmatched rows are retained in
 * diagnostics and no candidate fields are changed.
 */

const SIDELOAD_SCHEMA = 'rvm-converter-support-sideload/v1';
const COLUMN_ORDER = Object.freeze(['psNo', 'lineNo', 'boreMm', 'e', 'n', 'el', 'dtxr', 'cmpSupGap', 'cmpSupType', 'supportKind', 'supportType', 'mdsSuppType']);
const HEADER_ALIASES = Object.freeze({
  PSNO: 'psNo', PS: 'psNo', PSNUMBER: 'psNo', PSNO_: 'psNo', SUPPORTTAG: 'psNo', CMPSUPREFN: 'psNo', CMPSTRESSN: 'psNo',
  LINENO: 'lineNo', LINENUMBER: 'lineNo', LINE: 'lineNo', BRANCH: 'lineNo',
  BORE: 'boreMm', BOREMM: 'boreMm', NPS: 'boreMm', ABORE: 'boreMm',
  E: 'e', EAST: 'e', X: 'e',
  N: 'n', NORTH: 'n', Y: 'n',
  EL: 'el', ELEV: 'el', ELEVATION: 'el', Z: 'el',
  DTXR: 'dtxr', CMPSUPGAP: 'cmpSupGap', NODEGAP: 'cmpSupGap', GAP: 'cmpSupGap',
  CMPSUPTYPE: 'cmpSupType', SUPPORTKIND: 'supportKind', SUPPORT_KIND: 'supportKind',
  SUPPORTTYPE: 'supportType', SUPPORT_TYPE: 'supportType', MDSSUPPTYPE: 'mdsSuppType',
});

function text(value) { return String(value ?? '').trim(); }
function finite(value) { const number = Number(String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? value); return Number.isFinite(number) ? number : null; }
function norm(value) { return text(value).toUpperCase().replace(/[^A-Z0-9.]+/g, ''); }
function headerKey(value) { return HEADER_ALIASES[text(value).toUpperCase().replace(/[^A-Z0-9_]+/g, '')] || ''; }
function splitRow(line) {
  const source = String(line ?? '');
  if (source.includes('|')) return source.split('|').map(text);
  if (source.includes('\t')) return source.split('\t').map(text);
  if (source.includes(',')) return source.split(',').map(text);
  return source.trim().split(/\s+/).map(text);
}
function hasHeader(columns) {
  return columns.map(headerKey).filter(Boolean).length >= 3;
}
function point(row) {
  const x = finite(row.e), y = finite(row.n), z = finite(row.el);
  return x === null || y === null || z === null ? null : { x, y, z };
}
function lineMatches(rowLineNo, candidateLineNo) {
  const row = norm(rowLineNo);
  if (!row) return true;
  const candidate = norm(candidateLineNo);
  return Boolean(candidate && (candidate === row || candidate.includes(row) || row.includes(candidate)));
}
function coordScaleToMm(payload) {
  const units = text(payload?.source?.stageSource?.units || payload?.source?.units).toLowerCase();
  return units === 'm' ? 1000 : 1;
}
function candidatePointMm(candidate, scale) {
  const p = candidate?.position || candidate?.pos || candidate?.center;
  const x = finite(p?.x ?? p?.X), y = finite(p?.y ?? p?.Y), z = finite(p?.z ?? p?.Z);
  return x === null || y === null || z === null ? null : { x: x * scale, y: y * scale, z: z * scale };
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function rowAttrs(row) {
  return {
    SUPPORT_TAG: row.psNo, LINE_NO: row.lineNo, BORE: row.boreMm, POS: row.position ? `${row.position.x} ${row.position.y} ${row.position.z}` : '',
    DTXR: row.dtxr, CMPSUPGAP: row.cmpSupGap, CMPSUPTYPE: row.cmpSupType,
    SUPPORT_KIND: row.supportKind, SUPPORT_TYPE: row.supportType, MDSSUPPTYPE: row.mdsSuppType,
  };
}

export function supportKindFromText(...values) {
  const upper = values.map(text).filter(Boolean).join(' ').toUpperCase();
  if (!upper) return '';
  if (/\b(LINE\s*STOP|LINESTOP|LIMIT|LIM|DIRECTIONAL\s+ANCHOR|AXIAL\s+STOP|XST\d+|ST0?6)\b/.test(upper)) return 'LINESTOP';
  if (/\b(GUIDE|GUI|PDO-TYPE-603|GT\d+|PG-)\b/.test(upper)) return 'GUIDE';
  if (/\b(ANCHOR|ANC)\b/.test(upper)) return 'ANCHOR';
  if (/\b(SPRING|HANGER)\b/.test(upper)) return 'SPRING';
  if (/\b(REST|SHOE|SUPPORT|SADDLE|WEAR\s+PLATE|PAD|XRT\d*)\b/.test(upper)) return 'REST';
  return '';
}

export function directionForSupportKind(kind) {
  const value = text(kind).toUpperCase();
  if (value === 'GUIDE') return 'GUI';
  if (value === 'LINESTOP' || value === 'LIMIT') return 'LIM';
  if (value === 'ANCHOR') return 'A';
  if (value === 'SPRING') return 'Y';
  return '+Y';
}

export function parseConverterJsonSideload(rawText, options) {
  const lines = String(rawText ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const keyMode = text(options?.keyMode || 'psno').toLowerCase() === 'coordinate' ? 'coordinate' : 'psno';
  const tolerance = finite(options?.coordinateToleranceMm) ?? 25;
  if (!lines.length) return { schema: SIDELOAD_SCHEMA, keyMode, coordinateToleranceMm: tolerance, rows: [], diagnostics: { parsedRows: 0, warnings: [] } };
  const first = splitRow(lines[0]);
  const header = hasHeader(first) ? first.map((column) => headerKey(column) || '') : COLUMN_ORDER;
  const start = hasHeader(first) ? 1 : 0;
  const warnings = [];
  const rows = [];
  for (let index = start; index < lines.length; index += 1) {
    const values = splitRow(lines[index]);
    const row = {};
    for (let col = 0; col < header.length; col += 1) if (header[col]) row[header[col]] = values[col] ?? '';
    const position = point(row);
    const supportKind = text(row.supportKind) || supportKindFromText(row.dtxr, row.cmpSupType, row.supportType, row.mdsSuppType);
    if (!row.psNo && !position) warnings.push(`row ${index + 1}: no PS No. or complete coordinate key`);
    rows.push({
      rowIndex: index + 1, psNo: text(row.psNo), lineNo: text(row.lineNo), boreMm: text(row.boreMm),
      position, dtxr: text(row.dtxr), cmpSupGap: text(row.cmpSupGap), cmpSupType: text(row.cmpSupType),
      supportKind, supportType: text(row.supportType), mdsSuppType: text(row.mdsSuppType),
    });
  }
  return { schema: SIDELOAD_SCHEMA, keyMode, coordinateToleranceMm: tolerance, rows, diagnostics: { parsedRows: rows.length, warnings } };
}

function candidateMatches(row, candidate, keyMode, tolerance, scale) {
  if (!lineMatches(row.lineNo, candidate.lineNo || candidate.branchName || candidate.ownerBranchPath)) return false;
  if (keyMode === 'psno') return Boolean(row.psNo && norm(candidate.psNo || candidate.supportTag || candidate.sourceAttrs?.SUPPORT_TAG || candidate.attachmentPath).includes(norm(row.psNo)));
  const rowPoint = row.position, candidatePoint = candidatePointMm(candidate, scale);
  return Boolean(rowPoint && candidatePoint && distance(rowPoint, candidatePoint) <= tolerance);
}

function enrichCandidate(candidate, rows) {
  if (!rows.length) return candidate;
  const row = rows[rows.length - 1];
  const supportKind = row.supportKind || supportKindFromText(row.dtxr, row.cmpSupType, row.supportType, row.mdsSuppType, candidate.restraintType, candidate.supportKind);
  const sourceAttrs = { ...(candidate.sourceAttrs || {}), ...rowAttrs(row) };
  return {
    ...candidate,
    psNo: row.psNo || candidate.psNo || '',
    lineNo: row.lineNo || candidate.lineNo || '',
    boreMm: row.boreMm || candidate.boreMm || '',
    dtxr: row.dtxr || candidate.dtxr || '',
    cmpSupGap: row.cmpSupGap || candidate.cmpSupGap || '',
    cmpSupType: row.cmpSupType || candidate.cmpSupType || '',
    supportKind: supportKind || candidate.supportKind || '',
    supportType: row.supportType || candidate.supportType || '',
    mdsSuppType: row.mdsSuppType || candidate.mdsSuppType || '',
    restraintType: supportKind || candidate.restraintType || 'REST',
    direction: directionForSupportKind(supportKind || candidate.restraintType || 'REST'),
    sourceAttrs,
    sideLoadMatch: { schema: SIDELOAD_SCHEMA, rowIndexes: rows.map((entry) => entry.rowIndex) },
  };
}

export function applyConverterJsonSideload(payload, options) {
  const parsed = parseConverterJsonSideload(options?.text || '', options || {});
  const candidates = Array.isArray(payload?.rvmAttContext?.supportCandidates) ? payload.rvmAttContext.supportCandidates : [];
  const scale = coordScaleToMm(payload);
  const matchesByCandidate = new Map();
  const rowDiagnostics = parsed.rows.map((row) => {
    const matches = candidates.filter((candidate) => candidateMatches(row, candidate, parsed.keyMode, parsed.coordinateToleranceMm, scale));
    for (const candidate of matches) matchesByCandidate.set(candidate.id, [...(matchesByCandidate.get(candidate.id) || []), row]);
    return { rowIndex: row.rowIndex, psNo: row.psNo, lineNo: row.lineNo, supportKind: row.supportKind, matchedCandidateIds: matches.map((candidate) => candidate.id), matchedCount: matches.length };
  });
  const supportCandidates = candidates.map((candidate) => enrichCandidate(candidate, matchesByCandidate.get(candidate.id) || []));
  const matchedRows = rowDiagnostics.filter((row) => row.matchedCount > 0).length;
  const supportSideLoad = { ...parsed, diagnostics: { ...parsed.diagnostics, matchedRows, unmatchedRows: parsed.rows.length - matchedRows, rowDiagnostics } };
  return {
    ...payload,
    rvmAttContext: { ...(payload?.rvmAttContext || {}), supportCandidates },
    supportSideLoad,
    diagnostics: { ...(payload?.diagnostics || {}), stats: { ...(payload?.diagnostics?.stats || {}), supportSideLoadRows: parsed.rows.length, supportSideLoadMatchedRows: matchedRows } },
  };
}
