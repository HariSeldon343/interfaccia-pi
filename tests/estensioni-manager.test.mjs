import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { creaArchivioEstensioni, radiceProgrammiEstensioni, validaRegistroEstensioni } from "../app/estensioni-store.mjs";
import { scriviFileAtomico } from "../app/persistenza-atomica.mjs";
import { creaGestoreEstensioni } from "../app/estensioni-manager.mjs";
import { MASSIMO_TESTO } from "../app/estensioni-risorse.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const chiave = { chiaveId: "prova-manager", pubblica: publicKey, stato: "attiva", dal: "2020-01-01", primaParte: true };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function temporaneo(t) {
  const radice = await mkdtemp(join(tmpdir(), "pe-"));
  t.after(async () => {
    async function sblocca(p) {
      const info = await lstat(p);
      if (info.isSymbolicLink()) return;
      await chmod(p, info.isDirectory() ? 0o700 : 0o600);
      if (info.isDirectory()) for (const n of await readdir(p)) await sblocca(join(p, n));
    }
    await sblocca(radice);
    await rm(radice, { recursive: true, force: true });
  });
  return radice;
}

async function pacchetto(radice, { versione = "1.0.0", id = "prova", testo = "# Risorsa sintetica\nTesto completo di prova.\n", extra = {}, cambia = null } = {}) {
  const cartella = join(radice, "fonte-" + id + "-" + versione);
  const contenuti = { "skills/prova/SKILL.md": testo, "prompts/prova.md": "Modello sintetico vuoto.\n", ...extra };
  const pi = { skills: ["skills/prova/SKILL.md"], prompts: ["prompts/prova.md"], themes: [], extensions: [] };
  contenuti["package.json"] = JSON.stringify({ name: id, version: versione, pi });
  const files = [];
  for (const [percorso, contenuto] of Object.entries(contenuti)) {
    await mkdir(dirname(join(cartella, percorso)), { recursive: true });
    await writeFile(join(cartella, percorso), contenuto);
    files.push({ percorso, byte: Buffer.byteLength(contenuto), sha256: digest(contenuto) });
  }
  const manifesto = { schemaVersion: 1, id, nome: "Pacchetto sintetico", versione, editore: "Prova", descrizione: "Risorse sintetiche per verifiche locali.",
    categoria: "risorse", host: { minInclusa: "2.9.0", maxEsclusa: "3.0.0" }, pi, pannelli: [], files, limiti: {}, chiaveId: chiave.chiaveId };
  cambia?.(manifesto);
  const bytes = Buffer.from(JSON.stringify(manifesto, null, 2));
  await writeFile(join(cartella, "manifesto-estensione.json"), bytes);
  await writeFile(join(cartella, "manifest.sig"), sign(null, bytes, privateKey).toString("base64"));
  return cartella;
}

function gestore(radice, opzioni = {}) {
  return creaGestoreEstensioni({ home: join(radice, "home"), env: { LOCALAPPDATA: join(radice, "local"), XDG_DATA_HOME: join(radice, "local") },
    portachiavi: [chiave], ...opzioni });
}

