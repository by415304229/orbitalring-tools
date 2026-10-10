/* =========================================================================
 * 星环 (OrbitalRing) 产线计算器 · 蓝图生成器 · 通关引导
 * Vanilla JS, no build step, runs from file://
 * Data source: github.com/ProfessorCat305/OrbitalRing-MOD  (data/*.json)
 * ========================================================================= */
'use strict';

const D = window.SR_DATA;
const ITEMS = new Map(D.items.map(i => [i.id, i]));
const RECIPES = D.recipes;
const TECHS = D.techs;

/* ---- ERecipeType (from src/Utils/ERecipeType.cs) ------------------------- */
const RT = {
  0: 'None', 1: 'Smelt 冶炼', 2: 'Chemical 化工', 3: 'Refine 精炼', 4: 'Assemble 组装',
  5: 'Particle 粒子', 6: 'Exchange 能量交换', 7: 'PhotonStore 光子存储',
  8: 'Fractionate 分馏', 9: '太空船坞', 10: '粒子打印', 11: '等离子熔炼',
  12: '物质重组', 14: '生物化工', 15: 'Research 研究', 16: '低温工厂',
  17: '所有化工', 18: '黑盒', 19: '所有熔炉',
};

/* ---- Fallback machine table ---------------------------------------------
 * Used only when data/machines.json (extracted from the mod's C# source) is
 * absent. Vanilla DSP speeds; mod-added machines are best-effort and flagged.
 * `types` = ERecipeType values the machine can craft.                       */
const FALLBACK_MACHINES = [
  { itemId: 2303, name: '基础制造台',     speed: 0.75, types: [4] },
  { itemId: 2304, name: '高速装配线',     speed: 1.0,  types: [4] },
  { itemId: 2315, name: '量子制造台',     speed: 1.5,  types: [4] },
  { itemId: 2318, name: '制造台 Mk.IV',   speed: 2.0,  types: [4] },
  { itemId: 2302, name: '电弧熔炉',       speed: 1.0,  types: [1] },
  { itemId: 2307, name: '等离子熔炼炉',   speed: 2.0,  types: [1, 11] },
  { itemId: 2308, name: '原油精炼厂',     speed: 1.0,  types: [3] },
  { itemId: 2309, name: '化工厂',         speed: 1.0,  types: [2] },
  { itemId: 2317, name: '量子化工厂',     speed: 2.0,  types: [2] },
  { itemId: 2310, name: '微型粒子对撞机', speed: 1.0,  types: [5] },
  { itemId: 2305, name: '粒子打印车间',   speed: 1.0,  types: [10] },
  { itemId: 2313, name: '太空船坞',       speed: 1.0,  types: [9] },
  { itemId: 2901, name: '矩阵研究站',     speed: 1.0,  types: [15] },
  { itemId: 2902, name: '矩阵研究站 Mk.II', speed: 2.0, types: [15] },
  // --- mod-added (星环) ---
  { itemId: 6257, name: '太空船坞',       speed: 1.0,  types: [9, 18], mod: true, confidence: 'low' },
  { itemId: 7823, name: '低温工厂',       speed: 1.0,  types: [16],    mod: true, confidence: 'low' },
  { itemId: 6501, name: '轨道熔炼站',     speed: 2.0,  types: [1, 11, 19], mod: true, confidence: 'low' },
  { itemId: 7803, name: '突触凝练机',     speed: 1.0,  types: [14],    mod: true, confidence: 'low' },
  { itemId: 6215, name: '黑盒',           speed: 1.0,  types: [4, 9, 18], mod: true, confidence: 'low' },
  { itemId: 6254, name: '生态温室',       speed: 1.0,  types: [14],    mod: true, confidence: 'low' },
  { itemId: 6259, name: '天枢座',         speed: 1.0,  types: [12],    mod: true, confidence: 'low' },
  { itemId: 6264, name: '轨道水培舱',     speed: 1.0,  types: [14],    mod: true, confidence: 'low' },
];

/* Prefer the table extracted from the mod source; fall back otherwise.
 * NOTE: machines.json uses `acceptsTypes` (the recipe ERecipeTypes a building accepts,
 * derived from the mod's prefabDescs filterType via InternalFunctions.ContainsRecipeType).
 * A building the mod did NOT override has acceptsTypes:[] and keeps its BASE-GAME
 * capability, so we fill that gap from the vanilla type table below (corroborated by
 * dsp-calc's Vanilla dataset) rather than leaving it unable to craft anything.
 * `modelId` is the authoritative building ModelIndex (items_*.json) used by blueprints. */
const BASE_TYPES_BY_ITEM = new Map(FALLBACK_MACHINES.map(m => [m.itemId, m.types]));
const MACHINES = (D.machines && D.machines.length)
  ? D.machines.map(m => {
      const extracted = Array.isArray(m.acceptsTypes) ? m.acceptsTypes : [];
      const types = extracted.length ? extracted : (BASE_TYPES_BY_ITEM.get(m.itemId) || []);
      return {
        itemId: m.itemId,
        modelIndex: m.modelId ?? ((ITEMS.get(m.itemId) || {}).modelIndex ?? 0),
        name: m.name, speed: m.speed,
        types, power: m.powerKw ?? null,
        // high confidence when the capability came from the mod source or the base game
        confidence: (extracted.length || BASE_TYPES_BY_ITEM.has(m.itemId)) ? (m.confidence || 'high') : 'low',
        source: m.source || '',
      };
    })
  : FALLBACK_MACHINES.map(m => ({ ...m, modelIndex: (ITEMS.get(m.itemId) || {}).modelIndex ?? 0 }));
const USING_EXTRACTED_MACHINES = !!(D.machines && D.machines.length);

/* ---- logistics: belts & inserters ----------------------------------------
 * Throughput comes from the mod's prefabDescs (beltSpeed / inserterSTT), converted
 * with constants corroborated by the DSP wiki (belt items/min = beltSpeed*360;
 * inserter items/min = 18000000/STT). Tier is chosen as the LOWEST tier whose
 * throughput still covers a machine's own production/consumption rate, so the
 * belt/inserter等级适配机器速率 as requested. Inserter rates are the short-reach
 * maximum — real in-game rate falls off with placement distance. */
const BELTS = (D.belts || []).slice().sort((a, b) => a.perMin - b.perMin);
const INSERTERS = (D.inserters || []).slice().sort((a, b) => a.perMin - b.perMin);
const USING_LOGISTICS = BELTS.length > 0 || INSERTERS.length > 0;
function beltFor(rate) {
  if (!BELTS.length) return null;
  return BELTS.find(b => b.perMin >= rate) || BELTS[BELTS.length - 1];
}
function inserterFor(rate) {
  if (!INSERTERS.length) return null;
  return INSERTERS.find(b => b.perMin >= rate) || INSERTERS[INSERTERS.length - 1];
}

/* machines that can craft a given ERecipeType */
function machinesFor(type) {
  return MACHINES.filter(m => m.types.includes(type));
}
/* Choose a machine for a recipe type.
 *  'basic' (default) -> the SLOWEST building that accepts the type, i.e. the
 *     lowest-tier machine. This mirrors dsp-calc's default factory choice and keeps
 *     the line buildable with early tech (基础制造台 / 电弧熔炉 …).
 *  'fast' -> the FASTEST building (end-game mega structures), minimising machine count. */
