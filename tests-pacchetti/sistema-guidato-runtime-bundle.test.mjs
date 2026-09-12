import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  creaGestoreSistemaGuidato,
  preparaMigrazioneSistemaGuidato,
  radiceDatiSistemaGuidato,
  verificaBundleSistemaGuidato,
} from "../app/sistema-guidato-manager.mjs";

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));
const BUNDLE = process.env.SISTEMA_GUIDATO_PACCHETTO_TEST ? resolve(process.env.SISTEMA_GUIDATO_PACCHETTO_TEST) : null;
const RUNTIME = BUNDLE ? join(BUNDLE, "runtime") : null;
const testPacchetto = (nome, funzione) => test(nome, { skip: !BUNDLE && "Pacchetto opzionale assente: indicare SISTEMA_GUIDATO_PACCHETTO_TEST con una cartella firmata 2.9" }, funzione);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function json(relativo) {
  return JSON.parse(await readFile(join(BUNDLE, ...relativo.split("/")), "utf8"));
}

async function manifesti() {
  const [integrazione, compatibilita, release] = await Promise.all([
    json("integration-manifest.json"),
    json("source-compatibility.json"),
    json("source-release-manifest.json"),
  ]);
  return { integrazione, compatibilita, release };
}

async function cammina(radice) {
  const risultati = [];
  for (const voce of await readdir(radice, { withFileTypes: true })) {
    const percorso = join(radice, voce.name);
    if (voce.isDirectory()) risultati.push(...await cammina(percorso));
    else if (voce.isFile()) risultati.push(percorso);
  }
  return risultati;
}

testPacchetto("il pacchetto dichiara intervallo host, mount e proxy della 2.9.0", async () => {
  const { integrazione } = await manifesti();
  assert.equal(integrazione.schemaVersion, 1);
  assert.equal(integrazione.component, "sistema-guidato");
  assert.deepEqual(integrazione.host, {
    name: "interfaccia-pi",
    minInclusa: "2.9.0",
    maxEsclusa: "3.0.0",
    mountPath: "/sistema",
    sameOriginProxy: true,
    interfacciaPiPanel: true,
    legacySchema1ReadOnly: true,
  });
});

