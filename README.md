# Asset Tracker

A phone-first log for the boats, campers, houses, vehicles, and the parts on them (a furnace, a water heater). The page is static. The records live in the owner's Google Drive as three JSON files. There is no server and nothing here is a paid service: GitHub Pages hosts the page, and Google Drive stores the data.

Expected site, once Pages is on and the workflow has run from `main`:

**https://majormadmav-commits.github.io/asset-tracker/**

Until a Google client id is pasted into `site/config.js`, that URL opens in **local mode**. The banner says so. Records stay in that browser and are not in Drive.

## Use it on the phone

1. Open the site in Android Chrome.
2. Sign in with Google once `config.js` has the client id. The first sign-in creates a My Drive folder named `Asset Tracker`, the three JSON files, and a `Photos` folder. Do not create that folder yourself first. This app's permission is `drive.file`, so it can only see files it created.
3. In Chrome: menu → **Add to Home screen** (or Install app). The manifest and service worker make it stand alone. The shell is cached. Reading and saving the Drive files needs a connection.
4. The page is three buttons: **Assets**, **+ Add Asset**, and **Log Maintenance**. The asset list has **Refresh**. Add Asset starts with **Take photo / upload file** (camera or a file, including a PDF). Pick a type and the fields change. A VIN barcode, or a VIN you type, is looked up on the free NHTSA vPIC API and fills year, make, model, engine, and drive. A photo that cannot be read is still saved, and the asset is marked `needs_review` for a later pass. Maintenance and purchases are on the asset. Photos are scaled to a JPEG about 1600px on the long side before they go to `Photos`.

Ids (`A0001`, `M0001`, `P0001`) are assigned by the app and are never reused. A name can be blank when the only thing you have is an unread photo.

When `assets.json` has no assets, **Import seed data** loads the three known vehicles. It does not guess anything else. See [BOT-CONTRACT.md](BOT-CONTRACT.md) for the exact facts and for the rules an agent must follow if it edits the Drive files itself.

`?store=local` forces the on-phone store even after a client id is set. That is how the automated tests run a real save without Google.

## Create the OAuth client

The client id is not a secret (it ships in the page). Do not create a client secret, and do not put one in the repo. Use the Google account that owns the Drive.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project. Name it `Asset Tracker`. This is free.
2. **APIs & Services → Library**. Find **Google Drive API**. Click **Enable**.
3. **APIs & Services → OAuth consent screen**.
   - User type: **External**.
   - App name: `Asset Tracker`.
   - User support email and developer contact: the Gmail account that will use the tracker. The commits on this repo are `majormadmav@gmail.com`; use that account if it is the one that owns the Drive.
   - Save and continue through scopes. Do not add a sensitive or restricted scope. The page requests only `https://www.googleapis.com/auth/drive.file` at sign-in.
   - Publishing status must stay **Testing**.
   - **Test users**: add that same Gmail account (`majormadmav@gmail.com` if that is the Drive account). In Testing, only test users can sign in. Nobody else gets a copy of this Drive.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Asset Tracker web`.
   - **Authorized JavaScript origins**: `https://majormadmav-commits.github.io`
   - Do not put a path on that origin. `https://majormadmav-commits.github.io/asset-tracker` is not an origin and Google will reject it.
   - Authorized redirect URIs: leave empty. This app uses the Google Identity Services token client, not a redirect.
5. Copy the client id. It ends in `.apps.googleusercontent.com`.
6. Paste it into `site/config.js`:

   ```js
   window.ASSET_TRACKER_CONFIG = {
     GOOGLE_CLIENT_ID: "paste-the-id.apps.googleusercontent.com",
   };
   ```

7. Commit that file to `main` and push. The **Test and deploy** workflow publishes it. The id is visible in the page source; the origin allowlist and the test-user list are what keep it to this account.

Optional, only if you want to try Drive from a computer: also add the origins `http://127.0.0.1:4173` and `http://localhost:4173`, then run `npm start` and open `http://127.0.0.1:4173`.