function bestMachineFor(type, prefer) {
  const all = machinesFor(type);
  if (!all.length) return null;
  // A machine whose speed was never extracted (speed == null, e.g. 低温工厂) must
  // NOT win the "slowest" comparison — null would sort below every real speed and
  // silently zero the whole chain. Only fall back to unknown-speed machines when
  // there is no speed-known alternative, and then assume 1x at low confidence.
  const known = all.filter(m => Number.isFinite(m.speed) && m.speed > 0);
  if (!known.length) return { ...all[0], speed: 1, confidence: 'low' };
  return prefer === 'fast'
    ? known.reduce((a, b) => (b.speed > a.speed ? b : a))
    : known.reduce((a, b) => (b.speed < a.speed ? b : a));
}

/* ---- recipes producing a given item -------------------------------------- */
const RECIPES_BY_OUTPUT = new Map();
for (const r of RECIPES) {
  for (const o of r.outputs) {
    if (!RECIPES_BY_OUTPUT.has(o.item)) RECIPES_BY_OUTPUT.set(o.item, []);
    RECIPES_BY_OUTPUT.get(o.item).push(r);
  }
}

const itemName = id => (ITEMS.get(id) || {}).name || `#${id}`;
const isRaw = id => {
  const it = ITEMS.get(id);
  if (!it) return false;
  // raw = mined/extracted, or has no producing recipe
  return !!it.miningFrom || !(RECIPES_BY_OUTPUT.get(id) || []).length;
};

/* =========================================================================
 * SOLVER — recursive production-line expansion
 * =========================================================================
 * rate is items/min. For a recipe with `time` seconds and `speed` multiplier,
 * one machine yields (60/time)*speed*outCount items per minute, so
 *   machines = desiredRate / perMachineRate
 * ========================================================================= */
function solve(itemId, rate, opts, depth = 0, seen = new Set()) {
  opts = opts || {};
  const chosenRecipeId = opts.recipeOverride && opts.recipeOverride[itemId];
  let recipes = RECIPES_BY_OUTPUT.get(itemId) || [];
  if (chosenRecipeId) {
    const forced = recipes.find(r => r.id === chosenRecipeId);
    if (forced) recipes = [forced];
  }

  // raw resource or no recipe -> leaf
  if (!recipes.length) {
    return { kind: 'raw', itemId, rate, machines: 0, depth, children: [] };
  }

  // cycle guard
  if (seen.has(itemId)) {
    return { kind: 'cycle', itemId, rate, depth, children: [],
             note: '循环依赖，已在此截断（可指定另一配方打破）' };
  }

  const recipe = recipes[0];
  // Per-recipe building choice (mirrors dsp-calc's scheme_for_recipe[].建筑). Only a
  // machine that can actually craft this recipe type is accepted; otherwise fall back
  // to the tier default. All capabilities come from the mod-extracted machine table.
  const chosenMachineId = opts.machineOverride && opts.machineOverride[recipe.id];
  const chosenMachine = chosenMachineId
    ? MACHINES.find(m => m.itemId === chosenMachineId && m.types.includes(recipe.type))
    : null;
  const machine = chosenMachine || bestMachineFor(recipe.type, opts.tier) || { name: '?', speed: 1, itemId: 0 };
  // guard: a manually-picked building whose speed was never extracted (null) would
  // make perMachinePerMin 0 and zero the chain — assume 1x at low confidence instead.
  const machineSafe = (Number.isFinite(machine.speed) && machine.speed > 0)
    ? machine : { ...machine, speed: 1, confidence: 'low' };

  // proliferator: 增产插件 adds extra output; only if recipe is productive
  const prodBonus = (opts.proliferator && !recipe.nonProductive) ? opts.proliferator : 0;
  const speedBonus = opts.speedPlugin || 0;

  const outCount = (recipe.outputs.find(o => o.item === itemId) || {}).count || 1;
  const perMachinePerMin = (recipe.time > 0 ? 60 / recipe.time : 0) * machineSafe.speed * outCount * (1 + prodBonus);
  const machinesExact = perMachinePerMin > 0 ? rate / perMachinePerMin : 0;
  const machines = opts.roundUp === false ? machinesExact : Math.ceil(machinesExact * 100) / 100;

  const nextSeen = new Set(seen); nextSeen.add(itemId);
  const actualRate = machinesExact * perMachinePerMin;

  const children = [];
  for (const inp of recipe.inputs) {
    const need = (inp.count / outCount) * actualRate;
    children.push(solve(inp.item, need, opts, depth + 1, nextSeen));
  }

  return {
    kind: 'recipe', itemId, rate, recipe, machine: machineSafe, machines, machinesExact,
    speed: machineSafe.speed, time: recipe.time, depth, children,
    byproducts: recipe.outputs.filter(o => o.item !== itemId)
      .map(o => ({ itemId: o.item, rate: (o.count / outCount) * actualRate })),
    proliferable: !recipe.nonProductive,
  };
}

/* Flatten the solve tree into per-machine and per-raw-resource totals. */
function aggregate(root) {
  const byMachine = new Map();   // key itemId -> {name, count, recipes:Set}
  const byRaw = new Map();       // itemId -> rate
  const byProduct = new Map();   // itemId -> total rate produced
  let cycles = [];

  (function walk(node) {
    if (node.kind === 'cycle') { cycles.push(node); return; }
    if (node.kind === 'raw') {
      byRaw.set(node.itemId, (byRaw.get(node.itemId) || 0) + node.rate);
      return;
    }
    const k = node.machine.itemId || ('?' + node.machine.name);
    if (!byMachine.has(k)) byMachine.set(k, { name: node.machine.name, itemId: node.machine.itemId, count: 0, recipes: new Set(), lowConf: false });
    const e = byMachine.get(k);
    e.count += node.machinesExact;
    e.recipes.add(node.recipe.name);
    if (node.machine.confidence === 'low') e.lowConf = true;
    byProduct.set(node.itemId, (byProduct.get(node.itemId) || 0) + node.rate);
    node.children.forEach(walk);
  })(root);

  return { byMachine: [...byMachine.values()], byRaw: [...byRaw.entries()], byProduct: [...byProduct.entries()], cycles };
}

/* =========================================================================
 * UI helpers
 * ========================================================================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n, d = 2) => {
  if (!isFinite(n)) return '∞';
  if (Math.abs(n) >= 10000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(d);
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---- item icons (sprite atlas, replicated from dsp-calc's icon logic) ----- * Atlas coords are inlined in data.js (D.atlases). Key = IconPath basename.
 * Resolution order: OrbitalRing (mod) first, then Vanilla fallback — same as
 * dsp-calc, which prepends "Vanilla" and iterates mods in reverse. */
const ATLAS = D.atlases || {};
const ATLAS_ORDER = ['OrbitalRing', 'Vanilla'];
const iconKey = p => (p || '').split('/').pop();
function iconCoord(item) {
  const key = iconKey(item && item.icon);
  if (!key) return null;
  for (const mod of ATLAS_ORDER) {
    const a = ATLAS[mod];
    if (a && a[key]) return { mod, c: a[key] };
  }
  return null;
}
function iconHtml(item, size = 30) {
  const name = esc(item ? item.name : '?');
  const hit = iconCoord(item);
  if (!hit) return `<span class="ico ico-missing" style="width:${size}px;height:${size}px;line-height:${size}px" title="${name}">?</span>`;
  const { mod, c } = hit;
  const scale = size / c.height;
  const style = `width:${size}px;height:${size}px;` +
    `background-image:url('icons/${mod}.png');` +
    `background-position:${(-c.x * scale).toFixed(1)}px ${(-c.y * scale).toFixed(1)}px;` +
    `background-size:${(c.total_width * scale).toFixed(1)}px ${(c.total_height * scale).toFixed(1)}px;`;
  return `<span class="ico" style="${style}" title="${name}"></span>`;
}

