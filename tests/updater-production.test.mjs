import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  creaConfigurazioneProduction,
  normalizzaChiavePubblica,
  validaEndpoints,
  verificaConfigurazionePilota,
} from "../scripts/prepare-production-updater.mjs";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHIAVE_ESCLUSIVAMENTE_TEST = [
  "untrusted comment: minisign public key TEST FIXTURE - NON USARE",
  `RW${"A".repeat(40)}`,
].join("\n");

test("la configurazione base resta updater-disabled e non crea artefatti", async () => {
  assert.equal(await verificaConfigurazionePilota(), true);
  const base = JSON.parse(await readFile(join(RADICE, "src-tauri", "tauri.conf.json"), "utf8"));
  assert.equal(base.bundle.createUpdaterArtifacts, false);
  assert.equal(base.plugins?.updater, undefined);
});

test("la configurazione production e generata solo con segreti e HTTPS", () => {
  const configurazione = creaConfigurazioneProduction({
    TAURI_SIGNING_PRIVATE_KEY: "test-fixture-presence-only",
    PI_GUI_UPDATER_PUBLIC_KEY: CHIAVE_ESCLUSIVAMENTE_TEST,
    PI_GUI_UPDATER_ENDPOINTS_JSON: '["https://updates.example.invalid/{{target}}/{{arch}}/{{current_version}}"]',
  });
  assert.equal(configurazione.bundle.createUpdaterArtifacts, true);
  assert.equal(configurazione.plugins.updater.pubkey, CHIAVE_ESCLUSIVAMENTE_TEST);
  assert.deepEqual(configurazione.plugins.updater.endpoints, [
    "https://updates.example.invalid/{{target}}/{{arch}}/{{current_version}}",
  ]);
  assert.equal(configurazione.plugins.updater.windows.installMode, "passive");
  assert.doesNotMatch(JSON.stringify(configurazione), /test-fixture-presence-only/u,
    "la chiave privata non deve entrare nella configurazione generata");
});

test("la produzione fallisce chiusa su segreti mancanti, placeholder e HTTP", () => {
  const base = {
    TAURI_SIGNING_PRIVATE_KEY: "presenza-test",
    PI_GUI_UPDATER_PUBLIC_KEY: CHIAVE_ESCLUSIVAMENTE_TEST,
    PI_GUI_UPDATER_ENDPOINTS_JSON: '["https://updates.example.invalid/latest.json"]',
  };
  assert.throws(
    () => creaConfigurazioneProduction({ ...base, TAURI_SIGNING_PRIVATE_KEY: "" }),
    /TAURI_SIGNING_PRIVATE_KEY/u,
  );
  assert.throws(
    () => normalizzaChiavePubblica("PLACEHOLDER"),
    /placeholder/u,
  );
  assert.throws(
    () => validaEndpoints('["http://updates.example.invalid/latest.json"]'),
    /HTTPS/u,
  );
  assert.throws(
    () => validaEndpoints('["https://utente:password@updates.example.invalid/latest.json"]'),
    /HTTPS/u,
  );
});

test("la capability remota espone solo i quattro wrapper controllati", async () => {
  const capability = JSON.parse(await readFile(
    join(RADICE, "src-tauri", "capabilities", "updater-ui.json"),
    "utf8",
  ));
  assert.equal(capability.local, false);
  assert.deepEqual(capability.remote.urls, [
    "http://localhost:4666",
    "http://127.0.0.1:4666",
  ]);
  assert.deepEqual(capability.permissions, [
    "allow-updater-status",
    "allow-updater-check",
    "allow-updater-download",
    "allow-updater-install",
  ]);
  assert.doesNotMatch(JSON.stringify(capability.permissions), /updater:allow/u,
    "la WebView non deve ricevere i comandi grezzi del plugin");
});

test("il token launcher non viene ereditato da Pi o dai backend figli", async () => {
  const server = await readFile(join(RADICE, "app", "server.mjs"), "utf8");
  const cattura = server.indexOf("const launcherToken = process.env.PI_GUI_LAUNCHER_TOKEN");
  const rimozione = server.indexOf("delete process.env.PI_GUI_LAUNCHER_TOKEN", cattura);
  const avvio = server.indexOf("const ponte = creaPonte", cattura);
  assert.ok(cattura >= 0 && cattura < rimozione && rimozione < avvio,
    "il bridge deve catturare e rimuovere il token prima di creare processi figli");
  assert.doesNotMatch(server.slice(avvio, avvio + 500), /process\.env\.PI_GUI_LAUNCHER_TOKEN/u);
});
