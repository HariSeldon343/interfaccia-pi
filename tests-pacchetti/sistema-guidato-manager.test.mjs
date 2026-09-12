import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  creaGestoreSistemaGuidato,
  preparaMigrazioneSistemaGuidato,
  verificaBundleSistemaGuidato,
} from "../app/sistema-guidato-manager.mjs";
import { verificaPacchettoEstensione } from "../app/estensioni-manifest.mjs";

const chiaviProva = generateKeyPairSync("ed25519");
const portachiavi = [{ chiaveId: "prova-sg", pubblica: chiaviProva.publicKey, stato: "attiva", dal: "2026-01-01", primaParte: true }];

const SERVER_FALSO = String.raw`
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
const token = process.env.SG_API_TOKEN || "";
const bootstrapCodes = new Set();
const sessions = new Set();
const tickets = new Map();
const server = createServer(async (request, response) => {
  if (request.url === "/__sg/bootstrap/exchange") {
    const host = request.headers.host;
    const origin = request.headers.origin;
    const code = String(request.headers["x-sg-bootstrap"] || "");
    if (origin !== "http://" + host || !bootstrapCodes.delete(code)) {
      response.writeHead(403).end();
      return;
    }
    const session = randomBytes(32).toString("hex");
    sessions.add("sg_local_session=" + session);
    const attributes = process.env.SG_TEST_COOKIE_MODE === "weak"
      ? "; SameSite=Lax; Max-Age=28800; Path=/"
      : "; HttpOnly; SameSite=Strict; Max-Age=28800; Path=/";
    response.writeHead(204, { "set-cookie": "sg_local_session=" + session + attributes });
    response.end();
    return;
  }
  if (request.headers["x-sg-token"] !== token) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "token assente" }));
    return;
  }
  if (request.url === "/api/bootstrap") {
    const code = randomBytes(32).toString("hex");
    bootstrapCodes.add(code);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ path: "/__sg/bootstrap", code }));
    return;
  }
  const sessionCookie = String(request.headers.cookie || "");
  if (!sessions.has(sessionCookie)) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "sessione attendibile richiesta" }));
    return;
  }
  if (request.url === "/api/health") {
    const nonce = String(request.headers["x-sg-nonce"] || "");
    response.writeHead(200, {
      "content-type": "application/json",
      "x-sg-nonce": nonce,
      "content-security-policy": "default-src 'self'; frame-ancestors 'none';",
    });
    response.end(JSON.stringify({ service: "sistema-guidato", status: "ok", pi: { available: true } }));
    return;
  }
  if (request.url === "/api/environment") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      tokenAvailable: token.length === 64,
      leakedProviderSecret: Boolean(process.env.OPENAI_API_KEY),
      piNode: process.env.SG_PI_NODE,
      piCli: process.env.SG_PI_CLI,
      templatesDir: process.env.SG_TEMPLATES_DIR,
      dataDir: process.env.SG_DATA_DIR,
      runtimeBundled: process.env.SG_RUNTIME_BUNDLED,
      trustedSession: sessions.has(sessionCookie),
      forwardedOrigin: request.headers.origin || null,
      forwardedGuiToken: request.headers["x-pi-gui-token"] || null,
    }));
    return;
  }
  if (request.url === "/api/expire-session") {
    sessions.delete(sessionCookie);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ expired: true }));
    return;
  }
  if (request.url?.endsWith("/prepare") && (request.url.includes("/role/") || request.url.includes("/audit/findings/"))) {
    const ticketId = request.url.includes("/role/") ? "ticket-role" : "ticket-finding";
    tickets.set(ticketId, sessionCookie);
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({ ticketId }));
    return;
  }
  if (request.url?.endsWith("/commit") && (request.url.includes("/role/") || request.url.includes("/audit/findings/"))) {
    const body = Buffer.concat(await Array.fromAsync(request)).toString("utf8");
    const ticketId = JSON.parse(body || "{}").ticketId;
    if (!ticketId || tickets.get(ticketId) !== sessionCookie) {
      response.writeHead(409, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "binding sessione cambiato: ripetere prepare" }));
      return;
    }
    tickets.delete(ticketId);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ committed: true }));
    return;
  }
  if (request.url === "/api/crash") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ exiting: true }), () => setTimeout(() => process.exit(0), 10));
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'; frame-ancestors 'none';",
    "set-cookie": "capability=non-esporre",
  });
  response.end("<!doctype html><title>Sistema Guidato test</title>");
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.send?.({ type: "sistema-guidato-ready", baseUrl: "http://127.0.0.1:" + address.port, port: address.port, pid: process.pid });
});
const close = () => server.close(() => process.exit(0));
process.once("disconnect", close);
process.once("SIGTERM", close);
`;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function creaBundleFalso(base) {
  const root = join(base, "bundle");
  const file = new Map([
    ["runtime/server/server.mjs", Buffer.from(SERVER_FALSO)],
    ["runtime/dashboard/index.html", Buffer.from("<!doctype html><title>SG</title>")],
    ["runtime/templates/manifest.json", Buffer.from("{\"schemaVersion\":1}\n")],
  ]);
  for (const [relativo, contenuto] of file) {
    const percorso = join(root, ...relativo.split("/"));
    await mkdir(join(percorso, ".."), { recursive: true });
    await writeFile(percorso, contenuto);
  }
  const manifest = {
    schemaVersion: 1,
    component: "sistema-guidato",
    source: { packageVersion: "0.1.0" },
    host: {
      name: "interfaccia-pi",
      minInclusa: "2.9.0",
      maxEsclusa: "3.0.0",
      mountPath: "/sistema",
      sameOriginProxy: true,
      interfacciaPiPanel: true,
      legacySchema1ReadOnly: true,
    },
    runtime: {
      server: "runtime/server/server.mjs",
      dashboard: "runtime/dashboard/index.html",
      templatesMarker: "runtime/templates/manifest.json",
    },
    files: [...file].map(([path, contenuto]) => ({
      path,
      bytes: contenuto.byteLength,
      sha256: sha256(contenuto),
    })),
  };
  await writeFile(join(root, "integration-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const integrazione = await readFile(join(root, "integration-manifest.json"));
  const manifestoEstensione = {
    schemaVersion: 1, id: "sistema-guidato", nome: "Sistema Guidato", versione: "1.0.0",
    editore: "Prova", descrizione: "Pacchetto sintetico", categoria: "backend",
    host: { minInclusa: "2.9.0", maxEsclusa: "3.0.0" }, pi: { skills: [], prompts: [], themes: [], extensions: [] },
    pannelli: [{ id: "sistema-guidato", percorso: "/sistema" }], backend: { ingresso: "runtime/server/server.mjs" },
    files: [...file, ["integration-manifest.json", integrazione]].map(([percorso, contenuto]) => ({ percorso, byte: contenuto.length, sha256: sha256(contenuto) })),
    limiti: {}, chiaveId: "prova-sg",
  };
  const bytes = Buffer.from(JSON.stringify(manifestoEstensione));
  await writeFile(join(root, "manifesto-estensione.json"), bytes);
  await writeFile(join(root, "manifest.sig"), sign(null, bytes, chiaviProva.privateKey).toString("base64"));
  return root;
}

async function attendi(condizione, timeoutMs = 3000) {
  const scadenza = Date.now() + timeoutMs;
  while (Date.now() < scadenza) {
    if (condizione()) return;
    await new Promise((risolvi) => setTimeout(risolvi, 20));
  }
  throw new Error("Condizione di test non raggiunta entro il timeout");
}

test("la migrazione attende l'arresto del backend prima dell'inventario e della copia", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-sg-backup-arresto-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dataRoot = join(base, "dati");
  await mkdir(dataRoot);
  await writeFile(join(dataRoot, "prima.txt"), "prima");
  let fermo = false;
  const risultato = await preparaMigrazioneSistemaGuidato({ dataRoot, confermata: true,
    arrestaBackend: async () => {
      await writeFile(join(dataRoot, "ultima-scrittura.txt"), "ultima scrittura prima dell'arresto");
      fermo = true;
    },
    copiaFile: async (...argomenti) => { assert.equal(fermo, true); await copyFile(...argomenti); },
  });
  assert.equal(await readFile(join(risultato.backup, "ultima-scrittura.txt"), "utf8"), "ultima scrittura prima dell'arresto");
});

test("la migrazione rifiuta l'arresto mancante o fallito senza iniziare il backup", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-sg-backup-in-uso-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dataRoot = join(base, "dati");
  await mkdir(dataRoot);
  await assert.rejects(preparaMigrazioneSistemaGuidato({ dataRoot, confermata: true }), { code: "SG_BACKUP_IN_USE" });
  await assert.rejects(preparaMigrazioneSistemaGuidato({ dataRoot, confermata: true,
    arrestaBackend: async () => { throw Object.assign(new Error("Ancora in uso"), { code: "SG_IN_USE" }); },
  }), { code: "SG_IN_USE" });
  assert.deepEqual(await readdir(base), ["dati"]);
});

