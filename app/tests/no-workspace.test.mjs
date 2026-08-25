import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  argomentiAvvioPi,
  creaPonte,
  percorsoInRadiceSenzaCartella,
  radiceSessioniSenzaCartella,
} from "../server.mjs";
import { validaToolSenzaWorkspace } from "../no-workspace-guard.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const FAKE_PI = join(QUI, "fake-pi-rpc.mjs");
const PUBLIC = join(QUI, "..", "public");

test("il guard richiede percorsi assoluti espliciti per i tool file", () => {
  for (const nome of ["read", "write", "edit", "ls", "find", "grep"]) {
    assert.equal(validaToolSenzaWorkspace(nome, {}).consentito, false, nome);
    assert.equal(validaToolSenzaWorkspace(nome, { path: "relativo.txt" }).consentito, false, nome);
    assert.equal(validaToolSenzaWorkspace(nome, { path: "C:\\dati\\file.txt" }).consentito, true, nome);
  }
  assert.equal(validaToolSenzaWorkspace("bash", { command: "pi --version" }).consentito, true);
});

test("gli argomenti Pi isolano soltanto la modalita senza cartella", () => {
  const estensione = join(QUI, "..", "no-workspace-guard.mjs");
  const estensioneSistema = join(QUI, "..", "extensions", "sistema-guidato", "index.ts");
  const senza = argomentiAvvioPi({
    cliPi: FAKE_PI,
    senzaCartella: true,
    estensioneSenzaCartella: estensione,
    approvaProgetto: true,
  });
  assert.ok(senza.includes("--no-context-files"));
  assert.ok(senza.includes("--append-system-prompt"));
  assert.equal(senza.filter((argomento) => argomento === "--append-system-prompt").length, 1);
  const promptSenza = senza[senza.indexOf("--append-system-prompt") + 1];
  assert.match(promptSenza, /GUI desktop Windows/);
  assert.match(promptSenza, /renderizzate come Markdown/);
  assert.match(promptSenza, /\[etichetta descrittiva\]\(target\)/);
  assert.match(promptSenza, /Non suggerire Ctrl\+clic/);
  assert.match(promptSenza, /Non creare collegamenti sul Desktop/);
  assert.match(promptSenza, /Nessuna cartella di lavoro/);
  assert.deepEqual(senza.slice(senza.indexOf("--extension"), senza.indexOf("--extension") + 2), ["--extension", estensione]);
  assert.ok(senza.includes("--no-approve"));
  assert.equal(senza.includes("--approve"), false);

  const cartella = argomentiAvvioPi({ cliPi: FAKE_PI, approvaProgetto: true });
  assert.equal(cartella.includes("--no-context-files"), false);
  assert.equal(cartella.filter((argomento) => argomento === "--append-system-prompt").length, 1);
  const promptCartella = cartella[cartella.indexOf("--append-system-prompt") + 1];
  assert.match(promptCartella, /GUI desktop Windows/);
  assert.match(promptCartella, /\[etichetta descrittiva\]\(target\)/);
  assert.doesNotMatch(promptCartella, /Nessuna cartella di lavoro/);
  assert.deepEqual(
    cartella.slice(cartella.indexOf("--extension"), cartella.indexOf("--extension") + 2),
    ["--extension", estensioneSistema],
  );
  assert.ok(cartella.includes("--approve"));

  const nuova = argomentiAvvioPi({ cliPi: FAKE_PI, sessionId: "gui-session-1" });
  assert.deepEqual(
    nuova.slice(nuova.indexOf("--session-id"), nuova.indexOf("--session-id") + 2),
    ["--session-id", "gui-session-1"],
  );
  const ripresa = argomentiAvvioPi({
    cliPi: FAKE_PI,
    sessionId: "da-ignorare",
    sessionPath: "C:\\sessioni\\esistente.jsonl",
  });
  assert.equal(ripresa.includes("--session-id"), false);
});

test("la radice tecnica e stabile e non confonde percorsi esterni", () => {
  const radice = radiceSessioniSenzaCartella({
    localAppData: "C:\\Users\\test\\AppData\\Local",
    home: "C:\\Users\\test",
  });
  assert.ok(isAbsolute(radice));
  assert.equal(percorsoInRadiceSenzaCartella(join(radice, "sessione-123"), radice), true);
  assert.equal(percorsoInRadiceSenzaCartella(dirname(radice), radice), false);
});