/* ---- item categories (from the game's build-menu GridIndex) --------------
 * GridIndex encodes the in-game item grid; its leading digit is the top-level
 * build-menu category (verified against the mod's items_*.json: band 21-28 are
 * buildings, 31-38 metals/ores, 41-48 chemicals/fluids/bio, 51-58 military,
 * 11-18 materials/components). The mod re-uses this same scheme, so grouping by
 * floor(gridIndex/1000) reproduces the mod's own categorisation. */
const CATEGORY_LABELS = {
  0: '消耗品 / 弹药 / 增产剂',
  1: '材料 / 元器件',
  2: '建筑 / 设施',
  3: '金属 / 矿石',
  4: '化工 / 流体 / 生物',
  5: '军事 / 武器 / 黑雾',
};
const CATEGORY_ORDER = [2, 1, 3, 4, 5, 0];   // buildings & materials first (most-picked targets)
const itemCategoryLead = it => Math.floor((it.gridIndex || 0) / 1000);

/* Build the categorized <select> (optgroup per category, items sorted by GridIndex
 * so sub-bands cluster). Only items that can actually be a production target — i.e.
 * produced by some recipe, or a minable raw — are listed. */
function populateCategorySelect(sel) {
  const craftable = D.items.filter(i =>
    (RECIPES_BY_OUTPUT.get(i.id) || []).length || i.miningFrom || (i.type === 1 || i.type === 2) || i.isFluid);
  const byCat = new Map();
  for (const it of craftable) {
    const lead = itemCategoryLead(it);
    if (!byCat.has(lead)) byCat.set(lead, []);
    byCat.get(lead).push(it);
  }
  const leads = [...byCat.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  let html = '';
  for (const lead of leads) {
    const label = CATEGORY_LABELS[lead] || ('分类 ' + lead);
    const items = byCat.get(lead).sort((a, b) => (a.gridIndex - b.gridIndex) || a.name.localeCompare(b.name, 'zh'));
    html += `<optgroup label="${esc(label)}（${items.length}）">` +
      items.map(i => `<option value="${i.id}">${esc(i.name)}${i.fromMod ? ' ★' : ''}</option>`).join('') +
      `</optgroup>`;
  }
  sel.innerHTML = html;
}

/* ---- categorized icon-grid picker ---------------------------------------
 * Faithful to dsp-calc's GridIndex layout: column x = gridIndex % 100,
 * row y = floor(gridIndex / 100) (each row band is an in-game category). */
const PICKER_EXCLUDE = new Set(['沙土', '伊卡洛斯', '行星基地', '巨构星际组装厂']);
let targetItem = null;
function buildPicker() {
  const wrap = $('#c-picker');
  const list = D.items.filter(i => i.gridIndex > 0 && !PICKER_EXCLUDE.has(i.name));
  const cell = new Map();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const it of list) {
    const x = it.gridIndex % 100, y = Math.floor(it.gridIndex / 100);
    const k = x + ',' + y;
    if (!cell.has(k)) cell.set(k, it);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!cell.size) { wrap.innerHTML = '<p class="muted">无可用物品图标。</p>'; return; }
  const ncol = maxX - minX + 1, SIZE = 34;
  let html = `<div class="icon-grid" style="grid-template-columns:repeat(${ncol},${SIZE}px);grid-auto-rows:${SIZE}px">`;
  for (const [k, it] of cell) {
    const [x, y] = k.split(',').map(Number);
    html += `<button type="button" class="cell" data-id="${it.id}" data-name="${esc(it.name)}" ` +
      `style="grid-column:${x - minX + 1};grid-row:${y - minY + 1}" title="${esc(it.name)}${it.fromMod ? ' ★星环' : ''}">` +
      `${iconHtml(it, SIZE - 6)}</button>`;
  }
  wrap.innerHTML = html + '</div>';
  wrap.querySelectorAll('.cell').forEach(b =>
    b.addEventListener('click', () => selectTarget(+b.dataset.id)));
}
function filterPicker(q) {
  q = (q || '').trim().toLowerCase();
  $$('#c-picker .cell').forEach(b =>
    b.classList.toggle('dim', !!q && !b.dataset.name.toLowerCase().includes(q)));
}
function selectTarget(id) {
  targetItem = id;
  $('#c-item').value = id;
  $$('#c-picker .cell').forEach(b => b.classList.toggle('sel', +b.dataset.id === id));
  const it = ITEMS.get(id);
  $('#c-target').innerHTML = it ? `当前目标：${iconHtml(it, 22)} <b>${esc(it.name)}</b>` : '';
  calc();
}

/* =========================================================================
 * TAB 1 — 产线计算器
 * ========================================================================= */
let lastRoot = null;
let recipeChoices = {};   // itemId -> chosen recipe id (per-item, shared across tree nodes)
let machineChoices = {};  // recipeId -> chosen building itemId (per-recipe, like dsp-calc scheme)

function renderTree(node, out, depth = 0) {
  if (node.kind === 'cycle') {
    out.push(`<div class="node cycle" style="margin-left:${depth * 18}px">⟳ ${iconHtml(ITEMS.get(node.itemId), 18)} ${esc(itemName(node.itemId))} — ${esc(node.note || '循环')}</div>`);
    return;
  }
  if (node.kind === 'raw') {
    out.push(`<div class="node raw" style="margin-left:${depth * 18}px">${iconHtml(ITEMS.get(node.itemId), 18)} ⛏ ${esc(itemName(node.itemId))} <b>${fmt(node.rate)}/min</b> <span class="tag">原料</span></div>`);
    return;
  }
  const by = node.byproducts && node.byproducts.length
    ? ` <span class="bp">副产: ${node.byproducts.map(b => `${esc(itemName(b.itemId))} ${fmt(b.rate)}/min`).join(', ')}</span>` : '';
  // per-node recipe picker: when this product has multiple recipes, let the user
  // switch AT THIS NODE (mirrors dsp-calc's per-item recipe choice in the tree).
  const alts = RECIPES_BY_OUTPUT.get(node.itemId) || [];
  const via = alts.length > 1
    ? `<span class="via">←</span> <select class="recipe-pick" data-item="${node.itemId}" title="该产物有 ${alts.length} 个可选配方">` +
      alts.map(r => `<option value="${r.id}"${r.id === node.recipe.id ? ' selected' : ''}>${esc(r.name)}${alts.length > 1 ? ` · ${esc(RT[r.type] || r.type)}` : ''}</option>`).join('') +
      `</select>`
    : `<span class="via">← ${esc(node.recipe.name)}</span>`;
  // per-node building picker: when several machines can craft this recipe type, let the
  // user choose AT THIS NODE (mirrors dsp-calc's FactorySelect). Choice is keyed by recipe.
  const machOpts = machinesFor(node.recipe.type);
  const machSel = machOpts.length > 1
    ? `<select class="machine-pick" data-recipe="${node.recipe.id}" title="该配方可选建筑">` +
      machOpts.map(m => `<option value="${m.itemId}"${m.itemId === node.machine.itemId ? ' selected' : ''}>${esc(m.name)} ${Number.isFinite(m.speed) && m.speed > 0 ? m.speed + 'x' : '?x'}</option>`).join('') +
      `</select>`
    : esc(node.machine.name);
  out.push(`<div class="node" style="margin-left:${depth * 18}px">
      ${iconHtml(ITEMS.get(node.itemId), 20)} <span class="prod">${esc(itemName(node.itemId))}</span> <b>${fmt(node.rate)}/min</b>
      ${via}
      <span class="mach">${machSel} × <b>${fmt(node.machinesExact)}</b></span>
      <span class="meta">${node.time}s · ${node.speed}x${node.proliferable ? ' · 可增产' : ''}</span>
      ${by}
    </div>`);
  node.children.forEach(c => renderTree(c, out, depth + 1));
}

