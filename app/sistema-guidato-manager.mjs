// Lifecycle e reverse proxy del pannello Sistema Guidato incorporato.
// Il browser resta sempre sulla stessa origine della GUI: la capability del
// backend vive soltanto in questo processo e viene aggiunta come header interno.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { request as richiestaHttp } from "node:http";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const VERSIONE_HOST = "2.6.0";
const MOUNT_PATH = "/sistema";
const LIMITE_MANIFEST = 2 * 1024 * 1024;
const MAX_FILE_BUNDLE = 20_000;
const MAX_BYTE_BUNDLE = 512 * 1024 * 1024;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const COOKIE_SESSIONE_PATTERN = /^sg_local_session=([a-f0-9]{64})$/u;
const HEADER_RICHIESTA_CONSENTITI = new Set([
  "accept",
  "accept-language",
  "content-length",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "range",
  "x-sg-nonce",
]);
const HEADER_RISPOSTA_CONSENTITI = new Set([
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
  "x-sg-nonce",
]);
const VARIABILI_AMBIENTE_CONSENTITE = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
  "COMSPEC",
  "ComSpec",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
  "windir",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
];

function erroreGestore(messaggio, codice = "SG_MANAGER_ERROR") {
  const errore = new Error(messaggio);
  errore.code = codice;
  return errore;
}

function percorsoConfinato(percorso, radice) {
  const scarto = relative(radice, percorso);
  return scarto === "" || (
    scarto !== ".."
    && !scarto.startsWith(".." + sep)
    && !isAbsolute(scarto)
  );
}

function percorsoManifestValido(valore) {
  return typeof valore === "string"
    && valore.length > 0
    && valore.length <= 500
    && !valore.startsWith("/")
    && !valore.includes("\\")
    && valore.split("/").every((parte) => parte && parte !== "." && parte !== "..");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function radiceDatiSistemaGuidato({
  localAppData = process.env.LOCALAPPDATA,
  home = homedir(),
  platform = process.platform,
} = {}) {
  if (platform === "win32") {
    return resolve(localAppData || join(home, "AppData", "Local"), "it.amodeo.sistema-guidato");
  }
  return resolve(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "it.amodeo.sistema-guidato");
}

export function trovaBundleSistemaGuidato(guiDirectory) {
  const candidati = [
    resolve(guiDirectory, "sistema-guidato"),
    resolve(guiDirectory, "..", "vendor", "sistema-guidato"),
  ];
  return candidati.find((candidato) => existsSync(join(candidato, "integration-manifest.json")))
    || candidati[0];
}

export async function verificaBundleSistemaGuidato(
  bundleRoot,
  { versioneHost = VERSIONE_HOST, mountPath = MOUNT_PATH } = {},
) {
  const radice = resolve(bundleRoot);
  const percorsoManifest = join(radice, "integration-manifest.json");
  const infoManifest = await stat(percorsoManifest).catch(() => null);
  if (!infoManifest?.isFile() || infoManifest.size <= 0 || infoManifest.size > LIMITE_MANIFEST) {
    throw erroreGestore("Manifest d'integrazione Sistema Guidato assente o non valido", "SG_BUNDLE_INVALID");
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(percorsoManifest, "utf8"));
  } catch {
    throw erroreGestore("Manifest d'integrazione Sistema Guidato non leggibile", "SG_BUNDLE_INVALID");
  }
  if (
    !manifest
    || typeof manifest !== "object"
    || Array.isArray(manifest)
    || manifest.schemaVersion !== 1
    || manifest.component !== "sistema-guidato"
    || manifest.host?.name !== "interfaccia-pi"
    || manifest.host?.version !== versioneHost
    || manifest.host?.mountPath !== mountPath
    || manifest.host?.sameOriginProxy !== true
    || manifest.host?.interfacciaPiPanel !== true
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0
    || manifest.files.length > MAX_FILE_BUNDLE
  ) {
    throw erroreGestore("Manifest d'integrazione Sistema Guidato incompatibile", "SG_BUNDLE_INCOMPATIBLE");
  }

  const visti = new Set();
  let byteTotali = 0;
  for (const voce of manifest.files) {
    if (
      !voce
      || typeof voce !== "object"
      || Array.isArray(voce)
      || !percorsoManifestValido(voce.path)
      || !Number.isInteger(voce.bytes)
      || voce.bytes < 0
      || !HASH_PATTERN.test(voce.sha256)
      || visti.has(voce.path)
    ) {
      throw erroreGestore("Inventario bundle Sistema Guidato non valido", "SG_BUNDLE_INVALID");
    }
    visti.add(voce.path);
    byteTotali += voce.bytes;
    if (!Number.isSafeInteger(byteTotali) || byteTotali > MAX_BYTE_BUNDLE) {
      throw erroreGestore("Bundle Sistema Guidato oltre il limite verificabile", "SG_BUNDLE_INVALID");
    }
    const percorso = resolve(radice, ...voce.path.split("/"));
    if (!percorsoConfinato(percorso, radice)) {
      throw erroreGestore("Percorso bundle Sistema Guidato non confinato", "SG_BUNDLE_INVALID");
    }
    const info = await stat(percorso).catch(() => null);
    if (!info?.isFile() || info.size !== voce.bytes) {
      throw erroreGestore(`Asset Sistema Guidato mancante o alterato: ${voce.path}`, "SG_BUNDLE_TAMPERED");
    }
    const digest = sha256(await readFile(percorso));
    if (digest !== voce.sha256) {
      throw erroreGestore(`Digest Sistema Guidato non valido: ${voce.path}`, "SG_BUNDLE_TAMPERED");
    }
  }

  const richiesti = [
    manifest.runtime?.server,
    manifest.runtime?.dashboard,
  ];
  if (
    richiesti.some((percorso) => !percorsoManifestValido(percorso) || !visti.has(percorso))
    || !percorsoManifestValido(manifest.runtime?.templatesMarker)
    || !visti.has(manifest.runtime.templatesMarker)
  ) {
    throw erroreGestore("Entrypoint del bundle Sistema Guidato non inventariati", "SG_BUNDLE_INVALID");
  }
  return Object.freeze({
    root: radice,
    manifest,
    manifestSha256: sha256(await readFile(percorsoManifest)),
    serverPath: resolve(radice, ...manifest.runtime.server.split("/")),
    dashboardPath: dirname(resolve(radice, ...manifest.runtime.dashboard.split("/"))),
    templatesPath: dirname(resolve(radice, ...manifest.runtime.templatesMarker.split("/"))),
  });
}

