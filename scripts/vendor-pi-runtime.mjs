#!/usr/bin/env node

// Prepara il runtime Windows autocontenuto distribuito dall'installer Tauri.
// Le due sorgenti di rete sono bloccate a versione e digest; npm installa dal
// shrinkwrap pubblicato da PI con tutti gli script di lifecycle disattivati.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const RUNTIME_SPEC = Object.freeze({
  schema: 1,
  node: Object.freeze({
    version: "24.18.0",
    platform: "win-x64",
    archive: "node-v24.18.0-win-x64.zip",
    url: "https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip",
    sha256: "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821",
  }),
  pi: Object.freeze({
    name: "@earendil-works/pi-coding-agent",
    version: "0.84.2",
    archive: "pi-coding-agent-0.84.2.tgz",
    url: "https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-0.84.2.tgz",
    integrity: "sha512-l4E+B7hgXKWddRo8bC/eSue2aWZjEgJ9xIpf5p0Og+lq8a2TArCwJ0HCoCPCgaBP/tN4zbYH/wOwvx9pJpeLCA==",
  }),
  tools: Object.freeze({
    fd: Object.freeze({
      version: "10.4.2",
      archive: "fd-v10.4.2-x86_64-pc-windows-msvc.zip",
      url: "https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-x86_64-pc-windows-msvc.zip",
      sha256: "b2816e506390a89941c63c9187d58a3cc10e9a55f2ef0685f9ea0eccaf7c98c8",
      binary: "fd.exe",
      license: "MIT OR Apache-2.0",
    }),
    rg: Object.freeze({
      version: "15.2.0",
      archive: "ripgrep-15.2.0-x86_64-pc-windows-msvc.zip",
      url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip",
      sha256: "71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5",
      binary: "rg.exe",
      license: "MIT OR Unlicense",
    }),
  }),
});

// PI 0.84.2 non espone via RPC alcune operazioni che la TUI offre come
// comandi slash. L'adapter locale e applicato soltanto al file e alla build
// identificati qui: digest, sentinelle e hunks devono combaciare tutti.
export const PI_RPC_ADAPTER_PATCH = Object.freeze({
  schema: 1,
  id: "PI_GUI_RPC_ADAPTER_V1",
  target: "dist/modes/rpc/rpc-mode.js",
  patch: "patches/pi-0.84.2-rpc-adapter-v1.patch",
  upstreamSha256: "b8056af06447a3b89b680519bae1ce1d9063a266d827c3ca92f2dcd57c5ffd2b",
  patchedSha256: "fd50d795ef19913814570f2ee8a7cb946b27c303290201cb6d7d127d2086d408",
  marker: "// PI_GUI_RPC_ADAPTER_V1: trusted GUI parity commands for pinned PI 0.84.2.",
  upstreamSentinels: Object.freeze([
    "    const rebindSession = async () => {\n        session = runtimeHost.session;\n        await session.bindExtensions({",
    "            case \"get_available_models\": {\n                const models = session.modelRuntime.getAvailableSnapshot();\n                return success(id, \"get_available_models\", { models });\n            }",
    "            case \"export_html\": {\n                const path = await session.exportToHtml(command.outputPath);\n                return success(id, \"export_html\", { path });\n            }",
    "            case \"get_tree\": {\n                const sessionManager = session.sessionManager;\n                return success(id, \"get_tree\", { tree: sessionManager.getTree(), leafId: sessionManager.getLeafId() });\n            }",
  ]),
  patchedSentinels: Object.freeze([
    "                    scopedModels: session.scopedModels.slice(0, 256).map((scoped) => ({",
    "            case \"set_scoped_models\": {",
    "                session.settingsManager.setEnabledModels(allModelsEnabled",
    "            case \"refresh_models\": {",
    "            case \"get_rpc_settings\": {",
    "            case \"set_rpc_setting\": {",
    "            case \"export_jsonl\": {",
    "            case \"import_jsonl\": {",
    "copyFileSync(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL)",
    "            case \"navigate_tree\": {",
    "            case \"abort_branch_summary\": {",
    "            case \"set_label\": {",
    "            case \"reload\": {",
    "            case \"get_auth_providers\": {",
    "            case \"login_provider\": {",
    "            case \"abort_login_provider\": {",
    "            case \"logout_provider\": {",
    "    const createExtensionUIContext = (requestMetadata = {}) => ({",
  ]),
});

// Il tarball PI e verificato sopra, ma il suo shrinkwrap 0.84.2 omette
// l'integrita di sei pacchetti workspace @earendil-works. Questi SRI sono i
// valori pubblicati dal registry npm per le esatte versioni risolte. Prima di
// `npm ci` vengono aggiunti a una copia staging del lock; qualsiasi altra voce
// senza integrity fa fallire la build.
export const PI_INTEGRITA_SUPPLEMENTARE = Object.freeze({
  "node_modules/@earendil-works/pi-agent-core": "sha512-8Pn3wSCxj0cfo5I6jxQYVB/3uuQRmHhAlEclyjqpOuMEdQMIODHizRogv56FLdbU+dTiGnybeHQ2N+sV1/L2YA==",
  "node_modules/@earendil-works/pi-ai": "sha512-6MzsrYIYNVlE7SfpbL2yYb67Qo58p/7Q+xWG1RZvoX1P80aRCHSod2/13aFpxkow1lPO2LEh3c495J0Gwmyjig==",
  "node_modules/@earendil-works/pi-client": "sha512-/RFSPhD/bZbpOp1oJj+UneSUFSgZhWxzcSENUY+8+8xhoBrWXMYI2t77XNx4Yf+c8YK2qTHquForhNcelYpXvg==",
  "node_modules/@earendil-works/pi-protocol": "sha512-jbBh03fkeckWEroHpcZBr4w5/Ibat8WwdXFlXHivYQImrQNFtLpDeL0t1cku4hmK0q3pceIRQHkw4fwbM4YILQ==",
  "node_modules/@earendil-works/pi-telemetry": "sha512-wg5caea7uIv1BHRBm2Y116RvFG4oSAiP5qk9tA2463PDGIr4K8M1Ceyyg5DOpF/shUUl0gk826yQJAeAcHYB9g==",
  "node_modules/@earendil-works/pi-tui": "sha512-ds2TLihOnM5sLJB3VpXV6y0uR5efVuHf4MN7yDpsty6hA2DUO/EDVzjp/0od0G2JslzVLMjT8T8zavtxVb+qbg==",
});

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUI, "..");
const CARTELLA_VENDOR = join(RADICE, "vendor");
const DESTINAZIONE = join(CARTELLA_VENDOR, "pi-runtime");
const MANIFESTO = join(DESTINAZIONE, "manifest.json");
const BLOCCO = join(CARTELLA_VENDOR, ".pi-runtime.lock");
const LICENZA_PI = join(RADICE, "licenses", "PI-MIT.txt");
const LICENZA_SPDX_MIT = join(RADICE, "licenses", "SPDX-MIT.txt");
const LICENZA_SPDX_APACHE = join(RADICE, "licenses", "SPDX-Apache-2.0.txt");

