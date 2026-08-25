#!/usr/bin/env node

// Copia nella GUI soltanto il runtime di release prodotto dal monorepo
// sistema-guidato. Ogni byte viene prima verificato contro il manifest sorgente
// e poi inventariato nel manifest d'integrazione dell'host.

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { verificaBundleSistemaGuidato } from "../app/sistema-guidato-manager.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUI, "..");
const DESTINAZIONE = resolve(RADICE, "vendor", "sistema-guidato");
const VERSIONE_HOST = "2.6.0";
const PI_BASELINE = "0.84.2";
const PI_PATCH = "PI_GUI_RPC_ADAPTER_V1";

function argomento(nome) {
  const prefisso = `--${nome}=`;
  return process.argv.find((voce) => voce.startsWith(prefisso))?.slice(prefisso.length);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function dentroRadice(percorso, radice) {
  const scarto = relative(radice, percorso);
  return scarto === "" || (scarto !== ".." && !scarto.startsWith(".." + sep) && !isAbsolute(scarto));
}

async function cammina(directory) {
  const risultato = [];
  for (const voce of await readdir(directory, { withFileTypes: true })) {
    const percorso = join(directory, voce.name);
    if (voce.isDirectory()) risultato.push(...await cammina(percorso));
    else if (voce.isFile()) risultato.push(percorso);
    else throw new Error(`Asset non regolare nel bundle: ${percorso}`);
  }
  return risultato;
}

async function inventario(directory) {
  const voci = [];
  for (const percorso of await cammina(directory)) {
    if (basename(percorso) === "integration-manifest.json") continue;
    const contenuto = await readFile(percorso);
    voci.push({
      path: relative(directory, percorso).replaceAll("\\", "/"),
      bytes: contenuto.byteLength,
      sha256: sha256(contenuto),
    });
  }
  return voci.sort((sinistra, destra) => sinistra.path.localeCompare(destra.path));
}

async function leggiJson(percorso, etichetta) {
  try {
    return JSON.parse(await readFile(percorso, "utf8"));
  } catch {
    throw new Error(`${etichetta} non leggibile: ${percorso}`);
  }
}

async function verificaRuntimeRelease(runtimeRoot, releaseManifest) {
  const runtime = resolve(runtimeRoot);
  const vociRuntime = releaseManifest.files?.filter((voce) => voce?.path?.startsWith("runtime/"));
  if (
    releaseManifest.schemaVersion !== 1
    || releaseManifest.package !== "@sistema-guidato/pi-sistema-guidato"
    || !Array.isArray(vociRuntime)
    || vociRuntime.length === 0
    || releaseManifest.runtime?.server !== "runtime/server/server.mjs"
    || releaseManifest.runtime?.dashboard !== "runtime/dashboard/index.html"
    || releaseManifest.runtime?.templates !== "runtime/templates"
  ) {
    throw new Error("Release manifest Sistema Guidato incompatibile");
  }
  const attesi = new Set();
  for (const voce of vociRuntime) {
    if (
      typeof voce.path !== "string"
      || !Number.isInteger(voce.bytes)
      || !/^[a-f0-9]{64}$/u.test(voce.sha256)
      || voce.path.includes("..")
      || voce.path.includes("\\")
    ) throw new Error("Inventario runtime sorgente non valido");
    const relativoRuntime = voce.path.slice("runtime/".length);
    const percorso = resolve(runtime, ...relativoRuntime.split("/"));
    if (!dentroRadice(percorso, runtime)) throw new Error("Asset runtime fuori radice");
    const contenuto = await readFile(percorso);
    if (contenuto.byteLength !== voce.bytes || sha256(contenuto) !== voce.sha256) {
      throw new Error(`Release Sistema Guidato non riproducibile: ${voce.path}`);
    }
    attesi.add(relativoRuntime);
  }
  const presenti = (await cammina(runtime))
    .map((percorso) => relative(runtime, percorso).replaceAll("\\", "/"))
    .sort();
  if (presenti.length !== attesi.size || presenti.some((percorso) => !attesi.has(percorso))) {
    throw new Error("Il runtime sorgente contiene file non inventariati nel release manifest");
  }
  return runtime;
}

async function controlla() {
  const verificato = await verificaBundleSistemaGuidato(DESTINAZIONE, {
    versioneHost: VERSIONE_HOST,
    mountPath: "/sistema",
  });
  process.stdout.write(
    `Sistema Guidato verificato: ${verificato.manifest.source.packageVersion}, ${verificato.manifest.files.length} file, manifest ${verificato.manifestSha256}\n`,
  );
}

async function aggiorna() {
  const sourceArg = argomento("source") || process.env.SISTEMA_GUIDATO_SOURCE;
  const artifactArg = argomento("artifact-root");
  if (Boolean(sourceArg) === Boolean(artifactArg)) {
    throw new Error(
      "Indicare una sola sorgente: --source=<monorepo> per build locale oppure --artifact-root=<directory estratta> per CI",
    );
  }
  const inputRoot = resolve(sourceArg || artifactArg);
  if (inputRoot === RADICE || dentroRadice(DESTINAZIONE, inputRoot)) {
    throw new Error("La sorgente Sistema Guidato non puo coincidere con il repository GUI");
  }
  const releasePath = sourceArg
    ? resolve(inputRoot, "packages", "pi-sistema-guidato", "dist", "release-manifest.json")
    : resolve(inputRoot, "release-manifest.json");
  const compatibilityPath = sourceArg
    ? resolve(inputRoot, "packages", "pi-sistema-guidato", "pi-package-compatibility.json")
    : resolve(inputRoot, "pi-package-compatibility.json");
  const runtimePath = sourceArg
    ? resolve(inputRoot, "packages", "pi-sistema-guidato", "dist", "runtime")
    : resolve(inputRoot, "runtime");
  const [releaseBytes, compatibilityBytes] = await Promise.all([
    readFile(releasePath),
    readFile(compatibilityPath),
  ]);
  const releaseManifest = JSON.parse(releaseBytes.toString("utf8"));
  const compatibility = JSON.parse(compatibilityBytes.toString("utf8"));
  const runtimeSource = await verificaRuntimeRelease(runtimePath, releaseManifest);
  if (
    compatibility.manifestKind !== "pi-package-compatibility"
    || compatibility.schemaVersion !== 1
    || compatibility.packageVersion !== releaseManifest.version
    || compatibility.pi?.productionBaseline !== PI_BASELINE
    || compatibility.pi?.productionPatchId !== PI_PATCH
    || !compatibility.projectSchemaReaders?.includes(1)
    || !compatibility.projectSchemaReaders?.includes(2)
    || compatibility.projectSchemaWriters?.includes(1)
    || !compatibility.projectSchemaWriters?.includes(2)
  ) {
    throw new Error("Compatibilita Sistema Guidato non adatta all'host 2.6.0");
  }

  const vendorRoot = resolve(RADICE, "vendor");
  if (!dentroRadice(DESTINAZIONE, vendorRoot) || DESTINAZIONE === vendorRoot) {
    throw new Error("Destinazione vendor non confinata");
  }
  await mkdir(vendorRoot, { recursive: true });
  const staging = await mkdtemp(join(vendorRoot, ".sistema-guidato-stage-"));
  try {
    await cp(runtimeSource, join(staging, "runtime"), { recursive: true, force: false, errorOnExist: true });
    await writeFile(join(staging, "source-release-manifest.json"), releaseBytes);
    await writeFile(join(staging, "source-compatibility.json"), compatibilityBytes);
    const files = await inventario(staging);
    const manifest = {
      schemaVersion: 1,
      component: "sistema-guidato",
      source: {
        package: releaseManifest.package,
        packageVersion: releaseManifest.version,
        releaseManifestSha256: sha256(releaseBytes),
        compatibilitySha256: sha256(compatibilityBytes),
        projectSchemaReaders: compatibility.projectSchemaReaders,
        projectSchemaWriters: compatibility.projectSchemaWriters,
        piBaseline: compatibility.pi.productionBaseline,
        piPatchId: compatibility.pi.productionPatchId,
        sourcePanelQualified: compatibility.capabilities?.interfacciaPiPanel === true,
      },
      host: {
        name: "interfaccia-pi",
        version: VERSIONE_HOST,
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
      files,
    };
    await writeFile(
      join(staging, "integration-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await verificaBundleSistemaGuidato(staging, { versioneHost: VERSIONE_HOST, mountPath: "/sistema" });
    await rm(DESTINAZIONE, { recursive: true, force: true });
    await rename(staging, DESTINAZIONE);
  } catch (errore) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw errore;
  }
  await controlla();
}

if (process.argv.includes("--check")) await controlla();
else await aggiorna();
