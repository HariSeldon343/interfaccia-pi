import assert from "node:assert/strict";
import { createHash, sign } from "node:crypto";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { NOME_FIRMA } from "../../app/estensioni-manifest.mjs";
import { prepara as preparaBase, verifica as verificaBase } from "./scenario-base.mjs";

export async function prepara(contesto) {
  const base = await preparaBase(contesto);
  const cartelle = {};
  async function pacchetto(nome, { versione = "1.0.0", chiave = "attiva", id = "prova-estensioni", pannello = false,
    extra = false, senzaFirma = false, oltreTetti = false } = {}) {
    const directory = join(contesto.temporanea, "pacchetti", nome);
    await mkdir(join(directory, "skills", "prova"), { recursive: true });
    await mkdir(join(directory, "prompts"), { recursive: true });
    const pi = { skills: ["skills/prova/SKILL.md"], prompts: ["prompts/prova.md"], extensions: [], themes: [] };
    const contenuti = {
      "package.json": JSON.stringify({ name: id, version: versione, pi }),
      "skills/prova/SKILL.md": "---\nname: prova-estensioni\ndescription: Fixture sintetica\n---\n\nTesto sintetico per l’anteprima.\n",
      "prompts/prova.md": "---\ndescription: Modello sintetico di prova\n---\n\nCampo vuoto: [testo sintetico].\n",
    };
    if (pannello) contenuti["server.mjs"] = "// Backend sintetico: questo pacchetto deve essere rifiutato senza avviarlo.\n";
    for (const [nomeFile, testo] of Object.entries(contenuti)) await writeFile(join(directory, nomeFile), testo);
    const manifesto = { schemaVersion: 1, id, nome: "Estensione di prova", versione,
      editore: "Prova isolata", descrizione: "Contenuto sintetico", categoria: pannello ? "backend" : "risorse",
      host: { minInclusa: "2.9.0", maxEsclusa: "3.0.0" },
      pi, pannelli: pannello ? [{ id: "sistema-guidato", percorso: "/sistema" }] : [],
      backend: pannello ? { ingresso: "server.mjs" } : null, limiti: {}, chiaveId: `prova-${chiave}`,
      files: Object.entries(contenuti).map(([percorso, testo]) => ({ percorso, byte: Buffer.byteLength(testo), sha256: createHash("sha256").update(testo).digest("hex") })),
    };
    if (oltreTetti) manifesto.files[0].byte = 512 * 1024 * 1024 + 1;
    const byte = Buffer.from(JSON.stringify(manifesto, null, 2) + "\n");
    await writeFile(join(directory, "manifesto-estensione.json"), byte);
    if (!senzaFirma) await writeFile(join(directory, NOME_FIRMA), sign(null, byte, contesto.chiavi[chiave].privateKey).toString("base64"));
    if (extra) await writeFile(join(directory, "file-imprevisto.md"), "Contaminazione sintetica");
    cartelle[nome] = directory;
  }
  await pacchetto("pulito");
  await pacchetto("aggiornamento", { versione: "1.1.0" });
  await pacchetto("precedente", { versione: "0.9.0" });
  for (const [nome, configurazione] of Object.entries({
    "file-in-piu": { extra: true }, "firma-assente": { senzaFirma: true },
    "chiave-sconosciuta": { chiave: "sconosciuta" }, "chiave-revocata": { chiave: "revocata" }, "oltre-tetti": { oltreTetti: true },
    "pannello-terza-parte": { chiave: "terza-parte", id: "sistema-guidato", pannello: true },
    "pannello-altro-id": { id: "altro-pannello", pannello: true },
  })) await pacchetto(nome, configurazione);
  return { ...base, cartelle, istruzioni: [...base.istruzioni,
    ...Object.entries(cartelle).map(([nome, percorso]) => `${nome}: ${percorso}`),
    "Installa pulito, leggi il testo integrale della skill e del prompt, attiva e applica; poi disattiva e applica, aggiorna e rimuovi.",
    "I cinque rifiuti e i due pannelli non consentiti sono verificati con stato HTTP 400 e motivo specifico.",
    "Il ritorno richiede la voce esplicita e la conferma scritta; Aggiorna rifiuta la versione precedente.",
    "P1 espone gli endpoint; il pannello verrà montato da P3.",
  ] };
}

