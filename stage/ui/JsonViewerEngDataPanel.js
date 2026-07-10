const ENG_KEYS = [
  'lineNumber', 'line_no', 'lineNo', 'LINE_NO',
  'pipeClass', 'pipe_class', 'insulationClass',
  'fluidCode', 'fluid_code', 'service',
  'pidRef', 'pid_ref', 'P&ID',
  'operatingPressure', 'operatingTemperature',
  'nominalDiameter', 'schedule',
  'material', 'materialCode',
  'area', 'zone', 'unit',
];

function findSelectedItem(model, selectedRef) {
  if (!model || !selectedRef) return null;
  if (selectedRef.type === 'node') return model.hierarchy?.nodes?.find((node) => node.id === selectedRef.id) || null;
  if (selectedRef.type === 'component') return model.components?.find((component) => component.id === selectedRef.id) || null;
  if (selectedRef.type === 'primitive') {
    const primitive = model.primitives?.find((item) => item.id === selectedRef.id) || null;
    if (!primitive || primitive.enrichedAttributes) return primitive;
    const node = model.hierarchy?.nodes?.find((item) => item.id === primitive.nodeId);
    return node?.enrichedAttributes ? { ...primitive, enrichedAttributes: node.enrichedAttributes } : primitive;
  }
  return null;
}

export function renderEngDataPanel(target, model, selectedRef) {
  target.replaceChildren();
  const item = findSelectedItem(model, selectedRef);
  if (!item) { renderEmpty(target, 'Select a component to view Engineering Data'); return; }

  const title = document.createElement('h2');
  title.className = 'json-viewer-panel-title';
  title.textContent = 'Engineering Data';
  target.appendChild(title);

  const enriched = item.enrichedAttributes;

  if (enriched) {
    const processRows = [
      ['Line Number', enriched.lineNo],
      ['Fluid Service', enriched.fluidService],
      ['Fluid Phase', enriched.fluidPhase],
      ['Fluid Density', enriched.fluidDensityKgM3 != null ? `${enriched.fluidDensityKgM3} kg/m³` : null],
      ['Design Pressure', enriched.designPressureMpa != null ? `${enriched.designPressureMpa}` : null],
      ['Design Temp (T1)', enriched.designTemperatureC != null ? `${enriched.designTemperatureC} °C` : null],
      ['Operating Temp', enriched.operatingTemperatureC != null ? `${enriched.operatingTemperatureC} °C` : null],
      ['Minimum Temp', enriched.minimumTemperatureC != null ? `${enriched.minimumTemperatureC} °C` : null],
    ].filter(r => r[1] != null && r[1] !== '');
    if (processRows.length > 0) target.appendChild(renderGroup('Process Conditions', processRows));

    const specRows = [
      ['Piping Class', enriched.pipingClass],
      ['Pressure Rating', enriched.pressureRating],
      ['Nominal Bore', enriched.nominalBoreMm != null ? `${enriched.nominalBoreMm} mm` : null],
      ['Pipe OD', enriched.pipeOdMm != null ? `${enriched.pipeOdMm} mm` : null],
      ['Schedule', enriched.schedule],
      ['Wall Thickness', enriched.wallThicknessMm != null ? `${enriched.wallThicknessMm} mm` : null],
      ['Corrosion Allowance', enriched.corrosionAllowanceMm != null ? `${enriched.corrosionAllowanceMm} mm` : null],
      ['Insulation Thickness', enriched.insulationThicknessMm != null ? `${enriched.insulationThicknessMm} mm` : null],
    ].filter(r => r[1] != null && r[1] !== '');
    if (specRows.length > 0) target.appendChild(renderGroup('Piping Specification', specRows));

    const matRows = [
      ['Material Name', enriched.material],
      ['Material Code', enriched.materialCode],
    ].filter(r => r[1] != null && r[1] !== '');
    if (matRows.length > 0) target.appendChild(renderGroup('Material', matRows));

    const weightRows = [
      ['Component Weight', enriched.componentWeightKg != null ? `${enriched.componentWeightKg} kg` : null],
      ['Pipe Weight (per m)', enriched.pipeWeightKgPerM != null ? `${enriched.pipeWeightKgPerM} kg/m` : null],
    ].filter(r => r[1] != null && r[1] !== '');
    if (weightRows.length > 0) target.appendChild(renderGroup('Weight', weightRows));
    
    if (processRows.length === 0 && specRows.length === 0 && matRows.length === 0 && weightRows.length === 0) {
       renderEmpty(target, 'No enriched attributes available.');
    }
  } else {
    // Fallback to raw attributes if not enriched
    const attrs = { ...(item.attributes || {}), ...(item.sourceAttributes || {}) };
    const engRows = [];
    for (const key of ['LINE_NO', 'PIPING_CLASS', 'SPEC', 'NOMINAL_SIZE', 'BORE', 'RATING', 'MATERIAL', 'WEIGHT']) {
      if (attrs[key]) engRows.push([key, attrs[key]]);
    }
    if (engRows.length > 0) {
      target.appendChild(renderGroup('Raw Attributes (Not Enriched)', engRows));
    } else {
      renderEmpty(target, 'No engineering attributes found. Try running Enrichment.');
    }
  }
}

function renderGroup(title, rows) {
  const section = document.createElement('section');
  section.className = 'json-viewer-property-section';
  const h3 = document.createElement('h3');
  h3.className = 'json-viewer-property-subtitle';
  h3.textContent = title;
  section.appendChild(h3);

  const table = document.createElement('table');
  table.className = 'json-viewer-property-table';
  const body = document.createElement('tbody');
  for (const [key, value] of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row'; th.textContent = key;
    const td = document.createElement('td');
    td.textContent = displayValue(value);
    tr.append(th, td);
    body.appendChild(tr);
  }
  table.appendChild(body);
  section.appendChild(table);
  return section;
}

function renderEmpty(target, text) {
  const empty = document.createElement('div');
  empty.className = 'json-viewer-empty-state';
  empty.textContent = text;
  target.appendChild(empty);
}

function displayValue(value) {
  if (Array.isArray(value)) return value.length > 6 ? `${value.length} items` : value.join(', ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${displayValue(item)}`).join('; ') || '-';
  return value === undefined || value === null || value === '' ? '-' : String(value);
}
