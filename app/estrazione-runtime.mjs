import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { verificaDestinazionePercorsoReale } from "./estensioni-manifest.mjs";

export const SPEC_ESTRAZIONE = Object.freeze({
  schema: 1,
  nome: "pdfjs-dist",
  versione: "6.3.289",
  url: "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz",
  integrita: "sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==",
  file: Object.freeze(["build/pdf.mjs", "LICENSE", "legacy/build/pdf.worker.mjs"]),
});

function oggetto(valore) {
  return valore !== null && typeof valore === "object" && !Array.isArray(valore);
}

function percorsoValido(valore) {
  return typeof valore === "string" && valore.length > 0
    && !/[\\:\x00-\x1f\x7f]/.test(valore)
    && valore.split("/").every((parte) => parte && parte !== "." && parte !== "..");
}

export function trovaBundleEstrazione(guiDirectory) {
  const candidati = [resolve(guiDirectory, "estrazione"), resolve(guiDirectory, "..", "vendor", "estrazione")];
  return candidati.find((radice) => existsSync(join(radice, "manifest.json"))) || candidati[0];
}

export async function inventarioEstrazione(radice) {
  const files = [];
  const visita = async (cartella) => {
    const voci = await readdir(cartella, { withFileTypes: true });
    voci.sort((sinistra, destra) => sinistra.name.localeCompare(destra.name));
    for (const voce of voci) {
      const percorso = join(cartella, voce.name);
      const path = relative(radice, percorso).split(sep).join("/");
      const info = await lstat(percorso);
      if (info.isSymbolicLink()) throw new Error(`Link non ammesso nel bundle estrazione: ${path}`);
      if (info.isDirectory()) await visita(percorso);
      else if (info.isFile()) {
        if (path === "manifest.json") continue;
        if (!SPEC_ESTRAZIONE.file.includes(path) || info.size > 100 * 1024 * 1024) throw new Error(`File estrazione inatteso o troppo grande: ${path}`);
        files.push({ path, size: info.size, sha256: createHash("sha256").update(await readFile(percorso)).digest("hex") });
      } else throw new Error(`Voce speciale non ammessa nel bundle estrazione: ${path}`);
    }
  };
  await visita(radice);
  return files;
}

export async function verificaBundleEstrazione(bundleRoot) {
  const radice = resolve(bundleRoot);
  const infoRadice = await lstat(radice).catch(() => null);
  if (!infoRadice?.isDirectory() || infoRadice.isSymbolicLink()) {
    throw new Error("Bundle estrazione assente o collegato: eseguire npm run vendor:estrazione");
  }
  const radiceReale = await realpath(radice);
  try { await verificaDestinazionePercorsoReale(radice, radiceReale, process.platform); }
  catch { throw new Error("Bundle estrazione assente o collegato: eseguire npm run vendor:estrazione"); }
  const percorsoManifest = join(radice, "manifest.json");
  const info = await lstat(percorsoManifest).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 1024 * 1024) {
    throw new Error("Manifest estrazione mancante o non valido: eseguire npm run vendor:estrazione");
  }
  let manifest;
  try { manifest = JSON.parse(await readFile(percorsoManifest, "utf8")); }
  catch { throw new Error("Manifest estrazione non leggibile"); }
  if (!oggetto(manifest) || manifest.schema !== SPEC_ESTRAZIONE.schema || manifest.componente !== "estrazione"
    || !oggetto(manifest.pacchetto) || manifest.pacchetto.nome !== SPEC_ESTRAZIONE.nome
    || manifest.pacchetto.versione !== SPEC_ESTRAZIONE.versione || manifest.pacchetto.url !== SPEC_ESTRAZIONE.url
    || manifest.pacchetto.integrita !== SPEC_ESTRAZIONE.integrita) {
    throw new Error("Manifest estrazione incompatibile con i pin bloccati");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== SPEC_ESTRAZIONE.file.length) {
    throw new Error("Inventario estrazione: numero di file non valido");
  }
  const attesi = new Map();
  for (const voce of manifest.files) {
    if (!oggetto(voce) || !percorsoValido(voce.path)
      || !Number.isSafeInteger(voce.size) || voce.size < 0 || voce.size > 100 * 1024 * 1024
      || typeof voce.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(voce.sha256) || attesi.has(voce.path)) {
      throw new Error("Inventario estrazione non valido");
    }
    if (!SPEC_ESTRAZIONE.file.includes(voce.path)) throw new Error("Inventario estrazione: percorso fuori allowlist: " + voce.path);
    attesi.set(voce.path, voce);
  }
  if (SPEC_ESTRAZIONE.file.some((file) => !attesi.has(file))) throw new Error("File richiesto mancante nell'inventario estrazione");
  const correnti = await inventarioEstrazione(radice);
  if (correnti.length !== attesi.size || correnti.some((voce) => !attesi.has(voce.path))) {
    throw new Error("Inventario estrazione divergente: file mancante o inatteso");
  }
  for (const voce of correnti) {
    const attesa = attesi.get(voce.path);
    if (voce.size !== attesa.size || voce.sha256 !== attesa.sha256) throw new Error(`File estrazione alterato: ${voce.path}`);
  }
  // Il worker legacy include la compatibilità Uint8Array.toHex richiesta dal runtime Node supportato.
  // Il modulo principale standard evita il caricamento delle dipendenze canvas del modulo legacy.
  return { radice, manifest, pdf: join(radice, "build", "pdf.mjs"), worker: join(radice, "legacy", "build", "pdf.worker.mjs") };
}

export async function trovaRuntimeEstrazione(guiDirectory) {
  return verificaBundleEstrazione(trovaBundleEstrazione(guiDirectory));
}
