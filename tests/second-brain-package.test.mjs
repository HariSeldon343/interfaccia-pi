import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FILE_SECOND_BRAIN, verificaPacchettoSecondBrain } from "../scripts/verifica-pacchetto-estensione.mjs";

const chiavi = generateKeyPairSync("ed25519");
const portachiavi = [{ chiaveId: "prova", pubblica: chiavi.publicKey, stato: "attiva", dal: "2026-01-01", primaParte: true }];
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function pacchetto(t, { contaminazione = "", fileExtra = null, modificaPackage = () => {} } = {}) {
  const radice = await mkdtemp(join(tmpdir(), "pi-sb-curato-"));
  t.after(() => rm(radice, { force: true, recursive: true }));
  const pi = { skills: FILE_SECOND_BRAIN.filter((p) => p.startsWith("skills/")), prompts: FILE_SECOND_BRAIN.filter((p) => p.startsWith("prompts/")), extensions: [], themes: [] };
  const payload = { name: "second-brain", version: "1.0.0", description: "Fixture sintetica", pi };
  modificaPackage(payload);
  const file = FILE_SECOND_BRAIN.map((percorso) => [percorso, percorso === "package.json"
    ? JSON.stringify(payload) : `# Prova sintetica\n${percorso === "LEGGIMI.md" ? contaminazione : "Testo di controllo."}\n`]);
  if (fileExtra) file.push([fileExtra, "Contenuto sintetico"]);
  const manifesto = {
    schemaVersion: 1, id: "second-brain", nome: "Second Brain", versione: "1.0.0", editore: "Prova sintetica",
    descrizione: "Fixture sintetica", categoria: "risorse", host: { minInclusa: "2.9.0", maxEsclusa: "3.0.0" },
    pi, pannelli: [], limiti: {}, chiaveId: "prova",
    files: file.map(([percorso, testo]) => ({ percorso, byte: Buffer.byteLength(testo), sha256: hash(testo) })),
  };
  for (const [percorso, testo] of file) {
    await mkdir(dirname(join(radice, percorso)), { recursive: true });
    await writeFile(join(radice, percorso), testo);
  }
  const bytes = Buffer.from(JSON.stringify(manifesto, null, 2));
  await writeFile(join(radice, "manifesto-estensione.json"), bytes);
  await writeFile(join(radice, "manifest.sig"), sign(null, bytes, chiavi.privateKey).toString("base64"));
  return radice;
}

test("le contaminazioni sintetiche fanno fallire il controllo e il pacchetto pulito passa", async (t) => {
  const pulito = await pacchetto(t);
  const esito = await verificaPacchettoSecondBrain(pulito, { portachiavi });
  assert.equal(esito.revisioneUmanaRichiesta, true);
  for (const [contaminazione, atteso] of [
    ["C:\\Users\\ProfiloFinto\\Documenti", /percorso personale/u],
    ["/home/profilo-finto/note", /percorso personale/u],
    ["prova@example.invalid", /indirizzo di posta/u],
    ["Telefono: +39 333 123 4567", /numero di telefono/u],
    ["3331234567", /numero di telefono/u],
    ["api_key = valore-finto", /credenziale/u],
    ["Cliente: Societa Sintetica", /nome di cliente/u],
  ]) {
    const radice = await pacchetto(t, { contaminazione });
    await assert.rejects(verificaPacchettoSecondBrain(radice, { portachiavi }), atteso);
  }
  const nome = await pacchetto(t, { contaminazione: "Riferimento a Marchio Sintetico" });
  await assert.rejects(verificaPacchettoSecondBrain(nome, { portachiavi, nomiClienti: ["Marchio Sintetico"] }), /nome di cliente/u);
  for (const fileExtra of [".pi/settings.json", ".obsidian/config.json", ".git/config", "storia.jsonl", "debug.log", "dati.sqlite", "allegati/file.md", "immagine.png", "altro.md"]) {
    const radice = await pacchetto(t, { fileExtra });
    await assert.rejects(verificaPacchettoSecondBrain(radice, { portachiavi }), /elenco chiuso|formato non consentito/u);
  }
  const npm = await pacchetto(t, { modificaPackage: (p) => { p.scripts = { install: "comando sintetico" }; } });
  await assert.rejects(verificaPacchettoSecondBrain(npm, { portachiavi }), /package\.json contiene campi/u);
  const link = await pacchetto(t);
  await symlink(dirname(pulito), join(link, "collegamento"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(verificaPacchettoSecondBrain(link, { portachiavi }), /Collegamento|giunzione/u);
  await rm(join(link, "collegamento"), { recursive: true, force: true });
  await writeFile(join(pulito, "LEGGIMI.md"), "manomissione");
  await assert.rejects(verificaPacchettoSecondBrain(pulito, { portachiavi }), /alterato|limite/u);
});