test("il backup rileva file nuovi e directory create durante la copia e rimuove la copia incompleta", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-sg-backup-inventario-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dataRoot = join(base, "dati");
  await mkdir(dataRoot);
  await writeFile(join(dataRoot, "originale.txt"), "originale");
  for (const tipo of ["file", "directory"]) {
    const nuovaVoce = join(dataRoot, "nuova-" + tipo);
    await assert.rejects(preparaMigrazioneSistemaGuidato({ dataRoot, confermata: true, arrestaBackend: async () => {},
      copiaFile: async (...argomenti) => {
        await copyFile(...argomenti);
        if (tipo === "file") await writeFile(nuovaVoce, "comparso durante la copia");
        else await mkdir(nuovaVoce);
      },
    }), { code: "SG_BACKUP_CHANGED" });
    assert.deepEqual(await readdir(base), ["dati"]);
    assert.equal(await readFile(join(dataRoot, "originale.txt"), "utf8"), "originale");
    await rm(nuovaVoce, { recursive: true });
  }
});

test("il bundle Sistema Guidato e fail-closed su compatibilita e digest", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-gui-sg-bundle-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bundleRoot = await creaBundleFalso(base);

  const verificato = await verificaBundleSistemaGuidato(bundleRoot);
  assert.equal(verificato.manifest.host.minInclusa, "2.9.0");
  assert.equal(verificato.manifest.host.maxEsclusa, "3.0.0");
  assert.equal(relative(bundleRoot, verificato.serverPath), join("runtime", "server", "server.mjs"));

  await writeFile(join(bundleRoot, "runtime", "dashboard", "index.html"), "alterato");
  await assert.rejects(
    verificaBundleSistemaGuidato(bundleRoot),
    (errore) => errore?.code === "SG_BUNDLE_TAMPERED",
  );
});

