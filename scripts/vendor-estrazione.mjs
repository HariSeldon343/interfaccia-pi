import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, open, rename, rm, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { SPEC_ESTRAZIONE, inventarioEstrazione, verificaBundleEstrazione } from "../app/estrazione-runtime.mjs";

export { SPEC_ESTRAZIONE };
const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));
const VENDOR = join(RADICE, "vendor");
const DESTINAZIONE = join(VENDOR, "estrazione");
const BLOCCO = join(VENDOR, ".estrazione.lock");

function percorsoGestito(percorso) {
  const assoluto = resolve(percorso);
  const relativo = relative(VENDOR, assoluto);
  if (!relativo || relativo.startsWith("..") || isAbsolute(relativo)) throw new Error("Percorso temporaneo estrazione non confinato");
  return assoluto;
}

export async function verificaIntegritaArchivio(percorso) {
  const hash = createHash("sha512");
  for await (const parte of createReadStream(percorso)) hash.update(parte);
  const integrita = `sha512-${hash.digest("base64")}`;
  if (integrita !== SPEC_ESTRAZIONE.integrita) throw new Error(`Integrità pdfjs-dist non valida: ${integrita}`);
  return integrita;
}

async function scarica(destinazione) {
  const risposta = await fetch(SPEC_ESTRAZIONE.url, { redirect: "follow", headers: { "user-agent": "interfaccia-pi-estrazione-vendor/1" } });
  if (!risposta.ok || !risposta.body) throw new Error(`Download pdfjs-dist fallito (${risposta.status})`);
  await pipeline(Readable.fromWeb(risposta.body), createWriteStream(destinazione, { flags: "wx" }));
}

function estrai(archivio, destinazione) {
  const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";
  if (!existsSync(tar)) throw new Error(`Tar di sistema non disponibile: ${tar}`);
  const risultato = spawnSync(tar, ["-xzf", archivio, "--strip-components", "1", "-C", destinazione, ...SPEC_ESTRAZIONE.file.map((file) => `package/${file}`)], {
    cwd: RADICE, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  if (risultato.error) throw risultato.error;
  if (risultato.status !== 0) throw new Error(`Estrazione archivio fallita: ${String(risultato.stderr || risultato.stdout).slice(0, 2000)}`);
}

async function preparaEstrazione() {
  await mkdir(VENDOR, { recursive: true });
  const lock = await open(BLOCCO, "wx").catch((errore) => {
    if (errore?.code === "EEXIST") throw new Error("Un'altra preparazione del bundle estrazione è già in corso");
    throw errore;
  });
  let temporanea;
  try {
    temporanea = percorsoGestito(await mkdtemp(join(VENDOR, ".estrazione-stage-")));
    const archivio = join(temporanea, "pdfjs-dist.tgz");
    const bundle = join(temporanea, "bundle");
    await mkdir(bundle);
    process.stdout.write(`Scarico pdfjs-dist ${SPEC_ESTRAZIONE.versione}...\n`);
    await scarica(archivio);
    await verificaIntegritaArchivio(archivio);
    estrai(archivio, bundle);
    const files = await inventarioEstrazione(bundle);
    const manifest = {
      schema: SPEC_ESTRAZIONE.schema,
      componente: "estrazione",
      pacchetto: { nome: SPEC_ESTRAZIONE.nome, versione: SPEC_ESTRAZIONE.versione, url: SPEC_ESTRAZIONE.url, integrita: SPEC_ESTRAZIONE.integrita },
      files,
    };
    await writeFile(join(bundle, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await verificaBundleEstrazione(bundle);
    const backup = percorsoGestito(join(temporanea, "precedente"));
    const avevaDestinazione = existsSync(DESTINAZIONE);
    if (avevaDestinazione) await rename(DESTINAZIONE, backup);
    try { await rename(bundle, DESTINAZIONE); }
    catch (errore) {
      if (avevaDestinazione && !existsSync(DESTINAZIONE)) await rename(backup, DESTINAZIONE);
      throw errore;
    }
    await verificaBundleEstrazione(DESTINAZIONE);
    process.stdout.write(`Bundle estrazione verificato: ${files.length} file, pdfjs-dist ${SPEC_ESTRAZIONE.versione}.\n`);
  } finally {
    await lock.close().catch(() => {});
    await unlink(BLOCCO).catch(() => {});
    if (temporanea) await rm(percorsoGestito(temporanea), { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const argomenti = new Set(process.argv.slice(2));
  for (const argomento of argomenti) if (!["--check", "--force"].includes(argomento)) throw new Error(`Argomento sconosciuto: ${argomento}`);
  if (argomenti.has("--check")) {
    const risultato = await verificaBundleEstrazione(DESTINAZIONE);
    process.stdout.write(`Bundle estrazione verificato: ${risultato.manifest.files.length} file, pdfjs-dist ${SPEC_ESTRAZIONE.versione}.\n`);
    return;
  }
  if (!argomenti.has("--force")) {
    try {
      await verificaBundleEstrazione(DESTINAZIONE);
      process.stdout.write(`Bundle estrazione pdfjs-dist ${SPEC_ESTRAZIONE.versione} già presente e verificato.\n`);
      return;
    } catch { /* Un bundle incompleto viene ricostruito da un archivio verificato. */ }
  }
  await preparaEstrazione();
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((errore) => {
    process.stderr.write(`Vendor estrazione fallito: ${errore?.message || errore}\n`);
    process.exitCode = 1;
  });
}
