import {
  ASSET_STATUSES,
  METER_UNITS,
  OWNER_ENTITIES,
  PURCHASE_STATUSES,
} from "./schema.js";
import {
  ASSET_LABELS,
  displayAssetValue,
  esc,
  formatMeter,
  formatMoney,
  formatNumber,
  formatWhen,
  todayISO,
} from "./format.js";

const CATEGORIES = ["Boat", "Camper", "House", "Vehicle", "Computer", "Appliance", "Component"];

function banner(state) {
  if (state.busy && state.busyText) {
    return `<div class="banner busy" role="status" data-testid="busy-banner">${esc(state.busyText)}</div>`;
  }
  if (!state.message) return "";
  const kind = state.message.type === "error" ? "error" : "success";
  const role = kind === "error" ? "alert" : "status";
  return `<div class="banner ${kind}" role="${role}" data-testid="${kind}-banner">
    <p>${esc(state.message.text)}</p>
    <button type="button" class="text-button" data-action="dismiss">Dismiss</button>
  </div>`;
}

function modeLine(state) {
  if (state.mode === "drive") return "Google Drive";
  return "Local mode: data stays in this browser";
}

function shell(state, main) {
  const signOut =
    state.mode === "drive" && state.signedIn
      ? `<button type="button" class="text-button light" data-action="sign-out">Sign out</button>`
      : "";
  return `<div class="app">
    <header class="top">
      <div class="brand-row">
        <a class="brand" href="#/">Asset Tracker</a>
        ${signOut}
      </div>
      <p class="mode-line">${esc(modeLine(state))}</p>
    </header>
    <div class="banner-slot">${banner(state)}</div>
    <main id="main" data-view="${esc(state.view.name)}"${state.busy ? ' aria-busy="true"' : ""}>${main}</main>
  </div>`;
}

function optionList(values, current, blankLabel) {
  const blank = `<option value="">${esc(blankLabel)}</option>`;
  const rest = values
    .map((value) => {
      const selected = value === current ? " selected" : "";
      return `<option value="${esc(value)}"${selected}>${esc(value)}</option>`;
    })
    .join("");
  return blank + rest;
}

function fieldText({ label, name, value = "", type = "text", inputmode, spellcheck, autocapitalize, list, required }) {
  const extras = [
    inputmode ? ` inputmode="${esc(inputmode)}"` : "",
    spellcheck != null ? ` spellcheck="${spellcheck ? "true" : "false"}"` : "",
    autocapitalize ? ` autocapitalize="${esc(autocapitalize)}"` : "",
    list ? ` list="${esc(list)}"` : "",
    required ? " required" : "",
  ].join("");
  return `<label class="field">
    <span>${esc(label)}</span>
    <input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}"${extras}>
  </label>`;
}

function fieldArea({ label, name, value = "" }) {
  return `<label class="field">
    <span>${esc(label)}</span>
    <textarea name="${esc(name)}">${esc(value)}</textarea>
  </label>`;
}

function fieldSelect({ label, name, optionsHtml }) {
  return `<label class="field">
    <span>${esc(label)}</span>
    <select name="${esc(name)}">${optionsHtml}</select>
  </label>`;
}

function backLink(href, label) {
  return `<a class="back" href="${esc(href)}"><span class="chevron" aria-hidden="true">‹</span> ${esc(label)}</a>`;
}

function assetById(state, id) {
  return state.data?.assets.assets.find((asset) => asset.id === id) || null;
}

