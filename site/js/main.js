import { findVinInImage } from "./barcode.js";
import { createDriveStore } from "./drive-store.js";
import { reviewStatus } from "./field-config.js";
import { createLocalStore } from "./local-store.js";
import { photoFileName, resizeToJpeg } from "./photo.js";
import { photoIdsOnScreen, renderApp } from "./render.js";
import { applyVin, decodeVin, extractVin } from "./vin.js";

const root = document.getElementById("app");

const state = {
  mode: "local",
  store: null,
  auth: null,
  signedIn: false,
  needsSignIn: false,
  gisReady: false,
  booting: true,
  data: null,
  message: null,
  busy: false,
  busyText: "",
  draft: null,
  pendingFiles: [],
  vinNote: "",
  photoUrls: {},
  photoErrors: {},
  view: { name: "list" },
};

let keepMessage = false;
let vinTimer = 0;

function clientId() {
  return String(window.ASSET_TRACKER_CONFIG?.GOOGLE_CLIENT_ID || "").trim();
}

function selectedMode() {
  const param = new URLSearchParams(location.search).get("store");
  if (param === "local") return "local";
  if (param === "drive") return "drive";
  return clientId() ? "drive" : "local";
}

function parseRoute() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  if (parts[0] === "maintenance") return { name: "maintenance", assetId: params.get("asset") || "" };
  if (parts[0] === "asset" && parts[1] === "new") return { name: "asset-form" };
  if (parts[0] === "asset" && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    if (parts[2] === "purchase") return { name: "purchase", id };
    return { name: "detail", id };
  }
  return { name: "list" };
}

function render() {
  state.view = parseRoute();
  root.innerHTML = renderApp(state);
  void hydratePhotos();
}

function errorText(error) {
  if (!error) return "Something went wrong.";
  return error.message || String(error);
}

function showError(error) {
  state.busy = false;
  state.busyText = "";
  state.message = { type: "error", text: errorText(error) };
  render();
}

async function loadData() {
  state.data = await state.store.loadAll();
  state.booting = false;
  state.needsSignIn = false;
}

async function reload() {
  await loadData();
  render();
}

function clearPendingFiles() {
  for (const item of state.pendingFiles) {
    if (item.url) URL.revokeObjectURL(item.url);
  }
  state.pendingFiles = [];
  state.vinNote = "";
}

function go(hash, message) {
  state.draft = null;
  clearPendingFiles();
  state.busy = false;
  state.busyText = "";
  state.message = message || null;
  keepMessage = Boolean(message);
  if (location.hash === hash) {
    keepMessage = false;
    render();
    return;
  }
  location.hash = hash;
}

function readForm(form) {
  const data = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (key === "photo") continue;
    data[key] = typeof value === "string" ? value : "";
  }
  return data;
}

async function hydratePhotos() {
  if (!state.store || !state.data) return;
  const ids = photoIdsOnScreen(state);
  for (const id of ids) {
    if (!id || Object.prototype.hasOwnProperty.call(state.photoUrls, id)) continue;
    state.photoUrls[id] = "loading";
    try {
      const url = await state.store.photoUrl(id);
      state.photoUrls[id] = url || null;
      if (!url) state.photoErrors[id] = `Photo ${id} is unavailable.`;
    } catch (error) {
      state.photoUrls[id] = null;
      state.photoErrors[id] = errorText(error);
    }
    if (parseRoute().name === "detail") render();
    return;
  }
}

async function withBusy(label, fn) {
  state.busy = true;
  state.busyText = label;
  state.message = null;
  render();
  try {
    await fn();
  } catch (error) {
    showError(error);
  } finally {
    if (state.busy) {
      state.busy = false;
      state.busyText = "";
      render();
    }
  }
}

function safeUploadName(file) {
  const cleaned = String(file?.name || "file").replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned || "file";
}

async function uploadOne(file, fallbackId) {
  if (file.type.startsWith("image/")) {
    const resized = await resizeToJpeg(file);
    return state.store.uploadPhoto(resized.blob, photoFileName(fallbackId));
  }
  return state.store.uploadPhoto(file, safeUploadName(file));
}

async function lookupVin(vin) {
  const current = extractVin(vin);
  if (!current || parseRoute().name !== "asset-form") return;
  state.busy = true;
  state.busyText = "Looking up VIN…";
  state.message = null;
  render();
  try {
    const decoded = await decodeVin(current);
    if (parseRoute().name !== "asset-form") return;
    state.draft = applyVin(state.draft, decoded.fields, current);
    state.vinNote = "Filled year, make, model, engine, and drive from the VIN.";
    state.busy = false;
    state.busyText = "";
    render();
  } catch (error) {
    showError(error);
  }
}

