import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const updater = require(join(RADICE, "app", "public", "updater-core.js"));

test("la build pilota espone uno stato disattivato e non propone mutazioni", () => {
  const vista = updater.presenta({
    enabled: false,
    phase: "disabled",
    currentVersion: "2.6.0",
  });
  assert.match(vista.status, /build pilota/u);
  assert.match(vista.detail, /disattivati/u);
  assert.equal(vista.canCheck, false);
  assert.equal(vista.canDownload, false);
  assert.equal(vista.canInstall, false);
});

test("controllo, download e installazione restano tre azioni esplicite", () => {
  const pronto = updater.presenta({ enabled: true, phase: "ready", currentVersion: "2.6.0" });
  assert.equal(pronto.canCheck, true);
  assert.match(pronto.detail, /soltanto quando lo richiedi/u);

  const disponibile = updater.presenta({
    enabled: true,
    phase: "available",
    currentVersion: "2.6.0",
    availableVersion: "2.7.0",
  });
  assert.equal(disponibile.canDownload, true);
  assert.equal(disponibile.canInstall, false);
  assert.match(disponibile.detail, /non parte automaticamente/u);

  const scaricato = updater.presenta({
    enabled: true,
    phase: "downloaded",
    currentVersion: "2.6.0",
    availableVersion: "2.7.0",
  });
  assert.equal(scaricato.canInstall, true);
  assert.match(scaricato.status, /firma verificata/u);
  assert.match(scaricato.detail, /conversazioni.+terminali.+finestre/u);
});

test("il progresso usa unita leggibili e conserva l'errore nativo", () => {
  assert.equal(updater.byteLeggibili(0), "0 B");
  assert.equal(updater.byteLeggibili(1536), "1.5 KiB");
  const vista = updater.presenta({
    enabled: true,
    phase: "downloading",
    currentVersion: "2.6.0",
    availableVersion: "2.7.0",
    downloadedBytes: 1536,
    totalBytes: 4096,
    error: "errore test",
  });
  assert.match(vista.status, /1\.5 KiB/u);
  assert.match(vista.detail, /4\.0 KiB/u);
  assert.equal(vista.error, "errore test");
});