function percorsoGestito(percorso) {
  const assoluto = resolve(percorso);
  const relativo = relative(RADICE, assoluto);
  if (!relativo || relativo.startsWith(`..${sep}`) || relativo === ".." || isAbsolute(relativo)) {
    throw new Error(`Percorso di vendor non confinato al progetto: ${assoluto}`);
  }
  return assoluto;
}

async function esiste(percorso) {
  try {
    await access(percorso);
    return true;
  } catch {
    return false;
  }
}

async function rinominaConRetry(origine, destinazione, tentativi = 8) {
  for (let tentativo = 1; ; tentativo += 1) {
    try {
      await rename(origine, destinazione);
      return;
    } catch (errore) {
      const transitorioWindows = process.platform === "win32"
        && ["EPERM", "EACCES", "EBUSY"].includes(errore?.code);
      if (!transitorioWindows || tentativo >= tentativi) throw errore;
      await new Promise((risolvi) => setTimeout(risolvi, Math.min(250 * tentativo, 1500)));
    }
  }
}

async function digestFile(percorso, algoritmo = "sha256", codifica = "hex") {
  const hash = createHash(algoritmo);
  await pipeline(createReadStream(percorso), hash);
  return hash.digest(codifica);
}

function digestTesto(testo) {
  return createHash("sha256").update(testo, "utf8").digest("hex");
}

function contaOccorrenze(testo, frammento) {
  let totale = 0;
  let indice = 0;
  while ((indice = testo.indexOf(frammento, indice)) !== -1) {
    totale += 1;
    indice += frammento.length;
  }
  return totale;
}

function verificaSentinelle(testo, sentinelle, fase) {
  for (const sentinella of sentinelle) {
    const occorrenze = contaOccorrenze(testo, sentinella);
    if (occorrenze !== 1) {
      throw new Error(
        `Adapter RPC PI: sentinella ${fase} attesa una volta, trovata ${occorrenze}: ${JSON.stringify(sentinella)}`,
      );
    }
  }
}

// Applica il sottoinsieme di unified diff prodotto e conservato nel repository.
// Ogni riga di contesto/rimozione viene confrontata byte-per-byte con il file
// upstream; non e consentito alcun fuzzy matching.
function applicaPatchUnificataEsatta(originale, patch) {
  if (originale.includes("\r")) {
    throw new Error("Adapter RPC PI: il file upstream deve usare esclusivamente LF");
  }
  const patchNormalizzata = patch.replace(/\r\n/g, "\n");
  const sorgenteTerminaConLf = originale.endsWith("\n");
  const righeSorgente = originale.split("\n");
  if (sorgenteTerminaConLf) righeSorgente.pop();
  const righePatch = patchNormalizzata.split("\n");
  if (righePatch.at(-1) === "") righePatch.pop();

  const intestazioneAttesa = [
    "diff --git a/dist/modes/rpc/rpc-mode.js b/dist/modes/rpc/rpc-mode.js",
    "index a739ca7..73e3071 100644",
    "--- a/dist/modes/rpc/rpc-mode.js",
    "+++ b/dist/modes/rpc/rpc-mode.js",
  ];
  if (righePatch.slice(0, 4).join("\n") !== intestazioneAttesa.join("\n")) {
    throw new Error("Adapter RPC PI: intestazione della patch inattesa");
  }

  const risultato = [];
  let cursoreSorgente = 0;
  let indicePatch = 4;
  let terminaConLf = sorgenteTerminaConLf;
  let hunkFinaleVisto = false;
  let numeroHunk = 0;

  while (indicePatch < righePatch.length) {
    const intestazione = righePatch[indicePatch];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(intestazione);
    if (!match) throw new Error(`Adapter RPC PI: hunk non valido: ${intestazione}`);
    numeroHunk += 1;
    indicePatch += 1;
    const inizioVecchio = Number(match[1]) - 1;
    const conteggioVecchio = match[2] === undefined ? 1 : Number(match[2]);
    const conteggioNuovo = match[4] === undefined ? 1 : Number(match[4]);
    if (inizioVecchio < cursoreSorgente || inizioVecchio > righeSorgente.length) {
      throw new Error(`Adapter RPC PI: posizione hunk ${numeroHunk} fuori sequenza`);
    }
    risultato.push(...righeSorgente.slice(cursoreSorgente, inizioVecchio));
    cursoreSorgente = inizioVecchio;

    let vecchieConsumate = 0;
    let nuoveProdotte = 0;
    let prefissoPrecedente;
    let vecchioSenzaLf = false;
    let nuovoSenzaLf = false;
    while (indicePatch < righePatch.length && !righePatch[indicePatch].startsWith("@@ ")) {
      const rigaPatch = righePatch[indicePatch];
      indicePatch += 1;
      if (rigaPatch === "\\ No newline at end of file") {
        if (prefissoPrecedente === "-") vecchioSenzaLf = true;
        else if (prefissoPrecedente === "+") nuovoSenzaLf = true;
        else if (prefissoPrecedente === " ") {
          vecchioSenzaLf = true;
          nuovoSenzaLf = true;
        } else {
          throw new Error(`Adapter RPC PI: marcatore newline senza riga nell'hunk ${numeroHunk}`);
        }
        continue;
      }
      const prefisso = rigaPatch[0];
      const contenuto = rigaPatch.slice(1);
      prefissoPrecedente = prefisso;
      if (prefisso === " " || prefisso === "-") {
        if (righeSorgente[cursoreSorgente] !== contenuto) {
          throw new Error(`Adapter RPC PI: contesto divergente nell'hunk ${numeroHunk}`);
        }
        cursoreSorgente += 1;
        vecchieConsumate += 1;
      }
      if (prefisso === " " || prefisso === "+") {
        risultato.push(contenuto);
        nuoveProdotte += 1;
      }
      if (prefisso !== " " && prefisso !== "-" && prefisso !== "+") {
        throw new Error(`Adapter RPC PI: prefisso non valido nell'hunk ${numeroHunk}`);
      }
    }
    if (vecchieConsumate !== conteggioVecchio || nuoveProdotte !== conteggioNuovo) {
      throw new Error(`Adapter RPC PI: conteggi non validi nell'hunk ${numeroHunk}`);
    }
    if (inizioVecchio + conteggioVecchio === righeSorgente.length) {
      if (vecchioSenzaLf !== !sorgenteTerminaConLf) {
        throw new Error("Adapter RPC PI: stato newline upstream inatteso");
      }
      terminaConLf = !nuovoSenzaLf;
      hunkFinaleVisto = true;
    } else if (vecchioSenzaLf || nuovoSenzaLf) {
      throw new Error(`Adapter RPC PI: marcatore newline in hunk non finale ${numeroHunk}`);
    }
  }
  if (!numeroHunk || !hunkFinaleVisto) {
    throw new Error("Adapter RPC PI: patch priva dell'hunk finale atteso");
  }
  risultato.push(...righeSorgente.slice(cursoreSorgente));
  return risultato.join("\n") + (terminaConLf ? "\n" : "");
}

