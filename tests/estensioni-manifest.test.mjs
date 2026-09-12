import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LIMITI_ESTENSIONI, confrontaVersioni, leggiManifestoEstensione,
  percorsoEstensioneValido, verificaPacchettoEstensione,
} from "../app/estensioni-manifest.mjs";
import { PORTACHIAVI_ESTENSIONI } from "../app/estensioni-chiavi.mjs";

const chiavi = generateKeyPairSync("ed25519");
const portachiavi = [{ chiaveId: "prova", pubblica: chiavi.publicKey, stato: "attiva", dal: "2026-01-01", primaParte: true }];
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function fixture(t, modifica = () => {}) {
  const radice = await mkdtemp(join(tmpdir(), "pi-ext-firma-"));
  t.after(() => rm(radice, { force: true, recursive: true }));
  const contenuto = Buffer.from("---\nname: prova\ndescription: Risorsa sintetica\n---\nTesto sintetico.\n");
  const manifesto = {
    schemaVersion: 1, id: "pacchetto-prova", nome: "Pacchetto di prova", versione: "1.0.0",
    editore: "Prova sintetica", descrizione: "Contenuto sintetico", categoria: "risorse",
    host: { minInclusa: "2.9.0", maxEsclusa: "3.0.0" },
    pi: { skills: ["skills/prova/SKILL.md"], prompts: [], extensions: [], themes: [] },
    pannelli: [], limiti: {}, chiaveId: "prova",
    files: [{ percorso: "skills/prova/SKILL.md", byte: contenuto.length, sha256: hash(contenuto) }],
  };
  await mkdir(join(radice, "skills/prova"), { recursive: true });
  await writeFile(join(radice, "skills/prova/SKILL.md"), contenuto);
  modifica(manifesto);
  await riscrivi(radice, manifesto);
  return { radice, manifesto };
}

async function riscrivi(radice, manifesto, privata = chiavi.privateKey) {
  const bytes = Buffer.from(JSON.stringify(manifesto, null, 2) + "\n");
  await writeFile(join(radice, "manifesto-estensione.json"), bytes);
  await writeFile(join(radice, "manifest.sig"), sign(null, bytes, privata).toString("base64"));
}

test("il manifesto con campi sconosciuti, intervallo host non numerico, id non normalizzato o piu di un punto di ingresso viene rifiutato", async (t) => {
  const casi = [
    [(m) => { m.sconosciuto = true; }, /campi non previsti/u],
    [(m) => { m.host.minInclusa = "^2.9.0"; }, /Versione non numerica/u],
    [(m) => { m.host.maxEsclusa = "2.8.9"; }, /invertito/u],
    [(m) => { m.id = "Pacchetto-Prova"; }, /non normalizzato/u],
    [(m) => { m.id = "a".repeat(65); }, /non normalizzato/u],
    [(m) => { m.categoria = "programma"; }, /Categoria/u],
    [(m) => { m.pi.extensions = ["maligno.js"]; }, /non supportato nella 2.9/u],
    [(m) => { m.categoria = "backend"; m.backend = { ingresso: ["a.js", "b.js"] }; }, /Percorso non ammesso/u],
    [(m) => { m.categoria = "backend"; m.backend = { ingresso: "a.js", altro: "b.js" }; }, /campi non previsti/u],
    [(m) => { m.categoria = "backend"; m.backend = { ingresso: "a.js" }; }, /inventariato/u],
    [(m) => { m.pi.skills = ["skills"]; }, /non inventariata/u],
  ];
  for (const [modifica, messaggio] of casi) {
    const { radice } = await fixture(t, modifica);
    await assert.rejects(leggiManifestoEstensione(radice, { portachiavi }), messaggio);
  }
  assert.equal(confrontaVersioni("2.9.0", "2.10.0"), -1);
  const { radice } = await fixture(t);
  await assert.rejects(leggiManifestoEstensione(radice, { portachiavi, versioneHost: "3.0.0" }), /non compatibile/u);
  assert.equal((await verificaPacchettoEstensione(radice, { portachiavi })).manifesto.id, "pacchetto-prova");
});

