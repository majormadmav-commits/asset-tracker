# Bot contract for Asset Tracker files

This is the rule sheet for an agent editing the owner's Google Drive files directly. The web app is not the only writer. Follow these rules or you will split the data, reuse an id, or hide a file from the app.

The app's OAuth scope is only `https://www.googleapis.com/auth/drive.file`. It can read and write files **it created**. It cannot see a replacement file you create beside the original, even in the same folder.

## Where the files are

In the owner's My Drive:

- `Asset Tracker/` — folder the app created
- `Asset Tracker/assets.json`
- `Asset Tracker/maintenance.json`
- `Asset Tracker/purchases.json`
- `Asset Tracker/Photos/` — JPEG files referenced by `photo_ids`

The app stores those Drive file ids in the browser under `asset-tracker-drive-ids`. Do not delete the JSON files, do not rename them, and do not upload a second copy. Update the existing file bytes in place (`files.update`).

Photos the app should display have to be files it can read. A photo created by another OAuth client is often invisible under `drive.file`. Leave new photos to the app unless you already know the file id is one the app created.

## File shape

Every JSON file is an object. `schema_version` is first and is `1`. Do not raise it. `next_id` is second. Then the collection.

```json
{
  "schema_version": 1,
  "next_id": 4,
  "assets": []
}
```

`maintenance.json` uses `entries`. `purchases.json` uses `lines`.

Pretty-print with two spaces and a trailing newline. Keep each record's keys in the order below, and omit keys you do not know.

### Asset

`id`, `name`, `owner_entity`, `category`, `parent_id`, `status`, `location`, `year`, `make`, `model`, `model_code`, `vin_serial`, `engine_code`, `trans_code`, `paint_code`, `meter_value`, `meter_unit`, `meter_date`, `mods`, `purchase_date`, `cost`, `vendor`, `receipt_url`, `photo_ids`, `notes`, `updated_at`

Required: `id`, `name`. Everything else is optional.

- `owner_entity`: `AV business`, `428 Projects`, `Personal`, or omit
- `status`: `in service`, `down`, `rebuild`, `disposed`, or omit
- `meter_unit`: `miles`, `hours`, or omit
- `parent_id`: an existing asset id. No cycles.
- `photo_ids`: array of Drive file ids
- `year`: whole number. Money, meter, qty, prices: JSON numbers
- dates: `YYYY-MM-DD`
- `updated_at`: UTC ISO-8601, set on every asset change to the time you write, for example `2026-11-10T15:04:00.000Z`

### Maintenance entry

`id`, `asset_id`, `date`, `meter`, `work`, `parts`, `fluids`, `who`, `cost`, `notes`, `photo_ids`, `receipt_url`

### Purchase line

`id`, `date`, `vendor`, `order_number`, `part_number`, `description`, `qty`, `unit_price`, `shipping`, `receipt_url`, `asset_id`, `status`

- `status`: `ordered`, `received`, `installed`, `returned`, or omit
- There is no order-total field. The RockAuto seed stores the order total in `unit_price` and leaves `qty` and `shipping` off. Do not invent line items to "explain" that number.

## Ids

| Collection | Prefix | Example |
| --- | --- | --- |
| assets | `A` | `A0001` |
| maintenance | `M` | `M0001` |
| purchases | `P` | `P0001` |

Pad with zeros to at least four digits. Past 9999 the number just gets longer (`A10000`).

`next_id` is the next integer to hand out. It is one greater than the highest id **ever** assigned in that file, including rows that were later removed.

When you add a row:

1. Re-read the file.
2. Take `next_id` if it is ahead of every id still in the file. Also scan the rows, so a stale `next_id` cannot collide.
3. Assign that id, then set `next_id` to one more.
4. Never lower `next_id`. Never reuse an id.

## Write procedure

1. Re-read the file you are about to change. Do this immediately before the write, not at the start of a long task.
2. Change that fresh copy. Keep rows you did not mean to edit.
3. Write the whole file back to the **same** file id.
4. Send `If-Match` with the ETag from the read when the client allows it. On HTTP 412, go back to step 1 and apply your change again on the new copy.
5. Read the file once more if the write response is ambiguous. Do not tell the owner it saved until the write succeeded.
6. If it failed, show the error text. Do not swallow it and do not retry forever.

A correct merge for a new asset keeps every asset that was in the re-read, appends the new one, and bumps `next_id`. Editing one asset replaces that record only.

## Do not invent data

Unknown means omit the field. Do not guess a model, a trim, an owner, a cost, a date, a category, or a status. Do not copy a value from a different asset to fill a blank. Do not add a "helpful" note the owner did not state.

The seed vehicles are the exception that proves the rule. Their facts are only:

- 2017 Toyota 4Runner. Name `2017 Toyota 4Runner`. VIN `JTEBU5JR6H5470907`. Model code `GRN285L-GKAGKA`. Engine `1GR-FE`. Paint `1G3`.
- 1998 Chevrolet S10. Name `1998 Chevrolet S10`. VIN `1GCCS14X1WK105227`. Engine `4.3L LF6`. Notes `2WD` (there is no drivetrain field). Mods `MerCruiser 4.3 Gen+ engine (serial 0L057753) on LF6 donor, marine 4.3L oil pan`.
- 2011 Ram, name `Truckasaurus`. VIN `3D7LT2ET4BG551507`. Purchase date `2021-06-15`. Cost `18500`. Location `Island`. Notes `estimated value $7,500`. Model is unknown; leave it off.
- One purchase: vendor `RockAuto`, order `364948524`, `unit_price` `147.21`, asset the S10, status `ordered`. No part number, no qty, no shipping.

`owner_entity` is blank on all three. Do not set it later unless the owner says which entity.

`updated_at` is not a fact about the vehicle. The app stamps it when it imports or saves.

## What the app does on its own

The same rules are implemented in `site/js/drive-store.js` and `site/js/local-store.js`: re-read, merge, assign the next id, write, and surface the error string. `?store=local` uses the browser instead of Drive so an agent can run that path without the owner's Google account. A Drive-shaped test of the HTTP calls lives in `tests/drive-store.test.js`.
