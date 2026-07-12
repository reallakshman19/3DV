# Enriched stagedJson pass-through

3DV consumes enriched stagedJson and does not own the production enrichment step.

`Attr+ Draft` remains available as an experimental viewer-side feature. Its tooltip directs production users to **XML→CII 2019 Standalone → Adapted stagedJson enrichment**.

## Load and inspection

The managed-stage parser preserves top-level `enrichedAttributes` and `diagnostics` on hierarchy nodes. Schematic primitives inherit both records from their owning node for engineering inspection and selection export. The Engineering Data panel shows OPE/HYD density, per-metre weights, status, missing fields, conflicts, and diagnostic badges.

## SelJson contract

Selection exports use schema `json-viewer-selection/v1` and include both `mode` and `selectionMode`.

- Sel-E includes the selected primitive, inherited source attributes, hierarchy path, enriched attributes, diagnostics, and native endpoint/center data.
- Sel-N includes the selected node plus primitives belonging to that node and its descendants.

No line-list, piping-class, material, or weight master is required to view or export an already enriched file.