function calc() {
  const itemId = +$('#c-item').value;
  const rate = parseFloat($('#c-rate').value) || 60;
  const prol = parseFloat($('#c-prol').value) || 0;
  const roundUp = $('#c-round').checked;

  const opts = { proliferator: prol, roundUp: false };
  opts.tier = ($('#c-tier') && $('#c-tier').value) || 'basic';
  // Per-item recipe choice (mirrors dsp-calc's item_recipe_choices): a single map keyed
  // by itemId, so every node producing the same item shares one choice. We read from this
  // persistent map rather than scraping the DOM, because the same item can appear at
  // several tree nodes and a stale duplicate <select> would otherwise clobber the choice.
  opts.recipeOverride = { ...recipeChoices };
  opts.machineOverride = { ...machineChoices };

  lastRoot = solve(itemId, rate, opts);
  const agg = aggregate(lastRoot);

  // tree
  const out = [];
  renderTree(lastRoot, out);
  $('#c-tree').innerHTML = out.join('');

  // machine summary
  const totalMachines = agg.byMachine.reduce((s, m) => s + m.count, 0);
  $('#c-machines').innerHTML =
    `<table><thead><tr><th>建筑</th><th class="r">数量</th><th class="r">向上取整</th><th>承担配方</th></tr></thead><tbody>` +
    agg.byMachine.sort((a, b) => b.count - a.count).map(m =>
      `<tr${m.lowConf ? ' class="lowconf"' : ''}><td>${m.itemId ? iconHtml(ITEMS.get(m.itemId), 20) : ''} ${esc(m.name)}${m.lowConf ? ' <span class="tag warn" title="速度取自回退表，未经mod源码确认">?</span>' : ''}</td>
        <td class="r">${fmt(m.count)}</td><td class="r">${Math.ceil(m.count)}</td>
        <td class="recipes">${esc([...m.recipes].join(', '))}</td></tr>`).join('') +
    `</tbody><tfoot><tr><td>合计</td><td class="r">${fmt(totalMachines)}</td><td class="r">${agg.byMachine.reduce((s, m) => s + Math.ceil(m.count), 0)}</td><td></td></tr></tfoot></table>`;

  // raw resources
  $('#c-raws').innerHTML = agg.byRaw.length
    ? `<table><thead><tr><th>原料</th><th class="r">需求 /min</th></tr></thead><tbody>` +
      agg.byRaw.sort((a, b) => b[1] - a[1]).map(([id, r]) =>
        `<tr><td>${iconHtml(ITEMS.get(id), 20)} ${esc(itemName(id))}</td><td class="r">${fmt(r)}</td></tr>`).join('') + `</tbody></table>`
    : '<p class="muted">无需外部原料（全部可自产）。</p>';

  if (agg.cycles.length) {
    $('#c-warn').innerHTML = `<div class="warnbox">检测到 ${agg.cycles.length} 处循环依赖，已在该处截断。可在下方为目标产物指定其他配方来打破循环。</div>`;
  } else { $('#c-warn').innerHTML = ''; }

  // recipe alternatives are now chosen per-node directly in the expansion tree
  // (see renderTree's <select class="recipe-pick">), so no separate root picker.

  if (!USING_EXTRACTED_MACHINES) {
    $('#c-prov').innerHTML = `<div class="notice">当前使用<b>回退机器速度表</b>（原版DSP数值 + 星环新增建筑推测值，标记为 <span class="tag warn">?</span>）。
      运行 <code>node tools/extract-machines.mjs</code> 从mod源码提取精确数值后重新构建即可。</div>`;
  } else {
    $('#c-prov').innerHTML = `<div class="notice ok">机器速度与可制造配方类型已从星环mod源码提取（${MACHINES.length} 台建筑）。</div>`;
  }
}

/* =========================================================================
 * TAB 3 — 通关引导 / 项目跟踪
 * ========================================================================= */
