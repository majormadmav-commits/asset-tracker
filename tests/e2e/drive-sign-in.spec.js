import { expect, test } from "@playwright/test";

const CLIENT_ID = "311505228924-q4dboqg7cf23lunbcuj9po276js1sjju.apps.googleusercontent.com";
const TOKEN = "ya29.test-token";

const EMPTY = {
  assets1: '{"schema_version":1,"next_id":1,"assets":[]}\n',
  maint1: '{"schema_version":1,"next_id":1,"entries":[]}\n',
  purch1: '{"schema_version":1,"next_id":1,"lines":[]}\n',
};

function idFor(text) {
  if (text.includes("assets.json")) return "assets1";
  if (text.includes("maintenance.json")) return "maint1";
  if (text.includes("purchases.json")) return "purch1";
  if (text.includes('"name":"Photos"') || text.includes('"name": "Photos"')) return "photos1";
  if (text.includes("Asset Tracker")) return "folder1";
  return "";
}

function gisStub(onRequest) {
  return `window.__gis = { config: null, calls: [] };
window.google = { accounts: { oauth2: {
  initTokenClient(config) {
    window.__gis.config = { client_id: config.client_id, scope: config.scope };
    window.__gis.callback = config.callback;
    window.__gis.error = config.error_callback;
    return { requestAccessToken(override) { window.__gis.calls.push(override || {}); ${onRequest} } };
  },
  revoke() {}
} } };`;
}

test.use({ serviceWorkers: "block" });

test("first sign-in asks only for drive.file and creates the Asset Tracker folder", async ({ page }) => {
  const driveCalls = [];
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: gisStub(
        `queueMicrotask(() => config.callback({ access_token: ${JSON.stringify(TOKEN)}, expires_in: 3600 }));`,
      ),
    }),
  );
  await page.route("https://www.googleapis.com/**", async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    const body = request.postData() || "";
    driveCalls.push({
      url,
      method,
      body,
      authorization: request.headers().authorization || "",
    });
    if (method === "GET" && url.includes("alt=media")) {
      const id = decodeURIComponent(url.split("/files/")[1].split("?")[0]);
      const payload = EMPTY[id];
      if (!payload) {
        await route.fulfill({ status: 404, body: `missing ${id}` });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { etag: '"e"' },
        body: payload,
      });
      return;
    }
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: [] }),
      });
      return;
    }
    if (method === "POST") {
      const id = idFor(body);
      if (!id) {
        await route.fulfill({ status: 500, contentType: "text/plain", body: `unrecognized create: ${body.slice(0, 300)}` });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id }) });
      return;
    }
    await route.fulfill({ status: 500, body: `unhandled ${method} ${url}` });
  });

  await page.goto("/");
  await expect(page.locator(".mode-line")).toHaveText("Google Drive");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with Google" }).click();

  const gis = await page.evaluate(() => window.__gis);
  expect(gis.config).toEqual({
    client_id: CLIENT_ID,
    scope: "https://www.googleapis.com/auth/drive.file",
  });
  expect(gis.calls).toEqual([{ prompt: "consent" }]);

  await expect(page.getByText("No assets yet.")).toBeVisible();
  await expect(page.locator(".mode-line")).toHaveText("Google Drive");
  await expect(page.getByTestId("import-seed")).toBeVisible();

  expect(driveCalls.length).toBeGreaterThan(0);
  expect(driveCalls.every((call) => call.authorization === `Bearer ${TOKEN}`)).toBe(true);
  const posts = driveCalls.filter((call) => call.method === "POST");
  expect(posts.map((call) => idFor(call.body))).toEqual(["folder1", "assets1", "maint1", "purch1", "photos1"]);
  expect(posts[0].body).not.toContain("parents");
  expect(posts[1].body).toContain('"parents":["folder1"]');
  expect(posts[1].body).toContain("assets.json");
  expect(posts[2].body).toContain("maintenance.json");
  expect(posts[3].body).toContain("purchases.json");
  expect(posts[4].body).toContain('"name":"Photos"');
  expect(posts[4].body).toContain('"parents":["folder1"]');
  const lists = driveCalls
    .filter((call) => call.method === "GET" && call.url.includes("q="))
    .map((call) => decodeURIComponent(call.url.replace(/\+/g, " ")));
  expect(lists[0]).toContain("name = 'Asset Tracker'");
  expect(lists[1]).toContain("name = 'assets.json'");
  expect(lists[2]).toContain("name = 'maintenance.json'");
  expect(lists[3]).toContain("name = 'purchases.json'");
  expect(lists[4]).toContain("name = 'Photos'");
  expect(lists[4]).toContain("'folder1' in parents");
});

test("a blocked Google popup is shown and the sign-in button comes back", async ({ page }) => {
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: gisStub(`config.error_callback({ type: "popup_failed_to_open", message: "Failed to open popup window" });`),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByTestId("error-banner")).toContainText("Allow popups for this site");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByText("No assets yet.")).toHaveCount(0);
});
