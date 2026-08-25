import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  creaGestoreSistemaGuidato,
  verificaBundleSistemaGuidato,
} from "../app/sistema-guidato-manager.mjs";

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
      version: "2.6.0",
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

test("il bundle Sistema Guidato e fail-closed su compatibilita e digest", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-gui-sg-bundle-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bundleRoot = await creaBundleFalso(base);

  const verificato = await verificaBundleSistemaGuidato(bundleRoot);
  assert.equal(verificato.manifest.host.version, "2.6.0");
  assert.equal(relative(bundleRoot, verificato.serverPath), join("runtime", "server", "server.mjs"));

  await writeFile(join(bundleRoot, "runtime", "dashboard", "index.html"), "alterato");
  await assert.rejects(
    verificaBundleSistemaGuidato(bundleRoot),
    (errore) => errore?.code === "SG_BUNDLE_TAMPERED",
  );
});

test("il bootstrap rifiuta cookie backend privi degli attributi di confinamento", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-gui-sg-cookie-"));
  const bundleRoot = await creaBundleFalso(base);
  const piCli = join(base, "cli-pi-falso.js");
  await writeFile(piCli, "// runtime Pi test\n");
  const gestore = creaGestoreSistemaGuidato({
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