const LS_KEY = 'starring-guide-progress-v1';
let progress = {};
try { progress = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { progress = {}; }
function saveProgress() { localStorage.setItem(LS_KEY, JSON.stringify(progress)); }

/* topological order of the tech tree */
function topoTechs() {
  const byId = new Map(TECHS.map(t => [t.id, t]));
  const order = []; const visited = new Set(); const stack = new Set();
  function visit(id) {
    if (visited.has(id) || stack.has(id)) return;
    const t = byId.get(id); if (!t) return;
    stack.add(id);
    (t.preTechs || []).forEach(visit);
    stack.delete(id); visited.add(id); order.push(t);
  }
  TECHS.forEach(t => visit(t.id));
  // append anything missed (cycles / disconnected)
  TECHS.forEach(t => { if (!visited.has(t.id)) order.push(t); });
  return order;
}

/* group techs into progression phases by their tech-tree column (Position[0]) */
function phases() {
  const order = topoTechs();
  const groups = new Map();
  for (const t of order) {
    const col = (t.position && t.position[0]) || 0;
    if (!groups.has(col)) groups.set(col, []);
    groups.get(col).push(t);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

const PHASE_NAMES = [
  [0, '起步 · 手动与基础自动化'],
  [1, '电磁时代'], [2, '化石能源与外星系'], [3, '黄糖 · 分基地扩张'],
  [4, '绿糖 · 星际物流'], [5, '蓝糖 · 戴森球'], [6, '紫糖 · 反物质'],
  [7, '白糖 · 宇宙探索'], [8, '真·通关 · 星环巨构'],
];
function phaseLabel(col, idx) {
  const hit = PHASE_NAMES.find(p => p[0] === col);
  return hit ? `阶段 ${idx + 1} · ${hit[1]}` : `阶段 ${idx + 1} · 科技列 ${col}`;
}

/* ---- Milestone-based walkthrough ----------------------------------------
 * The old guide simply listed the tech tree by column. This reworks it into an
 * ordered 通关流程: 13 milestones from 电气矩阵开局 to 大统一矩阵终局. Each
 * milestone's "new techs" = prereqSet(anchor) minus prereqSet(previous anchor)
 * (recursive union of PreTechs + PreTechsImplicit), so a stage shows only what
 * that step actually adds. Anchor IDs and product item names were validated
 * against the mod's techs.json / items — every anchor exists and every product
 * resolves to a real craftable item. Building counts come from the same solver
 * the calculator uses (solve → aggregate) at the user's target rate; nothing is
 * hand-entered. Playtime is research ÷ an explicit, adjustable hash-rate
 * assumption and is clearly labelled 估算. */
const MILESTONES = [
  { key: 'm1',  anchorId: 1002, name: '电气矩阵（蓝糖 · 开局自动化）', product: '电气矩阵', goal: '建立电力与首条自动化产线，量产电气矩阵启动科研' },
  { key: 'm2',  anchorId: 1932, name: '石油化工',                    product: '塑料',     goal: '开采原油、裂解精炼，产出塑料等化工材料' },
  { key: 'm3',  anchorId: 1111, name: '化工矩阵（红糖）',            product: '化工矩阵', goal: '以石油化工为基础量产化工矩阵' },
  { key: 'm4',  anchorId: 1124, name: '材料矩阵',                    product: '材料矩阵', goal: '精炼金属与化工产物，量产材料矩阵' },
  { key: 'm5',  anchorId: 1413, name: '钛矿冶炼（钛星球 · 黄糖）',   product: '钛块',     goal: '登陆含钛星球，冶炼钛块解锁高级材料' },
  { key: 'm6',  anchorId: 1312, name: '信息矩阵（蓝糖）',            product: '信息矩阵', goal: '建立处理器/量子芯片产线，量产信息矩阵' },
  { key: 'm7',  anchorId: 1604, name: '行星 / 星际物流',             product: '物流运输机', goal: '部署物流塔与运输机/舰，实现跨星球自动运输' },
  { key: 'm8',  anchorId: 1112, name: '电磁矩阵（紫糖）',            product: '电磁矩阵', goal: '量产电磁矩阵，推进高级科研' },
  { key: 'm9',  anchorId: 1418, name: '粒子矩阵',                    product: '粒子矩阵', goal: '对撞与粒子物理产线，量产粒子矩阵' },
  { key: 'm10', anchorId: 1705, name: '引力矩阵 + 戴森球',           product: '引力矩阵', goal: '量产引力矩阵，建设戴森球获取巨量能源' },
  { key: 'm11', anchorId: 1992, name: '防守太空黑雾',                product: '黑雾引力透镜', goal: '建立防御体系，对抗并收割太空黑雾' },
  { key: 'm12', anchorId: 1974, name: '生物科技线',                  product: '糖料作物种', goal: '开辟生物培养与农业产线' },
  { key: 'm13', anchorId: 1507, name: '大统一矩阵（终局 · 通关）',   product: '大统一矩阵', goal: '量产大统一矩阵，完成全部科研 · 通关' },
];
const TECH_BY_ID = new Map(TECHS.map(t => [t.id, t]));
const itemByName = n => D.items.find(i => i.name === n) || null;

/* recursive union of PreTechs + PreTechsImplicit for an anchor tech */
function prereqSet(id, acc = new Set()) {
  if (acc.has(id)) return acc;
  const t = TECH_BY_ID.get(id); if (!t) return acc;
  acc.add(id);
  (t.preTechs || []).forEach(p => prereqSet(p, acc));
  (t.preTechsImplicit || []).forEach(p => prereqSet(p, acc));
  return acc;
}

function buildMilestoneData(rate, hashRate) {
  const topo = topoTechs();
  const topoIdx = new Map(topo.map((t, i) => [t.id, i]));
  // seenAll accumulates EVERY prior milestone's prereq closure, so a tech is
  // attributed to the first milestone that introduces it and never double-counted
  // later (prereq chains are not linearly nested — subtracting only the previous
  // set would re-surface early techs like 石油化工 inside 信息矩阵/大统一矩阵).
  let seenAll = new Set();
  return MILESTONES.map(ms => {
    const curSet = prereqSet(ms.anchorId);
    const newIds = [...curSet].filter(id => !seenAll.has(id));
    curSet.forEach(id => seenAll.add(id));
    const newTechs = newIds.map(id => TECH_BY_ID.get(id))
      .filter(t => t && t.published !== false)
      .sort((a, b) => (topoIdx.get(a.id) ?? 1e9) - (topoIdx.get(b.id) ?? 1e9));
    const research = newTechs.reduce((s, t) => s + (t.hashNeeded || 0), 0);
    const playMin = hashRate > 0 ? research / hashRate : 0;
    const prodItem = itemByName(ms.product);
    let byMachine = [], totalBuildings = 0, raws = [];
    if (prodItem) {
      try {
        const root = solve(prodItem.id, rate, { tier: 'basic', roundUp: false });
        const agg = aggregate(root);
        byMachine = agg.byMachine.filter(m => m.itemId)
          .map(m => ({ name: m.name, itemId: m.itemId, count: Math.ceil(m.count - 1e-9), lowConf: m.lowConf }))
          .sort((a, b) => b.count - a.count);
        totalBuildings = byMachine.reduce((s, m) => s + m.count, 0);
        raws = agg.byRaw.map(([id, r]) => ({ id, rate: r }))
          .sort((a, b) => b.rate - a.rate).slice(0, 6);
      } catch (e) { /* estimate unavailable for this product */ }
    }
    const doneCount = newTechs.filter(t => progress[t.id]).length;
    return { ...ms, newTechs, research, playMin, byMachine, totalBuildings, raws, doneCount, prodItem };
  });
}

const fmtTime = min => {
  if (!isFinite(min) || min <= 0) return '—';
  if (min < 60) return `${Math.round(min)} 分钟`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(1)} 小时`;
  return `${(h / 24).toFixed(1)} 天`;
};

function renderMilestone(m, idx, filter) {
  const visibleTechs = filter
    ? m.newTechs.filter(t => (t.name + (t.desc || '') + (t.conclusion || '')).toLowerCase().includes(filter))
    : m.newTechs;
  const stageDone = m.doneCount === m.newTechs.length && m.newTechs.length > 0;
  const techList = visibleTechs.map(t => {
    const locked = (t.preTechs || []).some(p => !progress[p] && !m.newTechs.find(x => x.id === p));
    const rs = (t.unlockRecipes || []).map(rid => (RECIPES.find(r => r.id === rid) || {}).name).filter(Boolean);
    const cost = (t.items || []).map((it, i) => `${itemName(it)}×${(t.itemPoints || [])[i] ?? '?'}`).join(', ');
    return `<div class="tech${progress[t.id] ? ' done' : ''}${locked ? ' locked' : ''}" data-id="${t.id}">
        <label class="tech-main">
          <input type="checkbox" ${progress[t.id] ? 'checked' : ''} data-tech="${t.id}">
          <span class="tech-name">${esc(t.name)}${t.maxLevel > 1 ? ` <span class="tag">Lv.${t.level || 0}/${t.maxLevel}</span>` : ''}${t.isHidden ? ' <span class="tag hidden">隐藏</span>' : ''}</span>
          ${t.hashNeeded ? `<span class="tag hash">${t.hashNeeded} hash</span>` : ''}
        </label>
        <div class="tech-detail">
          ${locked ? `<div class="locknote">🔒 前置未完成：${(t.preTechs || []).filter(p => !progress[p]).map(p => esc((TECH_BY_ID.get(p) || {}).name || p)).join(', ')}</div>` : ''}
          ${t.desc ? `<p>${esc(t.desc)}</p>` : ''}
          ${cost ? `<div class="kv"><span>需求物品</span><b>${esc(cost)}</b></div>` : ''}
          ${rs.length ? `<div class="kv"><span>解锁配方</span><b>${esc(rs.join('、'))}</b></div>` : ''}
          ${t.conclusion ? `<div class="concl">💡 ${esc(t.conclusion)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  const bldgTable = m.byMachine.length
    ? `<table class="ms-bldg"><thead><tr><th>建筑</th><th class="r">约需数量</th></tr></thead><tbody>` +
      m.byMachine.map(b => `<tr${b.lowConf ? ' class="lowconf"' : ''}><td>${iconHtml(ITEMS.get(b.itemId), 18)} ${esc(b.name)}${b.lowConf ? ' <span class="tag warn">?</span>' : ''}</td><td class="r">${b.count}</td></tr>`).join('') +
      `</tbody><tfoot><tr><td>合计（目标 ${fmt(+($('#g-ms-rate').value || 60))}/min）</td><td class="r">${m.totalBuildings}</td></tr></tfoot></table>`
    : `<p class="muted">该里程碑产物无自动产线可估算。</p>`;

  const rawLine = m.raws.length
    ? `<div class="kv"><span>外部原料</span><b>${m.raws.map(r => `${esc(itemName(r.id))} ${fmt(r.rate)}/min`).join('、')}</b></div>` : '';

  return `<section class="phase milestone${stageDone ? ' ms-done' : ''}" data-ms="${m.key}">
    <header class="phase-head">
      <h3><span class="ms-idx">${idx + 1}</span> ${esc(m.name)} <span class="ms-count">${m.doneCount}/${m.newTechs.length} 科技</span></h3>
      <div class="ms-stats">
        <span title="本阶段研究量（新解锁科技 hashNeeded 之和）">🔬 ${m.research.toLocaleString()} hash</span>
        <span title="估算游戏时长 = 研究量 ÷ 研究效率假设">⏱ ${fmtTime(m.playMin)}</span>
        ${m.prodItem ? `<button class="ghost ms-open" data-item="${m.prodItem.id}" title="在产线计算器中打开此产物">📈 ${esc(m.product)}</button>` : ''}
      </div>
    </header>
    <div class="phase-body">
      <p class="ms-goal">🎯 ${esc(m.goal)}</p>
      <div class="ms-cols">
        <div class="ms-col ms-techs">
          <h4>需解锁科技（${m.newTechs.length}）</h4>
          ${techList || '<p class="muted">无匹配科技。</p>'}
        </div>
        <div class="ms-col ms-bldgs">
          <h4>约需建筑（${m.totalBuildings}）</h4>
          ${bldgTable}
          ${rawLine}
        </div>
      </div>
    </div>
  </section>`;
}

function renderFullTree(filter) {
  const ph = phases();
  return ph.map(([col, list], idx) => {
    const visible = filter
      ? list.filter(t => (t.name + t.desc + t.conclusion).toLowerCase().includes(filter))
      : list;
    if (filter && !visible.length) return '';
    const d = list.filter(t => progress[t.id]).length;
    return `<section class="phase fulltree">
      <header class="phase-head" data-col="${col}">
        <h3>${esc(phaseLabel(col, idx))}</h3>
        <span class="phase-count">${d}/${list.length}</span>
      </header>
      <div class="phase-body">
        ${visible.map(t => {
          const rs = (t.unlockRecipes || []).map(rid => (RECIPES.find(r => r.id === rid) || {}).name).filter(Boolean);
          const cost = (t.items || []).map((it, i) => `${itemName(it)}×${(t.itemPoints || [])[i] ?? '?'}`).join(', ');
          const locked = (t.preTechs || []).some(p => !progress[p]);
          return `<div class="tech${progress[t.id] ? ' done' : ''}${locked ? ' locked' : ''}" data-id="${t.id}">
            <label class="tech-main">
              <input type="checkbox" ${progress[t.id] ? 'checked' : ''} data-tech="${t.id}">
              <span class="tech-name">${esc(t.name)}${t.maxLevel > 1 ? ` <span class="tag">Lv.${t.level || 0}/${t.maxLevel}</span>` : ''}${t.isHidden ? ' <span class="tag hidden">隐藏</span>' : ''}</span>
            </label>
            <div class="tech-detail">
              ${locked ? `<div class="locknote">🔒 前置未完成：${(t.preTechs || []).filter(p => !progress[p]).map(p => esc((TECH_BY_ID.get(p) || {}).name || p)).join(', ')}</div>` : ''}
              ${t.desc ? `<p>${esc(t.desc)}</p>` : ''}
              ${t.hashNeeded ? `<div class="kv"><span>研究量</span><b>${t.hashNeeded}</b></div>` : ''}
              ${cost ? `<div class="kv"><span>需求物品</span><b>${esc(cost)}</b></div>` : ''}
              ${rs.length ? `<div class="kv"><span>解锁配方</span><b>${esc(rs.join('、'))}</b></div>` : ''}
              ${t.conclusion ? `<div class="concl">💡 ${esc(t.conclusion)}</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');
}

function renderGuide() {
  const rate = parseFloat(($('#g-ms-rate') || {}).value) || 60;
  const hashRate = parseFloat(($('#g-hashrate') || {}).value) || 1500;
  const filter = ($('#g-filter').value || '').trim().toLowerCase();
  const ms = buildMilestoneData(rate, hashRate);

  const totalTechs = ms.reduce((s, m) => s + m.newTechs.length, 0);
  const doneTechs = ms.reduce((s, m) => s + m.doneCount, 0);
  const totalMin = ms.reduce((s, m) => s + m.playMin, 0);
  const msDone = ms.filter(m => m.newTechs.length && m.doneCount === m.newTechs.length).length;
  const pct = totalTechs ? doneTechs / totalTechs * 100 : 0;
  $('#g-progress-bar').style.width = pct + '%';
  $('#g-progress-text').innerHTML =
    `${msDone}/${ms.length} 里程碑 · ${doneTechs}/${totalTechs} 项科技（${pct.toFixed(1)}%）` +
    ` · 估算总时长 <b>${fmtTime(totalMin)}</b>（研究效率 ${fmt(hashRate)} hash/min）`;

  let html = ms.map((m, i) => renderMilestone(m, i, filter)).join('');
  if (($('#g-showtree') || {}).checked) {
    html += `<h3 style="margin:18px 0 8px">完整科技树（全部 ${TECHS.filter(t => t.published !== false).length} 项，按科技列分阶段）</h3>` + renderFullTree(filter);
  }
  $('#g-phases').innerHTML = html;

  $$('#g-phases input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = +cb.dataset.tech;
      if (cb.checked) progress[id] = Date.now(); else delete progress[id];
      saveProgress(); renderGuide();
    });
  });
  $$('#g-phases .phase-head').forEach(h => h.addEventListener('click', e => {
    if (e.target.closest('.ms-open')) return;         // don't collapse when clicking the button
    h.parentElement.classList.toggle('collapsed');
  }));
  $$('#g-phases .ms-open').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const id = +b.dataset.item;
    selectTarget(id);
    $$('.tab-btn').forEach(x => x.classList.remove('active'));
    $$('.tab').forEach(x => x.classList.remove('active'));
    const btn = $$('.tab-btn').find(x => x.dataset.tab === 'tab-calc');
    if (btn) btn.classList.add('active');
    $('#tab-calc').classList.add('active');
  }));
}

