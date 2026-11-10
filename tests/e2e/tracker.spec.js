import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const photoPath = fileURLToPath(new URL("./fixtures/wide.png", import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto("/?store=local");
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
  await expect(page.getByText("Local mode: data stays in this browser")).toBeVisible();
});

test("saves an asset, meter, maintenance photo, and purchase across reload", async ({ page }) => {
  await page.getByRole("link", { name: "Add asset" }).click();
  await page.getByLabel("Name").fill("Lake House");
  await page.getByLabel("Category").fill("House");
  await page.getByLabel("Status").selectOption("in service");
  await page.getByLabel("Location").fill("Island");
  await page.getByLabel("VIN / serial").fill("LH-100");
  await page.getByRole("button", { name: "Save asset" }).click();

  await expect(page.getByTestId("success-banner")).toContainText("Saved Lake House.");
  await expect(page.getByRole("heading", { name: "Lake House" })).toBeVisible();
  await expect(page.getByTestId("asset-id")).toHaveText("A0001");

  await page.getByRole("link", { name: "Update meter" }).click();
  await page.getByLabel("Meter").fill("1200");
  await page.getByLabel("Unit").selectOption("hours");
  await page.getByLabel("Date").fill("2026-11-01");
  await page.getByRole("button", { name: "Save meter" }).click();
  await expect(page.getByTestId("success-banner")).toContainText("Updated meter for Lake House.");
  await expect(page.getByTestId("meter-value")).toHaveText("1,200 hours on 2026-11-01");

  await page.getByRole("link", { name: "Add maintenance" }).click();
  await expect(page.getByRole("heading", { name: "Add maintenance" })).toBeVisible();
  await page.getByLabel("Date").fill("2026-11-01");
  await page.getByLabel("Meter").fill("1200");
  await page.getByLabel("Work").fill("Replaced anode");
  await page.getByLabel("Parts").fill("anode rod AR-9");
  await page.getByLabel("Cost").fill("42");
  await page.getByLabel("Photo").setInputFiles(photoPath);
  await expect(page.getByText("Ready: 1600×800 JPEG")).toBeVisible();
  await page.getByRole("button", { name: "Save maintenance" }).click();

  await expect(page.getByTestId("success-banner")).toContainText("Saved maintenance M0001.");
  await expect(page.getByTestId("maintenance-entry")).toContainText("Replaced anode");
  await expect(page.getByTestId("maintenance-entry")).toContainText("anode rod AR-9");
  const photo = page.getByTestId("maintenance-photo");
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img) => img.naturalWidth)).toBe(1600);
  await expect.poll(() => photo.evaluate((img) => img.naturalHeight)).toBe(800);
  await expect.poll(() => photo.evaluate((img) => img.getAttribute("src") || "")).toMatch(/^data:image\/jpeg;base64,/);

  await page.getByRole("link", { name: "Add purchase" }).click();
  await page.getByLabel("Date").fill("2026-11-02");
  await page.getByLabel("Vendor").fill("Amazon");
  await page.getByLabel("Part number").fill("AR-9");
  await page.getByLabel("Description").fill("Anode rod");
  await page.getByLabel("Qty").fill("2");
  await page.getByLabel("Price").fill("14.5");
  await page.getByLabel("Status").selectOption("ordered");
  await page.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.getByTestId("success-banner")).toContainText("Saved purchase P0001.");
  await expect(page.getByTestId("purchase-line")).toContainText("Amazon");
  await expect(page.getByTestId("purchase-line")).toContainText("AR-9");
  await expect(page.getByTestId("purchase-line")).toContainText("$14.50");
  await expect(page.getByTestId("purchase-line")).toContainText("ordered");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Lake House" })).toBeVisible();
  await expect(page.getByTestId("meter-value")).toHaveText("1,200 hours on 2026-11-01");
  await expect(page.getByTestId("maintenance-entry")).toContainText("Replaced anode");
  await expect(page.getByTestId("maintenance-photo")).toBeVisible();
  await expect(page.getByTestId("purchase-line")).toContainText("Anode rod");
  await expect.poll(() => page.getByTestId("maintenance-photo").evaluate((img) => img.naturalWidth)).toBe(1600);

  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search assets" }).fill("LH-100");
  await expect(page.getByTestId("asset-card")).toHaveCount(1);
  await expect(page.getByTestId("asset-card")).toContainText("Lake House");
  await expect(page.getByTestId("asset-card")).toContainText("in service");
});

