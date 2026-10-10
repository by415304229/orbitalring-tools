/* AUTO-GENERATED wrapper around tools/blueprint-gen.mjs — do not edit */
/**
 * blueprint-gen.mjs — turn a *solved production line* (calculator output) into an
 * importable Dyson Sphere Program blueprint string.
 *
 * DESIGN CONSTRAINTS
 *  - Zero imports. The DSP binary codec (encodeBlueprint) is injected, so this exact
 *    file runs unchanged in Node (test harness) and in the browser (dsp-calc app).
 *  - Nothing is guessed. Every building's `itemId`, `modelIndex`, `recipeId` and
 *    `footprint` must be supplied by the caller, which reads them straight from the
 *    mod's authoritative data (items_*.json ModelIndex + recipes[].ID + items[].Space).
 *
 * INPUT — `nodes`: one entry per production step the calculator solved for.
 *   {
 *     name:        string,   // human label (e.g. "铁块")
 *     itemId:      int,      // building protoId to place (e.g. 2303 基础制造台)
 *     modelIndex:  int,      // building ModelIndex from items_*.json (e.g. 65)
 *     recipeId:    int,      // in-game RecipeProto.ID to preselect (0 = none/miner)
 *     count:       number,   // how many of this building the line needs (fractional ok -> ceil)
 *     footprint:   number,   // building 占地 (Space, m^2); used to size the layout cell
 *   }
 *
 * OUTPUT — a BLUEPRINT: string. Buildings are laid out in non-overlapping rows on a
 *   whole-metre grid, each with its recipe preselected. Belt/inserter wiring between
 *   buildings is NOT emitted (see LAYOUT NOTES); machines are placed for the player to
 *   connect, or to feed a downstream wiring pass.
 *
 * LAYOUT NOTES
 *   DSP places buildings on a 1 m grid. We give each building a square cell of side
 *   `cellSide = max(2, ceil(sqrt(footprint))) + aisle`, quantise centres to whole metres
 *   so every offset is grid-legal, and wrap into a new row past `rowLength` cells.
 *   Because cellSide >= the building's own footprint side, cells (and thus buildings)
 *   never overlap.
 */

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------
function cellSideFor(footprint, aisle) {
  const fp = Number.isFinite(footprint) && footprint > 0 ? footprint : 4; // default ~2x2
  return Math.max(2, Math.ceil(Math.sqrt(fp))) + (aisle || 0);
}

/**
 * Compute a non-overlapping grid position for every building instance.
 * Returns an array (parallel to the flattened instance list) of {x, y, side, node, idxInNode}.
 */
/**
 * Layout modes (opts.layout):
 *  'grid'    — fixed-width rows (opts.rowLength, default 24), non-overlapping.
 *  'strip'   — 长条形: everything on a single row.
 *  'rect'    — 矩形: row length ≈ sqrt(N) so the footprint is roughly square.
 *  'compact' — 紧凑: like rect but with zero aisle between cells (tightest legal grid).
 *  'magic'   — 仙术: intentionally overlaps buildings using a sub-footprint spacing,
 *              exploiting the paste-overlap behaviour to cram machines together.
 *              NOT a legal manual layout — flagged so the UI can warn about it.
 * Returns an array (parallel to the flattened instance list) of {x, y, side, node, idxInNode}.
 */