async function ingestFiles(files) {
  const form = document.querySelector('form[data-form="asset"]');
  if (form) state.draft = readForm(form);
  state.busy = true;
  state.busyText = "Reading photo…";
  state.message = null;
  render();
  try {
    for (const file of files) {
      const item = {
        file,
        decoded: false,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
      };
      if (file.type.startsWith("image/")) {
        try {
          const vin = await findVinInImage(file);
          if (vin) {
            item.decoded = true;
            state.draft = applyVin(state.draft, {}, vin);
            try {
              const decoded = await decodeVin(vin);
              state.draft = applyVin(state.draft, decoded.fields, vin);
              state.vinNote = "Filled year, make, model, engine, and drive from the VIN.";
            } catch (error) {
              state.message = { type: "error", text: errorText(error) };
            }
          }
        } catch (error) {
          state.message = { type: "error", text: errorText(error) };
        }
      }
      state.pendingFiles.push(item);
    }
    state.busy = false;
    state.busyText = "";
    render();
  } catch (error) {
    showError(error);
  }
}

async function onSubmit(form) {
  const kind = form.dataset.form;
  const data = readForm(form);
  state.draft = data;
  const view = parseRoute();
  await withBusy("Saving…", async () => {
    if (kind === "asset") {
      const photoIds = [];
      for (const item of state.pendingFiles) {
        photoIds.push(await uploadOne(item.file, data.asset_type || "asset"));
      }
      const status = reviewStatus(state.pendingFiles);
      const saved = await state.store.saveAsset({
        ...data,
        photo_ids: photoIds,
        ...(status ? { status } : {}),
      });
      const label = saved.name || saved.id;
      const text = status
        ? `Saved ${label}. Photos that could not be read are marked needs review.`
        : `Saved ${label}.`;
      await loadData();
      go(`#/asset/${encodeURIComponent(saved.id)}`, { type: "success", text });
      return;
    }
    if (kind === "maintenance") {
      if (!data.asset_id) throw new Error("Choose an asset for this maintenance entry.");
      const photoIds = [];
      const file = form.querySelector('input[type="file"]')?.files?.[0];
      if (file) photoIds.push(await uploadOne(file, data.asset_id));
      const saved = await state.store.addMaintenance({ ...data, photo_ids: photoIds });
      await loadData();
      go(`#/asset/${encodeURIComponent(data.asset_id)}`, {
        type: "success",
        text: `Saved maintenance ${saved.id}.`,
      });
      return;
    }
    if (kind === "purchase") {
      const saved = await state.store.addPurchase(data);
      await loadData();
      go(`#/asset/${encodeURIComponent(view.id)}`, { type: "success", text: `Saved purchase ${saved.id}.` });
    }
  });
}

async function importSeed() {
  await withBusy("Importing seed data…", async () => {
    const response = await fetch(new URL("../seed/seed-data.json", import.meta.url));
    if (!response.ok) throw new Error(`Could not load seed data (${response.status} ${response.statusText}).`);
    const seed = await response.json();
    await state.store.importSeed(seed);
    state.busy = false;
    state.busyText = "";
    state.message = { type: "success", text: "Imported seed data." };
    await reload();
  });
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Could not load Google sign-in."));
    let existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.failed === "true") {
      existing.remove();
      existing = null;
    }
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      script.dataset.failed = "true";
      fail();
    };
    document.head.appendChild(script);
  });
}