test("il backend firmato viene riverificato prima dell'avvio e nomina il file alterato", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-sg-riverifica-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bundleRoot = await creaBundleFalso(base);
  let avvii = 0;
  const gestore = creaGestoreSistemaGuidato({ guiDirectory: base, bundleRoot, portachiavi, dataRoot: join(base, "dati"),
    avviaProcesso: () => { avvii += 1; } });
  await writeFile(join(bundleRoot, "runtime/dashboard/index.html"), "alterato");
  await assert.rejects(gestore.assicuratiAvviato(), /runtime[\\/]dashboard[\\/]index\.html/u);
  assert.equal(avvii, 0);
  assert.equal(gestore.diagnostica().stato, "Manomessa");
  await gestore.chiudi();
});

test("un processo ostinato conserva il riferimento e impedisce un secondo backend", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-sg-ostinato-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bundleRoot = await creaBundleFalso(base);
  const piCli = join(base, "pi.mjs");
  await writeFile(piCli, "// Pi sintetico\n");
  const figlio = Object.assign(new EventEmitter(), { pid: 45678, exitCode: null, signalCode: null, connected: true,
    stdout: { resume() {} }, stderr: { resume() {} },
    disconnect() { this.connected = false; }, kill() { return false; },
  });
  let avvii = 0;
  const gestore = creaGestoreSistemaGuidato({ guiDirectory: base, bundleRoot, portachiavi, dataRoot: join(base, "dati"),
    nodePath: process.execPath, piCliPath: piCli, timeoutArrestoMs: 5,
    avviaProcesso: () => {
      avvii += 1;
      setImmediate(() => figlio.emit("message", { type: "sistema-guidato-ready", pid: figlio.pid, port: 12345, baseUrl: "http://127.0.0.1:12345" }));
      return figlio;
    },
    inviaHttp: (opzioni, rispondi) => Object.assign(new EventEmitter(), { end() {
      const bootstrap = opzioni.path === "/api/bootstrap";
      const risposta = Readable.from([Buffer.from(bootstrap ? JSON.stringify({ path: "/__sg/bootstrap", code: "a".repeat(64) }) : "")]);
      risposta.statusCode = bootstrap ? 200 : 204;
      risposta.headers = bootstrap ? {} : { "set-cookie": [`sg_local_session=${"b".repeat(64)}; HttpOnly; SameSite=Strict; Max-Age=28800; Path=/`] };
      setImmediate(() => rispondi(risposta));
    } }),
  });
  t.after(async () => { figlio.exitCode = 0; figlio.emit("exit", 0, null); await gestore.chiudi(); });
  await gestore.assicuratiAvviato();
  await assert.rejects(gestore.arresta(), (errore) => errore.code === "SG_IN_USE");
  assert.equal(gestore.diagnostica().stato, "In uso, non rimovibile adesso");
  assert.equal(gestore.diagnostica().inUso, true);
  assert.throws(() => gestore.selezionaPacchetto(null), (errore) => errore.code === "SG_IN_USE");
  await assert.rejects(gestore.assicuratiAvviato(), (errore) => errore.code === "SG_IN_USE");
  await assert.rejects(gestore.chiudi(), (errore) => errore.code === "SG_IN_USE");
  assert.equal(gestore.diagnostica().inUso, true);
  assert.equal(avvii, 1);
  figlio.exitCode = 0;
  figlio.emit("exit", 0, null);
  await gestore.arresta();
  gestore.selezionaPacchetto(null);
  assert.equal(gestore.diagnostica().inUso, false);
});