function layoutNodes(nodes, opts = {}) {
  const layout = opts.layout || 'grid';
  const aisle = opts.aisle !== undefined ? opts.aisle : (layout === 'compact' ? 0 : 1);
  const rowGap = opts.rowGap !== undefined ? opts.rowGap : (layout === 'compact' ? 0 : 1);
  const originX = opts.originX || 0;
  const originY = opts.originY || 0;

  // expand to a flat instance list first (row length for rect/compact/magic depends on N)
  const inst = [];
  for (const node of nodes) {
    const count = Math.max(0, Math.ceil(Number(node.count) || 0));
    for (let k = 0; k < count; k++) inst.push(node);
  }
  const N = inst.length;

  // per-mode cell side + row length
  let sideOf, rowLength;
  if (layout === 'magic') {
    const sp = opts.magicSpacing || 2;               // sub-footprint spacing => deliberate overlap
    sideOf = () => sp;
    rowLength = opts.rowLength || Math.max(1, Math.ceil(Math.sqrt(N)));
  } else if (layout === 'strip') {
    sideOf = n => cellSideFor(n.footprint, aisle);
    rowLength = Math.max(1, N);                       // single row
  } else if (layout === 'rect' || layout === 'compact') {
    sideOf = n => cellSideFor(n.footprint, aisle);
    rowLength = opts.rowLength || Math.max(1, Math.ceil(Math.sqrt(N)));
  } else {                                            // 'grid'
    sideOf = n => cellSideFor(n.footprint, aisle);
    rowLength = opts.rowLength || 24;
  }

  const placed = [];
  let cx = 0, rowY = 0, rowMaxSide = 0, cellsInRow = 0;
  for (const node of inst) {
    const side = sideOf(node);
    if (cellsInRow >= rowLength) {                    // wrap to next row
      rowY += rowMaxSide + rowGap;
      cx = 0; cellsInRow = 0; rowMaxSide = 0;
    }
    placed.push({ x: originX + cx, y: originY + rowY, side, node, idxInNode: 0 });
    cx += side;
    cellsInRow++;
    if (side > rowMaxSide) rowMaxSide = side;
  }
  return placed;
}

/**
 * Build the blueprint OBJECT (the shape encodeBlueprint consumes) from nodes.
 * Pure / codec-free so it can be inspected in tests before encoding.
 */
function buildBlueprintObject(nodes, opts = {}) {
  const placed = layoutNodes(nodes, opts);

  const buildings = placed.map((p, i) => ({
    index: i,
    areaIndex: 0,
    // two float32 triples; planar position in metres, z = 0 (ground plane)
    localOffset: [
      { x: p.x, y: p.y, z: 0 },
      { x: p.x, y: p.y, z: 0 },
    ],
    yaw: [0, 0],
    itemId: p.node.itemId | 0,
    modelIndex: p.node.modelIndex | 0,
    outputObjIdx: -1,
    inputObjIdx: -1,
    outputToSlot: 0,
    inputFromSlot: 0,
    outputFromSlot: 0,
    inputToSlot: 0,
    outputOffset: 0,
    inputOffset: 0,
    recipeId: (p.node.recipeId || 0) | 0,
    filterId: 0,
    parameters: null,
  }));

  // Blueprint header. icon0 shows the first placed building for a recognisable label.
  const firstItem = buildings.length ? buildings[0].itemId : 0;
  const header = {
    layout: opts.layout !== undefined ? opts.layout : 10,
    icons: opts.icons || [firstItem, 0, 0, 0, 0],
    gameVersion: opts.gameVersion || '0.9.24.11286',
    shortDesc: opts.shortDesc !== undefined ? opts.shortDesc : '星环产线',
    desc: opts.desc !== undefined ? opts.desc : '由产线计算器自动生成',
    // time omitted -> codec stamps nowTicks()
  };

  return {
    header,
    version: 1,
    cursorOffset: { x: 0, y: 0 },
    cursorTargetArea: 0,
    dragBoxSize: { x: 0, y: 0 },
    primaryAreaIdx: 0,
    areas: [{
      index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 0,
      anchorLocalOffset: { x: 0, y: 0 }, size: { x: 0, y: 0 },
    }],
    buildings,
  };
}

/**
 * One-shot: nodes -> BLUEPRINT: string.
 * `encodeBlueprint` is injected (Node: ./blueprint-codec.mjs, browser: web codec).
 */
function generateBlueprint(nodes, encodeBlueprint, opts = {}) {
  if (typeof encodeBlueprint !== 'function') {
    throw new Error('generateBlueprint: encodeBlueprint(codec) must be injected');
  }
  const obj = buildBlueprintObject(nodes, opts);
  return encodeBlueprint(obj);
}

window.SRBlueprintGen = { generateBlueprint, buildBlueprintObject, layoutNodes, cellSideFor };