test("il registro nasce vuoto, si scrive in modo atomico e rifiuta una versione superata", async (t) => {
  const radice = await temporaneo(t);
  const archivio = creaArchivioEstensioni({ home: radice });
  const vuoto = await archivio.leggi();
  assert.deepEqual(vuoto, { schemaVersion: 1, versioneArchivio: 0, estensioni: [], risorsePersonali: [] });
  await assert.rejects(lstat(archivio.percorso), { code: "ENOENT" });
  const aggiornato = await archivio.salva(vuoto, 0);
  assert.equal(aggiornato.versioneArchivio, 1);
  assert.deepEqual(await readdir(dirname(archivio.percorso)), ["estensioni.json"]);
  await assert.rejects(archivio.salva(vuoto, 0), (errore) => errore.statusHttp === 409);
  assert.equal((await archivio.leggi()).versioneArchivio, 1);
  const guasto = creaArchivioEstensioni({ home: radice, scriviFile: async () => { throw new Error("Guasto sintetico"); } });
  await assert.rejects(guasto.salva(aggiornato, 1), /Guasto sintetico/u);
  assert.deepEqual(await archivio.leggi(), aggiornato);
  assert.deepEqual(await readdir(dirname(archivio.percorso)), ["estensioni.json"]);
  const altri = creaArchivioEstensioni({ home: radice });
  const risultati = await Promise.allSettled([archivio.salva(aggiornato, 1), altri.salva(aggiornato, 1)]);
  assert.equal(risultati.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(risultati.find((r) => r.status === "rejected").reason.statusHttp, 409);
  assert.equal(radiceProgrammiEstensioni({ home: radice, env: { LOCALAPPDATA: join(radice, "L") }, platform: "win32" }), join(radice, "L", "it.amodeo.interfaccia-pi", "estensioni"));
});

test("una cartella oltre i tetti viene rifiutata prima di copiare e l'installazione fallita non lascia tracce", async (t) => {
  const radice = await temporaneo(t);
  let copie = 0;
  const limitato = gestore(radice, { limiti: { byte: 16 }, osservaCopia: () => copie++ });
  const cartella = await pacchetto(radice);
  await assert.rejects(limitato.installa({ cartella, versioneAttesa: 0 }), /limite/iu);
  assert.equal(copie, 0);
  await assert.rejects(lstat(limitato.radiceProgrammi), { code: "ENOENT" });
  assert.equal((await limitato.archivio.leggi()).versioneArchivio, 0);
  const corrotto = gestore(radice, { osservaCopia: () => { copie++; throw new Error("Copia interrotta sintetica"); } });
  await assert.rejects(corrotto.installa({ cartella, versioneAttesa: 0 }), /Copia interrotta/u);
  assert.equal(copie, 1);
  await assert.rejects(lstat(corrotto.radiceProgrammi), { code: "ENOENT" });
  await assert.rejects(lstat(corrotto.archivio.percorso), { code: "ENOENT" });
});

test("una versione precedente o gia installata viene rifiutata e i dati sopravvivono alla rimozione", async (t) => {
  const radice = await temporaneo(t);
  const g = gestore(radice);
  const dati = join(radice, "local", "it.amodeo.sistema-guidato", "documento.txt");
  await mkdir(dirname(dati), { recursive: true });
  await writeFile(dati, "Documento sintetico conservato.");
  const fonte1 = await pacchetto(radice);
  let stato = await g.installa({ cartella: fonte1, versioneAttesa: 0 });
  assert.equal(stato.estensioni[0].stato, "Disattiva");
  await assert.rejects(g.installa({ cartella: fonte1, versioneAttesa: 1 }), /precedente o già installata/u);
  const fonte0 = await pacchetto(radice, { versione: "0.9.0" });
  await assert.rejects(g.aggiorna({ cartella: fonte0, versioneAttesa: 1 }), /precedente o già installata/u);
  const fonte2 = await pacchetto(radice, { versione: "1.1.0" });
  stato = await g.aggiorna({ cartella: fonte2, versioneAttesa: 1 });
  assert.deepEqual(stato.estensioni[0].versioniPresenti, ["1.0.0", "1.1.0"]);
  assert.equal(await readFile(join(g.radiceProgrammi, "prova", "1.0.0", "skills/prova/SKILL.md"), "utf8"), "# Risorsa sintetica\nTesto completo di prova.\n");
  await assert.rejects(g.tornaVersione({ id: "prova", versione: "1.0.0", conferma: "", versioneAttesa: 2 }), /scrivi: Torna a/u);
  stato = await g.tornaVersione({ id: "prova", versione: "1.0.0", conferma: "Torna a 1.0.0", versioneAttesa: 2 });
  assert.equal(stato.estensioni[0].versioneInstallata, "1.0.0");
  stato = await g.rimuovi({ id: "prova", versioneAttesa: 3 });
  assert.equal(stato.estensioni.length, 0);
  assert.equal(await readFile(dati, "utf8"), "Documento sintetico conservato.");
  await assert.rejects(lstat(join(g.radiceProgrammi, "prova")), { code: "ENOENT" });
});

test("un byte alterato dopo un'installazione riuscita blocca il caricamento successivo", async (t) => {
  const radice = await temporaneo(t);
  const g = gestore(radice);
  await g.installa({ cartella: await pacchetto(radice), versioneAttesa: 0 });
  await g.attiva({ id: "prova", attiva: true, versioneAttesa: 1 });
  await g.applica({ versioneAttesa: 2 });
  assert.equal((await g.risorsePerPi()).skills.length, 1);
  const percorso = join(g.radiceProgrammi, "prova", "1.0.0", "skills/prova/SKILL.md");
  await chmod(percorso, 0o600);
  const bytes = await readFile(percorso);
  bytes[0] = 65;
  await writeFile(percorso, bytes);
  await assert.rejects(g.risorsePerPi(), /SKILL\.md/u);
  const riletto = gestore(radice);
  const stato = await riletto.elenco();
  assert.equal(stato.estensioni[0].stato, "Manomessa");
  assert.match(stato.estensioni[0].messaggio, /SKILL\.md/u);
  await assert.rejects(riletto.risorsePerPi(), { code: "ESTENSIONE_MANOMESSA" });
});

test("l'applicazione si rinvia durante un turno e non riavvia nessuna sessione attiva", async (t) => {
  const radice = await temporaneo(t);
  let occupata = true;
  let riavvii = 0;
  const sessione = { id: "sintetica", jsonl: "stesso.jsonl", bozza: "Bozza sintetica", allegati: ["allegato.txt"] };
  const prima = structuredClone(sessione);
  const g = gestore(radice, { sessioniOccupate: () => occupata, applicaSessioni: async (config, riverifica) => {
    assert.equal(occupata, false);
    assert.deepEqual(config, await riverifica());
    assert.equal(config.skills.length, 1);
    riavvii++;
  } });
  await g.installa({ cartella: await pacchetto(radice), versioneAttesa: 0 });
  let stato = await g.attiva({ id: "prova", attiva: true, versioneAttesa: 1 });
  assert.equal(stato.estensioni[0].stato, "Da applicare");
  assert.deepEqual((await g.risorsePerPi()).skills, []);
  stato = await g.applica({ versioneAttesa: 2 });
  assert.equal(stato.rinviata, true);
  assert.equal(stato.versioneArchivio, 2);
  assert.equal(riavvii, 0);
  assert.deepEqual(sessione, prima);
  occupata = false;
  stato = await g.applica({ versioneAttesa: 2 });
  assert.equal(stato.estensioni[0].stato, "Attiva");
  assert.equal(riavvii, 1);
  assert.deepEqual(sessione, prima);
  await assert.rejects(g.rimuovi({ id: "prova", versioneAttesa: 3 }), /In uso/u);
  await g.attiva({ id: "prova", attiva: false, versioneAttesa: 3 });
  assert.equal((await g.risorsePerPi()).skills.length, 1);
});

test("il preflight rifiuta una risorsa manomessa prima di riavviare qualsiasi sessione", async (t) => {
  const radice = await temporaneo(t);
  let riavvii = 0;
  const g = gestore(radice, { applicaSessioni: async () => { riavvii++; } });
  await g.installa({ cartella: await pacchetto(radice), versioneAttesa: 0 });
  await g.attiva({ id: "prova", attiva: true, versioneAttesa: 1 });
  const percorso = join(g.radiceProgrammi, "prova", "1.0.0", "prompts/prova.md");
  await chmod(percorso, 0o600);
  await writeFile(percorso, "Contaminazione sintetica");
  await assert.rejects(g.applica({ versioneAttesa: 2 }), /prova\.md/u);
  assert.equal(riavvii, 0);
  assert.equal((await g.archivio.leggi()).versioneArchivio, 2);
});

test("l'annullamento della migrazione non scrive il programma e il backup precede la copia", async (t) => {
  const radice = await temporaneo(t);
  const eventi = [];
  let conferma = false;
  const g = gestore(radice, { primaDiInstallare: async () => { eventi.push("backup"); return { annullata: !conferma }; }, osservaCopia: () => eventi.push("copia") });
  const cartella = await pacchetto(radice);
  const esito = await g.installa({ cartella, versioneAttesa: 0 });
  assert.equal(esito.annullata, true);
  assert.deepEqual(eventi, ["backup"]);
  await assert.rejects(lstat(g.radiceProgrammi), { code: "ENOENT" });
  await assert.rejects(lstat(g.archivio.percorso), { code: "ENOENT" });
  conferma = true;
  await g.installa({ cartella, versioneAttesa: 0, confermaMigrazione: true });
  assert.equal(eventi[1], "backup");
  assert.equal(eventi[2], "copia");
});

test("le risorse personali si attivano nel solo registro e il testo cambiato richiede rilettura", async (t) => {
  const radice = await temporaneo(t);
  const percorso = join(radice, "home", ".agents", "skills", "prova", "SKILL.md");
  await mkdir(dirname(percorso), { recursive: true });
  await writeFile(percorso, "Risorsa personale sintetica\n");
  const g = gestore(radice);
  const prima = await readFile(percorso);
  assert.equal((await g.elenco()).risorsePersonali[0].attiva, false);
  await g.attiva({ percorso, attiva: true, versioneAttesa: 0 });
  assert.deepEqual((await g.risorsePerPi()).skills, []);
  await g.applica({ versioneAttesa: 1 });
  assert.deepEqual((await g.risorsePerPi()).skills, [percorso]);
  assert.deepEqual(await readFile(percorso), prima);
  await writeFile(percorso, "Risorsa personale sintetica cambiata\n");
  assert.deepEqual((await g.risorsePerPi()).skills, []);
  const modificata = await g.elenco();
  assert.equal(modificata.risorsePersonali[0].stato, "Da rileggere");
  assert.equal(modificata.risorsePersonali[0].statoApplicazione, "Da applicare");
  assert.ok(modificata.avvisiRisorsePersonali.some((avviso) => avviso.includes(percorso)));
  await rm(percorso);
  assert.deepEqual((await g.risorsePerPi()).skills, []);
  const assente = await g.elenco();
  assert.equal(assente.risorsePersonali[0].stato, "Assente");
  assert.equal(assente.risorsePersonali[0].statoApplicazione, "Da applicare");
  assert.ok(assente.avvisiRisorsePersonali.some((avviso) => avviso.includes(percorso)));
  await g.attiva({ percorso, attiva: false, versioneAttesa: 2 });
  await g.applica({ versioneAttesa: 3 });
  assert.deepEqual((await g.risorsePerPi()).skills, []);
  const falso = await g.archivio.leggi();
  falso.risorsePersonali[0].attivaApplicata = true;
  assert.throws(() => validaRegistroEstensioni(falso), /registro/u);
});

test("un errore di scrittura del registro ripristina i percorsi applicati precedenti", async (t) => {
  const radice = await temporaneo(t);
  let guasto = false;
  const archivio = creaArchivioEstensioni({ home: join(radice, "home"), scriviFile: async (...args) => {
    if (guasto) throw new Error("Guasto del disco sintetico");
    return scriviFileAtomico(...args);
  } });
  const configurazioni = [];
  const g = gestore(radice, { archivio, applicaSessioni: async (risorse) => configurazioni.push(risorse.skills) });
  await g.installa({ cartella: await pacchetto(radice), versioneAttesa: 0 });
  await g.attiva({ id: "prova", attiva: true, versioneAttesa: 1 });
  guasto = true;
  await assert.rejects(g.applica({ versioneAttesa: 2 }), /Guasto del disco/u);
  assert.equal(configurazioni.length, 2);
  assert.equal(configurazioni[0].length, 1);
  assert.deepEqual(configurazioni[1], []);
  assert.equal((await archivio.leggi()).versioneArchivio, 2);
  assert.deepEqual((await g.risorsePerPi()).skills, []);
});

test("le giunzioni negli antenati non fanno scrivere programmi o registri fuori dalla loro radice", async (t) => {
  const radice = await temporaneo(t);
  const esterna = join(radice, "esterna");
  await mkdir(esterna);
  const profilo = join(radice, "home");
  await mkdir(join(profilo, ".pi"), { recursive: true });
  await symlink(esterna, join(profilo, ".pi", "gui"), process.platform === "win32" ? "junction" : "dir");
  const archivio = creaArchivioEstensioni({ home: profilo });
  await assert.rejects(archivio.leggi(), /Collegamento|giunzione|reindirizzato/u);
  await assert.rejects(archivio.salva({ schemaVersion: 1, versioneArchivio: 0, estensioni: [], risorsePersonali: [] }, 0), /Collegamento|giunzione|reindirizzato/u);
  assert.deepEqual(await readdir(esterna), []);
  const fonte = await pacchetto(radice);
  const local = join(radice, "local");
  await mkdir(local);
  await symlink(esterna, join(local, "it.amodeo.interfaccia-pi"), process.platform === "win32" ? "junction" : "dir");
  let copie = 0;
  const g = gestore(radice, { home: join(radice, "altro-home"), osservaCopia: () => copie++ });
  await assert.rejects(g.installa({ cartella: fonte, versioneAttesa: 0 }), /Collegamento|giunzione|reindirizzato/u);
  assert.equal(copie, 0);
  assert.deepEqual(await readdir(esterna), []);
});

test("un ripristino non verificabile sospende le sessioni e conserva il registro precedente", async (t) => {
  const radice = await temporaneo(t);
  let guasto = false;
  let sospensioni = 0;
  let nuovaInEsecuzione = false;
  const g = gestore(radice, { applicaSessioni: async () => {
    if (!guasto) return;
    nuovaInEsecuzione = true;
    const precedente = join(g.radiceProgrammi, "prova", "1.0.0", "skills/prova/SKILL.md");
    await chmod(precedente, 0o600);
    await writeFile(precedente, "Alterazione sintetica della vecchia versione");
    throw new Error("Riavvio sintetico fallito");
  }, sospendiSessioni: async () => { sospensioni++; nuovaInEsecuzione = false; } });
  await g.installa({ cartella: await pacchetto(radice), versioneAttesa: 0 });
  await g.attiva({ id: "prova", attiva: true, versioneAttesa: 1 });
  await g.applica({ versioneAttesa: 2 });
  await g.aggiorna({ cartella: await pacchetto(radice, { versione: "1.1.0" }), versioneAttesa: 3 });
  guasto = true;
  await assert.rejects(g.applica({ versioneAttesa: 4 }), { code: "ESTENSIONI_RIPRISTINO" });
  assert.equal(sospensioni, 1);
  assert.equal(nuovaInEsecuzione, false);
  assert.equal((await g.archivio.leggi()).versioneArchivio, 4);
  assert.equal((await g.archivio.leggi()).estensioni[0].versioneApplicata, "1.0.0");
});

test("una chiave revocata blocca anche il backend gia applicato prima che venga eseguito", async (t) => {
  const radice = await temporaneo(t);
  const revocabile = { ...chiave };
  const g = gestore(radice, { portachiavi: [revocabile] });
  const cartella = await pacchetto(radice, { id: "sistema-guidato", extra: { "backend.mjs": "// Backend sintetico, nessun avvio nel test.\n" }, cambia: (m) => {
    m.categoria = "backend";
    m.backend = { ingresso: "backend.mjs" };
    m.pannelli = [{ id: "sistema-guidato", percorso: "/sistema" }];
  } });
  await g.installa({ cartella, versioneAttesa: 0 });
  assert.equal(await g.backendVerificato(), null);
  await g.attiva({ id: "sistema-guidato", attiva: true, versioneAttesa: 1 });
  await g.applica({ versioneAttesa: 2 });
  assert.equal((await g.backendVerificato()).ingresso, join(g.radiceProgrammi, "sistema-guidato", "1.0.0", "backend.mjs"));
  revocabile.stato = "revocata";
  await assert.rejects(g.backendVerificato(), /revocata/u);
  assert.equal((await g.elenco()).estensioni[0].stato, "Manomessa");
});

test("un file host alterato resta Manomessa e solo il codice di incompatibilita cambia stato", async (t) => {
  const radice = await temporaneo(t);
  const g = gestore(radice);
  await g.installa({ cartella: await pacchetto(radice, { extra: { "hosting/host.md": "Sintetico" } }), versioneAttesa: 0 });
  await g.attiva({ id: "prova", attiva: true, versioneAttesa: 1 });
  await g.applica({ versioneAttesa: 2 });
  const percorso = join(g.radiceProgrammi, "prova", "1.0.0", "hosting", "host.md");
  await chmod(percorso, 0o600);
  await writeFile(percorso, "Alterato!");
  assert.equal((await g.elenco()).estensioni[0].stato, "Manomessa");
  await assert.rejects(g.risorsePerPi(), { code: "ESTENSIONE_MANOMESSA" });
  const incompatibile = gestore(radice, { versioneHost: "3.0.0" });
  assert.equal((await incompatibile.elenco()).estensioni[0].stato, "Non compatibile");
  await assert.rejects(incompatibile.risorsePerPi(), { code: "ESTENSIONE_NON_COMPATIBILE" });
});

test("l'anteprima si ferma al tetto personale ma il digest verifica anche i byte successivi", async (t) => {
  const radice = await temporaneo(t);
  const g = gestore(radice);
  // Il carattere multibyte attraversa il limite dell'anteprima.
  const testo = "a".repeat(MASSIMO_TESTO - 1) + "è\nFine sintetica";
  const stato = await g.installa({ cartella: await pacchetto(radice, { testo }), versioneAttesa: 0 });
  const anteprima = stato.estensioni[0].risorse.find((r) => r.tipo === "skill");
  assert.equal(anteprima.troncata, true);
  assert.equal(anteprima.testo, "a".repeat(MASSIMO_TESTO - 1));
  assert.match(anteprima.messaggio, /troncata.*2 MB/u);
  const percorso = anteprima.percorso;
  await chmod(percorso, 0o600);
  const bytes = await readFile(percorso);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(percorso, bytes);
  assert.equal((await g.elenco()).estensioni[0].stato, "Manomessa");
});

test("una risorsa personale illeggibile non nasconde quelle sane e non diventa applicata", async (t) => {
  const radice = await temporaneo(t);
  const guasta = join(radice, "home", ".agents", "skills", "guasta.md");
  const sana = join(dirname(guasta), "sana.md");
  await mkdir(dirname(guasta), { recursive: true });
  await writeFile(guasta, "Sintetica iniziale");
  await writeFile(sana, "Sintetica valida");
  const g = gestore(radice);
  await g.attiva({ percorso: guasta, attiva: true, versioneAttesa: 0 });
  await g.attiva({ percorso: sana, attiva: true, versioneAttesa: 1 });
  await g.applica({ versioneAttesa: 2 });
  await writeFile(guasta, Buffer.from([0xff, 0xfe]));
  assert.deepEqual((await g.risorsePerPi()).skills, [sana]);
  let stato = await g.elenco();
  assert.equal(stato.risorsePersonali.find((r) => r.percorso === sana).stato, "Verificata");
  assert.equal(stato.risorsePersonali.find((r) => r.percorso === guasta).stato, "Da rileggere");
  stato = await g.applica({ versioneAttesa: 3 });
  assert.equal(stato.risorsePersonali.find((r) => r.percorso === guasta).attivaApplicata, false);
  assert.equal(stato.risorsePersonali.find((r) => r.percorso === guasta).statoApplicazione, "Da applicare");
  assert.deepEqual((await g.risorsePerPi()).skills, [sana]);
  await writeFile(guasta, "b".repeat(MASSIMO_TESTO + 1));
  stato = await g.elenco();
  assert.equal(stato.risorsePersonali.find((r) => r.percorso === sana).stato, "Verificata");
  assert.equal(stato.risorsePersonali.find((r) => r.percorso === guasta).stato, "Da rileggere");
});

test("una verifica concorrente della vecchia risorsa non falsifica quella appena applicata", async (t) => {
  const radice = await temporaneo(t);
  const percorso = join(radice, "home", ".agents", "skills", "prova.md");
  await mkdir(dirname(percorso), { recursive: true });
  await writeFile(percorso, "Sintetica A");
  let concorrente = false;
  const g = gestore(radice, { applicaSessioni: async (risorse, riverifica) => {
    assert.deepEqual(risorse, await riverifica());
    if (concorrente) assert.deepEqual((await g.risorsePerPi()).skills, []);
  } });
  await g.attiva({ percorso, attiva: true, versioneAttesa: 0 });
  await g.applica({ versioneAttesa: 1 });
  await writeFile(percorso, "Sintetica B");
  await g.attiva({ percorso, attiva: true, versioneAttesa: 2 });
  concorrente = true;
  const stato = await g.applica({ versioneAttesa: 3 });
  assert.equal(stato.risorsePersonali[0].attivaApplicata, true);
  assert.equal(stato.risorsePersonali[0].statoApplicazione, "Applicata");
  assert.deepEqual((await g.risorsePerPi()).skills, [percorso]);
});

test("l'apertura raccoglie residui abbandonati senza cancellare versioni o operazioni vive", async (t) => {
  const radice = await temporaneo(t);
  const programmi = join(radice, "programmi");
  const staging = join(programmi, "prova", ".staging-legacy");
  const cestino = join(programmi, ".rimozione-legacy");
  const vivo = join(programmi, "prova", `.staging-${process.pid}-${Date.now()}-vivo`);
  const recente = join(programmi, "prova", ".staging-recente");
  const versione = join(programmi, "prova", "1.0.0");
  for (const p of [staging, cestino, vivo, recente, versione]) {
    await mkdir(p, { recursive: true });
    await writeFile(join(p, "testo.txt"), "Sintetico conservato");
  }
  const vecchio = new Date(Date.now() - 10 * 60 * 1000);
  for (const p of [staging, cestino, vivo]) await utimes(p, vecchio, vecchio);
  const g = gestore(radice, { radiceProgrammi: programmi });
  await g.elenco();
  await assert.rejects(lstat(staging), { code: "ENOENT" });
  await assert.rejects(lstat(cestino), { code: "ENOENT" });
  for (const p of [vivo, recente, versione]) assert.equal(await readFile(join(p, "testo.txt"), "utf8"), "Sintetico conservato");
});

test("il modulo del pannello calcola gli stati e l'anteprima delle risorse senza toccare il documento", async () => {
  const codice = await readFile(new URL("../app/public/estensioni-core.js", import.meta.url), "utf8");
  const contesto = { module: { exports: {} } };
  Object.defineProperty(contesto, "document", { get() { throw new Error("Accesso al documento globale vietato"); } });
  vm.runInNewContext(codice, contesto);
  const api = contesto.module.exports;
  const integrale = "Prima riga\n<script>sintetico</script>\nUltima riga con accenti: è già così.\n";
  const risposta = { versioneArchivio: 7, estensioni: [{ id: "prova", versioneInstallata: "1.1.0", versioneApplicata: null,
    versioniPresenti: ["1.0.0", "1.1.0"], attiva: true, attivaApplicata: false, statoApplicazione: "Da applicare",
    risorse: [{ tipo: "skill", percorso: "/pacchetto/SKILL.md", origine: "/fonte", testo: integrale }] }],
  risorsePersonali: [{ tipo: "skill", percorso: "/personale/SKILL.md", origine: "/personale", testo: integrale }] };
  const vista = api.creaVistaEstensioni(risposta);
  assert.equal(vista.estensioni[0].stato, "Da applicare");
  assert.equal(vista.estensioni[0].risorse[0].testo, integrale);
  assert.equal(vista.estensioni[0].risorse[0].origine, "/fonte");
  assert.equal(vista.risorsePersonali[0].testo, integrale);
  assert.equal(vista.risorsePersonali[0].attiva, false);
  assert.equal(api.statoEstensione({ stato: "Manomessa" }), "Manomessa");
  assert.equal(api.statoEstensione({ stato: "Manomessa", rimovibile: false }), "Manomessa");
  assert.equal(api.statoEstensione({ stato: "Non compatibile", rimovibile: false }), "Non compatibile");
  assert.equal(api.statoEstensione({ attiva: true, attivaApplicata: true, rimovibile: false }), "In uso, non rimovibile adesso");
  assert.equal(api.statoEstensione({ attiva: false, attivaApplicata: false }), "Disattiva");
  assert.ok(vista.avvisi.some((a) => a.includes("provenienza e integrità, non confinamento")));
  assert.ok(vista.avvisi.some((a) => a.includes("prima dei filtri")));
  assert.match(codice, /btn-estensioni/u);
  assert.match(codice, /pannello-estensioni/u);
  assert.doesNotMatch(codice, /stati-estensioni|innerHTML/u);
  assert.throws(() => api.montaEstensioni(null, null), /È necessario fornire/u);

  const documentoLocale = {
    createElement(tag) {
      const nodo = { tagName: tag.toUpperCase(), ownerDocument: this, children: [], attributi: {}, eventi: {}, parentNode: null,
        append(...figli) { for (const figlio of figli) { figlio.parentNode = this; this.children.push(figlio); } },
        replaceChildren(...figli) { for (const figlio of this.children) figlio.parentNode = null; this.children = []; this.append(...figli); },
        setAttribute(nome, valore) { this.attributi[nome] = String(valore); },
        removeAttribute(nome) { delete this.attributi[nome]; },
        addEventListener(nome, funzione) { this.eventi[nome] = funzione; },
        focus() { this.ownerDocument.attivo = this; },
        remove() { this.parentNode.children = this.parentNode.children.filter((figlio) => figlio !== this); this.parentNode = null; },
      };
      let contenuto = "";
      Object.defineProperty(nodo, "textContent", {
        get() { return contenuto + this.children.map((figlio) => figlio.textContent).join(""); },
        set(valore) { contenuto = String(valore); this.replaceChildren(); },
      });
      Object.defineProperty(nodo, "innerHTML", { set() { throw new Error("Il testo delle risorse non deve essere interpretato come HTML"); } });
      return nodo;
    },
  };
  const contenitore = documentoLocale.createElement("div");
  const discendenti = (nodo) => [nodo, ...nodo.children.flatMap(discendenti)];
  const chiamate = [];
  const pannello = api.montaEstensioni(contenitore, {
    elenco: async () => { chiamate.push({ nome: "elenco" }); return risposta; },
    applica: async (dati) => { chiamate.push({ nome: "applica", dati: { ...dati } }); return risposta; },
  });
  assert.equal(contenitore.children.length, 1);
  assert.equal(chiamate.length, 0);
  await pannello.apri();
  assert.equal(chiamate[0].nome, "elenco");
  const sezione = discendenti(contenitore).find((nodo) => nodo.id === "pannello-estensioni");
  const pulsante = discendenti(contenitore).find((nodo) => nodo.id === "btn-estensioni");
  assert.equal(sezione.hidden, false);
  assert.equal(pulsante.attributi["aria-expanded"], "true");
  assert.equal(discendenti(sezione).filter((nodo) => nodo.tagName === "PRE" && nodo.textContent === integrale).length, 2);
  assert.equal(discendenti(sezione).some((nodo) => nodo.tagName === "SCRIPT"), false);
  await discendenti(sezione).find((nodo) => nodo.tagName === "BUTTON" && nodo.textContent === "Applica").eventi.click();
  assert.deepEqual(chiamate[1], { nome: "applica", dati: { versioneAttesa: 7 } });
  const messaggioTroncata = "Anteprima troncata al limite di lettura: apri il file per leggere il contenuto completo.";
  await pannello.aggiorna({ ...risposta, estensioni: [{ ...risposta.estensioni[0], rimovibile: false,
    risorse: [{ ...risposta.estensioni[0].risorse[0], troncata: true, messaggio: messaggioTroncata }] }] });
  assert.match(sezione.textContent, /In uso, non rimovibile adesso/u);
  assert.equal(discendenti(sezione).find((nodo) => nodo.tagName === "BUTTON" && nodo.textContent === "Rimuovi").disabled, true);
  assert.ok(discendenti(sezione).some((nodo) => nodo.tagName === "P" && nodo.textContent === messaggioTroncata));
  assert.equal(api.anteprimaRisorsa({ troncata: true }).troncata, true);
  await pannello.aggiorna({ ...risposta, risorsePersonali: [{ ...risposta.risorsePersonali[0], troncata: true }] });
  assert.match(sezione.textContent, /Anteprima troncata: il testo supera il limite di lettura\./u);
  let propagazioneFermata = false;
  sezione.eventi.keydown({ key: "Escape", stopPropagation() { propagazioneFermata = true; } });
  assert.equal(propagazioneFermata, true);
  assert.equal(sezione.hidden, true);
  assert.equal(documentoLocale.attivo, pulsante);
  pannello.distruggi();
  assert.equal(contenitore.children.length, 0);
});