test("la riverifica completa immediatamente prima dello spawn blocca una modifica tardiva", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-sg-tardiva-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bundleRoot = await creaBundleFalso(base);
  const piCli = join(base, "pi.mjs");
  await writeFile(piCli, "// Pi sintetico\n");
  let controlli = 0;
  let avvii = 0;
  const gestore = creaGestoreSistemaGuidato({ guiDirectory: base, bundleRoot, portachiavi, dataRoot: join(base, "dati"),
    nodePath: process.execPath, piCliPath: piCli,
    verificaPacchetto: async (radice) => {
      controlli += 1;
      if (controlli === 2) await writeFile(join(radice, "runtime/dashboard/index.html"), "modifica tardiva");
      return verificaPacchettoEstensione(radice, { portachiavi });
    },
    avviaProcesso: () => { avvii += 1; },
  });
  await assert.rejects(gestore.assicuratiAvviato(), /runtime[\\/]dashboard[\\/]index\.html/u);
  assert.equal(controlli, 2);
  assert.equal(avvii, 0);
  assert.equal(gestore.diagnostica().stato, "Manomessa");
  await gestore.chiudi();
});

test("il bundle Sistema Guidato rifiuta sourcemap e sourcesContent anche con digest validi", async (t) => {
  const baseMap = await mkdtemp(join(tmpdir(), "pi-gui-sg-map-"));
  const baseSource = await mkdtemp(join(tmpdir(), "pi-gui-sg-source-"));
  const baseMarker = await mkdtemp(join(tmpdir(), "pi-gui-sg-sources-content-"));
  t.after(() => Promise.all([
    rm(baseMap, { recursive: true, force: true }),
    rm(baseSource, { recursive: true, force: true }),
    rm(baseMarker, { recursive: true, force: true }),
  ]));

  const bundleMap = await creaBundleFalso(baseMap);
  const mapPath = join(bundleMap, "runtime", "dashboard", "assets", "app.js.map");
  const mapBytes = Buffer.from("{}\n");
  await mkdir(join(mapPath, ".."), { recursive: true });
  await writeFile(mapPath, mapBytes);
  const manifestMapPath = join(bundleMap, "integration-manifest.json");
  const manifestMap = JSON.parse(await readFile(manifestMapPath, "utf8"));
  manifestMap.files.push({
    path: "runtime/dashboard/assets/app.js.map",
    bytes: mapBytes.byteLength,
    sha256: sha256(mapBytes),
  });
  await writeFile(manifestMapPath, `${JSON.stringify(manifestMap, null, 2)}\n`);
  await assert.rejects(
    verificaBundleSistemaGuidato(bundleMap),
    (errore) => errore?.code === "SG_BUNDLE_INVALID" && /Sourcemap non ammesso/u.test(errore.message),
  );

  const bundleSource = await creaBundleFalso(baseSource);
  const sourcePath = join(bundleSource, "runtime", "dashboard", "App.tsx");
  const sourceBytes = Buffer.from("export const App = () => null;\n");
  await writeFile(sourcePath, sourceBytes);
  const manifestSourcePath = join(bundleSource, "integration-manifest.json");
  const manifestSource = JSON.parse(await readFile(manifestSourcePath, "utf8"));
  manifestSource.files.push({
    path: "runtime/dashboard/App.tsx",
    bytes: sourceBytes.byteLength,
    sha256: sha256(sourceBytes),
  });
  await writeFile(manifestSourcePath, `${JSON.stringify(manifestSource, null, 2)}\n`);
  await assert.rejects(
    verificaBundleSistemaGuidato(bundleSource),
    (errore) => errore?.code === "SG_BUNDLE_INVALID" && /File sorgente non ammesso/u.test(errore.message),
  );

  const bundleMarker = await creaBundleFalso(baseMarker);
  const dashboardPath = join(bundleMarker, "runtime", "dashboard", "index.html");
  const dashboardBytes = Buffer.from("<script>const leak = 'sourcesContent';</script>");
  await writeFile(dashboardPath, dashboardBytes);
  const manifestMarkerPath = join(bundleMarker, "integration-manifest.json");
  const manifestMarker = JSON.parse(await readFile(manifestMarkerPath, "utf8"));
  const dashboardEntry = manifestMarker.files.find((entry) => entry.path === "runtime/dashboard/index.html");
  dashboardEntry.bytes = dashboardBytes.byteLength;
  dashboardEntry.sha256 = sha256(dashboardBytes);
  await writeFile(manifestMarkerPath, `${JSON.stringify(manifestMarker, null, 2)}\n`);
  await assert.rejects(
    verificaBundleSistemaGuidato(bundleMarker),
    (errore) => errore?.code === "SG_BUNDLE_INVALID" && /sourcesContent non ammesso/u.test(errore.message),
  );
});

