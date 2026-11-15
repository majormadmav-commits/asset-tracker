import { expect, test } from "@playwright/test";

const CLIENT_ID = "311505228924-q4dboqg7cf23lunbcuj9po276js1sjju.apps.googleusercontent.com";
const TOKEN = "ya29.test-token";

function gisStub() {
  return `window.__gis = { config: null, calls: [] };
window.google = { accounts: { oauth2: {
  initTokenClient(config) {
    window.__gis.config = { client_id: config.client_id, scope: config.scope };
    window.__gis.callback = config.callback;
    window.__gis.error = config.error_callback;
    return { requestAccessToken(override) {
      window.__gis.calls.push(override || {});
      queueMicrotask(() => config.callback({ access_token: ${JSON.stringify(TOKEN)}, expires_in: 3600 }));
    } };
  },
  revoke() {}
} } };`;
}

test("install metadata is served and the worker does not replay a cached page", async ({ page }) => {
  const driveCalls = [];
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ contentType: "text/javascript", body: gisStub() }),
  );
  await page.route("https://www.googleapis.com/**", async (route) => {
    const request = route.request();
    driveCalls.push({ url: request.url(), method: request.method() });
    if (request.method() === "GET" && request.url().includes("alt=media")) {
      const id = decodeURIComponent(request.url().split("/files/")[1].split("?")[0]);
      const empty = {
        assets1: '{"schema_version":1,"next_id":1,"assets":[]}\n',
        maint1: '{"schema_version":1,"next_id":1,"entries":[]}\n',
        purch1: '{"schema_version":1,"next_id":1,"lines":[]}\n',
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { etag: '"e"' },
        body: empty[id] || "{}",
      });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "folder1" }),
    });
  });

  const manifest = await page.goto("/manifest.webmanifest");
  expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
  const body = await manifest.json();
  expect(body.name).toBe("Asset Tracker");
  expect(body.display).toBe("standalone");
  expect(body.start_url).toBe("/asset-tracker/");
  expect(body.scope).toBe("/asset-tracker/");

  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const keys = await page.evaluate(() => caches.keys());
  expect(keys).toEqual([]);

  await page.evaluate(async () => {
    const cache = await caches.open("poison");
    await cache.put(
      location.href,
      new Response("<!doctype html><title>STALE SHELL</title><h1>STALE SHELL</h1>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("STALE SHELL")).toHaveCount(0);
  await expect(page.locator(".top")).toHaveCSS("background-color", "rgb(11, 13, 77)");

  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByText("No assets yet.")).toBeVisible();
  const gis = await page.evaluate(() => window.__gis);
  expect(gis.config).toEqual({
    client_id: CLIENT_ID,
    scope: "https://www.googleapis.com/auth/drive.file",
  });
  expect(driveCalls.length).toBeGreaterThan(0);
  expect(driveCalls.every((call) => call.url.startsWith("https://www.googleapis.com/"))).toBe(true);
});