test("un manifesto riserializzato, una firma assente, una firma elencata nell'inventario e una chiave sconosciuta vengono rifiutati", async (t) => {
  const { radice, manifesto } = await fixture(t);
  const originale = await readFile(join(radice, "manifesto-estensione.json"));
  await writeFile(join(radice, "manifesto-estensione.json"), JSON.stringify(JSON.parse(originale)));
  await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi }), /Firma del manifesto non valida/u);
  await riscrivi(radice, manifesto);
  await rm(join(radice, "manifest.sig"));
  await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi }), /manifest\.sig/u);
  for (const percorso of ["manifest.sig", "manifesto-estensione.json"]) {
    const prova = await fixture(t, (m) => m.files.push({ percorso, byte: 0, sha256: hash("") }));
    await assert.rejects(verificaPacchettoEstensione(prova.radice, { portachiavi }), /non entrano nell'inventario/u);
  }
  await riscrivi(radice, manifesto);
  await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi: [] }), /sconosciuta/u);
  for (const firma of ["{}", "firma\ncommento", "A".repeat(86) + "==\n\n"]) {
    await writeFile(join(radice, "manifest.sig"), firma);
    await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi }), /Firma non valida/u);
  }
  assert.equal(PORTACHIAVI_ESTENSIONI.length, 0, "la build non contiene chiavi di prova");
});

test("una chiave revocata rifiuta anche un pacchetto gia installato e i pannelli restano del solo Sistema Guidato", async (t) => {
  const { radice } = await fixture(t);
  await verificaPacchettoEstensione(radice, { portachiavi });
  await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi: [{ ...portachiavi[0], stato: "revocata" }] }), /revocata/u);
  const pannello = await fixture(t, (m) => {
    m.id = "sistema-guidato";
    m.categoria = "backend";
    m.backend = { ingresso: "server.mjs" };
    m.files.push({ percorso: "server.mjs", byte: 0, sha256: hash("") });
    m.pannelli = [{ id: "sistema-guidato", percorso: "/sistema" }];
  });
  await writeFile(join(pannello.radice, "server.mjs"), "");
  await verificaPacchettoEstensione(pannello.radice, { portachiavi });
  await assert.rejects(verificaPacchettoEstensione(pannello.radice, { portachiavi: [{ ...portachiavi[0], primaParte: false }] }), /solo Sistema Guidato firmato di prima parte/u);
  pannello.manifesto.id = "altro";
  await riscrivi(pannello.radice, pannello.manifesto);
  await assert.rejects(verificaPacchettoEstensione(pannello.radice, { portachiavi }), /solo Sistema Guidato firmato di prima parte/u);
});

test("un file in piu o in meno, un collegamento o un percorso troppo lungo fanno fallire la verifica", async (t) => {
  const { radice, manifesto } = await fixture(t);
  await writeFile(join(radice, "extra.txt"), "sintetico");
  await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi }), /extra\.txt/u);
  await rm(join(radice, "extra.txt"));
  await rm(join(radice, "skills/prova/SKILL.md"));
  await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi }), /SKILL\.md/u);
  const sorgente = await fixture(t);
  await symlink(join(sorgente.radice, "skills"), join(radice, "collegamento"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi }), /Collegamento|giunzione/u);
  await rm(join(radice, "collegamento"), { recursive: true, force: true });
  const lungo = `${"a".repeat(100)}/${"b".repeat(80)}/file.md`;
  manifesto.files = [{ percorso: lungo, byte: 0, sha256: hash("") }];
  manifesto.pi.skills = [lungo];
  await mkdir(dirname(join(radice, lungo)), { recursive: true });
  await writeFile(join(radice, lungo), "");
  await riscrivi(radice, manifesto);
  await assert.rejects(verificaPacchettoEstensione(radice, { portachiavi }), /Percorso troppo lungo/u);
});

test("i percorsi ostili di Windows e le collisioni di maiuscole vengono rifiutati prima della copia", async (t) => {
  for (const percorso of ["../fuori", "C:/fuori", "\\\\server\\share", "a:b", "file.", "file ", "NUL.txt", "a/COM1.md", "a/LPT¹.md", "a//b", "/assoluto", "a/../b"]) {
    assert.equal(percorsoEstensioneValido(percorso), false, percorso);
  }
  const { radice } = await fixture(t, (m) => m.files.push({ ...m.files[0], percorso: "skills/PROVA/SKILL.md" }));
  await assert.rejects(leggiManifestoEstensione(radice, { portachiavi }), /duplicato/u);
  assert.equal(LIMITI_ESTENSIONI.manifestoByte, 2 * 1024 * 1024);
  assert.equal(LIMITI_ESTENSIONI.file, 20_000);
  assert.equal(LIMITI_ESTENSIONI.byte, 512 * 1024 * 1024);
});
