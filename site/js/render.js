import { ASSET_TYPES, EXTRA_FIELDS, fieldsForType, isMoneyKey, reviewStatus, typeLabel } from "./field-config.js";
import { esc, formatMoney, formatNumber, todayISO } from "./format.js";
import { PURCHASE_STATUSES } from "./schema.js";

function assetTitle(asset) {
  return asset.name || "No name";
}

function displayValue(key, value) {
  if (value == null || value === "") return "";
  if (isMoneyKey(key)) return formatMoney(value);
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}

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

function nav(state) {
  const view = state.view?.name;
  const item = (href, label, current) =>
    `<a class="button ${current ? "primary" : "secondary"}" href="${esc(href)}"${current ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  return `<nav class="big-nav" aria-label="Main">
    ${item("#/", "Assets", view === "list" || view === "detail" || view === "purchase")}
    ${item("#/asset/new", "+ Add Asset", view === "asset-form")}
    ${item("#/maintenance", "Log Maintenance", view === "maintenance")}
  </nav>`;
}

function shell(state, main) {
  const signOut =
    state.mode === "drive" && state.signedIn
      ? `<button type="button" class="text-button light" data-action="sign-out">Sign out</button>`
      : "";
  const mode = state.mode === "drive" ? "Google Drive" : "Local mode: data stays in this browser";
  return `<div class="app">
    <header class="top">
      <div class="brand-row">
        <h1 class="brand">Asset Tracker</h1>
        ${signOut}
      </div>
      <p class="mode-line">${esc(mode)}</p>
    </header>
    ${state.data ? nav(state) : ""}
    <div class="banner-slot">${banner(state)}</div>
    <main id="main" data-view="${esc(state.view?.name || "")}"${state.busy ? ' aria-busy="true"' : ""}>${main}</main>
  </div>`;
}

function statusChip(status) {
  if (!status) return "";
  const label = status === "needs_review" ? "needs review" : status;
  return `<span class="chip status-${esc(status)}">${esc(label)}</span>`;
}

function listHtml(state) {
  const assets = state.data?.assets.assets || [];
  const rows = assets
    .slice()
    .sort((a, b) => assetTitle(a).localeCompare(assetTitle(b), undefined, { sensitivity: "base" }))
    .map((asset) => {
      const type = typeLabel(asset.asset_type);
      return `<li>
        <a class="asset-row" href="#/asset/${esc(asset.id)}" data-testid="asset-row" data-id="${esc(asset.id)}">
          <span>
            <span class="asset-name">${esc(assetTitle(asset))}</span>
            ${type ? `<span class="meta"> ${esc(type)}</span>` : ""}
          </span>
          ${statusChip(asset.status)}
        </a>
      </li>`;
    })
    .join("");
  const empty = assets.length === 0;
  return `<section class="screen">
    <button type="button" class="button secondary" data-action="refresh">Refresh</button>
    ${empty ? `<div class="empty"><p>No assets yet.</p><button type="button" class="button secondary" data-action="import-seed" data-testid="import-seed">Import seed data</button></div>` : `<ul class="plain-list">${rows}</ul>`}
  </section>`;
}

function detailRows(asset) {
  const fields = asset.asset_type ? fieldsForType(asset.asset_type) : [...fieldsForType("car"), ...EXTRA_FIELDS];
  const seen = new Set(["name"]);
  const rows = [];
  const pool = asset.asset_type ? [...fields, ...EXTRA_FIELDS] : fields;
  for (const field of pool) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    const value = asset[field.key];
    if (value == null || value === "") continue;
    rows.push(`<div class="row"><dt>${esc(field.label)}</dt><dd>${esc(displayValue(field.key, value))}</dd></div>`);
  }
  return rows.join("");
}

function fileFigure(state, photoId) {
  const url = state.photoUrls[photoId];
  if (url && url !== "loading") {
    if (String(url).startsWith("data:application/pdf")) {
      return `<p><a href="${esc(url)}" target="_blank" rel="noopener">Open PDF</a></p>`;
    }
    return `<img class="photo" data-testid="asset-photo" alt="Asset photo" src="${esc(url)}">`;
  }
  if (url === "loading") return `<p class="hint">Loading photo…</p>`;
  return `<p class="hint">${esc(state.photoErrors?.[photoId] || `Photo ${photoId} is unavailable.`)}</p>`;
}

function detailHtml(state) {
  const asset = state.data?.assets.assets.find((item) => item.id === state.view.id);
  if (!asset) {
    return `<section class="screen"><h2>Not found</h2><p class="hint">That asset is not in the file that just loaded.</p></section>`;
  }
  const maintenance = (state.data?.maintenance.entries || [])
    .filter((entry) => entry.asset_id === asset.id)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const purchases = (state.data?.purchases.lines || [])
    .filter((line) => line.asset_id === asset.id)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const maintenanceHtml = maintenance.length
    ? maintenance
        .map(
          (entry) => `<article class="record" data-testid="maintenance-entry">
            <header><span class="mono">${esc(entry.id)}</span><span>${esc(entry.date || "")}</span></header>
            ${entry.work ? `<p class="work">${esc(entry.work)}</p>` : ""}
            ${entry.notes ? `<p>${esc(entry.notes)}</p>` : ""}
            ${entry.parts ? `<p>${esc(entry.parts)}</p>` : ""}
          </article>`,
        )
        .join("")
    : `<p class="hint">No maintenance yet.</p>`;
  const purchaseHtml = purchases.length
    ? purchases
        .map((line) => {
          const title = line.description || line.part_number || line.vendor || "Purchase";
          const price =
            line.unit_price != null
              ? `<p><span class="k">${line.qty == null ? "Price" : "Unit price"}</span> ${esc(formatMoney(line.unit_price))}</p>`
              : "";
          return `<article class="record" data-testid="purchase-line">
            <header><span class="mono">${esc(line.id)}</span>${statusChip(line.status)}</header>
            <p class="work">${esc(title)}</p>
            ${line.vendor && title !== line.vendor ? `<p><span class="k">Vendor</span> ${esc(line.vendor)}</p>` : ""}
            ${line.order_number ? `<p><span class="k">Order</span> <span class="mono">${esc(line.order_number)}</span></p>` : ""}
            ${price}
          </article>`;
        })
        .join("")
    : `<p class="hint">No purchases yet.</p>`;
  return `<section class="screen">
    <div class="screen-head">
      <h2>${esc(assetTitle(asset))}</h2>
      ${statusChip(asset.status)}
    </div>
    <p class="id-line mono" data-testid="asset-id">${esc(asset.id)}</p>
    ${typeLabel(asset.asset_type) ? `<p class="meta">${esc(typeLabel(asset.asset_type))}</p>` : ""}
    ${asset.status === "needs_review" ? `<p data-testid="needs-review">Needs review. A later pass can read the photo and fill the blank fields.</p>` : ""}
    <dl class="facts">${detailRows(asset)}</dl>
    ${(asset.photo_ids || []).map((id) => fileFigure(state, id)).join("")}
    <h2>Maintenance</h2>
    ${maintenanceHtml}
    <a class="button secondary" href="#/maintenance?asset=${esc(asset.id)}">Log maintenance</a>
    <h2>Purchases</h2>
    ${purchaseHtml}
    <a class="button secondary" href="#/asset/${esc(asset.id)}/purchase">Add purchase</a>
  </section>`;
}

function fieldControl(field, value) {
  const current = value == null ? "" : value;
  if (field.input === "textarea") {
    return `<label class="field"><span>${esc(field.label)}</span><textarea name="${esc(field.key)}">${esc(current)}</textarea></label>`;
  }
  const type = field.input === "number" ? "number" : field.input === "date" ? "date" : "text";
  const extra =
    field.key === "vin_serial" ? ` autocapitalize="characters" spellcheck="false" maxlength="17"` : "";
  return `<label class="field"><span>${esc(field.label)}</span><input name="${esc(field.key)}" type="${type}" value="${esc(current)}"${extra}></label>`;
}

function pendingHtml(state) {
  if (!state.pendingFiles?.length) return "";
  const review = reviewStatus(state.pendingFiles);
  const items = state.pendingFiles
    .map((item) => {
      const name = item.file?.name || "file";
      const note = item.decoded ? "VIN read from this photo" : "Not read — will be saved for review";
      const preview = item.url ? `<img class="photo" alt="" src="${esc(item.url)}">` : `<p class="hint">${esc(name)}</p>`;
      return `<li data-testid="pending-file">${preview}<p>${esc(note)}</p></li>`;
    })
    .join("");
  const flag = review ? `<p data-testid="will-need-review">This asset will be saved as needs review.</p>` : "";
  return `<ul class="pending-files">${items}</ul>${flag}`;
}

function assetFormHtml(state) {
  const draft = state.draft || { asset_type: "car" };
  const type = draft.asset_type || "car";
  const options = ASSET_TYPES.map((item) => {
    const selected = item.id === type ? " selected" : "";
    return `<option value="${esc(item.id)}"${selected}>${esc(item.label)}</option>`;
  }).join("");
  const fields = fieldsForType(type)
    .map((field) => fieldControl(field, draft[field.key]))
    .join("");
  const note = state.vinNote ? `<p class="hint" data-testid="vin-note">${esc(state.vinNote)}</p>` : "";
  return `<section class="screen">
    <h2>Add asset</h2>
    <form data-form="asset" novalidate>
      <label class="photo-picker">
        Take photo / upload file
        <input id="photo" name="photo" type="file" accept="image/*,application/pdf,.pdf" multiple>
      </label>
      ${pendingHtml(state)}
      <label class="field">
        <span>Type</span>
        <select name="asset_type">${options}</select>
      </label>
      ${note}
      ${fields}
      <div class="form-actions"><button type="submit" class="button primary">Save</button></div>
    </form>
  </section>`;
}

function assetOptions(state, selected) {
  const assets = state.data?.assets.assets || [];
  const options = [`<option value="">Choose</option>`]
    .concat(
      assets.map((asset) => {
        const on = asset.id === selected ? " selected" : "";
        return `<option value="${esc(asset.id)}"${on}>${esc(assetTitle(asset))} (${esc(asset.id)})</option>`;
      }),
    )
    .join("");
  return options;
}

function maintenanceFormHtml(state) {
  const assets = state.data?.assets.assets || [];
  if (!assets.length) {
    return `<section class="screen"><h2>Log maintenance</h2><p>Add an asset first.</p></section>`;
  }
  const draft = state.draft || { date: todayISO(), asset_id: state.view.assetId || "" };
  return `<section class="screen">
    <h2>Log maintenance</h2>
    <form data-form="maintenance" novalidate>
      <label class="field"><span>Asset</span><select name="asset_id">${assetOptions(state, draft.asset_id || "")}</select></label>
      <label class="field"><span>Date</span><input name="date" type="date" value="${esc(draft.date || "")}"></label>
      <label class="field"><span>Work</span><textarea name="work">${esc(draft.work || "")}</textarea></label>
      <label class="field"><span>Notes</span><textarea name="notes">${esc(draft.notes || "")}</textarea></label>
      <label class="field"><span>Photo</span><input id="maint-photo" name="photo" type="file" accept="image/*" capture="environment"></label>
      <div class="form-actions"><button type="submit" class="button primary">Save maintenance</button></div>
    </form>
  </section>`;
}

function purchaseFormHtml(state) {
  const asset = state.data?.assets.assets.find((item) => item.id === state.view.id);
  if (!asset) return `<section class="screen"><h2>Not found</h2></section>`;
  const draft = state.draft || { date: todayISO(), asset_id: asset.id };
  const statuses = [`<option value="">Blank</option>`]
    .concat(
      PURCHASE_STATUSES.map((status) => {
        const selected = draft.status === status ? " selected" : "";
        return `<option value="${esc(status)}"${selected}>${esc(status)}</option>`;
      }),
    )
    .join("");
  return `<section class="screen">
    <h2>Add purchase</h2>
    <p class="hint">${esc(assetTitle(asset))}</p>
    <form data-form="purchase" novalidate>
      <input type="hidden" name="asset_id" value="${esc(asset.id)}">
      <label class="field"><span>Date</span><input name="date" type="date" value="${esc(draft.date || "")}"></label>
      <label class="field"><span>Vendor</span><input name="vendor" value="${esc(draft.vendor || "")}"></label>
      <label class="field"><span>Order number</span><input name="order_number" value="${esc(draft.order_number || "")}"></label>
      <label class="field"><span>Part number</span><input name="part_number" value="${esc(draft.part_number || "")}"></label>
      <label class="field"><span>Description</span><input name="description" value="${esc(draft.description || "")}"></label>
      <label class="field"><span>Qty</span><input name="qty" type="number" value="${esc(draft.qty ?? "")}"></label>
      <label class="field"><span>Price</span><input name="unit_price" type="number" value="${esc(draft.unit_price ?? "")}"></label>
      <label class="field"><span>Status</span><select name="status">${statuses}</select></label>
      <div class="form-actions"><button type="submit" class="button primary">Save purchase</button></div>
    </form>
  </section>`;
}

function signInHtml(state) {
  const problem = state.message
    ? `<div class="banner error" role="alert" data-testid="error-banner"><p>${esc(state.message.text)}</p></div>`
    : "";
  const action = state.busy
    ? `<p class="hint" role="status">${esc(state.busyText || "Working…")}</p>`
    : `<button type="button" class="button primary" data-action="sign-in">Sign in with Google</button>`;
  return `<div class="app">
    <header class="top"><h1 class="brand">Asset Tracker</h1><p class="mode-line">Google Drive</p></header>
    <main id="main" data-view="sign-in"><section class="screen">${problem}<h2>Sign in</h2><p>Files are stored in a Google Drive folder named Asset Tracker. This page creates that folder the first time you sign in.</p>${action}</section></main>
  </div>`;
}

export function renderApp(state) {
  if (state.needsSignIn) return signInHtml(state);
  if (state.booting) return shell(state, `<section class="screen"><p class="hint">Loading…</p></section>`);
  if (!state.data) {
    return shell(
      state,
      `<section class="screen"><h2>Could not open the files</h2><p data-testid="load-error">${esc(state.message?.text || "The files could not be read.")}</p><button type="button" class="button primary" data-action="retry">Try again</button></section>`,
    );
  }
  let main = "";
  if (state.view.name === "detail") main = detailHtml(state);
  else if (state.view.name === "asset-form") main = assetFormHtml(state);
  else if (state.view.name === "maintenance") main = maintenanceFormHtml(state);
  else if (state.view.name === "purchase") main = purchaseFormHtml(state);
  else main = listHtml(state);
  return shell(state, main);
}

export function photoIdsOnScreen(state) {
  if (!state.data || state.view?.name !== "detail") return [];
  const asset = state.data.assets.assets.find((item) => item.id === state.view.id);
  return asset?.photo_ids ? [...asset.photo_ids] : [];
}