testPacchetto("la verifica runtime dell'host accetta il bundle completo e inventariato", async () => {
  const verificato = await verificaBundleSistemaGuidato(BUNDLE);
  assert.equal(verificato.root, BUNDLE);
  assert.match(verificato.manifestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(relative(BUNDLE, verificato.serverPath), join("runtime", "server", "server.mjs"));
  assert.equal(relative(BUNDLE, verificato.dashboardPath), join("runtime", "dashboard"));
  assert.equal(relative(BUNDLE, verificato.templatesPath), join("runtime", "templates"));
});

testPacchetto("il bundle reale completa bootstrap, sessione host-only e health via proxy", async (t) => {
  const dati = await mkdtemp(join(tmpdir(), "pi-gui-sg-real-bundle-"));
  const gestore = creaGestoreSistemaGuidato({
    guiDirectory: RADICE,
    bundleRoot: BUNDLE,
    dataRoot: dati,
    nodePath: join(RADICE, "vendor", "pi-runtime", "node", "node.exe"),
    piCliPath: join(RADICE, "vendor", "pi-runtime", "pi", "dist", "cli.js"),
    timeoutAvvioMs: 15_000,
    timeoutArrestoMs: 3_000,
  });
  const host = createServer((richiesta, risposta) => {
    void gestore.proxy(richiesta, risposta, richiesta.url || "/").catch(() => {
      if (!risposta.headersSent) risposta.writeHead(502).end();
    });
  });
  await new Promise((risolvi, rifiuta) => {
    host.once("error", rifiuta);
    host.listen(0, "127.0.0.1", risolvi);
  });
  t.after(async () => {
    await gestore.chiudi();
    await new Promise((risolvi) => host.close(risolvi));
    await rm(dati, { recursive: true, force: true });
  });

  const nonce = "runtime-bundle-health-nonce-1234";
  const risposta = await fetch(`http://127.0.0.1:${host.address().port}/api/health`, {
    headers: { "x-sg-nonce": nonce },
  });
  assert.equal(risposta.status, 200);
  assert.equal(risposta.headers.get("x-sg-nonce"), nonce);
  assert.equal(risposta.headers.get("set-cookie"), null);
  assert.equal(risposta.headers.get("x-frame-options"), "SAMEORIGIN");
  const salute = await risposta.json();
  assert.equal(salute.service, "sistema-guidato");
  assert.equal(salute.status, "ok");
  assert.equal(gestore.diagnostica().stato, "ready");
  assert.doesNotMatch(JSON.stringify(gestore.diagnostica()), /sg_local_session|[a-f0-9]{64}/iu);
});

testPacchetto("le prove sorgente conservano esattamente gli hash registrati dall'host", async () => {
  const { integrazione } = await manifesti();
  const [release, compatibilita] = await Promise.all([
    readFile(join(BUNDLE, "source-release-manifest.json")),
    readFile(join(BUNDLE, "source-compatibility.json")),
  ]);
  assert.equal(sha256(release), integrazione.source.releaseManifestSha256);
  assert.equal(sha256(compatibilita), integrazione.source.compatibilitySha256);
});

testPacchetto("la baseline Pi e la patch RPC coincidono con il runtime GUI qualificato", async () => {
  const { integrazione, compatibilita } = await manifesti();
  assert.equal(compatibilita.pi.productionBaseline, "0.84.2");
  assert.equal(compatibilita.pi.productionPatchId, "PI_GUI_RPC_ADAPTER_V1");
  assert.equal(integrazione.source.piBaseline, compatibilita.pi.productionBaseline);
  assert.equal(integrazione.source.piPatchId, compatibilita.pi.productionPatchId);
  assert.equal(compatibilita.capabilities.interfacciaPiPanel, true);
  assert.equal(integrazione.source.sourcePanelQualified, true);
});

testPacchetto("schema 1 resta soltanto leggibile e ogni nuova scrittura usa schema 2", async () => {
  const { integrazione, compatibilita } = await manifesti();
  assert.deepEqual(compatibilita.projectSchemaReaders, [1, 2]);
  assert.deepEqual(compatibilita.projectSchemaWriters, [2]);
  assert.deepEqual(integrazione.source.projectSchemaReaders, [1, 2]);
  assert.deepEqual(integrazione.source.projectSchemaWriters, [2]);
  assert.equal(integrazione.host.legacySchema1ReadOnly, true);
});

testPacchetto("l'inventario e ordinato, univoco e privo di percorsi evasivi", async () => {
  const { integrazione } = await manifesti();
  const percorsi = integrazione.files.map((voce) => voce.path);
  assert.deepEqual(percorsi, [...percorsi].sort((a, b) => a.localeCompare(b)));
  assert.equal(new Set(percorsi).size, percorsi.length);
  for (const percorso of percorsi) {
    assert.match(percorso, /^(?:runtime|package\.json|source-(?:compatibility|release-manifest)\.json)/u);
    assert.equal(percorso.includes("\\"), false);
    assert.equal(percorso.split("/").includes(".."), false);
  }
});

testPacchetto("ogni file vendorizzato ha dimensione e SHA-256 corrispondenti", async () => {
  const { integrazione } = await manifesti();
  for (const voce of integrazione.files) {
    const contenuto = await readFile(join(BUNDLE, ...voce.path.split("/")));
    assert.equal(contenuto.byteLength, voce.bytes, voce.path);
    assert.equal(sha256(contenuto), voce.sha256, voce.path);
  }
});

testPacchetto("il bundle non contiene file runtime estranei al manifesto", async () => {
  const { integrazione } = await manifesti();
  const attesi = new Set(integrazione.files.map((voce) => voce.path));
  const presenti = (await cammina(BUNDLE))
    .map((percorso) => relative(BUNDLE, percorso).replaceAll("\\", "/"))
    .filter((percorso) => !["integration-manifest.json", "manifesto-estensione.json", "manifest.sig"].includes(percorso));
  assert.equal(presenti.length, attesi.size);
  assert.deepEqual(new Set(presenti), attesi);
});

testPacchetto("il bundle destinato all'installer non contiene sourcemap o sorgenti incorporati", async () => {
  const textExtensions = new Set([".css", ".htm", ".html", ".js", ".json", ".mjs", ".ts", ".txt"]);
  const sourceExtensions = new Set([".cts", ".jsx", ".mts", ".svelte", ".ts", ".tsx", ".vue"]);
  for (const percorso of await cammina(RUNTIME)) {
    assert.notEqual(extname(percorso).toLowerCase(), ".map", relative(RUNTIME, percorso));
    assert.equal(sourceExtensions.has(extname(percorso).toLowerCase()), false, relative(RUNTIME, percorso));
    if (!textExtensions.has(extname(percorso).toLowerCase())) continue;
    const contenuto = await readFile(percorso, "utf8");
    assert.doesNotMatch(contenuto, /sourcesContent|sourceMappingURL/u, relative(RUNTIME, percorso));
  }
});

testPacchetto("server, dashboard e template sono entrypoint inventariati", async () => {
  const { integrazione } = await manifesti();
  const percorsi = new Set(integrazione.files.map((voce) => voce.path));
  assert.equal(integrazione.runtime.server, "runtime/server/server.mjs");
  assert.equal(integrazione.runtime.dashboard, "runtime/dashboard/index.html");
  assert.equal(integrazione.runtime.templatesMarker, "runtime/templates/manifest.json");
  assert.equal(percorsi.has(integrazione.runtime.server), true);
  assert.equal(percorsi.has(integrazione.runtime.dashboard), true);
  assert.equal(percorsi.has(integrazione.runtime.templatesMarker), true);
});

testPacchetto("la dashboard usa asset relativi ed e quindi montabile sotto /sistema/", async () => {
  const html = await readFile(join(RUNTIME, "dashboard", "index.html"), "utf8");
  assert.match(html, /(?:src|href)="\.\/assets\//u);
  assert.doesNotMatch(html, /(?:src|href)="\/assets\//u);
  assert.doesNotMatch(html, /X-SG-Token|sg_local_session|SG_API_TOKEN/iu);
});

testPacchetto("il JavaScript del pannello non incorpora capability del backend", async () => {
  const assets = (await cammina(join(RUNTIME, "dashboard", "assets")))
    .filter((percorso) => percorso.endsWith(".js"));
  assert.ok(assets.length > 0);
  const javascript = (await Promise.all(assets.map((percorso) => readFile(percorso, "utf8")))).join("\n");
  assert.doesNotMatch(javascript, /X-SG-Token|SG_API_TOKEN|sg_local_session/iu);
  assert.match(javascript, /document\.baseURI/u);
});

testPacchetto("il pack include template neutrali Word ed Excel senza testo ISO", async () => {
  const template = await json("runtime/templates/manifest.json");
  assert.equal(template.schemaVersion, 1);
  assert.equal(template.scheme, "ISO 9001/HLS");
  assert.match(template.notice, /Non contengono il testo della norma ISO/u);
  assert.ok(template.documents.some((documento) => documento.format === "docx"));
  assert.ok(template.documents.some((documento) => documento.format === "xlsx"));
  assert.equal(new Set(template.documents.map((documento) => documento.id)).size, template.documents.length);
});

testPacchetto("ogni template dichiarato esiste ed e compreso nell'inventario host", async () => {
  const [{ integrazione }, template] = await Promise.all([
    manifesti(),
    json("runtime/templates/manifest.json"),
  ]);
  const inventario = new Set(integrazione.files.map((voce) => voce.path));
  for (const documento of template.documents) {
    const relativo = `runtime/templates/${documento.path}`;
    assert.equal(inventario.has(relativo), true, documento.id);
    assert.equal((await stat(join(BUNDLE, ...relativo.split("/")))).isFile(), true);
  }
});

testPacchetto("il server compilato espone sessione attendibile e lifecycle IPC", async () => {
  const server = await readFile(join(RUNTIME, "server", "server.mjs"), "utf8");
  assert.match(server, /SG_API_TOKEN/u);
  assert.match(server, /sg_local_session/u);
  assert.match(server, /\/__sg\/bootstrap/u);
  assert.match(server, /sistema-guidato-ready/u);
  assert.match(server, /SG_PARENT_PID/u);
});

testPacchetto("la migrazione legacy e una superficie esplicita prepare/commit e non un writer automatico", async () => {
  const server = await readFile(join(RUNTIME, "server", "server.mjs"), "utf8");
  assert.match(server, /scanLegacyProjects/u);
  assert.match(server, /\/api\/trusted-ui\/migrations\/:[^"']+\/dry-run/u);
  assert.match(server, /\/api\/trusted-ui\/migrations\/:[^"']+\/execute\/prepare/u);
  assert.match(server, /\/api\/trusted-ui\/migrations\/:[^"']+\/execute\/commit/u);
  assert.match(
    server,
    /\/api\/trusted-ui\/migrations\/:[^"']+\/execute"[\s\S]{0,180}?\.code\(409\)/u,
  );
});

testPacchetto("il release manifest sorgente coincide con l'intero sottoalbero runtime", async () => {
  const { release } = await manifesti();
  assert.equal(release.package, "@sistema-guidato/pi-sistema-guidato");
  assert.equal(release.reproducible, true);
  const attesi = new Set(
    release.files
      .filter((voce) => voce.path.startsWith("runtime/"))
      .map((voce) => voce.path.slice("runtime/".length)),
  );
  const presenti = new Set(
    (await cammina(RUNTIME)).map((percorso) => relative(RUNTIME, percorso).replaceAll("\\", "/")),
  );
  assert.deepEqual(presenti, attesi);
});

testPacchetto("manifesti e configurazione non registrano percorsi macchina o vecchi writer", async () => {
  const [manifest, tauri, serverHost] = await Promise.all([
    readFile(join(BUNDLE, "integration-manifest.json"), "utf8"),
    readFile(join(RADICE, "src-tauri", "tauri.conf.json"), "utf8"),
    readFile(join(RADICE, "app", "server.mjs"), "utf8"),
  ]);
  assert.doesNotMatch(manifest, /[A-Z]:\\|Users[\\/]|AppData[\\/]/iu);
  assert.doesNotMatch(tauri, /app\/extensions\/sistema-guidato/u);
  assert.doesNotMatch(serverHost, /extensions["',\s]+sistema-guidato["',\s]+index\.ts/u);
});

test("senza pacchetto installato il gestore risponde assente e non avvia nessun processo", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-sg-assente-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  let avvii = 0;
  const gestore = creaGestoreSistemaGuidato({ guiDirectory: base, dataRoot: join(base, "dati"), avviaProcesso: () => { avvii += 1; } });
  assert.equal(gestore.diagnostica().stato, "assente");
  assert.equal(await gestore.assicuratiAvviato(), null);
  assert.equal(avvii, 0);
  assert.deepEqual(await readdir(base), []);
  await gestore.chiudi();
});

test("un payload 2.8 rimasto nella cartella dell'app non viene caricato e i dati restano intatti", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-sg-legacy-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const guiDirectory = join(base, "app");
  const payload = join(guiDirectory, "sistema-guidato");
  const dataRoot = radiceDatiSistemaGuidato({ platform: "win32", localAppData: join(base, "local") });
  await mkdir(payload, { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  await writeFile(join(payload, "integration-manifest.json"), '{"host":{"version":"2.8.0"}}');
  await writeFile(join(dataRoot, "documento.txt"), "Dato sintetico già presente\n");
  const prima = await readFile(join(dataRoot, "documento.txt"));
  const vecchioPayload = await readFile(join(payload, "integration-manifest.json"));
  let avvii = 0;
  const gestore = creaGestoreSistemaGuidato({ guiDirectory, dataRoot, avviaProcesso: () => { avvii += 1; } });
  assert.equal(await gestore.assicuratiAvviato(), null);
  assert.equal(avvii, 0);
  const precedente = await gestore.installazionePrecedente();
  assert.equal(precedente.presente, true);
  assert.equal(precedente.titolo, "Il Sistema Guidato ora si installa a parte");
  const primaElenco = await readdir(dirname(dataRoot));
  const annullata = await preparaMigrazioneSistemaGuidato({ guiDirectory, dataRoot, confermata: false });
  assert.equal(annullata.annullata, true);
  assert.deepEqual(await readdir(dirname(dataRoot)), primaElenco);
  assert.deepEqual(await readFile(join(dataRoot, "documento.txt")), prima);
  assert.deepEqual(await readFile(join(payload, "integration-manifest.json")), vecchioPayload);
  const confermata = await preparaMigrazioneSistemaGuidato({ guiDirectory, dataRoot, confermata: true, arrestaBackend: () => gestore.arresta() });
  assert.equal(confermata.annullata, false);
  assert.ok(confermata.backup);
  assert.deepEqual(await readFile(join(confermata.backup, "documento.txt")), prima);
  assert.deepEqual(await readFile(join(dataRoot, "documento.txt")), prima);
  assert.deepEqual(await readFile(join(payload, "integration-manifest.json")), vecchioPayload);
  await gestore.chiudi();
});