export async function applicaAdapterRpcPi(radicePi) {
  const destinazione = join(radicePi, ...PI_RPC_ADAPTER_PATCH.target.split("/"));
  const originale = await readFile(destinazione, "utf8");
  const digestOriginale = digestTesto(originale);
  if (digestOriginale === PI_RPC_ADAPTER_PATCH.patchedSha256) {
    verificaSentinelle(originale, [PI_RPC_ADAPTER_PATCH.marker, ...PI_RPC_ADAPTER_PATCH.patchedSentinels], "patched");
    return { modified: false, sha256: digestOriginale };
  }
  if (digestOriginale !== PI_RPC_ADAPTER_PATCH.upstreamSha256) {
    throw new Error(
      `Adapter RPC PI: SHA-256 upstream inatteso (${digestOriginale}); atteso ${PI_RPC_ADAPTER_PATCH.upstreamSha256}`,
    );
  }
  if (contaOccorrenze(originale, PI_RPC_ADAPTER_PATCH.marker) !== 0) {
    throw new Error("Adapter RPC PI: marker presente in un file con digest upstream");
  }
  verificaSentinelle(originale, PI_RPC_ADAPTER_PATCH.upstreamSentinels, "upstream");
  const percorsoPatch = join(QUI, PI_RPC_ADAPTER_PATCH.patch);
  const patch = await readFile(percorsoPatch, "utf8");
  const modificato = applicaPatchUnificataEsatta(originale, patch);
  verificaSentinelle(modificato, [PI_RPC_ADAPTER_PATCH.marker, ...PI_RPC_ADAPTER_PATCH.patchedSentinels], "patched");
  const digestModificato = digestTesto(modificato);
  if (digestModificato !== PI_RPC_ADAPTER_PATCH.patchedSha256) {
    throw new Error(
      `Adapter RPC PI: risultato non riproducibile (${digestModificato}); atteso ${PI_RPC_ADAPTER_PATCH.patchedSha256}`,
    );
  }
  await writeFile(destinazione, modificato, "utf8");
  return { modified: true, sha256: digestModificato };
}

async function scarica(url, destinazione) {
  const risposta = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "pi-gui-runtime-vendor/1" },
  });
  if (!risposta.ok || !risposta.body) {
    throw new Error(`Download fallito (${risposta.status}) da ${url}`);
  }
  await pipeline(Readable.fromWeb(risposta.body), createWriteStream(destinazione, { flags: "wx" }));
}