/* =========================================================================
 * TAB 2 — 蓝图生成器（由产线计算器自动驱动，不再手写摆放）
 * =========================================================================
 * Walks the calculator's solved tree (lastRoot), aggregates one entry per
 * (building, recipe) pair, and hands the counts to SRBlueprintGen, which lays
 * them out on a non-overlapping whole-metre grid and encodes via the verified
 * codec. Every identity field (itemId / modelIndex / recipeId) comes from the
 * extracted mod data — nothing is hand-placed or guessed. */
function collectBlueprintNodes(root) {
  const agg = new Map();   // "itemId|recipeId" -> accumulated node
  const skipped = [];
  (function walk(node) {
    if (node.kind === 'recipe') {
      const m = node.machine || {};
      const recipeId = node.recipe ? node.recipe.id : 0;
      if (!m.itemId) {
        skipped.push(`${itemName(node.itemId)}（无对应建筑）`);
      } else {
        const modelIndex = m.modelIndex ?? (ITEMS.get(m.itemId) || {}).modelIndex ?? 0;
        const key = m.itemId + '|' + recipeId;
        if (!agg.has(key)) agg.set(key, {
          itemId: m.itemId, modelIndex, recipeId, count: 0,
          label: (node.recipe ? node.recipe.name : '') + ' · ' + m.name,
          perMachineRate: 0,
        });
        const g = agg.get(key);
        g.count += (node.machinesExact || 0);
        // items/min handled by ONE building of this recipe (for belt/inserter sizing)
        const oneRate = (node.machinesExact > 0) ? (node.rate / node.machinesExact) : 0;
        if (oneRate > g.perMachineRate) g.perMachineRate = oneRate;
      }
    }
    (node.children || []).forEach(walk);
  })(root);
  const nodes = [...agg.values()]
    .map(a => ({
      name: a.label, itemId: a.itemId, modelIndex: a.modelIndex, recipeId: a.recipeId,
      count: Math.ceil(a.count - 1e-9), footprint: null,
      perMachineRate: a.perMachineRate,
    }))
    .filter(n => n.count > 0);
  return { nodes, skipped: [...new Set(skipped)] };
}