function parentOptions(state, selfId, selected) {
  const assets = state.data?.assets.assets || [];
  const blocked = new Set();
  if (selfId) {
    blocked.add(selfId);
    const childrenOf = new Map();
    for (const asset of assets) {
      if (!asset.parent_id) continue;
      if (!childrenOf.has(asset.parent_id)) childrenOf.set(asset.parent_id, []);
      childrenOf.get(asset.parent_id).push(asset.id);
    }
    const stack = [selfId];
    while (stack.length) {
      const id = stack.pop();
      for (const child of childrenOf.get(id) || []) {
        if (!blocked.has(child)) {
          blocked.add(child);
          stack.push(child);
        }
      }
    }
  }
  const choices = assets
    .filter((asset) => !blocked.has(asset.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const opts = [`<option value="">None</option>`]
    .concat(
      choices.map((asset) => {
        const selectedAttr = asset.id === selected ? " selected" : "";
        return `<option value="${esc(asset.id)}"${selectedAttr}>${esc(asset.name)} (${esc(asset.id)})</option>`;
      }),
    )
    .join("");
  return opts;
}

function matches(asset, query) {
  const hay = [asset.name, asset.vin_serial, asset.category].filter(Boolean).join("\n").toLowerCase();
  return hay.includes(query);
}

function visibleIds(assets, query) {
  const q = query.trim().toLowerCase();
  if (!q) return new Set(assets.map((asset) => asset.id));
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const children = new Map();
  for (const asset of assets) {
    if (!asset.parent_id) continue;
    if (!children.has(asset.parent_id)) children.set(asset.parent_id, []);
    children.get(asset.parent_id).push(asset.id);
  }
  const ids = new Set();
  const addDescendants = (id) => {
    ids.add(id);
    for (const child of children.get(id) || []) addDescendants(child);
  };
  for (const asset of assets) {
    if (!matches(asset, q)) continue;
    let parent = asset.parent_id;
    while (parent && byId.has(parent)) {
      ids.add(parent);
      parent = byId.get(parent).parent_id;
    }
    addDescendants(asset.id);
  }
  return ids;
}

function statusChip(status) {
  if (!status) return "";
  const slug = status.replace(/\s+/g, "-");
  return `<span class="chip status-${slug}">${esc(status)}</span>`;
}

function assetCard(asset, parent) {
  const meta = [asset.category, asset.location].filter(Boolean).join(" · ");
  const vin = asset.vin_serial ? `<p class="vin mono">${esc(asset.vin_serial)}</p>` : "";
  const part = parent ? `<p class="part-of">Part of ${esc(parent.name)}</p>` : "";
  return `<a class="asset-card" href="#/asset/${esc(asset.id)}" data-testid="asset-card" data-id="${esc(asset.id)}">
    <span class="asset-card-top">
      <span class="asset-name">${esc(asset.name)}</span>
      ${statusChip(asset.status)}
    </span>
    ${part}
    ${meta ? `<p class="meta">${esc(meta)}</p>` : ""}
    ${vin}
  </a>`;
}

function buildTree(assets) {
  const byParent = new Map();
  const ids = new Set(assets.map((asset) => asset.id));
  for (const asset of assets) {
    const key = asset.parent_id && ids.has(asset.parent_id) ? asset.parent_id : "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(asset);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }
  return byParent;
}

function renderBranch(byParent, id, depth, assetsById) {
  const nodes = byParent.get(id) || [];
  if (!nodes.length) return "";
  const items = nodes
    .map((asset) => {
      const parent = asset.parent_id ? assetsById.get(asset.parent_id) : null;
      const kids = renderBranch(byParent, asset.id, depth + 1, assetsById);
      return `<li class="${depth ? "child" : "root"}">${assetCard(asset, depth ? parent : null)}${kids}</li>`;
    })
    .join("");
  return `<ul class="asset-tree depth-${Math.min(depth, 4)}">${items}</ul>`;
}

export function listCountText(state) {
  const assets = state.data?.assets.assets || [];
  if (!assets.length) return "";
  const shown = visibleIds(assets, state.search);
  let count = 0;
  for (const asset of assets) if (shown.has(asset.id)) count += 1;
  return `${count} of ${assets.length}`;
}

export function listResultsHtml(state) {
  const assets = state.data?.assets.assets || [];
  const shown = visibleIds(assets, state.search);
  const filtered = assets.filter((asset) => shown.has(asset.id));
  if (!assets.length) {
    return `<div class="empty">
      <p>No assets yet.</p>
      <p class="hint">Add one, or import the three vehicles already on file.</p>
    </div>`;
  }
  if (!filtered.length) return `<div class="empty"><p>Nothing matches that search.</p></div>`;
  const byParent = buildTree(filtered);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return renderBranch(byParent, "", 0, assetsById);
}

function listHtml(state) {
  const assets = state.data?.assets.assets || [];
  const empty = assets.length === 0;
  const importButton = empty
    ? `<button type="button" class="button secondary" data-action="import-seed" data-testid="import-seed">Import seed data</button>`
    : "";
  const count = listCountText(state);
  return `<section class="screen">
    <div class="screen-head">
      <h1>Assets</h1>
      ${count ? `<p class="count" data-testid="asset-count">${esc(count)}</p>` : ""}
    </div>
    <label class="field search-field">
      <span class="sr-only">Search assets</span>
      <input id="search" type="search" placeholder="Search name, VIN, or category" value="${esc(state.search)}" autocomplete="off" enterkeyhint="search">
    </label>
    <div class="stack">
      <a class="button primary" href="#/asset/new">Add asset</a>
      ${importButton}
    </div>
    <div id="asset-list" aria-live="polite">${listResultsHtml(state)}</div>
  </section>`;
}

function detailRows(asset) {
  const keys = Object.keys(ASSET_LABELS);
  return keys
    .filter((key) => asset[key] != null && asset[key] !== "")
    .map((key) => {
      const value = displayAssetValue(key, asset[key]);
      const content =
        key === "receipt_url" && safeUrl(value)
          ? `<a href="${esc(safeUrl(value))}" target="_blank" rel="noopener">${esc(value)}</a>`
          : esc(key === "cost" ? formatMoney(asset.cost) : value);
      return `<div class="row"><dt>${esc(ASSET_LABELS[key])}</dt><dd>${content}</dd></div>`;
    })
    .join("");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    /* not a url */
  }
  return "";
}

function photoFigure(state, photoId, testId) {
  const url = state.photoUrls[photoId];
  if (url && url !== "loading") {
    return `<img class="photo" data-testid="${esc(testId)}" alt="Photo" src="${esc(url)}">`;
  }
  if (url === "loading") return `<p class="hint">Loading photo…</p>`;
  const error = state.photoErrors?.[photoId];
  return `<p class="hint">${esc(error || `Photo ${photoId} is unavailable.`)}</p>`;
}

function maintenanceHtml(state, assetId) {
  const entries = (state.data?.maintenance.entries || [])
    .filter((entry) => entry.asset_id === assetId)
    .sort(byDateDesc);
  if (!entries.length) return `<p class="hint">No maintenance yet.</p>`;
  return entries
    .map((entry) => {
      const bits = [
        entry.work ? `<p class="work">${esc(entry.work)}</p>` : "",
        entry.parts ? `<p><span class="k">Parts</span> ${esc(entry.parts)}</p>` : "",
        entry.fluids ? `<p><span class="k">Fluids</span> ${esc(entry.fluids)}</p>` : "",
        entry.who ? `<p><span class="k">Who</span> ${esc(entry.who)}</p>` : "",
        entry.meter != null ? `<p><span class="k">Meter</span> ${esc(formatNumber(entry.meter))}</p>` : "",
        entry.cost != null ? `<p><span class="k">Cost</span> ${esc(formatMoney(entry.cost))}</p>` : "",
        entry.notes ? `<p>${esc(entry.notes)}</p>` : "",
        entry.receipt_url && safeUrl(entry.receipt_url)
          ? `<p><a href="${esc(safeUrl(entry.receipt_url))}" target="_blank" rel="noopener">Receipt</a></p>`
          : "",
        ...(entry.photo_ids || []).map((id) => photoFigure(state, id, "maintenance-photo")),
      ].join("");
      return `<article class="record" data-testid="maintenance-entry">
        <header><span class="mono">${esc(entry.id)}</span><time>${esc(entry.date || "")}</time></header>
        ${bits}
      </article>`;
    })
    .join("");
}

function purchaseHtml(state, assetId) {
  const lines = (state.data?.purchases.lines || [])
    .filter((line) => line.asset_id === assetId)
    .sort(byDateDesc);
  if (!lines.length) return `<p class="hint">No purchases yet.</p>`;
  return lines
    .map((line) => {
      const title = line.description || line.part_number || line.vendor || "Purchase";
      const price =
        line.unit_price != null
          ? `<p><span class="k">${line.qty == null ? "Price" : "Unit price"}</span> ${esc(formatMoney(line.unit_price))}</p>`
          : "";
      return `<article class="record" data-testid="purchase-line">
        <header><span class="mono">${esc(line.id)}</span>${statusChip(line.status)}</header>
        <p class="work">${esc(title)}</p>
        ${line.date ? `<p><span class="k">Date</span> ${esc(line.date)}</p>` : ""}
        ${line.vendor && title !== line.vendor ? `<p><span class="k">Vendor</span> ${esc(line.vendor)}</p>` : ""}
        ${line.order_number ? `<p><span class="k">Order</span> <span class="mono">${esc(line.order_number)}</span></p>` : ""}
        ${line.part_number ? `<p><span class="k">Part</span> <span class="mono">${esc(line.part_number)}</span></p>` : ""}
        ${line.qty != null ? `<p><span class="k">Qty</span> ${esc(formatNumber(line.qty))}</p>` : ""}
        ${price}
        ${line.shipping != null ? `<p><span class="k">Shipping</span> ${esc(formatMoney(line.shipping))}</p>` : ""}
      </article>`;
    })
    .join("");
}

function byDateDesc(a, b) {
  const date = String(b.date || "").localeCompare(String(a.date || ""));
  if (date) return date;
  return String(b.id || "").localeCompare(String(a.id || ""));
}

function detailHtml(state) {
  const asset = assetById(state, state.view.id);
  if (!asset) {
    return `<section class="screen"><h1>Asset not found</h1><p class="hint">It is not in the file that just loaded.</p><a class="button secondary" href="#/">Back to assets</a></section>`;
  }
  const parent = asset.parent_id ? assetById(state, asset.parent_id) : null;
  const children = (state.data?.assets.assets || []).filter((item) => item.parent_id === asset.id);
  const meter = formatMeter(asset);
  const childList = children.length
    ? `<ul class="child-list">${children
        .map(
          (child) =>
            `<li><a href="#/asset/${esc(child.id)}">${esc(child.name)}</a>${child.category ? ` <span class="meta">${esc(child.category)}</span>` : ""}</li>`,
        )
        .join("")}</ul>`
    : `<p class="hint">No components under this asset.</p>`;
  return `<section class="screen">
    ${backLink("#/", "Assets")}
    <div class="screen-head">
      <h1>${esc(asset.name)}</h1>
      ${statusChip(asset.status)}
    </div>
    <p class="id-line mono" data-testid="asset-id">${esc(asset.id)}</p>
    ${parent ? `<p class="part-of">Part of <a href="#/asset/${esc(parent.id)}">${esc(parent.name)}</a></p>` : ""}
    <p class="meter" data-testid="meter-value">${meter ? esc(meter) : "No meter reading"}</p>
    <div class="action-grid">
      <a class="button secondary" href="#/asset/${esc(asset.id)}/edit">Edit</a>
      <a class="button secondary" href="#/asset/${esc(asset.id)}/meter">Update meter</a>
      <a class="button primary" href="#/asset/${esc(asset.id)}/maintenance">Add maintenance</a>
      <a class="button secondary" href="#/asset/${esc(asset.id)}/purchase">Add purchase</a>
      <a class="button secondary wide" href="#/asset/new?parent=${esc(asset.id)}">Add component</a>
    </div>
    <dl class="facts">${detailRows(asset)}</dl>
    ${(asset.photo_ids || []).map((id) => photoFigure(state, id, "asset-photo")).join("")}
    <p class="updated">${asset.updated_at ? `Updated ${esc(formatWhen(asset.updated_at))}` : ""}</p>
    <h2>Components</h2>
    ${childList}
    <div class="section-head">
      <h2>Maintenance</h2>
    </div>
    ${maintenanceHtml(state, asset.id)}
    <div class="section-head">
      <h2>Purchases</h2>
    </div>
    ${purchaseHtml(state, asset.id)}
  </section>`;
}

function formActions(label, busy) {
  return `<div class="form-actions">
    <button type="submit" class="button primary"${busy ? " disabled" : ""}>${esc(label)}</button>
  </div>`;
}

function assetFormHtml(state) {
  const existing = state.view.id ? assetById(state, state.view.id) : null;
  if (state.view.id && !existing) {
    return `<section class="screen"><h1>Asset not found</h1>${backLink("#/", "Assets")}</section>`;
  }
  const draft = state.draft || existing || {};
  const parentSelected = draft.parent_id || (!existing && !state.draft ? state.view.parentId || "" : "");
  const value = (key) => (draft[key] == null ? "" : draft[key]);
  return `<section class="screen">
    ${backLink(existing ? `#/asset/${existing.id}` : "#/", existing ? "Cancel" : "Assets")}
    <h1>${existing ? "Edit asset" : "New asset"}</h1>
    <form data-form="asset" novalidate>
      ${existing ? `<input type="hidden" name="id" value="${esc(existing.id)}">` : ""}
      <fieldset>
        <legend>What it is</legend>
        ${fieldText({ label: "Name", name: "name", value: value("name"), required: true })}
        ${fieldSelect({
          label: "Owner",
          name: "owner_entity",
          optionsHtml: optionList(OWNER_ENTITIES, value("owner_entity"), "Blank"),
        })}
        ${fieldText({ label: "Category", name: "category", value: value("category"), list: "categories" })}
        <datalist id="categories">${CATEGORIES.map((item) => `<option value="${esc(item)}"></option>`).join("")}</datalist>
        ${fieldSelect({
          label: "Parent asset",
          name: "parent_id",
          optionsHtml: parentOptions(state, existing?.id, parentSelected),
        })}
        ${fieldSelect({
          label: "Status",
          name: "status",
          optionsHtml: optionList(ASSET_STATUSES, value("status"), "Blank"),
        })}
        ${fieldText({ label: "Location", name: "location", value: value("location") })}
      </fieldset>
      <fieldset>
        <legend>Nameplate</legend>
        ${fieldText({ label: "Year", name: "year", value: value("year"), type: "number", inputmode: "numeric" })}
        ${fieldText({ label: "Make", name: "make", value: value("make") })}
        ${fieldText({ label: "Model", name: "model", value: value("model") })}
        ${fieldText({ label: "Model code", name: "model_code", value: value("model_code"), spellcheck: false })}
        ${fieldText({
          label: "VIN / serial",
          name: "vin_serial",
          value: value("vin_serial"),
          spellcheck: false,
          autocapitalize: "characters",
        })}
        ${fieldText({ label: "Engine", name: "engine_code", value: value("engine_code"), spellcheck: false })}
        ${fieldText({ label: "Transmission", name: "trans_code", value: value("trans_code"), spellcheck: false })}
        ${fieldText({ label: "Paint", name: "paint_code", value: value("paint_code"), spellcheck: false })}
      </fieldset>
      <fieldset>
        <legend>Meter</legend>
        ${fieldText({ label: "Meter", name: "meter_value", value: value("meter_value"), type: "number", inputmode: "decimal" })}
        ${fieldSelect({
          label: "Meter unit",
          name: "meter_unit",
          optionsHtml: optionList(METER_UNITS, value("meter_unit"), "Blank"),
        })}
        ${fieldText({ label: "Meter date", name: "meter_date", value: value("meter_date"), type: "date" })}
      </fieldset>
      <fieldset>
        <legend>Purchase</legend>
        ${fieldText({ label: "Purchase date", name: "purchase_date", value: value("purchase_date"), type: "date" })}
        ${fieldText({ label: "Cost", name: "cost", value: value("cost"), type: "number", inputmode: "decimal" })}
        ${fieldText({ label: "Vendor", name: "vendor", value: value("vendor") })}
        ${fieldText({ label: "Receipt URL", name: "receipt_url", value: value("receipt_url"), type: "url", spellcheck: false })}
      </fieldset>
      ${fieldArea({ label: "Mods", name: "mods", value: value("mods") })}
      ${fieldArea({ label: "Notes", name: "notes", value: value("notes") })}
      ${formActions(existing ? "Save changes" : "Save asset", state.busy)}
    </form>
  </section>`;
}

function meterFormHtml(state) {
  const asset = assetById(state, state.view.id);
  if (!asset) return `<section class="screen"><h1>Asset not found</h1></section>`;
  const draft = state.draft || {
    meter_value: asset.meter_value ?? "",
    meter_unit: asset.meter_unit || "",
    meter_date: asset.meter_date || todayISO(),
  };
  return `<section class="screen">
    ${backLink(`#/asset/${asset.id}`, "Cancel")}
    <h1>Update meter</h1>
    <p class="hint">${esc(asset.name)}</p>
    <form data-form="meter" novalidate>
      ${fieldText({
        label: "Meter",
        name: "meter_value",
        value: draft.meter_value ?? "",
        type: "number",
        inputmode: "decimal",
      })}
      ${fieldSelect({
        label: "Unit",
        name: "meter_unit",
        optionsHtml: optionList(METER_UNITS, draft.meter_unit || "", "Blank"),
      })}
      ${fieldText({ label: "Date", name: "meter_date", value: draft.meter_date || "", type: "date" })}
      ${formActions("Save meter", state.busy)}
    </form>
  </section>`;
}

function photoBlock(state) {
  if (!state.pendingPhoto) {
    return `<label class="field">
      <span>Photo</span>
      <input id="photo" name="photo" type="file" accept="image/*" capture="environment">
    </label>`;
  }
  const shot = state.pendingPhoto;
  return `<div class="photo-ready">
    <img class="photo" data-testid="photo-preview" alt="Resized photo preview" src="${esc(shot.url)}">
    <p class="hint">Ready: ${shot.width}×${shot.height} JPEG</p>
    <button type="button" class="button secondary" data-action="clear-photo">Remove photo</button>
    <label class="field">
      <span>Replace photo</span>
      <input id="photo" name="photo" type="file" accept="image/*" capture="environment">
    </label>
  </div>`;
}

function maintenanceFormHtml(state) {
  const asset = assetById(state, state.view.id);
  if (!asset) return `<section class="screen"><h1>Asset not found</h1></section>`;
  const draft = state.draft || { date: todayISO(), meter: asset.meter_value ?? "" };
  const value = (key) => (draft[key] == null ? "" : draft[key]);
  return `<section class="screen">
    ${backLink(`#/asset/${asset.id}`, "Cancel")}
    <h1>Add maintenance</h1>
    <p class="hint">${esc(asset.name)}</p>
    <form data-form="maintenance" novalidate>
      ${fieldText({ label: "Date", name: "date", value: value("date"), type: "date" })}
      ${fieldText({ label: "Meter", name: "meter", value: value("meter"), type: "number", inputmode: "decimal" })}
      ${photoBlock(state)}
      ${fieldArea({ label: "Work", name: "work", value: value("work") })}
      ${fieldArea({ label: "Parts", name: "parts", value: value("parts") })}
      ${fieldText({ label: "Fluids", name: "fluids", value: value("fluids") })}
      ${fieldText({ label: "Who", name: "who", value: value("who") })}
      ${fieldText({ label: "Cost", name: "cost", value: value("cost"), type: "number", inputmode: "decimal" })}
      ${fieldArea({ label: "Notes", name: "notes", value: value("notes") })}
      ${fieldText({ label: "Receipt URL", name: "receipt_url", value: value("receipt_url"), type: "url", spellcheck: false })}
      ${formActions("Save maintenance", state.busy)}
    </form>
  </section>`;
}

function purchaseFormHtml(state) {
  const asset = assetById(state, state.view.id);
  if (!asset && state.view.id) return `<section class="screen"><h1>Asset not found</h1></section>`;
  const draft = state.draft || { date: todayISO(), asset_id: state.view.id || "", status: "" };
  const value = (key) => (draft[key] == null ? "" : draft[key]);
  return `<section class="screen">
    ${backLink(asset ? `#/asset/${asset.id}` : "#/", "Cancel")}
    <h1>Add purchase</h1>
    ${asset ? `<p class="hint">${esc(asset.name)}</p>` : ""}
    <form data-form="purchase" novalidate>
      ${fieldText({ label: "Date", name: "date", value: value("date"), type: "date" })}
      ${fieldText({ label: "Vendor", name: "vendor", value: value("vendor") })}
      ${fieldText({ label: "Order number", name: "order_number", value: value("order_number"), spellcheck: false })}
      ${fieldText({ label: "Part number", name: "part_number", value: value("part_number"), spellcheck: false })}
      ${fieldText({ label: "Description", name: "description", value: value("description") })}
      ${fieldText({ label: "Qty", name: "qty", value: value("qty"), type: "number", inputmode: "decimal" })}
      ${fieldText({ label: "Price", name: "unit_price", value: value("unit_price"), type: "number", inputmode: "decimal" })}
      ${fieldText({ label: "Shipping", name: "shipping", value: value("shipping"), type: "number", inputmode: "decimal" })}
      ${fieldText({ label: "Receipt URL", name: "receipt_url", value: value("receipt_url"), type: "url", spellcheck: false })}
      ${fieldSelect({
        label: "Asset",
        name: "asset_id",
        optionsHtml: parentOptions(state, null, value("asset_id")),
      })}
      ${fieldSelect({
        label: "Status",
        name: "status",
        optionsHtml: optionList(PURCHASE_STATUSES, value("status"), "Blank"),
      })}
      ${formActions("Save purchase", state.busy)}
    </form>
  </section>`;
}

function signInHtml(state) {
  const problem = state.message
    ? `<div class="banner error" role="alert" data-testid="error-banner"><p>${esc(state.message.text)}</p></div>`
    : "";
  const busy = state.busy
    ? `<p class="hint" role="status">${esc(state.busyText || "Working…")}</p>`
    : `<button type="button" class="button primary" data-action="sign-in">Sign in with Google</button>`;
  return `<div class="app">
    <header class="top">
      <div class="brand-row"><span class="brand">Asset Tracker</span></div>
      <p class="mode-line">Google Drive</p>
    </header>
    <main id="main" data-view="sign-in">
      <section class="screen sign-in">
        ${problem}
        <h1>Sign in</h1>
        <p>The asset files live in a Google Drive folder named Asset Tracker. This app creates that folder the first time you sign in. It only asks for access to files it creates.</p>
        ${busy}
      </section>
    </main>
  </div>`;
}

export function renderApp(state) {
  if (state.needsSignIn) return signInHtml(state);
  if (state.booting) {
    return shell(state, `<section class="screen"><h1>Asset Tracker</h1><p class="hint">Loading…</p></section>`);
  }
  if (!state.data) {
    return shell(
      state,
      `<section class="screen">
        <h1>Could not open the files</h1>
        <p data-testid="load-error">${esc(state.message?.text || "The files could not be read.")}</p>
        <button type="button" class="button primary" data-action="retry">Try again</button>
      </section>`,
    );
  }
  let main = "";
  if (state.view.name === "list") main = listHtml(state);
  else if (state.view.name === "detail") main = detailHtml(state);
  else if (state.view.name === "asset-form") main = assetFormHtml(state);
  else if (state.view.name === "meter") main = meterFormHtml(state);
  else if (state.view.name === "maintenance") main = maintenanceFormHtml(state);
  else if (state.view.name === "purchase") main = purchaseFormHtml(state);
  else main = listHtml(state);
  return shell(state, main);
}

export function photoIdsOnScreen(state) {
  if (!state.data || !state.view) return [];
  if (state.view.name !== "detail") return [];
  const ids = [];
  const asset = assetById(state, state.view.id);
  if (asset?.photo_ids) ids.push(...asset.photo_ids);
  for (const entry of state.data.maintenance.entries || []) {
    if (entry.asset_id === state.view.id && entry.photo_ids) ids.push(...entry.photo_ids);
  }
  return ids;
}
