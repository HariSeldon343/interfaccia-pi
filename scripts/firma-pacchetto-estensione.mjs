#!/usr/bin/env node

import { createHash, sign, verify } from "node:crypto";
import { lstat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inventarioCartellaEstensione, leggiFileRegolare, LIMITI_ESTENSIONI,
  NOME_FIRMA, NOME_MANIFESTO, validaManifestoEstensione, verificaPacchettoEstensione,
  verificaPercorsoRegolare,
} from "../app/estensioni-manifest.mjs";
import { VERSIONE_HOST } from "../app/versione-host.mjs";
import { leggiChiavePrivataEstensioni } from "./genera-chiavi-estensioni.mjs";

async function metadatiPacchetto(radice) {
  const presente = await lstat(join(radice, NOME_MANIFESTO)).catch((errore) => {
    if (errore.code === "ENOENT") return null;
    throw errore;
  });
  if (presente) return JSON.parse((await leggiFileRegolare(join(radice, NOME_MANIFESTO), LIMITI_ESTENSIONI.manifestoByte)).toString("utf8"));
  const pacchetto = JSON.parse((await leggiFileRegolare(join(radice, "package.json"), LIMITI_ESTENSIONI.manifestoByte)).toString("utf8"));
  if (!pacchetto.interfacciaPi || typeof pacchetto.interfacciaPi !== "object" || Array.isArray(pacchetto.interfacciaPi)) {
    throw new Error("Dichiarare i metadati dell'estensione in package.json, campo interfacciaPi, oppure in manifesto-estensione.json");
  }
  return { versione: pacchetto.version, pi: pacchetto.pi, ...pacchetto.interfacciaPi };
}

export async function firmaPacchettoEstensione(radice, percorsoChiave, { manifesto, versioneHost = VERSIONE_HOST } = {}) {
  radice = resolve(radice);
  const { privata, pubblica } = await leggiChiavePrivataEstensioni(percorsoChiave, { cartellaPacchetto: radice });
  const files = [];
  for (const voce of await inventarioCartellaEstensione(radice)) {
    if ([NOME_MANIFESTO, NOME_FIRMA].includes(voce.percorso)) continue;
    const bytes = await leggiFileRegolare(join(radice, voce.percorso), voce.byte);
    files.push({ ...voce, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const metadati = manifesto ?? await metadatiPacchetto(radice);
  const firmato = { ...metadati, schemaVersion: 1, files, chiaveId: pubblica.chiaveId };
  const opzioni = { versioneHost, portachiavi: [pubblica] };
  const validato = validaManifestoEstensione(firmato, opzioni);
  const bytes = Buffer.from(JSON.stringify(firmato, null, 2) + "\n");
  if (bytes.length > validato.limiti.manifestoByte) throw new Error("Manifesto oltre il limite di byte");
  const firma = sign(null, bytes, privata);
  if (!verify(null, bytes, validato.chiave.pubblica, firma)) throw new Error("La verifica immediata della firma Ed25519 è fallita");
  for (const nome of [NOME_MANIFESTO, NOME_FIRMA]) {
    const destinazione = join(radice, nome);
    const presente = await lstat(destinazione).catch((errore) => {
      if (errore.code === "ENOENT") return null;
      throw errore;
    });
    if (presente) await verificaPercorsoRegolare(destinazione);
    await writeFile(destinazione, nome === NOME_MANIFESTO ? bytes : firma.toString("base64"), { flag: presente ? "w" : "wx" });
  }
  const verificato = await verificaPacchettoEstensione(radice, opzioni);
  return { ...verificato, chiavePubblica: pubblica };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Uso: node scripts/firma-pacchetto-estensione.mjs <cartella-pacchetto> <percorso-chiave-privata-esterno>");
    const verificato = await firmaPacchettoEstensione(process.argv[2], process.argv[3]);
    process.stdout.write(`Pacchetto firmato e verificato: ${verificato.manifesto.id} ${verificato.manifesto.versione}, ${verificato.files.length} file, keyId ${verificato.manifesto.chiaveId}. Firma: ${NOME_FIRMA}.\n`);
  } catch (errore) {
    process.stderr.write(errore.message + "\n");
    process.exitCode = 1;
  }
}