test("il bundle Sistema Guidato rifiuta file fisici extra e nomi sensibili non inventariati", async (t) => {
  const baseExtra = await mkdtemp(join(tmpdir(), "pi-gui-sg-extra-file-"));
  const baseSensitive = await mkdtemp(join(tmpdir(), "pi-gui-sg-sensitive-file-"));
  t.after(() => Promise.all([
    rm(baseExtra, { recursive: true, force: true }),
    rm(baseSensitive, { recursive: true, force: true }),
  ]));

  const bundleExtra = await creaBundleFalso(baseExtra);
  await writeFile(join(bundleExtra, "runtime", "unexpected.bin"), "extra");
  await assert.rejects(
    verificaBundleSistemaGuidato(bundleExtra),
    (errore) => errore?.code === "SG_BUNDLE_INVALID" && /Inventario fisico bundle divergente/u.test(errore.message),
  );

  const bundleSensitive = await creaBundleFalso(baseSensitive);
  await writeFile(join(bundleSensitive, ".env.production"), "TOKEN=non-deve-entrare");
  await assert.rejects(
    verificaBundleSistemaGuidato(bundleSensitive),
    (errore) => errore?.code === "SG_BUNDLE_INVALID" && /Nome file non ammesso/u.test(errore.message),
  );
});