test("shows a component under its parent and searches by category", async ({ page }) => {
  await page.getByRole("link", { name: "Add asset" }).click();
  await page.getByLabel("Name").fill("Cabin");
  await page.getByLabel("Category").fill("House");
  await page.getByLabel("VIN / serial").fill("CABIN-1");
  await page.getByRole("button", { name: "Save asset" }).click();
  await expect(page.getByTestId("asset-id")).toHaveText("A0001");

  await page.getByRole("link", { name: "Add component" }).click();
  await page.getByLabel("Name").fill("Furnace");
  await page.getByLabel("Category").fill("Component");
  await page.getByLabel("VIN / serial").fill("FUR-99");
  await expect(page.getByLabel("Parent asset")).toHaveValue("A0001");
  await page.getByRole("button", { name: "Save asset" }).click();
  await expect(page.getByText("Part of Cabin")).toBeVisible();

  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await page.getByRole("link", { name: "Add asset" }).click();
  await page.getByLabel("Name").fill("Laptop");
  await page.getByLabel("Category").fill("Computer");
  await page.getByRole("button", { name: "Save asset" }).click();

  await page.getByRole("link", { name: "Assets", exact: true }).click();
  const furnace = page.getByTestId("asset-card").filter({ hasText: "Furnace" });
  await expect(furnace).toContainText("Part of Cabin");
  await page.getByRole("searchbox", { name: "Search assets" }).fill("FUR-99");
  await expect(page.getByTestId("asset-count")).toHaveText("2 of 3");
  await expect(page.getByTestId("asset-card").filter({ hasText: "Laptop" })).toHaveCount(0);
  await expect(furnace).toBeVisible();
  await expect(page.getByRole("link", { name: /^Cabin\b/ })).toBeVisible();
});

test("imports the known vehicles and keeps them after reload", async ({ page }) => {
  await page.getByTestId("import-seed").click();
  await expect(page.getByTestId("success-banner")).toContainText("Imported seed data.");
  await expect(page.getByTestId("import-seed")).toHaveCount(0);
  await expect(page.getByTestId("asset-card")).toHaveCount(3);

  await page.getByRole("searchbox", { name: "Search assets" }).fill("jtebu5jr6h5470907");
  await page.getByTestId("asset-card").click();
  await expect(page.getByRole("heading", { name: "2017 Toyota 4Runner" })).toBeVisible();
  await expect(page.getByText("GRN285L-GKAGKA")).toBeVisible();
  await expect(page.getByText("1GR-FE")).toBeVisible();
  await expect(page.getByText("1G3")).toBeVisible();
  await expect(page.locator(".row", { hasText: "Owner" })).toHaveCount(0);
  await expect(page.locator(".row", { hasText: "Category" })).toHaveCount(0);

  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search assets" }).fill("1GCCS14X1WK105227");
  await page.getByTestId("asset-card").click();
  await expect(page.getByText("MerCruiser 4.3 Gen+ engine (serial 0L057753) on LF6 donor, marine 4.3L oil pan")).toBeVisible();
  await expect(page.getByText("2WD")).toBeVisible();
  await expect(page.getByText("4.3L LF6")).toBeVisible();
  const purchase = page.getByTestId("purchase-line");
  await expect(purchase).toContainText("RockAuto");
  await expect(purchase).toContainText("364948524");
  await expect(purchase).toContainText("$147.21");
  await expect(purchase).toContainText("ordered");
  await expect(purchase).toContainText("Price");

  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search assets" }).fill("Truckasaurus");
  await page.getByTestId("asset-card").click();
  await expect(page.getByText("Island")).toBeVisible();
  await expect(page.getByText("$18,500.00")).toBeVisible();
  await expect(page.getByText("2021-06-15")).toBeVisible();
  await expect(page.getByText("estimated value $7,500")).toBeVisible();
  await expect(page.getByText("3D7LT2ET4BG551507")).toBeVisible();
  await expect(page.locator(".row", { hasText: "Model" })).toHaveCount(0);
  await expect(page.getByText("AV business")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Truckasaurus" })).toBeVisible();
  await expect(page.getByText("$18,500.00")).toBeVisible();
});

test("shows error text instead of failing silently", async ({ page }) => {
  await page.goto("/?store=local#/asset/new");
  await page.getByRole("button", { name: "Save asset" }).click();
  await expect(page.getByRole("alert")).toContainText("Name is required.");

  await page.goto("/?store=local");
  await page.evaluate(() => localStorage.setItem("asset-tracker-local-v1-assets", "{"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(/Could not read assets\.json: .+/);
});