The first time you sign in, Google shows an unverified-app warning because the consent screen is in Testing. That is expected. Continue as the test user (Advanced, then go on to Asset Tracker, if Google asks). The scope is non-sensitive, so the app does not need Google's restricted-scope verification. Leave the consent screen in Testing.

The sign-in token lasts about an hour. When a save says the session expired, tap **Sign in** again.

### If sign-in fails

The page shows the error text. Common ones:

| What you see | What to do |
| --- | --- |
| `origin_mismatch` or `redirect_uri_mismatch` | The JavaScript origin must be exactly `https://majormadmav-commits.github.io` |
| `accessNotConfigured` or Drive API 403 | Enable the Google Drive API on this Cloud project |
| `access_denied` | Add this Gmail address as a test user. Stay in Testing. |
| The app stays on "Local mode" | `GOOGLE_CLIENT_ID` in `site/config.js` is still empty, or the new value has not been deployed |
| A folder you made by hand never fills in | Delete nothing yet. Sign in and let the app create `Asset Tracker`. A hand-made folder is invisible to `drive.file`. |

## GitHub Pages

The workflow [`.github/workflows/test-and-deploy.yml`](.github/workflows/test-and-deploy.yml) runs the unit tests and Playwright, then on a push to `main` deploys the `site/` directory with `actions/deploy-pages`.

Pages has to use **GitHub Actions** as the source. If this repo's Pages setting is not that already, the owner does this once:

1. GitHub → this repo → **Settings** → **Pages**.
2. **Build and deployment** → **Source** → **GitHub Actions**.
3. Merge to `main` if that has not happened. The **Test and deploy** workflow runs. The green deployment's URL is the site above.

A push to `main` is what publishes a new `config.js`. Pull requests run tests and do not deploy.

## Tests

Node 22. From the repo root:

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:e2e
```

`npm test` checks id assignment, the seed facts, LocalStore, and DriveStore against a fake `fetch` (find-or-create folder and files, re-read, multipart update with `If-Match`, conflict retry, photo upload, and that API error text is kept).

`npm run test:e2e` opens the real page at a Pixel 7 size with `?store=local`, adds an asset, updates a meter, attaches a photo, adds a purchase, reloads, and checks that all of it is still there. It also imports the seed and checks that a missing name and a broken file show the error on screen.

## Layout

| Path | Role |
| --- | --- |
| `site/` | The page that GitHub Pages serves |
| `site/config.js` | The only place the OAuth client id goes |
| `site/js/drive-store.js` | Drive REST v3, scope limited to files the app creates |
| `site/js/local-store.js` | Same operations in `localStorage` |
| `site/seed/seed-data.json` | The three known vehicles |
| `BOT-CONTRACT.md` | Rules for an agent editing the JSON in Drive |

Both stores re-read the file, merge, assign the next id, write, and return an error string the page puts in a banner. Nothing is saved quietly.

## Design notes

A few choices are worth knowing:

- Each JSON file has `next_id`. Deleting the highest row must not hand that id out again, so the counter only moves forward. The app also scans the rows so a stale counter cannot collide.
- Saves send `If-Match` with the ETag from the re-read. A 412 reads again and reapplies the edit, so two saves do not drop a row the other one just added.
- The RockAuto order total of $147.21 is `unit_price` on one line. Qty and shipping are unknown, so they are omitted. The S10 seed still has `2WD` in `notes`. New cars use the `drive` field. Truckasaurus has no model, because that was not in the known facts.
- Which fields appear for a type is `site/js/field-config.js`. Unread photos set `status` to `needs_review`. See BOT-CONTRACT.md for how a later pass fills those and clears the flag.
- `updated_at` is stamped by the app when it writes an asset. It is not in the seed file.
- A new meter, maintenance, or purchase form suggests today's date. It is only stored if you leave it there and tap save.
- There is no delete in v1. Removing a row by hand is allowed only if `next_id` stays where it is.