function ambienteMinimo(origine = process.env) {
  const ambiente = {};
  for (const nome of VARIABILI_AMBIENTE_CONSENTITE) {
    const valore = origine[nome];
    if (typeof valore === "string" && valore) ambiente[nome] = valore;
  }
  return ambiente;
}

function messaggioAvvioValido(messaggio, figlio) {
  return messaggio?.type === "sistema-guidato-ready"
    && Number.isInteger(messaggio.port)
    && messaggio.port > 0
    && messaggio.port <= 65_535
    && messaggio.pid === figlio.pid
    && messaggio.baseUrl === `http://127.0.0.1:${messaggio.port}`;
}

function richiestaInterna(inviaHttp, opzioni, corpo = "") {
  return new Promise((risolvi, rifiuta) => {
    const richiesta = inviaHttp(opzioni, (risposta) => {
      const pezzi = [];
      let byte = 0;
      risposta.on("data", (pezzo) => {
        byte += pezzo.length;
        if (byte > 64 * 1024) {
          risposta.destroy();
          rifiuta(erroreGestore("Risposta bootstrap Sistema Guidato troppo grande", "SG_SESSION_FAILED"));
          return;
        }
        pezzi.push(pezzo);
      });
      risposta.once("error", rifiuta);
      risposta.once("end", () => risolvi({
        statusCode: risposta.statusCode || 0,
        headers: risposta.headers,
        body: Buffer.concat(pezzi).toString("utf8"),
      }));
    });
    richiesta.once("error", rifiuta);
    richiesta.end(corpo);
  });
}