function esegui(comando, argomenti, opzioni = {}) {
  const esito = spawnSync(comando, argomenti, {
    cwd: opzioni.cwd || RADICE,
    env: opzioni.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    stdio: opzioni.cattura ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (esito.error) throw esito.error;
  if (esito.status !== 0) {
    const dettaglio = [esito.stdout, esito.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `${basename(comando)} e terminato con codice ${esito.status}`
        + (dettaglio ? `: ${dettaglio.slice(0, 4000)}` : ""),
    );
  }
  return String(esito.stdout || "").trim();
}

function strumentiWindows() {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const tar = join(systemRoot, "System32", "tar.exe");
  if (!existsSync(tar)) {
    throw new Error("tar.exe di sistema e necessario per preparare il runtime Windows");
  }
  return { tar };
}

function ambienteNpmPulito(cartellaTemporanea) {
  const env = {};
  for (const nome of [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ]) {
    if (process.env[nome]) env[nome] = process.env[nome];
  }
  const homeIsolata = join(cartellaTemporanea, "npm-home");
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return {
    ...env,
    HOME: homeIsolata,
    USERPROFILE: homeIsolata,
    APPDATA: join(homeIsolata, "AppData", "Roaming"),
    LOCALAPPDATA: join(homeIsolata, "AppData", "Local"),
    TEMP: cartellaTemporanea,
    TMP: cartellaTemporanea,
    PATH: join(systemRoot, "System32"),
    NODE_OPTIONS: "",
    NPM_CONFIG_USERCONFIG: join(cartellaTemporanea, "empty-user-npmrc"),
    NPM_CONFIG_GLOBALCONFIG: join(cartellaTemporanea, "empty-global-npmrc"),
    NPM_CONFIG_CACHE: join(cartellaTemporanea, "npm-cache"),
    NPM_CONFIG_PREFIX: join(cartellaTemporanea, "npm-global"),
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
}

async function completaIntegritaShrinkwrap(percorso) {
  const originale = await readFile(percorso, "utf8");
  const shrinkwrap = JSON.parse(originale);
  const aggiunte = [];
  for (const [nome, pacchetto] of Object.entries(shrinkwrap.packages || {})) {
    if (!nome || pacchetto?.link === true || pacchetto?.integrity) continue;
    const integrita = PI_INTEGRITA_SUPPLEMENTARE[nome];
    if (!integrita || !pacchetto?.resolved) {
      throw new Error(`Shrinkwrap PI privo di integrity non autorizzata: ${nome}`);
    }
    pacchetto.integrity = integrita;
    aggiunte.push(nome);
  }
  const previste = Object.keys(PI_INTEGRITA_SUPPLEMENTARE).sort();
  aggiunte.sort();
  if (JSON.stringify(aggiunte) !== JSON.stringify(previste)) {
    throw new Error(
      `Set di integrity supplementari inatteso: ${aggiunte.join(", ") || "nessuna"}`,
    );
  }
  for (const [nome, pacchetto] of Object.entries(shrinkwrap.packages || {})) {
    if (nome && pacchetto?.link !== true && pacchetto?.resolved && !pacchetto?.integrity) {
      throw new Error(`Shrinkwrap ancora privo di integrity: ${nome}`);
    }
  }
  await writeFile(percorso, `${JSON.stringify(shrinkwrap, null, 2)}\n`, "utf8");
  return createHash("sha256").update(originale).digest("hex");
}

async function preparaPackageJsonRuntime(radicePi) {
  const percorso = join(radicePi, "package.json");
  const originale = await readFile(percorso, "utf8");
  const dati = JSON.parse(originale);
  // Il shrinkwrap pubblicato contiene intenzionalmente la closure production,
  // mentre il package.json del tarball elenca anche i devDependencies del
  // monorepo. npm ci valida tutto prima di applicare --omit=dev: salviamo il
  // metadata originale e rimuoviamo soltanto quel campo dalla copia runtime.
  await writeFile(join(radicePi, "package.upstream.json"), originale, "utf8");
  delete dati.devDependencies;
  await writeFile(percorso, `${JSON.stringify(dati, null, 2)}\n`, "utf8");
  return createHash("sha256").update(originale).digest("hex");
}

async function smokeRuntime(runtime, cartellaTemporanea) {
  const node = join(runtime, "node", "node.exe");
  const cli = join(runtime, "pi", "dist", "cli.js");
  const homeSmoke = join(cartellaTemporanea, "smoke-home");
  const appDataSmoke = join(homeSmoke, "AppData", "Roaming");
  const localAppDataSmoke = join(homeSmoke, "AppData", "Local");
  await mkdir(appDataSmoke, { recursive: true });
  await mkdir(localAppDataSmoke, { recursive: true });
  const env = {
    ...ambienteNpmPulito(cartellaTemporanea),
    HOME: homeSmoke,
    USERPROFILE: homeSmoke,
    APPDATA: appDataSmoke,
    LOCALAPPDATA: localAppDataSmoke,
    PI_OFFLINE: "1",
    PATH: [
      join(runtime, "node"),
      join(runtime, "tools"),
      join(process.env.SystemRoot || "C:\\Windows", "System32"),
    ].join(delimiter),
  };

  const nodeVersione = esegui(node, ["--version"], { cattura: true, env });
  const piVersione = esegui(node, [cli, "--version"], { cattura: true, env });
  if (nodeVersione !== `v${RUNTIME_SPEC.node.version}` || !piVersione.split(/\s+/).includes(RUNTIME_SPEC.pi.version)) {
    throw new Error(`Smoke test versioni fallito: Node ${nodeVersione}, PI ${piVersione}`);
  }

  // Carica il catalogo modelli senza rete e attraversa il parser CLI reale.
  // Non importa se la ricerca non trova righe: l'import e la discovery devono
  // completarsi con exit code zero e senza leggere ~/.pi dell'utente.
  esegui(
    node,
    [cli, "--offline", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates", "--list-models", "lmstudio"],
    { cwd: cartellaTemporanea, cattura: true, env },
  );

  // Verifica esplicitamente i due asset non-JS usati da PI su Windows:
  // WebAssembly di photon e addon nativo console-mode di pi-tui. Il clipboard
  // viene importato senza leggere o cambiare gli appunti.
  const provaModuli = String.raw`
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const root = process.argv[1];
const photon = await import(pathToFileURL(path.join(root, 'node_modules', '@silvia-odwyer', 'photon-node', 'photon_rs.js')).href);
if (typeof photon.PhotonImage !== 'function') throw new Error('Photon WASM non caricato');
const clipboard = await import(pathToFileURL(path.join(root, 'node_modules', '@mariozechner', 'clipboard', 'index.js')).href);
if (!clipboard.default) throw new Error('Clipboard nativo non caricato');
const consoleMode = require(path.join(root, 'node_modules', '@earendil-works', 'pi-tui', 'native', 'win32', 'prebuilds', 'win32-x64', 'win32-console-mode.node'));
if (!consoleMode || typeof consoleMode !== 'object') throw new Error('Console-mode nativo non caricato');
`;
  esegui(
    node,
    ["--input-type=module", "-e", provaModuli, join(runtime, "pi")],
    { cwd: join(runtime, "pi"), cattura: true, env },
  );

  const campione = join(cartellaTemporanea, "smoke-search.txt");
  await writeFile(campione, "PI_GUI_SMOKE_SEARCH\n", "utf8");
  const fd = join(runtime, "tools", "fd.exe");
  const rg = join(runtime, "tools", "rg.exe");
  if (!esegui(fd, ["--version"], { cattura: true, env }).includes(RUNTIME_SPEC.tools.fd.version)) {
    throw new Error("Versione fd inattesa");
  }
  if (!esegui(rg, ["--version"], { cattura: true, env }).includes(RUNTIME_SPEC.tools.rg.version)) {
    throw new Error("Versione ripgrep inattesa");
  }
  if (!esegui(fd, ["smoke-search.txt", cartellaTemporanea], { cattura: true, env }).includes("smoke-search.txt")) {
    throw new Error("Smoke test fd fallito");
  }
  if (!esegui(rg, ["PI_GUI_SMOKE_SEARCH", campione], { cattura: true, env }).includes("PI_GUI_SMOKE_SEARCH")) {
    throw new Error("Smoke test ripgrep fallito");
  }
}

async function trovaFileRicorsivo(radice, predicato) {
  const pila = [radice];
  while (pila.length) {
    const cartella = pila.pop();
    const voci = await readdir(cartella, { withFileTypes: true });
    voci.sort((a, b) => b.name.localeCompare(a.name));
    for (const voce of voci) {
      const percorso = join(cartella, voce.name);
      if (voce.isDirectory()) pila.push(percorso);
      else if (voce.isFile() && predicato(voce.name, percorso)) return percorso;
    }
  }
  return null;
}

async function preparaTool(spec, cartellaTemporanea, runtime, tar) {
  const archivio = join(cartellaTemporanea, spec.archive);
  const estrazione = join(cartellaTemporanea, `extract-${spec.binary.replace(".exe", "")}`);
  await mkdir(estrazione, { recursive: true });
  console.log(`Scarico ${spec.binary} ${spec.version}...`);
  await scarica(spec.url, archivio);
  const digest = await digestFile(archivio);
  if (digest !== spec.sha256) throw new Error(`SHA-256 non valido per ${spec.archive}: ${digest}`);
  esegui(tar, ["-xf", archivio, "-C", estrazione]);
  const binario = await trovaFileRicorsivo(
    estrazione,
    (nome) => nome.toLowerCase() === spec.binary.toLowerCase(),
  );
  if (!binario) throw new Error(`${spec.binary} non trovato nell'archivio verificato`);
  const destinazioneTool = join(runtime, "tools");
  const destinazioneLicenze = join(destinazioneTool, "licenses");
  await mkdir(destinazioneLicenze, { recursive: true });
  await copyFile(binario, join(destinazioneTool, spec.binary));

  const licenze = [];
  const pila = [estrazione];
  while (pila.length) {
    const cartella = pila.pop();
    for (const voce of await readdir(cartella, { withFileTypes: true })) {
      const percorso = join(cartella, voce.name);
      if (voce.isDirectory()) pila.push(percorso);
      else if (voce.isFile() && /^(license|unlicense|copying)(\.|-|$)/i.test(voce.name)) {
        licenze.push(percorso);
      }
    }
  }
  if (!licenze.length) throw new Error(`Nessuna licenza trovata nell'archivio ${spec.archive}`);
  licenze.sort();
  const prefisso = spec.binary.replace(/\.exe$/i, "");
  for (let indice = 0; indice < licenze.length; indice += 1) {
    const nome = basename(licenze[indice]).replace(/[^a-z0-9_.-]/gi, "_");
    await copyFile(licenze[indice], join(destinazioneLicenze, `${prefisso}-${indice + 1}-${nome}`));
  }
}

async function cartellePacchettiPi(radicePi) {
  const trovate = [];
  const visita = async (cartellaPacchetto) => {
    const packageJson = join(cartellaPacchetto, "package.json");
    if (await esiste(packageJson)) trovate.push(cartellaPacchetto);
    const moduli = join(cartellaPacchetto, "node_modules");
    if (!(await esiste(moduli))) return;
    for (const voce of await readdir(moduli, { withFileTypes: true })) {
      if (!voce.isDirectory() || voce.name === ".bin") continue;
      const percorso = join(moduli, voce.name);
      if (voce.name.startsWith("@")) {
        for (const sotto of await readdir(percorso, { withFileTypes: true })) {
          if (sotto.isDirectory()) await visita(join(percorso, sotto.name));
        }
      } else {
        await visita(percorso);
      }
    }
  };
  await visita(radicePi);
  return trovate;
}

function licenzaDichiarata(packageJson) {
  if (typeof packageJson.license === "string" && packageJson.license.trim()) {
    return packageJson.license.trim();
  }
  if (Array.isArray(packageJson.licenses)) {
    return packageJson.licenses.map((voce) => voce?.type).filter(Boolean).join(" OR ") || "NON DICHIARATA";
  }
  return "NON DICHIARATA";
}

function autoreDichiarato(packageJson) {
  if (typeof packageJson.author === "string") return packageJson.author;
  if (packageJson.author?.name) return packageJson.author.name;
  // I pacchetti clipboard pubblicati nello scope personale non riportano il
  // campo author, ma indicano il repository ufficiale badlogic/clipboard.
  if (
    String(packageJson.name || "").startsWith("@mariozechner/clipboard")
    && /github\.com\/badlogic\/clipboard/i.test(repositoryDichiarato(packageJson))
  ) {
    return "Mario Zechner";
  }
  return "non indicato nel package.json";
}

function repositoryDichiarato(packageJson) {
  if (typeof packageJson.repository === "string") return packageJson.repository;
  if (packageJson.repository?.url) return packageJson.repository.url;
  return "non indicato nel package.json";
}

async function fileLicenzaPacchetto(cartella) {
  const candidati = (await readdir(cartella, { withFileTypes: true }))
    .filter((voce) => voce.isFile() && /^(licen[sc]e|copying|notice)(\.|$)/i.test(voce.name))
    .map((voce) => voce.name)
    .sort((a, b) => a.localeCompare(b));
  const testi = [];
  for (const nome of candidati) {
    const percorso = join(cartella, nome);
    const info = await stat(percorso);
    if (info.size > 2 * 1024 * 1024) {
      throw new Error(`File di licenza insolitamente grande: ${percorso}`);
    }
    testi.push({ nome, testo: await readFile(percorso, "utf8") });
  }
  return testi;
}

async function generaNotice(radicePi, destinazione) {
  const licenzaPi = await readFile(LICENZA_PI, "utf8");
  const licenzaMit = await readFile(LICENZA_SPDX_MIT, "utf8");
  const licenzaApache = await readFile(LICENZA_SPDX_APACHE, "utf8");
  const pacchetti = [];
  for (const cartella of await cartellePacchettiPi(radicePi)) {
    const dati = JSON.parse(await readFile(join(cartella, "package.json"), "utf8"));
    pacchetti.push({
      nome: dati.name || basename(cartella),
      versione: dati.version || "sconosciuta",
      licenza: licenzaDichiarata(dati),
      autore: autoreDichiarato(dati),
      repository: repositoryDichiarato(dati),
      testi: await fileLicenzaPacchetto(cartella),
    });
  }
  pacchetti.sort((a, b) => `${a.nome}@${a.versione}`.localeCompare(`${b.nome}@${b.versione}`));

  const sezioni = [
    "THIRD-PARTY NOTICES - Interfaccia pi",
    "====================================",
    "",
    "Generato dal runtime PI bloccato dal relativo npm-shrinkwrap.",
    `Patch locale ${PI_RPC_ADAPTER_PATCH.id}: ${PI_RPC_ADAPTER_PATCH.target}.`,
    `SHA-256 upstream: ${PI_RPC_ADAPTER_PATCH.upstreamSha256}.`,
    `SHA-256 dopo la patch: ${PI_RPC_ADAPTER_PATCH.patchedSha256}.`,
    "La patch amplia soltanto il protocollo RPC; versione e licenza del package PI restano invariate.",
    "Node.js conserva separatamente la propria licenza e i propri avvisi in node/LICENSE.",
    "",
  ];
  for (const pacchetto of pacchetti) {
    let testi = pacchetto.testi;
    let provenienza = "file pubblicato nel tarball npm";
    if (!testi.length && pacchetto.nome.startsWith("@earendil-works/pi-")) {
      testi = [{ nome: "PI-MIT.txt", testo: licenzaPi }];
      provenienza = "licenza MIT del repository PI (il tarball npm non includeva LICENSE)";
    } else if (!testi.length && pacchetto.licenza === "MIT") {
      testi = [{
        nome: "SPDX-MIT.txt",
        testo: licenzaMit,
      }];
      provenienza = "template canonico SPDX MIT; il tarball non pubblica un avviso copyright e non ne viene attribuito uno per inferenza";
    } else if (!testi.length && pacchetto.licenza === "Apache-2.0") {
      testi = [{ nome: "SPDX-Apache-2.0.txt", testo: licenzaApache }];
      provenienza = "testo canonico SPDX Apache-2.0; il tarball non pubblica un file LICENSE o NOTICE";
    }
    if (!testi?.length) {
      throw new Error(
        `Licenza senza testo verificabile per ${pacchetto.nome}@${pacchetto.versione} (${pacchetto.licenza})`,
      );
    }
    sezioni.push(
      "-".repeat(78),
      `${pacchetto.nome}@${pacchetto.versione}`,
      `Licenza dichiarata: ${pacchetto.licenza}`,
      `Autore: ${pacchetto.autore}`,
      `Repository: ${pacchetto.repository}`,
      `Provenienza testo: ${provenienza}`,
      "",
    );
    for (const file of testi) {
      sezioni.push(`[${file.nome}]`, file.testo.trim(), "");
    }
  }
  await writeFile(destinazione, `${sezioni.join("\n").trim()}\n`, "utf8");
  return pacchetti.length;
}

async function inventarioFile(radice, { escludiManifesto = false } = {}) {
  const risultati = [];
  const visita = async (cartella) => {
    const voci = await readdir(cartella, { withFileTypes: true });
    voci.sort((a, b) => a.name.localeCompare(b.name));
    for (const voce of voci) {
      const assoluto = join(cartella, voce.name);
      const relativo = relative(radice, assoluto).split(sep).join("/");
      if (escludiManifesto && relativo === "manifest.json") continue;
      if (voce.isSymbolicLink()) throw new Error(`Link simbolico non ammesso nel runtime: ${relativo}`);
      if (voce.isDirectory()) {
        await visita(assoluto);
      } else if (voce.isFile()) {
        const info = await stat(assoluto);
        risultati.push({ path: relativo, size: info.size, sha256: await digestFile(assoluto) });
      } else {
        throw new Error(`Voce speciale non ammessa nel runtime: ${relativo}`);
      }
    }
  };
  await visita(radice);
  return risultati;
}

async function controllaAssenzaDatiUtente(radice) {
  const fileSensibile = (nome) => /^(?:\.npmrc|\.env(?:\..+)?|auth\.json|settings\.json|trust\.json|credentials\.json|models(?:[._-][^.]+)*\.json)$/i.test(nome);
  const cartelleSensibili = new Set([".pi", ".agents"]);
  const percorsiUtente = [...new Set([
    homedir(),
    process.env.USERPROFILE,
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
  ].filter((voce) => typeof voce === "string" && voce.length >= 4))];
  const segreti = Object.entries(process.env)
    .filter(([nome, valore]) => (
      /(?:^|_)(?:TOKEN|PASSWORD|SECRET|AUTH|CREDENTIALS?|API_KEY)(?:_|$)/i.test(nome)
      && typeof valore === "string"
      && valore.length >= 12
    ));
  const visita = async (cartella) => {
    for (const voce of await readdir(cartella, { withFileTypes: true })) {
      const percorso = join(cartella, voce.name);
      const relativo = relative(radice, percorso);
      const relativoPosix = relativo.split(sep).join("/").toLowerCase();
      const configurazioneNpmUfficiale = relativoPosix === "node/node_modules/npm/.npmrc";
      if (fileSensibile(voce.name) && !configurazioneNpmUfficiale) {
        throw new Error(`Configurazione o credenziale non ammessa nel bundle: ${relative(radice, join(cartella, voce.name))}`);
      }
      if (voce.isDirectory()) {
        if (cartelleSensibili.has(voce.name.toLowerCase())) {
          throw new Error(`Cartella utente non ammessa nel bundle: ${relativo}`);
        }
        await visita(percorso);
      } else if (voce.isFile()) {
        const info = await stat(percorso);
        // I segreti restano cercati byte-per-byte in ogni file. I percorsi del
        // profilo vengono invece cercati nei file non nativi: PE e moduli .node
        // ufficiali possono contenere il percorso di compilazione del runner.
        // Quei binari provengono da pacchetti con integrity bloccata e vengono
        // inoltre coperti dal digest individuale nel manifesto del runtime.
        if (info.size > 32 * 1024 * 1024) continue;
        const contenuto = await readFile(percorso);
        const binarioNativoVerificato = /\.(?:dll|exe|lib|node|pdb)$/i.test(voce.name);
        if (!binarioNativoVerificato) {
          const testoMinuscolo = contenuto.toString("utf8").toLowerCase();
          for (const percorsoUtente of percorsiUtente) {
            const normale = percorsoUtente.replaceAll("/", "\\").toLowerCase();
            const alternativo = percorsoUtente.replaceAll("\\", "/").toLowerCase();
            if (testoMinuscolo.includes(normale) || testoMinuscolo.includes(alternativo)) {
              throw new Error(`Percorso del profilo utente rilevato nel bundle: ${relativo}`);
            }
          }
        }
        for (const [nome, valore] of segreti) {
          if (contenuto.includes(Buffer.from(valore))) {
            throw new Error(`Valore dell'ambiente sensibile ${nome} rilevato nel bundle: ${relativo}`);
          }
        }
      }
    }
  };
  await visita(radice);
}

async function verificaRuntime({ eseguiVersioni = true, silenzioso = false } = {}) {
  if (!(await esiste(MANIFESTO))) throw new Error("Runtime PI non preparato: manca vendor/pi-runtime/manifest.json");
  const manifesto = JSON.parse(await readFile(MANIFESTO, "utf8"));
  if (
    manifesto.schema !== RUNTIME_SPEC.schema
    || manifesto.node?.version !== RUNTIME_SPEC.node.version
    || manifesto.node?.sha256 !== RUNTIME_SPEC.node.sha256
    || manifesto.pi?.version !== RUNTIME_SPEC.pi.version
    || manifesto.pi?.integrity !== RUNTIME_SPEC.pi.integrity
    || manifesto.pi?.rpcAdapter?.id !== PI_RPC_ADAPTER_PATCH.id
    || manifesto.pi?.rpcAdapter?.target !== PI_RPC_ADAPTER_PATCH.target
    || manifesto.pi?.rpcAdapter?.upstreamSha256 !== PI_RPC_ADAPTER_PATCH.upstreamSha256
    || manifesto.pi?.rpcAdapter?.patchedSha256 !== PI_RPC_ADAPTER_PATCH.patchedSha256
    || manifesto.tools?.fd?.sha256 !== RUNTIME_SPEC.tools.fd.sha256
    || manifesto.tools?.rg?.sha256 !== RUNTIME_SPEC.tools.rg.sha256
  ) {
    throw new Error("Il manifesto del runtime non corrisponde alle versioni bloccate nello script");
  }
  if (!Array.isArray(manifesto.files) || !manifesto.files.length) {
    throw new Error("Inventario del runtime mancante o vuoto");
  }

  const attesi = new Set();
  for (const voce of manifesto.files) {
    if (!voce?.path || voce.path.includes("..") || voce.path.startsWith("/")) {
      throw new Error("Percorso non valido nell'inventario del runtime");
    }
    const percorso = join(DESTINAZIONE, ...voce.path.split("/"));
    const info = await stat(percorso);
    if (!info.isFile() || info.size !== voce.size || await digestFile(percorso) !== voce.sha256) {
      throw new Error(`File del runtime modificato o incompleto: ${voce.path}`);
    }
    attesi.add(voce.path);
  }
  const correnti = await inventarioFile(DESTINAZIONE, { escludiManifesto: true });
  const extra = correnti.map((voce) => voce.path).filter((percorso) => !attesi.has(percorso));
  if (extra.length) throw new Error(`File inattesi nel runtime: ${extra.slice(0, 5).join(", ")}`);
  if (correnti.length !== manifesto.files.length) throw new Error("Inventario del runtime non completo");
  await controllaAssenzaDatiUtente(DESTINAZIONE);

  const node = join(DESTINAZIONE, "node", "node.exe");
  const cli = join(DESTINAZIONE, "pi", "dist", "cli.js");
  const fd = join(DESTINAZIONE, "tools", "fd.exe");
  const rg = join(DESTINAZIONE, "tools", "rg.exe");
  const packagePi = JSON.parse(await readFile(join(DESTINAZIONE, "pi", "package.json"), "utf8"));
  if (packagePi.name !== RUNTIME_SPEC.pi.name || packagePi.version !== RUNTIME_SPEC.pi.version) {
    throw new Error("Il package PI incluso non e quello bloccato");
  }
  if (eseguiVersioni) {
    const nodeVersione = esegui(node, ["--version"], { cattura: true });
    const piVersione = esegui(node, [cli, "--version"], { cattura: true });
    if (nodeVersione !== `v${RUNTIME_SPEC.node.version}`) throw new Error(`Versione Node inattesa: ${nodeVersione}`);
    if (!piVersione.split(/\s+/).includes(RUNTIME_SPEC.pi.version)) {
      throw new Error(`Versione PI inattesa: ${piVersione}`);
    }
    if (!esegui(fd, ["--version"], { cattura: true }).includes(RUNTIME_SPEC.tools.fd.version)) {
      throw new Error("Versione fd inattesa");
    }
    if (!esegui(rg, ["--version"], { cattura: true }).includes(RUNTIME_SPEC.tools.rg.version)) {
      throw new Error("Versione ripgrep inattesa");
    }
  }
  if (!silenzioso) {
    const mib = (Number(manifesto.totalBytes || 0) / 1024 / 1024).toFixed(1);
    console.log(`Runtime verificato: Node ${RUNTIME_SPEC.node.version}, PI ${RUNTIME_SPEC.pi.version}, ${mib} MiB.`);
  }
  return manifesto;
}

async function preparaRuntime() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Questo vendor prepara esclusivamente il runtime Windows x64 dichiarato dal bundle Tauri");
  }
  await mkdir(CARTELLA_VENDOR, { recursive: true });
  const lock = await open(BLOCCO, "wx").catch((errore) => {
    if (errore?.code === "EEXIST") throw new Error("Un'altra preparazione del runtime PI e gia in corso");
    throw errore;
  });
  let temporanea;
  try {
    temporanea = await mkdtemp(join(CARTELLA_VENDOR, ".pi-runtime-stage-"));
    percorsoGestito(temporanea);
    const runtime = join(temporanea, "runtime");
    const estrazioneNode = join(temporanea, "node-extract");
    const nodeZip = join(temporanea, RUNTIME_SPEC.node.archive);
    const piTgz = join(temporanea, RUNTIME_SPEC.pi.archive);
    const radicePi = join(runtime, "pi");
    await mkdir(runtime, { recursive: true });
    await mkdir(estrazioneNode, { recursive: true });
    await mkdir(radicePi, { recursive: true });
    await writeFile(join(temporanea, "empty-user-npmrc"), "", "utf8");
    await writeFile(join(temporanea, "empty-global-npmrc"), "", "utf8");

    console.log(`Scarico Node.js ${RUNTIME_SPEC.node.version} ufficiale...`);
    await scarica(RUNTIME_SPEC.node.url, nodeZip);
    const nodeHash = await digestFile(nodeZip);
    if (nodeHash !== RUNTIME_SPEC.node.sha256) {
      throw new Error(`SHA-256 Node non valido: ${nodeHash}`);
    }
    console.log(`Scarico PI ${RUNTIME_SPEC.pi.version} dal registry npm...`);
    await scarica(RUNTIME_SPEC.pi.url, piTgz);
    const piHash = `sha512-${await digestFile(piTgz, "sha512", "base64")}`;
    if (piHash !== RUNTIME_SPEC.pi.integrity) {
      throw new Error(`Integrita npm di PI non valida: ${piHash}`);
    }

    const { tar } = strumentiWindows();
    esegui(tar, ["-xf", nodeZip, "-C", estrazioneNode]);
    const nodeEstratto = join(estrazioneNode, `node-v${RUNTIME_SPEC.node.version}-${RUNTIME_SPEC.node.platform}`);
    if (!(await esiste(join(nodeEstratto, "node.exe")))) throw new Error("Archivio Node privo di node.exe");
    await rename(nodeEstratto, join(runtime, "node"));

    await preparaTool(RUNTIME_SPEC.tools.fd, temporanea, runtime, tar);
    await preparaTool(RUNTIME_SPEC.tools.rg, temporanea, runtime, tar);

    esegui(tar, ["-xzf", piTgz, "--strip-components", "1", "-C", radicePi]);
    const shrinkwrap = join(radicePi, "npm-shrinkwrap.json");
    if (!(await esiste(shrinkwrap))) throw new Error("Il tarball PI non contiene npm-shrinkwrap.json");
    const upstreamPackageJsonSha256 = await preparaPackageJsonRuntime(radicePi);
    const upstreamShrinkwrapSha256 = await completaIntegritaShrinkwrap(shrinkwrap);
    await copyFile(LICENZA_PI, join(radicePi, "LICENSE"));

    const node = join(runtime, "node", "node.exe");
    const npmCli = join(runtime, "node", "node_modules", "npm", "bin", "npm-cli.js");
    console.log("Installo le dipendenze bloccate di PI (lifecycle scripts disattivati)...");
    esegui(
      node,
      [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: radicePi, env: ambienteNpmPulito(temporanea) },
    );

    // Deve restare dopo npm ci (che materializza la closure upstream) e prima
    // di qualsiasi smoke/manifest, cosi viene verificato il runtime effettivo.
    await applicaAdapterRpcPi(radicePi);

    await smokeRuntime(runtime, temporanea);

    await controllaAssenzaDatiUtente(runtime);
    const packageCount = await generaNotice(radicePi, join(runtime, "THIRD-PARTY-NOTICES.txt"));
    const files = await inventarioFile(runtime);
    const totalBytes = files.reduce((totale, voce) => totale + voce.size, 0);
    const manifesto = {
      schema: RUNTIME_SPEC.schema,
      node: {
        version: RUNTIME_SPEC.node.version,
        platform: RUNTIME_SPEC.node.platform,
        url: RUNTIME_SPEC.node.url,
        sha256: RUNTIME_SPEC.node.sha256,
        license: "node/LICENSE",
      },
      pi: {
        name: RUNTIME_SPEC.pi.name,
        version: RUNTIME_SPEC.pi.version,
        url: RUNTIME_SPEC.pi.url,
        integrity: RUNTIME_SPEC.pi.integrity,
        upstreamPackageJsonSha256,
        effectivePackageJsonSha256: await digestFile(join(radicePi, "package.json")),
        upstreamShrinkwrapSha256,
        effectiveShrinkwrapSha256: await digestFile(shrinkwrap),
        supplementalIntegrities: PI_INTEGRITA_SUPPLEMENTARE,
        rpcAdapter: {
          id: PI_RPC_ADAPTER_PATCH.id,
          target: PI_RPC_ADAPTER_PATCH.target,
          upstreamSha256: PI_RPC_ADAPTER_PATCH.upstreamSha256,
          patchedSha256: PI_RPC_ADAPTER_PATCH.patchedSha256,
        },
        cli: "pi/dist/cli.js",
        license: "pi/LICENSE",
      },
      tools: {
        fd: {
          version: RUNTIME_SPEC.tools.fd.version,
          url: RUNTIME_SPEC.tools.fd.url,
          sha256: RUNTIME_SPEC.tools.fd.sha256,
          binary: "tools/fd.exe",
          license: RUNTIME_SPEC.tools.fd.license,
        },
        rg: {
          version: RUNTIME_SPEC.tools.rg.version,
          url: RUNTIME_SPEC.tools.rg.url,
          sha256: RUNTIME_SPEC.tools.rg.sha256,
          binary: "tools/rg.exe",
          license: RUNTIME_SPEC.tools.rg.license,
        },
      },
      packageCount,
      totalBytes,
      files,
    };
    await writeFile(join(runtime, "manifest.json"), `${JSON.stringify(manifesto, null, 2)}\n`, "utf8");

    // Sostituzione atomica: un runtime precedente resta disponibile finche il
    // nuovo albero non ha superato download, hash, npm ci, licenze e smoke test.
    const backup = join(CARTELLA_VENDOR, `.pi-runtime-backup-${process.pid}`);
    percorsoGestito(backup);
    let avevaDestinazione = false;
    if (await esiste(DESTINAZIONE)) {
      await rinominaConRetry(DESTINAZIONE, backup);
      avevaDestinazione = true;
    }
    try {
      await rinominaConRetry(runtime, DESTINAZIONE);
    } catch (errore) {
      if (avevaDestinazione && !(await esiste(DESTINAZIONE))) {
        await rinominaConRetry(backup, DESTINAZIONE);
      }
      throw errore;
    }
    if (avevaDestinazione) await rm(backup, { recursive: true, force: true });
    await verificaRuntime();
  } finally {
    await lock.close().catch(() => {});
    await unlink(BLOCCO).catch(() => {});
    if (temporanea) await rm(percorsoGestito(temporanea), { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const argomenti = new Set(process.argv.slice(2));
  for (const argomento of argomenti) {
    if (argomento !== "--check" && argomento !== "--force") {
      throw new Error(`Argomento sconosciuto: ${argomento}`);
    }
  }
  if (argomenti.has("--check")) {
    await verificaRuntime();
    return;
  }
  if (!argomenti.has("--force")) {
    try {
      await verificaRuntime({ silenzioso: true });
      console.log(`Runtime PI ${RUNTIME_SPEC.pi.version} gia presente e verificato.`);
      return;
    } catch {
      // Manca o non e integro: viene rigenerato in staging senza riutilizzarlo.
    }
  }
  await preparaRuntime();
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (eseguitoDirettamente) {
  main().catch((errore) => {
    console.error(`Vendor runtime fallito: ${errore?.message || errore}`);
    process.exitCode = 1;
  });
}