/* Build the optional belt/inserter logistics nodes from the machine nodes.
 * For each machine group we pick the belt + inserter tier whose throughput covers
 * that machine's own rate, then add: 1 belt segment per building (trunk scaffold)
 * and ceil(rate / inserterThroughput) inserters per building. Returns nodes plus a
 * per-group breakdown for the summary table. */
function buildLogisticsNodes(nodes, opts) {
  const out = [];
  const beltAgg = new Map();     // belt itemId -> {def, count}
  const insAgg = new Map();      // inserter itemId -> {def, count}
  const detail = [];
  for (const n of nodes) {
    const rate = n.perMachineRate || 0;
    if (rate <= 0) continue;
    const belt = opts.belt ? beltFor(rate) : null;
    const ins = opts.inserter ? inserterFor(rate) : null;
    let beltCount = 0, insCount = 0;
    if (belt) {
      beltCount = n.count;                              // one trunk segment per building
      const e = beltAgg.get(belt.itemId) || { def: belt, count: 0 };
      e.count += beltCount; beltAgg.set(belt.itemId, e);
    }
    if (ins) {
      const perBldg = Math.max(1, Math.ceil(rate / ins.perMin));
      insCount = n.count * perBldg;
      const e = insAgg.get(ins.itemId) || { def: ins, count: 0 };
      e.count += insCount; insAgg.set(ins.itemId, e);
    }
    detail.push({ machine: n.name, itemId: n.itemId, count: n.count, rate,
      belt, beltCount, ins, insCount });
  }
  for (const { def, count } of beltAgg.values()) {
    out.push({ name: def.name, itemId: def.itemId, modelIndex: def.modelId, recipeId: 0,
      count, footprint: null, isLogistics: 'belt', perMin: def.perMin });
  }
  for (const { def, count } of insAgg.values()) {
    out.push({ name: def.name, itemId: def.itemId, modelIndex: def.modelId, recipeId: 0,
      count, footprint: null, isLogistics: 'inserter', perMin: def.perMin });
  }
  return { nodes: out, detail };
}

function bpGenerate() {
  const status = $('#b-status');
  const summary = $('#b-summary');
  if (!lastRoot) { status.textContent = '请先在「产线计算器」选择目标产物并求解。'; return; }
  const { nodes, skipped } = collectBlueprintNodes(lastRoot);
  if (!nodes.length) {
    $('#b-out').value = '';
    summary.innerHTML = '';
    status.textContent = '当前产线没有可放置的建筑。' + (skipped.length ? '（跳过：' + skipped.join('、') + '）' : '');
    return;
  }
  const rowLength = parseInt($('#b-rowlen') && $('#b-rowlen').value, 10) || 24;
  const layout = ($('#b-layout') && $('#b-layout').value) || 'grid';
  const wantBelt = !!($('#b-belt') && $('#b-belt').checked) && USING_LOGISTICS;
  const wantIns = !!($('#b-inserter') && $('#b-inserter').checked) && USING_LOGISTICS;

  // optional logistics: belts/inserters whose tier adapts to each machine's rate
  let logNodes = [], logDetail = [];
  if (wantBelt || wantIns) {
    const L = buildLogisticsNodes(nodes, { belt: wantBelt, inserter: wantIns });
    logNodes = L.nodes; logDetail = L.detail;
  }
  const allNodes = nodes.concat(logNodes);

  let bp;
  try {
    bp = window.SRBlueprintGen.generateBlueprint(allNodes, window.SRBlueprint.encodeBlueprint, {
      shortDesc: ($('#b-shortdesc') && $('#b-shortdesc').value) || '星环产线',
      desc: `由产线计算器自动生成 · ${allNodes.length} 种建筑 · ${layout}` +
            ((wantBelt || wantIns) ? ` · 物流:${wantBelt ? '带' : ''}${wantIns ? '拣' : ''}` : ''),
      rowLength, layout,
    });
  } catch (e) { status.textContent = '生成失败：' + e.message; return; }

  // self-verify through the codec's decoder (checksum + structure)
  let verified = false, bcount = 0;
  try { const d = window.SRBlueprint.decodeBlueprint(bp); verified = true; bcount = d.buildings.length; } catch (e) { /* reported below */ }

  $('#b-out').value = bp;
  const machTotal = nodes.reduce((s, n) => s + n.count, 0);
  const logTotal = logNodes.reduce((s, n) => s + n.count, 0);
  const total = machTotal + logTotal;

  const machRows = nodes.slice().sort((a, b) => b.count - a.count).map(n =>
    `<tr><td>${iconHtml(ITEMS.get(n.itemId), 18)} ${esc(n.name || itemName(n.itemId))}</td>` +
    `<td class="r">${n.count}</td><td class="r">${n.itemId}</td><td class="r">${n.modelIndex}</td><td class="r">${n.recipeId}</td></tr>`).join('');
  const logRows = logNodes.slice().sort((a, b) => b.count - a.count).map(n =>
    `<tr class="logi"><td>${iconHtml(ITEMS.get(n.itemId), 18)} ${esc(n.name)} <span class="tag">${n.isLogistics === 'belt' ? '传送带' : '分拣器'} ${fmt(n.perMin, 0)}/min</span></td>` +
    `<td class="r">${n.count}</td><td class="r">${n.itemId}</td><td class="r">${n.modelIndex}</td><td class="r">—</td></tr>`).join('');

  summary.innerHTML =
    `<table><thead><tr><th>建筑 / 配方</th><th class="r">数量</th><th class="r">itemId</th><th class="r">modelIndex</th><th class="r">recipeId</th></tr></thead><tbody>` +
    machRows + logRows +
    `</tbody><tfoot><tr><td>合计（机器 ${machTotal}${logTotal ? ' + 物流 ' + logTotal : ''}）</td><td class="r">${total}</td><td colspan="3"></td></tr></tfoot></table>`;

  // per-machine logistics breakdown (shows the tier adaptation explicitly)
  if (logDetail.length) {
    summary.innerHTML +=
      `<div class="hint" style="margin:8px 0 4px">物流等级适配（按每台机器的产出/消耗速率选择最低可用等级）：</div>` +
      `<table class="logtable"><thead><tr><th>机器 / 配方</th><th class="r">单机速率</th><th class="r">台数</th><th>传送带</th><th>分拣器</th></tr></thead><tbody>` +
      logDetail.map(d =>
        `<tr><td>${iconHtml(ITEMS.get(d.itemId), 16)} ${esc(d.machine)}</td>` +
        `<td class="r">${fmt(d.rate)}/min</td><td class="r">${d.count}</td>` +
        `<td>${d.belt ? `${esc(d.belt.name)}（${fmt(d.belt.perMin, 0)}/min）×${d.beltCount}` : '—'}</td>` +
        `<td>${d.ins ? `${esc(d.ins.name)}（${fmt(d.ins.perMin, 0)}/min）×${d.insCount}` : '—'}</td></tr>`).join('') +
      `</tbody></table>`;
  }

  status.innerHTML = `已按当前产线自动生成 <b>${total}</b> 座建筑（机器 ${machTotal}${logTotal ? ` + 物流 ${logTotal}` : ''}，共 ${allNodes.length} 种），布局：${esc(layout)}。` +
    `解码自校验${verified ? `通过（${bcount} 座，校验和有效）` : '<b>失败</b>'}。` +
    (skipped.length ? ` 跳过 ${skipped.length} 项：${esc(skipped.slice(0, 6).join('、'))}。` : '') +
    (layout === 'magic' ? ' ⚠ 仙术布局：建筑间距小于其占地、故意重叠（利用蓝图粘贴可重叠的行为），游戏内可能需要手动确认摆放。' : '') +
    ((wantBelt || wantIns)
      ? ` ⚠ 已按机器速率铺设${wantBelt ? '传送带' : ''}${wantBelt && wantIns ? '/' : ''}${wantIns ? '分拣器' : ''}（等级自动适配）。但建筑间的<b>连接槽位/朝向由游戏依据几何位置推导</b>，本工具无法从源码复现该规则，故物流件作为<b>脚手架</b>摆放在机器旁，粘贴后可能需要在游戏内旋转/微调才能真正接通。`
      : ` 蓝图仅摆放机器并预置配方，未铺设传送带/分拣器连线。`);
}

