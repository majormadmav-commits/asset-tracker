import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CLIENT_ID = "311505228924-q4dboqg7cf23lunbcuj9po276js1sjju.apps.googleusercontent.com";

test("the only Google scope is drive.file and the Pages client id is published", () => {
  const main = readFileSync(new URL("../site/js/main.js", import.meta.url), "utf8");
  const drive = readFileSync(new URL("../site/js/drive-store.js", import.meta.url), "utf8");
  const config = readFileSync(new URL("../site/config.js", import.meta.url), "utf8");
  assert.match(main, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.doesNotMatch(main, /auth\/drive"/);
  assert.doesNotMatch(main, /auth\/drive\.readonly/);
  assert.doesNotMatch(main, /auth\/drive\.metadata/);
  assert.doesNotMatch(`${main}\n${drive}`, /googleapis\.com\/auth\/drive[^.file]/);
  assert.match(config, new RegExp(`GOOGLE_CLIENT_ID:\\s*"${CLIENT_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(main, /action === "sign-in"[\s\S]{0,500}beginSignIn\(\)[\s\S]{0,300}withBusy\(/);
  assert.doesNotMatch(main, /async beginSignIn/);
  assert.match(main, /error_callback/);
  assert.match(main, /requestToken\("consent"\)/);
  assert.doesNotMatch(main, /ux_mode:\s*"redirect"/);
});
