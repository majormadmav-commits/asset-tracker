import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const photoPath = fileURLToPath(new URL("./fixtures/wide.png", import.meta.url));
const vpicBody = readFileSync(new URL("../fixtures/vpic-JTEBU5JR6H5470907.json", import.meta.url), "utf8");

test.beforeEach(async ({ page }) => {
  await page.route("https://vpic.nhtsa.dot.gov/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: vpicBody }),
  );
  await page.goto("/?store=local");
  await expect(page.getByRole("heading", { name: "Asset Tracker" })).toBeVisible();
  await expect(page.getByText("Local mode: data stays in this browser")).toBeVisible();
});

test("fills car fields from a typed VIN and keeps a maintenance log", async ({ page }) => {
  await page.getByRole("link", { name: "+ Add Asset" }).click();
  await page.getByLabel("VIN").fill("JTEBU5JR6H5470907");
  await expect(page.getByRole("textbox", { name: "Make", exact: true })).toHaveValue("TOYOTA");
  await expect(page.getByRole("textbox", { name: "Model", exact: true })).toHaveValue("4Runner");
  await expect(page.getByRole("textbox", { name: "Engine", exact: true })).toHaveValue("1GR-FE");
  await expect(page.getByRole("textbox", { name: "Drive", exact: true })).toHaveValue("4WD/4-Wheel Drive/4x4");
  await expect(page.getByRole("spinbutton", { name: "Year", exact: true })).toHaveValue("2017");
  await expect(page.getByRole("combobox", { name: "Type", exact: true })).toHaveValue("car");
  await expect(page.getByTestId("vin-note")).toContainText("Filled year, make, model, engine, and drive");
  await page.getByLabel("Name").fill("2017 Toyota 4Runner");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("success-banner")).toContainText("Saved 2017 Toyota 4Runner.");
  await expect(page.getByTestId("needs-review")).toHaveCount(0);
  await expect(page.getByText("1GR-FE")).toBeVisible();

  await page.getByRole("link", { name: "Log Maintenance", exact: true }).click();
  await page.getByLabel("Asset").selectOption({ label: "2017 Toyota 4Runner (A0001)" });
  await page.getByLabel("Work").fill("Oil change");
  await page.getByRole("button", { name: "Save maintenance" }).click();
  await expect(page.getByTestId("maintenance-entry")).toContainText("Oil change");

  await page.reload();
  await expect(page.getByRole("heading", { name: "2017 Toyota 4Runner" })).toBeVisible();
  await expect(page.getByTestId("maintenance-entry")).toContainText("Oil change");
  await expect(page.getByText("TOYOTA", { exact: true })).toBeVisible();
});

test("saves an unread photo as needs review", async ({ page }) => {
  await page.getByRole("link", { name: "+ Add Asset" }).click();
  await page.getByLabel("Take photo / upload file").setInputFiles(photoPath);
  await expect(page.getByText("Not read — will be saved for review")).toBeVisible();
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("house");
  await expect(page.getByRole("textbox", { name: "VIN", exact: true })).toHaveCount(0);
  await page.getByLabel("Name").fill("Cabin");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("success-banner")).toContainText("needs review");
  await expect(page.getByTestId("needs-review")).toBeVisible();
  const photo = page.getByTestId("asset-photo");
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img) => img.naturalWidth)).toBe(1600);

  await page.reload();
  await expect(page.getByTestId("needs-review")).toBeVisible();
  await expect(page.getByTestId("asset-photo")).toBeVisible();
  await page.getByRole("link", { name: "Assets" }).click();
  await expect(page.getByTestId("asset-row")).toContainText("needs review");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("asset-row")).toContainText("Cabin");
});

test("type picker changes the fields", async ({ page }) => {
  await page.getByRole("link", { name: "+ Add Asset" }).click();
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("boat");
  await expect(page.getByRole("textbox", { name: "HIN", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Engine make/model/serial", exact: true })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Hours", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "VIN", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Price", exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("appliance");
  await expect(page.getByRole("textbox", { name: "Fuel", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "BTU", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Install date", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "HIN", exact: true })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("computer");
  await expect(page.getByRole("textbox", { name: "OS", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Fuel", exact: true })).toHaveCount(0);
});

test("imports the known vehicles and shows an error when nothing was entered", async ({ page }) => {
  await page.getByTestId("import-seed").click();
  await expect(page.getByTestId("success-banner")).toContainText("Imported seed data.");
  await expect(page.getByTestId("asset-row")).toHaveCount(3);

  await page.getByRole("link", { name: /1998 Chevrolet S10/ }).click();
  await expect(page.getByText("4.3L LF6")).toBeVisible();
  await expect(page.getByText("2WD")).toBeVisible();
  await expect(page.getByText("MerCruiser 4.3 Gen+ engine (serial 0L057753) on LF6 donor, marine 4.3L oil pan")).toBeVisible();
  const purchase = page.getByTestId("purchase-line");
  await expect(purchase).toContainText("RockAuto");
  await expect(purchase).toContainText("364948524");
  await expect(purchase).toContainText("$147.21");

  await page.getByRole("link", { name: "Assets" }).click();
  await page.getByRole("link", { name: /Truckasaurus/ }).click();
  await expect(page.getByText("Island")).toBeVisible();
  await expect(page.getByText("$18,500.00")).toBeVisible();
  await expect(page.getByText("estimated value $7,500")).toBeVisible();

  await page.getByRole("link", { name: "+ Add Asset" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("Add a photo or a name.");
});