test("il bootstrap rifiuta cookie backend privi degli attributi di confinamento", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-gui-sg-cookie-"));
  const bundleRoot = await creaBundleFalso(base);
  const piCli = join(base, "cli-pi-falso.js");
  await writeFile(piCli, "// runtime Pi test\n");
  const gestore = creaGestoreSistemaGuidato({
    portachiavi,
    guiDirectory: base,
    bundleRoot,
    dataRoot: join(base, "dati"),
    nodePath: process.execPath,
    piCliPath: piCli,
    timeoutAvvioMs: 5000,
    timeoutArrestoMs: 1000,
    avviaProcesso(command, args, options) {
      return spawn(command, args, {
        ...options,
        env: { ...options.env, SG_TEST_COOKIE_MODE: "weak" },
      });
    },
  });
  t.after(async () => {
    await gestore.chiudi();
    await rm(base, { recursive: true, force: true });
  });

  await assert.rejects(
    gestore.assicuratiAvviato(),
    (errore) => errore?.code === "SG_SESSION_FAILED" && /non verificabile/u.test(errore.message),
  );
  const diagnostica = gestore.diagnostica();
  assert.equal(diagnostica.stato, "error");
  assert.doesNotMatch(JSON.stringify(diagnostica), /sg_local_session|[a-f0-9]{64}/iu);
});