async function creaSessioneBackend(inviaHttp, port, token, ora) {
  const host = `127.0.0.1:${port}`;
  const preparazione = await richiestaInterna(inviaHttp, {
    host: "127.0.0.1",
    port,
    method: "POST",
    path: "/api/bootstrap",
    headers: {
      host,
      "x-sg-token": token,
      "content-length": "0",
      connection: "close",
    },
  });
  let bootstrap;
  try {
    bootstrap = JSON.parse(preparazione.body);
  } catch {
    bootstrap = null;
  }
  if (
    preparazione.statusCode !== 200
    || bootstrap?.path !== "/__sg/bootstrap"
    || !TOKEN_PATTERN.test(bootstrap?.code || "")
  ) {
    throw erroreGestore("Sessione backend Sistema Guidato non preparata", "SG_SESSION_FAILED");
  }
  const scambio = await richiestaInterna(inviaHttp, {
    host: "127.0.0.1",
    port,
    method: "POST",
    path: bootstrap.path + "/exchange",
    headers: {
      host,
      origin: `http://${host}`,
      "x-sg-bootstrap": bootstrap.code,
      "content-length": "0",
      connection: "close",
    },
  });
  const setCookie = scambio.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  if (scambio.statusCode !== 204 || cookies.length !== 1) {
    throw erroreGestore("Sessione backend Sistema Guidato non stabilita", "SG_SESSION_FAILED");
  }
  const parti = String(cookies[0]).split(";").map((parte) => parte.trim());
  const cookie = parti[0] || "";
  const attributi = parti.slice(1);
  const attributiNormalizzati = attributi.map((parte) => parte.toLowerCase());
  const maxAgeVoci = attributi.filter((parte) => /^Max-Age=/iu.test(parte));
  const maxAgeParte = maxAgeVoci[0];
  const maxAge = Number(maxAgeParte?.slice("Max-Age=".length));
  if (!COOKIE_SESSIONE_PATTERN.test(cookie)
    || maxAgeVoci.length !== 1
    || !Number.isInteger(maxAge)
    || maxAge < 60
    || maxAge > 24 * 60 * 60
    || !attributiNormalizzati.includes("httponly")
    || !attributiNormalizzati.includes("samesite=strict")
    || !attributiNormalizzati.includes("path=/")
    || attributiNormalizzati.some((parte) => parte.startsWith("domain="))) {
    throw erroreGestore("Cookie backend Sistema Guidato non verificabile", "SG_SESSION_FAILED");
  }
  return Object.freeze({ cookie, expiresAt: ora() + maxAge * 1000 });
}

function attendiUscita(figlio, timeoutMs) {
  if (figlio.exitCode !== null || figlio.signalCode !== null) return Promise.resolve(true);
  return new Promise((risolvi) => {
    let conclusa = false;
    const completa = (uscito) => {
      if (conclusa) return;
      conclusa = true;
      clearTimeout(timer);
      figlio.off("exit", onExit);
      risolvi(uscito);
    };
    const onExit = () => completa(true);
    const timer = setTimeout(() => completa(false), timeoutMs);
    figlio.once("exit", onExit);
  });
}

function copiaHeaderRichiesta(headers) {
  const copiati = {};
  for (const [nome, valore] of Object.entries(headers)) {
    const normalizzato = nome.toLowerCase();
    if (!HEADER_RICHIESTA_CONSENTITI.has(normalizzato) || valore === undefined) continue;
    if (Array.isArray(valore)) continue;
    copiati[normalizzato] = String(valore);
  }
  return copiati;
}

function headerRispostaSicuri(headers) {
  const sicuri = {};
  for (const [nome, valore] of Object.entries(headers)) {
    const normalizzato = nome.toLowerCase();
    if (!HEADER_RISPOSTA_CONSENTITI.has(normalizzato) || valore === undefined) continue;
    sicuri[normalizzato] = valore;
  }
  const csp = String(headers["content-security-policy"] || "")
    .replace(/frame-ancestors\s+[^;]+;?/iu, "frame-ancestors 'self';");
  sicuri["content-security-policy"] = csp || "default-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'";
  sicuri["x-content-type-options"] = "nosniff";
  sicuri["x-frame-options"] = "SAMEORIGIN";
  sicuri["cross-origin-resource-policy"] = "same-origin";
  sicuri["referrer-policy"] = "no-referrer";
  sicuri["permissions-policy"] = "camera=(), microphone=(), geolocation=()";
  return sicuri;
}

