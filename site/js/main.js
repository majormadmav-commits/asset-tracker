import { createDriveStore } from "./drive-store.js";
import { createLocalStore } from "./local-store.js";
import { photoFileName, resizeToJpeg } from "./photo.js";
import { listCountText, listResultsHtml, photoIdsOnScreen, renderApp } from "./render.js";

const root = document.getElementById("app");

const state = {
  mode: "local",
  store: null,
  auth: null,
  signedIn: false,
  needsSignIn: false,
  booting: true,
  data: null,
  search: "",
  message: null,
  busy: false,
  busyText: "",
  draft: null,
  pendingPhoto: null,
  photoUrls: {},
  photoErrors: {},
  view: { name: "list" },
};

let keepMessage = false;

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
  if (parts[0] === "asset" && parts[1] === "new") {
    return { name: "asset-form", parentId: params.get("parent") || "" };
  }
  if (parts[0] === "asset" && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    if (parts[2] === "edit") return { name: "asset-form", id };
    if (parts[2] === "meter") return { name: "meter", id };
    if (parts[2] === "maintenance") return { name: "maintenance", id };
    if (parts[2] === "purchase") return { name: "purchase", id };
    return { name: "detail", id };
  }
  return { name: "list" };
}

function render() {
  state.view = parseRoute();
  const search = document.getElementById("search");
  const keepSearch = state.view.name === "list" && search && document.activeElement === search;
  const selectionStart = keepSearch ? search.selectionStart : null;
  root.innerHTML = renderApp(state);
  if (keepSearch) {
    const next = document.getElementById("search");
    if (next) {
      next.focus();
      if (selectionStart != null) next.setSelectionRange(selectionStart, selectionStart);
    }
  }
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

function go(hash, message) {
  state.draft = null;
  clearPendingPhoto();
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

function clearPendingPhoto() {
  if (state.pendingPhoto?.url) URL.revokeObjectURL(state.pendingPhoto.url);
  state.pendingPhoto = null;
}

function readForm(form) {
  const data = {};
  const formData = new FormData(form);
  for (const [key, value] of formData.entries()) {
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

async function onSubmit(form) {
  const kind = form.dataset.form;
  const data = readForm(form);
  state.draft = data;
  const view = parseRoute();
  await withBusy("Saving…", async () => {
    if (kind === "asset") {
      const saved = await state.store.saveAsset(data);
      await loadData();
      go(`#/asset/${encodeURIComponent(saved.id)}`, { type: "success", text: `Saved ${saved.name}.` });
      return;
    }
    if (kind === "meter") {
      const saved = await state.store.updateMeter(view.id, data);
      await loadData();
      go(`#/asset/${encodeURIComponent(saved.id)}`, {
        type: "success",
        text: `Updated meter for ${saved.name}.`,
      });
      return;
    }
    if (kind === "maintenance") {
      const photoIds = [];
      if (state.pendingPhoto?.blob) {
        const photoId = await state.store.uploadPhoto(state.pendingPhoto.blob, photoFileName(view.id));
        photoIds.push(photoId);
      }
      const saved = await state.store.addMaintenance({ ...data, asset_id: view.id, photo_ids: photoIds });
      await loadData();
      go(`#/asset/${encodeURIComponent(view.id)}`, {
        type: "success",
        text: `Saved maintenance ${saved.id}.`,
      });
      return;
    }
    if (kind === "purchase") {
      const saved = await state.store.addPurchase({ ...data, asset_id: data.asset_id || view.id });
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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google sign-in."));
    document.head.appendChild(script);
  });
}

function createAuth(id) {
  let token = "";
  let expiresAt = 0;
  let client = null;

  function clientInstance() {
    if (client) return client;
    if (!window.google?.accounts?.oauth2) {
      throw new Error("Google sign-in is not available yet.");
    }
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: () => {},
    });
    return client;
  }

  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      const tokenClient = clientInstance();
      tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        token = response.access_token || "";
        const seconds = Number(response.expires_in) || 3600;
        expiresAt = Date.now() + seconds * 1000 - 60_000;
        if (!token) {
          reject(new Error("Google sign-in did not return an access token."));
          return;
        }
        resolve(token);
      };
      tokenClient.requestAccessToken(prompt ? { prompt } : {});
    });
  }

  return {
    async signIn() {
      await loadScript("https://accounts.google.com/gsi/client");
      await requestToken("consent");
    },
    async getAccessToken() {
      if (token && Date.now() < expiresAt) return token;
      await loadScript("https://accounts.google.com/gsi/client");
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
    state.message = {
      type: "error",
      text: "Google client ID is missing. Paste it into config.js. See the README.",
    };
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
  render();
}

function registerServiceWorker() {
  const param = new URLSearchParams(location.search).get("store");
  if (param === "local" || !("serviceWorker" in navigator)) return;
  const url = new URL("../sw.js", import.meta.url);
  navigator.serviceWorker.register(url).catch((error) => {
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
  if (action === "clear-photo") {
    const form = button.closest("form");
    if (form) state.draft = readForm(form);
    clearPendingPhoto();
    render();
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
    void withBusy("Signing in…", async () => {
      if (!state.auth) state.auth = createAuth(clientId());
      await state.auth.signIn();
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

root.addEventListener("input", (event) => {
  if (event.target?.id !== "search") return;
  state.search = event.target.value;
  const slot = document.getElementById("asset-list");
  if (!slot || !state.data) return;
  slot.innerHTML = listResultsHtml(state);
  const count = document.querySelector("[data-testid='asset-count']");
  const text = listCountText(state);
  if (count) count.textContent = text;
});

root.addEventListener("change", (event) => {
  if (event.target?.id !== "photo") return;
  const file = event.target.files?.[0];
  if (!file) return;
  const form = event.target.form;
  if (form) state.draft = readForm(form);
  void (async () => {
    try {
      state.busy = true;
      state.busyText = "Resizing photo…";
      state.message = null;
      render();
      const resized = await resizeToJpeg(file);
      if (state.pendingPhoto?.url) URL.revokeObjectURL(state.pendingPhoto.url);
      state.pendingPhoto = {
        blob: resized.blob,
        width: resized.width,
        height: resized.height,
        url: URL.createObjectURL(resized.blob),
      };
      state.busy = false;
      state.busyText = "";
      render();
    } catch (error) {
      showError(error);
    }
  })();
});

window.addEventListener("hashchange", () => {
  state.draft = null;
  clearPendingPhoto();
  state.busy = false;
  state.busyText = "";
  if (!keepMessage) state.message = null;
  keepMessage = false;
  render();
});

registerServiceWorker();
void boot();