function createAuth(id) {
  let token = "";
  let expiresAt = 0;
  let client = null;
  let pending = null;

  function finish(error, accessToken) {
    const current = pending;
    pending = null;
    if (!current) return;
    if (error) current.reject(error);
    else current.resolve(accessToken);
  }

  function onToken(response) {
    if (response.error) {
      finish(new Error(response.error_description || response.error));
      return;
    }
    token = response.access_token || "";
    const seconds = Number(response.expires_in) || 3600;
    expiresAt = Date.now() + seconds * 1000 - 60_000;
    if (!token) {
      finish(new Error("Google sign-in did not return an access token."));
      return;
    }
    finish(null, token);
  }

  function onClientError(error) {
    const type = error?.type || "";
    const text =
      type === "popup_failed_to_open"
        ? "The Google sign-in window was blocked. Allow popups for this site, then tap Sign in again."
        : type === "popup_closed"
          ? "Google sign-in was closed before it finished."
          : error?.message || "Google sign-in could not open.";
    finish(new Error(text));
  }

  function clientInstance() {
    if (client) return client;
    if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in is not available yet.");
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: onToken,
      error_callback: onClientError,
    });
    return client;
  }

  function requestToken(prompt) {
    const tokenClient = clientInstance();
    if (pending) return Promise.reject(new Error("Google sign-in is already in progress."));
    let rejectPending;
    const promise = new Promise((resolve, reject) => {
      pending = { resolve, reject };
      rejectPending = reject;
    });
    try {
      tokenClient.requestAccessToken(prompt ? { prompt } : {});
    } catch (error) {
      pending = null;
      rejectPending(error);
    }
    return promise;
  }

  return {
    async prepare() {
      await loadScript(GSI_SRC);
      clientInstance();
    },
    // Call from the tap handler. Android Chrome blocks the popup if this waits.
    beginSignIn() {
      if (token && Date.now() < expiresAt) return Promise.resolve(token);
      return requestToken("consent");
    },
    async getAccessToken() {
      if (token && Date.now() < expiresAt) return token;
      await loadScript(GSI_SRC);
      return requestToken("");
    },
    signOut() {
      const current = token;
      token = "";
      expiresAt = 0;
      if (current && window.google?.accounts?.oauth2?.revoke) {
        window.google.accounts.oauth2.revoke(current, () => {});
      }
    },
  };
}

async function connectDrive() {
  state.store = createDriveStore({
    getAccessToken: () => state.auth.getAccessToken(),
    storage: localStorage,
  });
  await state.store.init();
  state.signedIn = true;
  state.busy = false;
  state.busyText = "";
  state.message = null;
  await reload();
}

async function boot() {
  state.mode = selectedMode();
  state.view = parseRoute();
  if (state.mode === "drive" && !clientId()) {
    state.booting = false;
    state.needsSignIn = true;
    state.message = { type: "error", text: "Google client ID is missing. Paste it into config.js. See the README." };
    render();
    return;
  }
  if (state.mode === "local") {
    state.store = createLocalStore({ storage: localStorage });
    try {
      await reload();
    } catch (error) {
      state.booting = false;
      state.data = null;
      showError(error);
    }
    return;
  }
  state.auth = createAuth(clientId());
  state.needsSignIn = true;
  state.booting = false;
  state.gisReady = false;
  state.message = null;
  render();
  try {
    await state.auth.prepare();
    if (!state.needsSignIn) return;
    state.gisReady = true;
    render();
  } catch (error) {
    if (!state.needsSignIn) return;
    showError(error);
  }
}

function registerServiceWorker() {
  const param = new URLSearchParams(location.search).get("store");
  if (param === "local" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch((error) => {
    console.warn("Service worker registration failed:", error);
  });
}

root.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "dismiss") {
    state.message = null;
    render();
    return;
  }
  if (action === "refresh") {
    void withBusy("Refreshing…", async () => {
      state.busy = false;
      state.busyText = "";
      await reload();
    });
    return;
  }
  if (action === "import-seed") {
    void importSeed();
    return;
  }
  if (action === "retry") {
    void boot().catch(showError);
    return;
  }
  if (action === "sign-in") {
    if (!state.auth) state.auth = createAuth(clientId());
    let signingIn;
    try {
      signingIn = state.auth.beginSignIn();
    } catch (error) {
      showError(error);
      return;
    }
    void withBusy("Signing in…", async () => {
      await signingIn;
      await connectDrive();
    });
    return;
  }
  if (action === "sign-out") {
    state.auth?.signOut();
    state.signedIn = false;
    state.store = null;
    state.data = null;
    state.needsSignIn = true;
    state.message = null;
    render();
  }
});

root.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  void onSubmit(form);
});

root.addEventListener("change", (event) => {
  if (event.target?.name === "asset_type" && event.target.form) {
    state.draft = readForm(event.target.form);
    state.message = null;
    render();
    return;
  }
  if (event.target?.id === "photo") {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length) void ingestFiles(files);
  }
});

root.addEventListener("input", (event) => {
  if (event.target?.name !== "vin_serial") return;
  if (event.target.form) state.draft = readForm(event.target.form);
  const vin = extractVin(event.target.value);
  window.clearTimeout(vinTimer);
  if (!vin) return;
  vinTimer = window.setTimeout(() => {
    void lookupVin(vin);
  }, 250);
});

window.addEventListener("hashchange", () => {
  state.draft = null;
  clearPendingFiles();
  state.busy = false;
  state.busyText = "";
  if (!keepMessage) state.message = null;
  keepMessage = false;
  render();
});

registerServiceWorker();
void boot();