export async function verifica(contesto) {
  await verificaBase(contesto);
  const { api, fixture, ponte } = contesto;
  const iniziale = await api("/api/estensioni");
  assert.equal(iniziale.stato, 200);
  assert.deepEqual(iniziale.corpo.estensioni, [], "la prova inizia senza estensioni");
  const versioneAttesa = iniziale.corpo.versioneArchivio;
  const fileRegistro = join(contesto.home, ".pi", "gui", "estensioni.json");
  const prima = await readFile(fileRegistro).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
  const rifiuti = [
    ["file-in-piu", /Inventario divergente.*file-imprevisto\.md/u],
    ["firma-assente", /File o cartella assente: .*manifest\.sig/u],
    ["chiave-sconosciuta", /Chiave di firma sconosciuta: prova-sconosciuta/u],
    ["chiave-revocata", /Chiave di firma revocata: prova-revocata/u],
    ["oltre-tetti", /Pacchetto oltre il limite di byte/u],
    ["pannello-terza-parte", /pannelli sono riservati al solo Sistema Guidato firmato di prima parte/u],
    ["pannello-altro-id", /pannelli sono riservati al solo Sistema Guidato firmato di prima parte/u],
  ];
  for (const [nome, motivo] of rifiuti) {
    const esito = await api("/api/estensioni/installa", { cartella: fixture.cartelle[nome], versioneAttesa });
    assert.equal(esito.stato, 400, `${nome}: rifiuto del pacchetto, senza errore del ponte`);
    assert.match(esito.corpo.errore || esito.corpo.messaggio || "", motivo, `${nome}: motivo del rifiuto`);
    const dopo = await readFile(fileRegistro).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
    assert.deepEqual(dopo, prima, `${nome}: registro invariato`);
    assert.equal((await api("/api/estensioni")).corpo.versioneArchivio, versioneAttesa);
    const programmi = ponte.estensioni.radiceProgrammi;
    const presenti = await readdir(programmi).catch((e) => { if (e.code === "ENOENT") return []; throw e; });
    assert.deepEqual(presenti, [], `${nome}: nessuna pubblicazione`);
    console.log(`PASS ${nome}: ${esito.corpo.errore || esito.corpo.messaggio}`);
  }
  let stato = iniziale.corpo;
  async function mutazione(azione, corpo = {}) {
    const esito = await api(`/api/estensioni/${azione}`, { ...corpo, versioneAttesa: stato.versioneArchivio });
    assert.equal(esito.stato, 200, `${azione}: ${esito.corpo.errore || esito.corpo.messaggio || "esito positivo atteso"}`);
    stato = esito.corpo;
    return stato;
  }
  const vuote = { skills: [], prompts: [], themes: [] };
  assert.deepEqual(await ponte.estensioni.risorsePerPi(), vuote);
  await mutazione("installa", { cartella: fixture.cartelle.pulito });
  const installata = stato.estensioni.find((voce) => voce.id === "prova-estensioni");
  assert.ok(installata, "il pacchetto pulito si installa attraverso lo stesso endpoint dei rifiuti");
  assert.equal(installata.attiva, false);
  for (const [tipo, relativo] of [["skill", "skills/prova/SKILL.md"], ["prompt", "prompts/prova.md"]]) {
    const risorsa = installata.risorse.find((voce) => voce.tipo === tipo);
    const percorso = join(ponte.estensioni.radiceProgrammi, "prova-estensioni", "1.0.0", relativo);
    assert.equal(risorsa?.percorso, percorso, `${tipo}: percorso dell'anteprima`);
    assert.equal(risorsa.origine, join(ponte.estensioni.radiceProgrammi, "prova-estensioni", "1.0.0"));
    assert.equal(risorsa.testo, await readFile(join(fixture.cartelle.pulito, relativo), "utf8"), `${tipo}: testo integrale prima dell'attivazione`);
  }
  await mutazione("attiva", { id: "prova-estensioni", attiva: true });
  assert.deepEqual(await ponte.estensioni.risorsePerPi(), vuote, "l'attivazione desiderata resta da applicare");
  await mutazione("applica");
  assert.deepEqual(await ponte.estensioni.risorsePerPi(), {
    skills: [join(ponte.estensioni.radiceProgrammi, "prova-estensioni", "1.0.0", "skills/prova/SKILL.md")],
    prompts: [join(ponte.estensioni.radiceProgrammi, "prova-estensioni", "1.0.0", "prompts/prova.md")], themes: [],
  });
  await mutazione("attiva", { id: "prova-estensioni", attiva: false });
  await mutazione("applica");
  assert.deepEqual(await ponte.estensioni.risorsePerPi(), vuote);
  await mutazione("aggiorna", { cartella: fixture.cartelle.aggiornamento });
  assert.equal(stato.estensioni[0].versioneInstallata, "1.1.0");
  const precedente = await api("/api/estensioni/aggiorna", { cartella: fixture.cartelle.precedente, versioneAttesa: stato.versioneArchivio });
  assert.equal(precedente.stato, 400);
  assert.match(precedente.corpo.errore || "", /Versione precedente o già installata/u);
  await mutazione("torna-versione", { id: "prova-estensioni", versione: "1.0.0", conferma: "Torna a 1.0.0" });
  assert.equal(stato.estensioni[0].versioneInstallata, "1.0.0");
  await mutazione("rimuovi", { id: "prova-estensioni" });
  assert.deepEqual(stato.estensioni, [], "il browser resta senza pacchetti installati dopo il controllo positivo");
  assert.deepEqual(await ponte.estensioni.risorsePerPi(), vuote);
  assert.equal(await readFile(fixture.percorso, "utf8"), fixture.testo, "la risorsa personale resta intatta e disattivata");
  assert.equal(stato.risorsePersonali.find((voce) => voce.percorso === fixture.percorso)?.attiva, false);
  console.log("PASS pacchetto pulito: skill e prompt leggibili, attivazione esplicita, aggiornamento, ritorno confermato e rimozione completati.");
}