test("singleton lazy, proxy header-only, crash recovery e shutdown restano confinati", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-gui-sg-manager-"));
  const bundleRoot = await creaBundleFalso(base);
  const piCli = join(base, "cli-pi-falso.js");
  await writeFile(piCli, "// runtime Pi test\n");
  const precedenteSegreto = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "non-inoltrare";
  const gestore = creaGestoreSistemaGuidato({
    portachiavi,
    guiDirectory: base,
    bundleRoot,
    dataRoot: join(base, "dati"),
    nodePath: process.execPath,
    piCliPath: piCli,
    timeoutAvvioMs: 5000,
    timeoutArrestoMs: 2000,
  });
  const host = createServer((richiesta, risposta) => {
    void gestore.proxy(richiesta, risposta, richiesta.url || "/").catch((errore) => {
      if (!risposta.headersSent) {
        risposta.writeHead(502, { "content-type": "application/json" });
        risposta.end(JSON.stringify({ error: errore.message }));
      }
    });
  });
  await new Promise((risolvi, rifiuta) => {
    host.once("error", rifiuta);
    host.listen(0, "127.0.0.1", risolvi);
  });
  const baseUrl = `http://127.0.0.1:${host.address().port}`;
  t.after(async () => {
    if (precedenteSegreto === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = precedenteSegreto;
    await gestore.chiudi();
    await new Promise((risolvi) => host.close(risolvi));
    await rm(base, { recursive: true, force: true });
  });

  assert.equal(gestore.diagnostica().stato, "idle");
  const nonce = "nonce-health-abcdefghijklmnop";
  const [prima, seconda] = await Promise.all([
    fetch(baseUrl + "/api/health", { headers: { "X-SG-Nonce": nonce } }),
    fetch(baseUrl + "/api/health", { headers: { "X-SG-Nonce": nonce } }),
  ]);
  assert.equal(prima.status, 200);
  assert.equal(seconda.status, 200);
  assert.equal(prima.headers.get("x-sg-nonce"), nonce);
  assert.equal(prima.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(prima.headers.get("content-security-policy") || "", /frame-ancestors 'self'/u);
  assert.equal(gestore.diagnostica().riavvii, 1);

  const ambiente = await fetch(baseUrl + "/api/environment", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://origine-gui.test",
      cookie: "pi-gui=non-inoltrare",
      "x-pi-gui-token": "non-inoltrare",
    },
    body: "{}",
  }).then((risposta) => risposta.json());
  assert.equal(ambiente.tokenAvailable, true);
  assert.equal(ambiente.leakedProviderSecret, false);
  assert.equal(ambiente.piNode, process.execPath);
  assert.equal(ambiente.piCli, piCli);
  assert.equal(ambiente.templatesDir, join(bundleRoot, "runtime", "templates"));
  assert.equal(ambiente.dataDir, join(base, "dati"));
  assert.equal(ambiente.runtimeBundled, "1");
  assert.equal(ambiente.trustedSession, true);
  assert.equal(ambiente.forwardedOrigin, null);
  assert.equal(ambiente.forwardedGuiToken, null);
  assert.doesNotMatch(JSON.stringify(ambiente), /^[a-f0-9]{64}$/u);

  const pagina = await fetch(baseUrl + "/");
  assert.equal(pagina.headers.get("set-cookie"), null);
  assert.equal(pagina.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(pagina.headers.get("content-security-policy") || "", /frame-ancestors 'self'/u);

  const ruoloPreparato = await fetch(baseUrl + "/api/projects/p/role/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).then((risposta) => risposta.json());
  assert.equal(ruoloPreparato.ticketId, "ticket-role");
  await fetch(baseUrl + "/api/expire-session", { method: "POST", body: "{}" });
  const scaduta = await fetch(baseUrl + "/api/environment", { method: "POST", body: "{}" });
  assert.equal(scaduta.status, 401);
  assert.equal(scaduta.headers.get("set-cookie"), null);
  const commitVecchio = await fetch(baseUrl + "/api/projects/p/role/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticketId: ruoloPreparato.ticketId }),
  });
  assert.equal(commitVecchio.status, 409);
  assert.match(await commitVecchio.text(), /ripetere prepare/u);

  const ruoloNuovo = await fetch(baseUrl + "/api/projects/p/role/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).then((risposta) => risposta.json());
  const ruoloCommit = await fetch(baseUrl + "/api/projects/p/role/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticketId: ruoloNuovo.ticketId }),
  });
  assert.equal(ruoloCommit.status, 200);

  const findingPreparato = await fetch(baseUrl + "/api/projects/p/audit/findings/f/validate/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).then((risposta) => risposta.json());
  const findingCommit = await fetch(baseUrl + "/api/projects/p/audit/findings/f/validate/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticketId: findingPreparato.ticketId }),
  });
  assert.equal(findingCommit.status, 200);
  assert.equal(findingCommit.headers.get("set-cookie"), null);

  await fetch(baseUrl + "/api/crash");
  await attendi(() => gestore.diagnostica().stato === "idle");
  const dopoCrash = await fetch(baseUrl + "/api/health", { headers: { "X-SG-Nonce": nonce } });
  assert.equal(dopoCrash.status, 200);
  assert.equal(gestore.diagnostica().riavvii, 2);

  await gestore.chiudi();
  assert.equal(gestore.diagnostica().stato, "closed");
  await assert.rejects(gestore.assicuratiAvviato(), (errore) => errore?.code === "SG_CLOSED");
});