test("la UI offre una nuova scheda nel contesto corrente o senza cartella", async () => {
  const [html, javascript] = await Promise.all([
    readFile(join(PUBLIC, "index.html"), "utf8"),
    readFile(join(PUBLIC, "app.js"), "utf8"),
  ]);
  assert.match(html, /id="btn-nuova-chat"/);
  assert.match(html, /Nuova scheda/);
  assert.match(javascript, /function avviaNuovaSchedaNelContestoCorrente\(\)/);
  assert.match(javascript, /avviaSessione\(corrente\.cartella, \{ forzaNuova: true \}\)/);
  assert.match(javascript, /avviaSessione\(null, \{ senzaCartella: true, forzaNuova: true \}\)/);
  assert.match(javascript, /sessione\.senzaCartella\s*\?\s*"Senza cartella"/);
  assert.match(javascript, /File solo tramite percorso assoluto/);
  assert.match(javascript, /\["unknown", "—"\]/);
});

test("API: avvio senza cartella nasconde la directory tecnica e non rompe il flusso classico", async (t) => {
  // Su GitHub Actions il workspace temporaneo puo vivere su D:, un volume che
  // la policy fail-closed puo classificare diversamente. LOCALAPPDATA e la
  // radice locale e scrivibile usata davvero dall'app Windows.
  const baseTemporanea = process.platform === "win32"
    ? process.env.LOCALAPPDATA || tmpdir()
    : tmpdir();
  const radiceTest = await mkdtemp(join(baseTemporanea, "pi-gui-no-workspace-"));
  const home = join(radiceTest, "home");
  const radiceNeutra = join(radiceTest, "neutral");
  const cartellaUtente = join(radiceTest, "workspace");
  await Promise.all([mkdir(home, { recursive: true }), mkdir(cartellaUtente, { recursive: true })]);

  const ponte = creaPonte({
    home,
    cliPi: FAKE_PI,
    cartellaPubblica: PUBLIC,
    radiceSenzaCartella: radiceNeutra,
    timeoutStatoIniziale: 3000,
    elencaDiscendenti: async () => [],
    terminaDiscendenti: async () => true,
  });
  await new Promise((resolve, reject) => {
    ponte.server.once("error", reject);
    ponte.server.listen(0, "127.0.0.1", resolve);
  });
  const porta = ponte.server.address().port;
  const url = `http://localhost:${porta}`;
  const post = async (corpo) => {
    const risposta = await fetch(url + "/api/avvia", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-gui-token": ponte.tokenApi,
      },
      body: JSON.stringify(corpo),
    });
    return { status: risposta.status, body: await risposta.json() };
  };

  t.after(async () => {
    await ponte.chiudiTutto({ definitiva: false });
    await new Promise((resolve) => ponte.server.close(resolve));
    await rm(radiceTest, { recursive: true, force: true });
  });

  const vuota = await post({ senzaCartella: true, forzaNuova: true });
  assert.equal(vuota.status, 200, JSON.stringify(vuota.body));
  assert.equal(vuota.body.cartella, null);
  assert.equal(vuota.body.senzaCartella, true);
  const sessioneVuota = ponte.sessioni.get(vuota.body.id);
  assert.equal(sessioneVuota.senzaCartella, true);
  assert.equal(percorsoInRadiceSenzaCartella(sessioneVuota.directoryLavoro, radiceNeutra), true);
  const intestazione = JSON.parse((await readFile(sessioneVuota.fileSessione, "utf8")).split(/\r?\n/)[0]);
  assert.equal(percorsoInRadiceSenzaCartella(intestazione.cwd, radiceNeutra), true);

  const archivio = join(home, ".pi", "agent", "sessions", "senza-cartella");
  await mkdir(archivio, { recursive: true });
  const salvata = join(archivio, "salvata.jsonl");
  await writeFile(salvata, JSON.stringify({
    type: "session",
    version: 3,
    id: "salvata-senza-cartella",
    timestamp: new Date().toISOString(),
    cwd: sessioneVuota.directoryLavoro,
  }) + "\n", "utf8");
  const rispostaSalvate = await fetch(url + "/api/sessioni-salvate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ponte.tokenApi,
    },
    body: "{}",
  });
  const elencoSalvate = await rispostaSalvate.json();
  const riconosciuta = elencoSalvate.sessioni.find((voce) => voce.percorso === salvata);
  assert.equal(riconosciuta.senzaCartella, true);
  assert.equal(riconosciuta.cwd, null);
  const ripresa = await post({
    senzaCartella: true,
    sessionPath: salvata,
    forzaNuova: true,
  });
  assert.equal(ripresa.status, 200, JSON.stringify(ripresa.body));
  assert.equal(ripresa.body.senzaCartella, true);

  const classica = await post({ cartella: cartellaUtente, forzaNuova: true });
  assert.equal(classica.status, 200, JSON.stringify(classica.body));
  assert.equal(classica.body.cartella, cartellaUtente);
  assert.equal(classica.body.senzaCartella, false);
  assert.equal(ponte.sessioni.get(classica.body.id).directoryLavoro, cartellaUtente);
});