/* Decode-only viewer: validate / inspect any existing blueprint string. */
function bpImport() {
  const s = $('#b-import').value.trim();
  const status = $('#b-status');
  if (!s) return;
  try {
    const d = window.SRBlueprint.decodeBlueprint(s);
    const counts = {};
    (d.buildings || []).forEach(b => { counts[b.itemId] = (counts[b.itemId] || 0) + 1; });
    $('#b-summary').innerHTML =
      `<table><thead><tr><th>建筑</th><th class="r">数量</th></tr></thead><tbody>` +
      Object.entries(counts).map(([id, n]) =>
        `<tr><td>${iconHtml(ITEMS.get(+id), 18)} ${esc(itemName(+id))}</td><td class="r">${n}</td></tr>`).join('') +
      `</tbody></table>`;
    status.textContent = `解析成功：${d.buildings.length} 个建筑，校验和有效。`;
  } catch (e) { status.textContent = '解析失败：' + e.message; }
}

/* =========================================================================
 * TAB 4 — 配方浏览器
 * ========================================================================= */
function renderRecipes() {
  const q = ($('#r-q').value || '').trim().toLowerCase();
  const tf = $('#r-type').value;
  let list = RECIPES;
  if (tf) list = list.filter(r => String(r.type) === tf);
  if (q) list = list.filter(r =>
    r.name.toLowerCase().includes(q) ||
    r.inputs.some(i => itemName(i.item).toLowerCase().includes(q)) ||
    r.outputs.some(o => itemName(o.item).toLowerCase().includes(q)));
  list = list.slice(0, 300);
  $('#r-count').textContent = list.length;
  $('#r-table').innerHTML = `<table><thead><tr><th>ID</th><th>配方</th><th>类型</th><th class="r">时间</th><th>输入</th><th>输出</th><th>可增产</th></tr></thead><tbody>` +
    list.map(r => `<tr>
      <td>${r.id}</td><td>${esc(r.name)}</td>
      <td><span class="tag">${esc(RT[r.type] || r.type)}</span></td>
      <td class="r">${r.time}s</td>
      <td>${r.inputs.map(i => `${esc(itemName(i.item))}×${i.count}`).join(' + ') || '—'}</td>
      <td>${r.outputs.map(o => `${esc(itemName(o.item))}×${o.count}`).join(' + ')}</td>
      <td>${r.nonProductive ? '✗' : '✓'}</td></tr>`).join('') + '</tbody></table>';
}

/* =========================================================================
 * boot
 * ========================================================================= */
function boot() {
  // tabs
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => {
    $$('.tab-btn').forEach(x => x.classList.remove('active'));
    $$('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('#' + b.dataset.tab).classList.add('active');
  }));

  // calculator
  populateCategorySelect($('#c-item'));
  $('#c-item').addEventListener('change', e => selectTarget(+e.target.value));
  buildPicker();
  $('#c-rate').value = 60;
  ['c-rate', 'c-prol'].forEach(id => $('#' + id).addEventListener('input', calc));
  $('#c-round').addEventListener('change', calc);
  $('#c-tier').addEventListener('change', calc);
  $('#c-search').addEventListener('input', e => filterPicker(e.target.value));
  $('#c-tree').addEventListener('change', e => {
    if (e.target.classList.contains('recipe-pick')) {
      recipeChoices[+e.target.dataset.item] = +e.target.value;   // per-item choice, shared by all its nodes
      calc();
    } else if (e.target.classList.contains('machine-pick')) {
      machineChoices[+e.target.dataset.recipe] = +e.target.value; // per-recipe building choice
      calc();
    }
  });
  // default target: a meaningful multi-step product if present, else first craftable
  const defItem = D.items.find(i => i.name.includes('矩阵') && (RECIPES_BY_OUTPUT.get(i.id) || []).length)
    || D.items.find(i => (RECIPES_BY_OUTPUT.get(i.id) || []).length && i.gridIndex > 0);
  if (defItem) selectTarget(defItem.id); else calc();

  // guide
  $('#g-filter').addEventListener('input', renderGuide);
  ['g-ms-rate', 'g-hashrate'].forEach(id => $('#' + id).addEventListener('input', renderGuide));
  $('#g-showtree').addEventListener('change', renderGuide);
  $('#g-reset').addEventListener('click', () => {
    if (confirm('确定清空所有通关进度？此操作不可撤销。')) { progress = {}; saveProgress(); renderGuide(); }
  });
  $('#g-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'starring-progress.json'; a.click();
  });
  renderGuide();

  // blueprint (auto-driven by the calculator's solved line)
  $('#b-gen').addEventListener('click', bpGenerate);
  ['b-belt', 'b-inserter'].forEach(id => $('#' + id).addEventListener('change', () => { if (lastRoot) bpGenerate(); }));
  $('#b-import-btn').addEventListener('click', bpImport);
  $('#b-copy').addEventListener('click', () => {
    const ta = $('#b-out');
    if (!ta.value) { $('#b-status').textContent = '还没有可复制的蓝图，请先「从当前产线生成蓝图」。'; return; }
    ta.select(); document.execCommand('copy');
    $('#b-status').textContent = '已复制蓝图字符串到剪贴板，游戏内 Ctrl+V 粘贴即可。';
  });

  // recipes
  $('#r-type').innerHTML = `<option value="">全部类型</option>` +
    [...new Set(RECIPES.map(r => r.type))].sort((a, b) => a - b)
      .map(t => `<option value="${t}">${esc(RT[t] || t)}</option>`).join('');
  $('#r-q').addEventListener('input', renderRecipes);
  $('#r-type').addEventListener('change', renderRecipes);
  renderRecipes();

  // stats
  $('#stat-items').textContent = D.items.length;
  $('#stat-recipes').textContent = RECIPES.length;
  $('#stat-techs').textContent = TECHS.length;
  $('#stat-machines').textContent = MACHINES.length;
  $('#stat-prov').textContent = USING_EXTRACTED_MACHINES ? '已提取' : '回退表';
}

document.addEventListener('DOMContentLoaded', boot);