export function creaGestoreSistemaGuidato({
  guiDirectory,
  bundleRoot = trovaBundleSistemaGuidato(guiDirectory),
  dataRoot = radiceDatiSistemaGuidato(),
  nodePath = process.env.PI_GUI_NODE || process.execPath,
  piCliPath,
  versioneHost = VERSIONE_HOST,
  mountPath = MOUNT_PATH,
  avviaProcesso = spawn,
  inviaHttp = richiestaHttp,
  timeoutAvvioMs = 30_000,
  timeoutArrestoMs = 8_000,
  margineRinnovoSessioneMs = 60_000,
  ora = Date.now,
  log = () => {},
} = {}) {
  if (!guiDirectory) throw new Error("guiDirectory obbligatoria per Sistema Guidato");
  let processo = null;
  let endpoint = null;
  let avvioInCorso = null;
  let rinnovoSessioneInCorso = null;
  let chiuso = false;
  let ultimoErrore = null;
  let riavvii = 0;

  async function avvia() {
    const bundle = await verificaBundleSistemaGuidato(bundleRoot, { versioneHost, mountPath });
    const node = resolve(nodePath);
    const cliPi = piCliPath ? resolve(piCliPath) : null;
    const [infoNode, infoPi] = await Promise.all([
      stat(node).catch(() => null),
      cliPi ? stat(cliPi).catch(() => null) : Promise.resolve(null),
    ]);
    if (!infoNode?.isFile()) throw erroreGestore("Runtime Node verificato non disponibile", "SG_RUNTIME_MISSING");
    if (!infoPi?.isFile()) throw erroreGestore("Runtime Pi verificato non disponibile", "SG_RUNTIME_MISSING");
    await mkdir(dataRoot, { recursive: true });
    const token = randomBytes(32).toString("hex");
    if (!TOKEN_PATTERN.test(token)) throw erroreGestore("Capability interna non generata", "SG_TOKEN_ERROR");
    const ambiente = {
      ...ambienteMinimo(),
      SG_HOST: "127.0.0.1",
      SG_PORT: "0",
      SG_API_TOKEN: token,
      SG_PARENT_PID: String(process.pid),
      SG_UI_DIR: bundle.dashboardPath,
      SG_DATA_DIR: resolve(dataRoot),
      SG_TEMPLATES_DIR: bundle.templatesPath,
      SG_PI_NODE: node,
      SG_PI_CLI: cliPi,
      SG_RUNTIME_BUNDLED: "1",
    };
    const figlio = avviaProcesso(node, [bundle.serverPath], {
      cwd: bundle.root,
      env: ambiente,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      shell: false,
    });
    processo = figlio;
    // I flussi vengono drenati per evitare backpressure, ma non memorizzati:
    // un backend non deve poter riversare capability o cookie nella diagnostica host.
    figlio.stdout?.resume();
    figlio.stderr?.resume();
    figlio.once("exit", (codice, segnale) => {
      if (processo === figlio) {
        processo = null;
        endpoint = null;
      }
      log({ evento: "sistema-guidato-exit", codice, segnale });
    });

    try {
      const pronto = await new Promise((risolvi, rifiuta) => {
        let conclusa = false;
        const completa = (errore, valore) => {
          if (conclusa) return;
          conclusa = true;
          clearTimeout(timer);
          figlio.off("message", onMessage);
          figlio.off("error", onError);
          figlio.off("exit", onExit);
          if (errore) rifiuta(errore);
          else risolvi(valore);
        };
        const onMessage = (messaggio) => {
          if (messaggioAvvioValido(messaggio, figlio)) completa(null, messaggio);
        };
        const onError = () => completa(erroreGestore("Backend Sistema Guidato non avviato", "SG_START_FAILED"));
        const onExit = () => completa(erroreGestore(
          "Backend Sistema Guidato terminato durante l'avvio",
          "SG_START_FAILED",
        ));
        const timer = setTimeout(
          () => completa(erroreGestore("Avvio Sistema Guidato scaduto", "SG_START_TIMEOUT")),
          timeoutAvvioMs,
        );
        figlio.on("message", onMessage);
        figlio.once("error", onError);
        figlio.once("exit", onExit);
      });
      if (processo !== figlio || chiuso) throw erroreGestore("Avvio Sistema Guidato annullato", "SG_START_ABORTED");
      const sessioneBackend = await creaSessioneBackend(inviaHttp, pronto.port, token, ora);
      if (processo !== figlio || chiuso) throw erroreGestore("Avvio Sistema Guidato annullato", "SG_START_ABORTED");
      endpoint = Object.freeze({
        port: pronto.port,
        token,
        pid: figlio.pid,
        sessionCookie: sessioneBackend.cookie,
        sessionExpiresAt: sessioneBackend.expiresAt,
      });
      riavvii += 1;
      ultimoErrore = null;
      return endpoint;
    } catch (errore) {
      ultimoErrore = String(errore?.message || errore).slice(0, 1000);
      if (processo === figlio) {
        processo = null;
        endpoint = null;
      }
      try { if (figlio.connected) figlio.disconnect(); } catch {}
      try { figlio.kill(); } catch {}
      await attendiUscita(figlio, Math.min(timeoutArrestoMs, 3000));
      throw errore;
    }
  }

  async function assicuratiAvviato() {
    if (chiuso) throw erroreGestore("Il ponte Sistema Guidato e chiuso", "SG_CLOSED");
    if (processo && endpoint && processo.exitCode === null && processo.signalCode === null) {
      if (endpoint.sessionExpiresAt > ora() + margineRinnovoSessioneMs) return endpoint;
      if (rinnovoSessioneInCorso) return rinnovoSessioneInCorso;
      const corrente = endpoint;
      rinnovoSessioneInCorso = creaSessioneBackend(inviaHttp, corrente.port, corrente.token, ora)
        .then((sessioneBackend) => {
          if (endpoint !== corrente || processo?.pid !== corrente.pid || chiuso) {
            throw erroreGestore("Rinnovo sessione Sistema Guidato annullato", "SG_SESSION_ABORTED");
          }
          endpoint = Object.freeze({
            ...corrente,
            sessionCookie: sessioneBackend.cookie,
            sessionExpiresAt: sessioneBackend.expiresAt,
          });
          return endpoint;
        })
        .catch(async (errore) => {
          ultimoErrore = "Sessione backend Sistema Guidato da ristabilire";
          const figlio = processo;
          processo = null;
          endpoint = null;
          try { if (figlio?.connected) figlio.disconnect(); } catch {}
          try { figlio?.kill(); } catch {}
          if (figlio) await attendiUscita(figlio, Math.min(timeoutArrestoMs, 3000));
          throw errore;
        })
        .finally(() => { rinnovoSessioneInCorso = null; });
      return rinnovoSessioneInCorso;
    }
    if (avvioInCorso) return avvioInCorso;
    avvioInCorso = avvia().finally(() => { avvioInCorso = null; });
    return avvioInCorso;
  }

  async function proxy(richiesta, risposta, percorsoBackend) {
    const interno = await assicuratiAvviato();
    if (typeof percorsoBackend !== "string" || !percorsoBackend.startsWith("/")) {
      throw erroreGestore("Percorso proxy Sistema Guidato non valido", "SG_PROXY_INVALID");
    }
    const headers = {
      ...copiaHeaderRichiesta(richiesta.headers),
      host: `127.0.0.1:${interno.port}`,
      "x-sg-token": interno.token,
      cookie: interno.sessionCookie,
      connection: "close",
    };
    return new Promise((risolvi, rifiuta) => {
      let rispostaIniziata = false;
      const inoltro = inviaHttp({
        host: "127.0.0.1",
        port: interno.port,
        method: richiesta.method,
        path: percorsoBackend,
        headers,
      }, (rispostaBackend) => {
        rispostaIniziata = true;
        if (rispostaBackend.statusCode === 401 && endpoint === interno) {
          endpoint = Object.freeze({ ...interno, sessionExpiresAt: 0 });
        }
        risposta.writeHead(
          rispostaBackend.statusCode || 502,
          rispostaBackend.statusMessage,
          headerRispostaSicuri(rispostaBackend.headers),
        );
        rispostaBackend.on("error", (errore) => {
          risposta.destroy(errore);
          rifiuta(errore);
        });
        rispostaBackend.on("end", risolvi);
        rispostaBackend.pipe(risposta);
      });
      inoltro.once("error", (errore) => {
        if (rispostaIniziata || risposta.headersSent) risposta.destroy(errore);
        rifiuta(errore);
      });
      richiesta.once("aborted", () => inoltro.destroy());
      richiesta.pipe(inoltro);
    });
  }

  async function chiudi() {
    chiuso = true;
    const attesa = avvioInCorso;
    if (attesa) await attesa.catch(() => {});
    const figlio = processo;
    processo = null;
    endpoint = null;
    if (!figlio) return;
    try { if (figlio.connected) figlio.disconnect(); } catch {}
    if (await attendiUscita(figlio, timeoutArrestoMs)) return;
    try { figlio.kill(); } catch {}
    await attendiUscita(figlio, Math.min(timeoutArrestoMs, 3000));
  }

  return Object.freeze({
    assicuratiAvviato,
    proxy,
    chiudi,
    diagnostica: () => ({
      stato: chiuso ? "closed" : endpoint ? "ready" : avvioInCorso ? "starting" : ultimoErrore ? "error" : "idle",
      riavvii,
      ...(ultimoErrore ? { ultimoErrore } : {}),
    }),
  });
}
