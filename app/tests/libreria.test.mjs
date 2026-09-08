import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { creaGestoreLibreria, quotaOperazioneConsentita, MASSIMO_FILE_OPERAZIONE, MASSIMO_BYTE_OPERAZIONE } from "../libreria.mjs";
import { creaPonte } from "../server.mjs";
import ALLEGATI from "../public/attachment-core.js";
import LIBRERIA_CORE from "../public/library-core.js";
import { creaSerializzatore, scriviFileAtomico } from "../persistenza-atomica.mjs";
import { estraiDocumento } from "../estrazione.mjs";
import { creaGestoreEstrazione } from "../estrazione-worker.mjs";
import { docxMinimo, pdfMinimo } from "../../tests/fixture-documenti.mjs";

const TEMPORANEI = resolve(".tmp-test");
const impronta = (tipo, dati) => createHash(tipo).update(dati).digest("hex");

async function prepara(t, opzioni = {}) {
  await mkdir(TEMPORANEI, { recursive: true });
  const base = await mkdtemp(join(TEMPORANEI, "libreria-"));
  const home = join(base, "home");
  const cartella = join(base, "workspace");
  await mkdir(home);
  await mkdir(cartella);
  if (opzioni.pulisci !== false) t.after(() => rm(base, { recursive: true, force: true }));
  const sessione = { id: randomUUID(), cartella, senzaCartella: false };
  const gestore = creaGestoreLibreria({ home, estrai: (_id, documento) => estraiDocumento(documento), ...opzioni });
  const aggiungi = (nome, contenuto = nome, altre = {}) => gestore.indicizza(sessione, {
    nome, percorsoRelativo: nome, mimeType: "application/octet-stream", dati: Buffer.isBuffer(contenuto) ? contenuto : Buffer.from(contenuto), ...altre,
  });
  return { base, home, cartella, sessione, gestore, aggiungi };
}

test("libreria: copia testo, DOCX e PDF con indice, sidecar e riferimenti testuali", async (t) => {
  const { cartella, aggiungi, gestore, sessione } = await prepara(t);
  const testo = await aggiungi("Norma è.txt", "contenuto à", { percorsoRelativo: "Origine/Norma è.txt", mimeType: "text/plain" });
  assert.equal(testo.esito, "indicizzato");
  assert.match(testo.avvisi.join(" "), /indice.*assente/i);
  assert.equal(testo.voce.percorso, join(cartella, "raw", "normativa", "norma-e.txt"));
  assert.equal(testo.voce.percorso_relativo_origine, "Origine/Norma è.txt");
  assert.equal(testo.voce.testo, null);
  assert.equal(testo.voce.estrazione.parser, "testo-originale");
  assert.equal(testo.riferimento.percorso, testo.voce.percorso);
  assert.equal(testo.riferimento.dimensione, Buffer.byteLength("contenuto à"));
  for (const [nome, dati, atteso] of [["Rapporto.docx", docxMinimo(), "DOCX"], ["Manuale.pdf", pdfMinimo(), "PDF"]]) {
    const risultato = await aggiungi(nome, dati);
    assert.equal(risultato.voce.estrazione.stato, "ok", risultato.voce.estrazione.motivo);
    assert.equal(risultato.voce.testo, risultato.voce.percorso + ".testo.md");
    assert.deepEqual(await readFile(risultato.voce.percorso), dati);
    const contenuto = await readFile(risultato.voce.testo, "utf8");
    assert.match(contenuto, new RegExp("Testo " + atteso + " verificato"));
    assert.equal(risultato.riferimento.percorso, risultato.voce.testo);
    assert.equal(risultato.riferimento.mimeType, "text/markdown");
    assert.equal(risultato.riferimento.dimensione, Buffer.byteLength(contenuto));
  }
  const stato = await gestore.stato(sessione);
  assert.equal(stato.numero, 3);
  assert.equal(stato.ultime.length, 3);
  assert.equal(stato.radice, cartella);
  assert.equal(stato.percorsoIndice, join(cartella, ".ingest-index.json"));
  assert.equal(JSON.parse(await readFile(stato.percorsoIndice, "utf8")).versione, 1);
});

test("libreria: dedupe e collisione MD5 verificano anche SHA256", async (t) => {
  const { aggiungi, cartella } = await prepara(t);
  const primo = await aggiungi("prima.txt", "primo");
  const duplicato = await aggiungi("altro nome.txt", "primo");
  assert.equal(duplicato.esito, "duplicato");
  assert.equal(duplicato.voce.percorso, primo.voce.percorso);
  const percorsoIndice = join(cartella, ".ingest-index.json");
  const indice = JSON.parse(await readFile(percorsoIndice, "utf8"));
  const md5 = impronta("md5", "secondo");
  indice.voci = { [md5]: primo.voce };
  await writeFile(percorsoIndice, JSON.stringify(indice));
  const secondo = await aggiungi("seconda.txt", "secondo");
  assert.equal(secondo.esito, "indicizzato");
  const aggiornato = JSON.parse(await readFile(percorsoIndice, "utf8"));
  assert.equal(Object.keys(aggiornato.voci).length, 2);
  assert.equal(aggiornato.voci[md5].sha256, primo.voce.sha256);
  assert.equal(aggiornato.voci[md5 + "-" + impronta("sha256", "secondo")].percorso, secondo.voce.percorso);
});

test("libreria: collisioni raw e sidecar non indicizzati conservano i file esistenti", async (t) => {
  const { aggiungi, cartella } = await prepara(t);
  const directory = join(cartella, "raw", "documenti");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "dato.docx"), "precedente");
  await writeFile(join(directory, "dato-v2.docx.testo.md"), "sidecar precedente");
  const risultato = await aggiungi("Dato.docx", docxMinimo());
  assert.equal(risultato.voce.percorso, join(directory, "dato-v3.docx"));
  assert.equal(await readFile(join(directory, "dato.docx"), "utf8"), "precedente");
  assert.equal(await readFile(join(directory, "dato-v2.docx.testo.md"), "utf8"), "sidecar precedente");
  const secondo = await aggiungi("Dato.docx", docxMinimo("altro"));
  assert.equal(secondo.voce.percorso, join(directory, "dato-v4.docx"));
});

test("libreria: raw orfano ripara l'indice e conserva sidecar e scheda esistenti senza v2", async (t) => {
  let estrazioni = 0;
  const { aggiungi, cartella } = await prepara(t, { estrai: (_id, documento) => {
    if (++estrazioni > 1) throw new Error("Parser non disponibile al ritentativo");
    return estraiDocumento(documento);
  } });
  const wiki = join(cartella, "wiki", "sources");
  await mkdir(wiki, { recursive: true });
  const dati = docxMinimo();
  const primo = await aggiungi("Dato.docx", dati);
  const scheda = join(wiki, "dato-docx.md");
  const testoScheda = await readFile(scheda, "utf8") + "\nNota editoriale conservata.\n";
  await writeFile(scheda, testoScheda);
  const sidecar = await readFile(primo.voce.testo);
  const indice = JSON.parse(await readFile(primo.percorsoIndice, "utf8"));
  delete indice.voci[impronta("md5", dati)];
  await writeFile(primo.percorsoIndice, JSON.stringify(indice));
  const risultato = await aggiungi("Dato.docx", dati);
  assert.equal(risultato.esito, "duplicato");
  assert.equal(risultato.motivo, "indice riparato");
  assert.equal(risultato.voce.percorso, primo.voce.percorso);
  assert.equal(estrazioni, 1, "Il sidecar valido deve essere riutilizzato senza dipendere dal parser.");
  assert.deepEqual(risultato.voce.estrazione, primo.voce.estrazione);
  assert.deepEqual(risultato.riferimento, primo.riferimento);
  assert.deepEqual(await readdir(join(cartella, "raw", "documenti")), ["dato.docx", "dato.docx.testo.md"]);
  assert.deepEqual(await readFile(primo.voce.testo), sidecar);
  assert.deepEqual(await readdir(wiki), ["dato-docx.md"]);
  assert.equal(await readFile(scheda, "utf8"), testoScheda);
  assert.deepEqual(JSON.parse(await readFile(primo.percorsoIndice, "utf8")).voci[impronta("md5", dati)], risultato.voce);
});

test("libreria: indice fallito dopo raw, sidecar o wiki viene riparato rigenerando gli artefatti mancanti", async (t) => {
  for (const interruzione of ["raw", "sidecar", "indice"]) {
    let fallisci = true;
    const { aggiungi, cartella } = await prepara(t, { scriviAtomico: async (percorso, contenuto, opzioni) => {
      if (fallisci && percorso.endsWith(".ingest-index.json")) throw new Error("Disco pieno");
      await scriviFileAtomico(percorso, contenuto, opzioni);
      if (fallisci && ((interruzione === "raw" && percorso.endsWith(".docx"))
        || (interruzione === "sidecar" && percorso.endsWith(".testo.md")))) throw new Error("Disco pieno");
    } });
    const wiki = join(cartella, "wiki", "sources");
    await mkdir(wiki, { recursive: true });
    await assert.rejects(aggiungi("Dato.docx", docxMinimo()), /Disco pieno/);
    fallisci = false;
    const risultato = await aggiungi("Dato.docx", docxMinimo());
    assert.equal(risultato.esito, "duplicato", interruzione);
    assert.equal(risultato.motivo, "indice riparato");
    assert.equal(risultato.voce.percorso, join(cartella, "raw", "documenti", "dato.docx"));
    assert.match(await readFile(risultato.voce.testo, "utf8"), /Testo DOCX verificato/);
    assert.deepEqual(await readdir(wiki), ["dato-docx.md"]);
    assert.equal(Object.keys(JSON.parse(await readFile(risultato.percorsoIndice, "utf8")).voci).length, 1);
  }
});

test("libreria: indice corrotto o schema non valido viene ricreato senza cancellare documenti", async (t) => {
  const { aggiungi, cartella } = await prepara(t);
  const primo = await aggiungi("dato.txt", "prima");
  for (const corrotto of ["{rotto", JSON.stringify({ versione: 1, voci: { errata: {} } })]) {
    await writeFile(join(cartella, ".ingest-index.json"), corrotto);
    const risultato = await aggiungi("dato.txt", corrotto);
    assert.match(risultato.avvisi.join(" "), /indice.*corrotto/i);
    assert.notEqual(risultato.voce.percorso, primo.voce.percorso);
    assert.equal(await readFile(primo.voce.percorso, "utf8"), "prima");
  }
});

test("libreria: radice, raw, indice, wiki e sources rifiutano junction o symlink", async (t) => {
  for (const bersaglio of ["radice", "raw", ".ingest-index.json", "wiki", "wiki/sources"]) {
    const { base, cartella, sessione, gestore } = await prepara(t);
    const fuori = join(base, "esterno");
    await mkdir(fuori);
    let percorso = bersaglio === "radice" ? join(base, "collegamento") : join(cartella, bersaglio);
    if (bersaglio === "wiki/sources") await mkdir(join(cartella, "wiki"));
    await symlink(fuori, percorso, process.platform === "win32" ? "junction" : "dir");
    if (bersaglio === "radice") sessione.cartella = percorso;
    await assert.rejects(gestore.indicizza(sessione, { nome: "dato.txt", percorsoRelativo: "dato.txt", mimeType: "text/plain", dati: Buffer.from("dato") }), (errore) => errore.statusHttp === 409, bersaglio);
    assert.deepEqual(await readdir(fuori), [], "nessuna scrittura oltre " + bersaglio);
  }
});

test("libreria: due sessioni e due gestori sulla stessa radice non perdono aggiornamenti", async (t) => {
  const { home, sessione, gestore } = await prepara(t);
  const altro = creaGestoreLibreria({ home, estrai: (_id, documento) => estraiDocumento(documento) });
  const seconda = { ...sessione, id: randomUUID() };
  await Promise.all(Array.from({ length: 12 }, (_, indice) => (indice % 2 ? gestore : altro).indicizza(indice % 2 ? sessione : seconda, {
    nome: "dato " + indice + ".txt", percorsoRelativo: "dato " + indice + ".txt", mimeType: "text/plain", dati: Buffer.from(String(indice)),
  })));
  const stato = await gestore.stato(sessione);
  assert.equal(stato.numero, 12);
  assert.equal(stato.ultime.length, 10);
});

test("libreria: wiki opzionale, nome indipendente, wx ed escape frontmatter", async (t) => {
  const { aggiungi, cartella } = await prepara(t);
  await aggiungi("primo.txt", "prima");
  await assert.rejects(readFile(join(cartella, "wiki", "sources", "primo-txt.md")), { code: "ENOENT" });
  const wiki = join(cartella, "wiki", "sources");
  await mkdir(wiki, { recursive: true });
  await writeFile(join(wiki, "dato-docx.md"), "scheda già presente");
  const risultato = await aggiungi("Dato.docx", docxMinimo("parola ".repeat(350)));
  const scheda = await readFile(join(wiki, "dato-docx-v2.md"), "utf8");
  assert.match(scheda, /type: source/);
  assert.match(scheda, /fonte_primaria: "\[\[raw\/documenti\/dato.docx\]\]"/);
  assert.match(scheda, /parser: "office-xml DOCX"/);
  assert.equal(scheda.split("## Sintesi provvisoria\n\n")[1].trim().split(/\s+/).length, 300);
  assert.equal(await readFile(join(wiki, "dato-docx.md"), "utf8"), "scheda già presente");
  assert.equal((await aggiungi("altro.docx", docxMinimo("parola ".repeat(350)))).esito, "duplicato");
  assert.equal((await readdir(wiki)).length, 2);
  await aggiungi("Nome \"doppio\".txt", "à");
  assert.match(await readFile(join(wiki, "nome-doppio-txt.md"), "utf8"), /title: "Nome \\"doppio\\".txt"/);
  assert.ok(risultato.voce.testo);
});

test("libreria: senza cartella usa home esplicita, unsupported ed errori non riferiscono binari", async (t) => {
  const { home, sessione, gestore } = await prepara(t);
  sessione.senzaCartella = true;
  sessione.cartella = null;
  for (const [nome, dati, statoAtteso] of [["dato.bin", Buffer.from([0, 1]), "non-supportato"], ["rotto.docx", Buffer.from("rotto"), "errore"]]) {
    const risultato = await gestore.indicizza(sessione, { nome, percorsoRelativo: nome, mimeType: "application/octet-stream", dati });
    assert.equal(risultato.radice, join(home, ".pi", "gui", "libreria"));
    assert.equal(risultato.voce.estrazione.stato, statoAtteso);
    assert.equal(risultato.riferimento, null);
    assert.equal(risultato.voce.testo, null);
    assert.deepEqual(await readFile(risultato.voce.percorso), dati);
  }
});

test("libreria: estrazione annullata non pubblica file né indice", async (t) => {
  const { aggiungi, cartella } = await prepara(t, { estrai: async () => ({ stato: "errore", annullata: true, motivo: "Chiusura" }) });
  await assert.rejects(aggiungi("dato.docx", docxMinimo()), (errore) => errore.statusHttp === 409);
  await assert.rejects(readFile(join(cartella, ".ingest-index.json")), { code: "ENOENT" });
  await assert.rejects(readFile(join(cartella, "raw", "documenti", "dato.docx")), { code: "ENOENT" });
});

test("libreria: chiusura fra il primo controllo e la lettura indice impedisce l'estrazione", async (t) => {
  const estrazione = creaGestoreEstrazione();
  let avvii = 0;
  let chiusura;
  let controlli = 0;
  const { aggiungi, cartella, sessione } = await prepara(t, {
    iniziaPreparazione: estrazione.iniziaPreparazione,
    estrai: (...argomenti) => { avvii += 1; return estrazione.estrai(...argomenti); },
  });
  await assert.rejects(aggiungi("dato.docx", docxMinimo(), { ancoraValida: () => {
    if (++controlli === 1) { chiusura = estrazione.chiudiSessione(sessione.id); return true; }
    return false;
  } }), (errore) => errore.statusHttp === 409);
  await chiusura;
  assert.equal(avvii, 0);
  assert.deepEqual(await readdir(cartella), []);
});

test("persistenza: serializzazione sopravvive a errori e pubblicazione atomica esclusiva", async (t) => {
  const { base } = await prepara(t);
  const file = join(base, "indice.json");
  await scriviFileAtomico(file, "prima");
  await assert.rejects(scriviFileAtomico(file, "seconda", { primaPubblicazione: () => { throw new Error("rifiuto"); } }), /rifiuto/);
  assert.equal(await readFile(file, "utf8"), "prima");
  await assert.rejects(scriviFileAtomico(file, "terza", { esclusivo: true }), { code: "EEXIST" });
  assert.equal(await readFile(file, "utf8"), "prima");
  assert.equal((await readdir(base)).filter((nome) => nome.endsWith(".tmp")).length, 0);
  const serializza = creaSerializzatore();
  await assert.rejects(serializza("radice", () => { throw new Error("fallisce"); }), /fallisce/);
  assert.equal(await serializza("radice", () => "prosegue"), "prosegue");
});

test("libreria: validazione rifiuta SHA256 non stringa e parser testuale dichiarato per un binario", async (t) => {
  const { aggiungi, cartella } = await prepara(t);
  let precedente = await aggiungi("dato.docx", docxMinimo());
  for (const altera of [(voce) => { voce.sha256 = [voce.sha256]; }, (voce) => { voce.testo = null; voce.estrazione.parser = "testo-originale"; }]) {
    const percorso = join(cartella, ".ingest-index.json");
    const indice = JSON.parse(await readFile(percorso, "utf8"));
    altera(Object.values(indice.voci)[0]);
    await writeFile(percorso, JSON.stringify(indice));
    const risultato = await aggiungi("dato.docx", docxMinimo());
    assert.equal(risultato.esito, "duplicato");
    assert.equal(risultato.motivo, "indice riparato");
    assert.match(risultato.avvisi.join(" "), /indice.*corrotto/i);
    assert.ok(risultato.riferimento.percorso.endsWith(".testo.md"));
    assert.equal(risultato.voce.percorso, precedente.voce.percorso);
    precedente = risultato;
  }
});

test("libreria: originale cresciuto oltre limite, collisione directory e suffisso wiki indipendente", async (t) => {
  const { aggiungi, cartella } = await prepara(t);
  const primo = await aggiungi("dato.txt", "uno");
  await writeFile(primo.voce.percorso, Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal((await aggiungi("dato.txt", "uno")).esito, "indicizzato");
  const directory = join(cartella, "raw", "documenti");
  await mkdir(join(directory, "documento.docx"));
  const wiki = join(cartella, "wiki", "sources");
  await mkdir(wiki, { recursive: true });
  await writeFile(join(wiki, "documento-docx.md"), "prima");
  const documento = await aggiungi("documento.docx", docxMinimo());
  assert.equal(documento.voce.percorso, join(directory, "documento-v2.docx"));
  assert.match(await readFile(join(wiki, "documento-docx-v2.md"), "utf8"), /documento-v2.docx/);
});

test("persistenza: guardia prima di scrivere temporaneo e prima di pubblicarlo", async (t) => {
  const { base } = await prepara(t);
  let controlli = 0;
  await scriviFileAtomico(join(base, "guardia.json"), "contenuto", { primaPubblicazione: async () => {
    const temporanei = (await readdir(base)).filter((nome) => nome.endsWith(".tmp"));
    assert.equal(temporanei.length, controlli);
    controlli += 1;
  } });
  assert.equal(controlli, 2);
});

async function preparaApi(t, opzioni = {}) {
  const ambiente = await prepara(t, { pulisci: false });
  const ponte = creaPonte({
    home: ambiente.home,
    radiceSenzaCartella: join(ambiente.base, "senza-cartella"),
    cliPi: resolve("tests/fake-pi.mjs"),
    timeoutStatoIniziale: 3000,
    elencaDiscendenti: async () => [],
    terminaDiscendenti: async () => true,
    ...opzioni,
  });
  await new Promise((risolvi) => ponte.server.listen(0, "127.0.0.1", risolvi));
  t.after(async () => {
    await ponte.chiudiTutto({ definitiva: false });
    await new Promise((risolvi) => ponte.server.close(risolvi));
    await rm(ambiente.base, { recursive: true, force: true });
  });
  const baseUrl = "http://127.0.0.1:" + ponte.server.address().port;
  const post = async (via, corpo, altreIntestazioni = {}) => {
    const risposta = await fetch(baseUrl + via, { method: "POST", headers: {
      "content-type": "application/json", "x-pi-gui-token": ponte.tokenApi, ...altreIntestazioni,
    }, body: JSON.stringify(corpo) });
    return { status: risposta.status, body: await risposta.json() };
  };
  const avvia = async (altre = {}) => {
    const risposta = await post("/api/avvia", { cartella: ambiente.cartella, forzaNuova: true, ...altre });
    assert.equal(risposta.status, 200, JSON.stringify(risposta.body));
    return risposta.body.id;
  };
  return { ...ambiente, ponte, post, avvia, baseUrl };
}

function corpoDocumento(sessionId, nome = "dato.txt", dati = Buffer.from("dato"), operazioneId = randomUUID()) {
  return { sessionId, operazioneId, nome, percorsoRelativo: nome, mimeType: "application/octet-stream", dimensione: dati.length, data: dati.toString("base64") };
}

test("API libreria: entrambe le vie sono POST autenticate e validano campi e tipi", async (t) => {
  const { post, avvia, baseUrl, cartella } = await preparaApi(t);
  const sessionId = await avvia();
  const corpo = corpoDocumento(sessionId);
  for (const via of ["/api/libreria/indicizza", "/api/libreria/stato"]) {
    const dati = via.endsWith("stato") ? { sessionId } : corpo;
    assert.equal((await fetch(baseUrl + via)).status, 405);
    assert.equal((await post(via, dati, { "x-pi-gui-token": "errato" })).status, 403);
    assert.equal((await post(via, dati, { origin: "https://example.test" })).status, 403);
    assert.equal((await post(via, { ...dati, extra: true })).status, 400);
    assert.equal((await post(via, { ...dati, sessionId: null })).status, 400);
    assert.equal((await post(via, { ...dati, sessionId: "inesistente" })).status, 404);
  }
  for (const [campo, valore] of [["nome", 1], ["nome", "a/b.txt"], ["percorsoRelativo", "../dato.txt"], ["percorsoRelativo", "C:\\dato.txt"], ["percorsoRelativo", "dato\n.txt"], ["mimeType", null], ["dimensione", "4"], ["dimensione", -1], ["dimensione", 3], ["data", "!!!!"], ["operazioneId", "breve"]]) {
    const risultato = await post("/api/libreria/indicizza", { ...corpo, [campo]: valore });
    assert.equal(risultato.status, 400, campo + ": " + JSON.stringify(risultato.body));
  }
  const troppoGrande = await post("/api/libreria/indicizza", { ...corpo, dimensione: 10 * 1024 * 1024 + 1 });
  assert.equal(troppoGrande.status, 413);
  assert.equal((await post("/api/libreria/indicizza", corpoDocumento(sessionId, "programma.exe"))).body.motivo, "tipo");
  assert.equal((await post("/api/libreria/indicizza", { ...corpo, percorsoRelativo: "node_modules/dato.txt" })).body.motivo, "cartella");
  assert.equal((await post("/api/libreria/indicizza", { ...corpo, percorsoRelativo: ".git/dato.txt", operazioneId: randomUUID() })).body.esito, "saltato");
  await assert.rejects(readFile(join(cartella, ".ingest-index.json")), { code: "ENOENT" });
});

test("API libreria: ritentativi idempotenti e quote isolate per sessione e operazione", async (t) => {
  const { post, avvia } = await preparaApi(t);
  const sessionId = await avvia();
  const altraSessione = await avvia();
  const corpo = corpoDocumento(sessionId);
  const primo = await post("/api/libreria/indicizza", corpo);
  assert.equal(primo.status, 200, JSON.stringify(primo.body));
  assert.equal(primo.body.esito, "indicizzato");
  assert.deepEqual(await post("/api/libreria/indicizza", corpo), primo);
  assert.equal((await post("/api/libreria/indicizza", { ...corpo, sessionId: altraSessione })).body.esito, "duplicato");
  assert.equal((await post("/api/libreria/indicizza", { ...corpo, operazioneId: randomUUID() })).body.esito, "duplicato");
  const operazioneId = randomUUID();
  for (let numero = 0; numero < 200; numero += 1) {
    const risposta = await post("/api/libreria/indicizza", corpoDocumento(sessionId, "escluso.exe", Buffer.from(String(numero)), operazioneId));
    assert.equal(risposta.status, 200, "file " + numero + ": " + JSON.stringify(risposta.body));
    assert.equal(risposta.body.esito, "saltato");
  }
  assert.equal((await post("/api/libreria/indicizza", corpoDocumento(sessionId, "escluso.exe", Buffer.from("oltre"), operazioneId))).status, 429);
  assert.equal((await post("/api/libreria/indicizza", corpoDocumento(sessionId, "escluso.exe", Buffer.from("0"), operazioneId))).status, 200);
  assert.equal((await post("/api/libreria/indicizza", corpoDocumento(altraSessione, "escluso.exe", Buffer.from("oltre"), operazioneId))).status, 200);
});

test("API libreria: confini esatti di 200 file e 300 MiB senza quote configurabili", () => {
  assert.equal(MASSIMO_FILE_OPERAZIONE, 200);
  assert.equal(MASSIMO_BYTE_OPERAZIONE, 300 * 1024 * 1024);
  assert.deepEqual(quotaOperazioneConsentita({ numero: 199, byte: MASSIMO_BYTE_OPERAZIONE - 1 }, 1), { numero: 200, byte: MASSIMO_BYTE_OPERAZIONE });
  assert.throws(() => quotaOperazioneConsentita({ numero: 200, byte: 0 }, 0), (errore) => errore.statusHttp === 429);
  assert.throws(() => quotaOperazioneConsentita({ numero: 30, byte: MASSIMO_BYTE_OPERAZIONE }, 1), (errore) => errore.statusHttp === 413);
  assert.throws(() => quotaOperazioneConsentita({ numero: -1, byte: 0 }, 1), (errore) => errore.statusHttp === 400);
});

test("API libreria: errore di scrittura ritentabile con stesso operazioneId e stessa quota", async (t) => {
  const { post, avvia, cartella } = await preparaApi(t);
  const sessionId = await avvia();
  const corpo = corpoDocumento(sessionId);
  await mkdir(join(cartella, "raw"));
  const ostacolo = join(cartella, "raw", "documenti");
  await writeFile(ostacolo, "File al posto della categoria");
  const errore = await post("/api/libreria/indicizza", corpo);
  assert.equal(errore.status, 409);
  assert.match(JSON.stringify(errore.body), /Percorso della libreria non sicuro/);
  await rm(ostacolo);
  const riprovato = await post("/api/libreria/indicizza", corpo);
  assert.equal(riprovato.status, 200, JSON.stringify(riprovato.body));
  assert.equal(riprovato.body.esito, "indicizzato");
  assert.deepEqual(await post("/api/libreria/indicizza", corpo), riprovato);
  for (let numero = 1; numero < 200; numero += 1) {
    assert.equal((await post("/api/libreria/indicizza", corpoDocumento(sessionId, "escluso.exe", Buffer.from(String(numero)), corpo.operazioneId))).status, 200);
  }
  assert.equal((await post("/api/libreria/indicizza", corpoDocumento(sessionId, "oltre.exe", Buffer.from("oltre"), corpo.operazioneId))).status, 429);
});

test("API libreria: due sessioni concorrenti indicizzano nella stessa radice senza perdere voci", async (t) => {
  const { post, avvia, cartella } = await preparaApi(t);
  const sessionId = await avvia();
  const seconda = await avvia();
  assert.notEqual(sessionId, seconda);
  const risultati = await Promise.all(Array.from({ length: 6 }, (_, numero) => post("/api/libreria/indicizza", corpoDocumento(numero % 2 ? sessionId : seconda, "dato-" + numero + ".txt", Buffer.from(String(numero))))));
  assert.ok(risultati.every((risultato) => risultato.status === 200), JSON.stringify(risultati));
  const stato = await post("/api/libreria/stato", { sessionId });
  assert.equal(stato.status, 200);
  assert.equal(stato.body.numero, 6);
  assert.equal(stato.body.radice, cartella);
});

test("API libreria: senza cartella rispetta home e radiceSenzaCartella esplicite", async (t) => {
  const { post, avvia, home, base, ponte } = await preparaApi(t);
  const sessionId = await avvia({ cartella: null, senzaCartella: true });
  const risultato = await post("/api/libreria/indicizza", corpoDocumento(sessionId));
  assert.equal(risultato.status, 200, JSON.stringify(risultato.body));
  assert.equal(risultato.body.radice, join(home, ".pi", "gui", "libreria"));
  assert.ok(ponte.sessioni.get(sessionId).directoryLavoro.startsWith(join(base, "senza-cartella")));
  assert.equal((await post("/api/libreria/stato", { sessionId })).body.numero, 1);
});

test("API libreria: Pi finto riceve sidecar PDF e Office, con 12 voci riceve 7 più indice", async (t) => {
  const { post, avvia, ponte } = await preparaApi(t);
  const sessionId = await avvia();
  const risultati = [];
  for (const [nome, dati] of [["Documento.pdf", pdfMinimo()], ["Rapporto.docx", docxMinimo()], ...Array.from({ length: 10 }, (_, numero) => ["dato-" + numero + ".txt", Buffer.from(String(numero))])]) {
    const risposta = await post("/api/libreria/indicizza", corpoDocumento(sessionId, nome, dati));
    assert.equal(risposta.status, 200, JSON.stringify(risposta.body));
    assert.ok(risposta.body.riferimento, JSON.stringify(risposta.body));
    risultati.push(risposta.body);
  }
  const composto = LIBRERIA_CORE.componiVociBlocco([], risultati.map((risultato) => risultato.riferimento), risultati[0].percorsoIndice);
  assert.ok(composto.avviso);
  const testo = ALLEGATI.creaMessaggioConFile("Analizza i documenti.", composto.voci);
  const invio = await post("/api/comando", { sessionId, type: "prompt", id: "libreria-prompt", message: testo });
  assert.equal(invio.status, 200, JSON.stringify(invio.body));
  const messaggi = await ponte.sessioni.get(sessionId).inviaEAttendi({ type: "get_messages" });
  const ricevuto = messaggi.messages.find((messaggio) => messaggio.role === "user");
  const contenuto = typeof ricevuto.content === "string" ? ricevuto.content : ricevuto.content.find((blocco) => blocco.type === "text").text;
  const separato = ALLEGATI.separaMessaggioConFile(contenuto);
  assert.equal(separato.file.length, 8);
  assert.equal(separato.file[7].nome, "indice della libreria");
  assert.equal(separato.file[7].percorso, risultati[0].percorsoIndice);
  assert.ok(separato.file.slice(0, 2).every((voce) => voce.percorso.endsWith(".testo.md")));
  assert.ok(risultati.slice(0, 2).every((voce) => !separato.file.some((file) => file.percorso === voce.voce.percorso)));
});

test("API libreria: chiusura sessione annulla worker e impedisce pubblicazioni tardive", async (t) => {
  let risolviEstrazione;
  let segnalaAvvio;
  const avviata = new Promise((risolvi) => { segnalaAvvio = risolvi; });
  const chiuse = [];
  const gestoreEstrazione = {
    estrai: () => new Promise((risolvi) => { risolviEstrazione = risolvi; segnalaAvvio(); }),
    chiudiSessione: async (id) => { chiuse.push(id); risolviEstrazione?.({ stato: "errore", annullata: true, motivo: "Chiusura" }); },
    chiudi: async () => { risolviEstrazione?.({ stato: "errore", annullata: true, motivo: "Chiusura" }); },
  };
  const { post, avvia, cartella } = await preparaApi(t, { gestoreEstrazione });
  const sessionId = await avvia();
  const pendente = post("/api/libreria/indicizza", corpoDocumento(sessionId, "dato.docx", docxMinimo()));
  await avviata;
  const chiusura = await post("/api/chiudi", { sessionId });
  assert.equal(chiusura.status, 200, JSON.stringify(chiusura.body));
  assert.deepEqual(chiuse, [sessionId]);
  assert.equal((await pendente).status, 409);
  await assert.rejects(readFile(join(cartella, ".ingest-index.json")), { code: "ENOENT" });
});

test("API libreria: durante la terminazione worker rifiuta nuove indicizzazioni", async (t) => {
  let segnalaChiusura;
  let completaChiusura;
  const iniziata = new Promise((risolvi) => { segnalaChiusura = risolvi; });
  const arresto = new Promise((risolvi) => { completaChiusura = risolvi; });
  let estrazioni = 0;
  const gestoreEstrazione = {
    estrai: async (_id, documento) => { estrazioni += 1; return estraiDocumento(documento); },
    chiudiSessione: async () => { segnalaChiusura(); await arresto; },
    chiudi: async () => {},
  };
  const { post, avvia, cartella } = await preparaApi(t, { gestoreEstrazione });
  const sessionId = await avvia();
  const chiusura = post("/api/chiudi", { sessionId });
  await iniziata;
  let risposta;
  try { risposta = await post("/api/libreria/indicizza", corpoDocumento(sessionId)); }
  finally { completaChiusura(); }
  assert.equal((await chiusura).status, 200);
  assert.equal(risposta.status, 409);
  assert.equal(estrazioni, 0);
  await assert.rejects(readFile(join(cartella, ".ingest-index.json")), { code: "ENOENT" });
});

test("API libreria: chiusura durante preparazione attende e impedisce un worker tardivo", async (t) => {
  const reale = creaGestoreEstrazione({urlWorker: new URL("../../tests/fixture-estrazione-worker.mjs", import.meta.url)});
  const ingresso = Promise.withResolvers();
  const rilascio = Promise.withResolvers();
  const arrestoIniziato = Promise.withResolvers();
  let arrestata = false;
  let risultatoEstrazione;
  const gestoreEstrazione = {
    iniziaPreparazione: reale.iniziaPreparazione,
    estrai: async (id, documento) => {
      ingresso.resolve();
      await rilascio.promise;
      risultatoEstrazione = await reale.estrai(id, documento);
      return risultatoEstrazione;
    },
    chiudiSessione: async (id) => {
      const chiusura = reale.chiudiSessione(id);
      arrestoIniziato.resolve();
      await chiusura;
      arrestata = true;
    },
    chiudi: reale.chiudi,
  };
  t.after(() => { rilascio.resolve(); return reale.chiudi(); });
  const { post, avvia, cartella } = await preparaApi(t, { gestoreEstrazione });
  const sessionId = await avvia();
  const filePrima = await readdir(cartella);
  const pendente = post("/api/libreria/indicizza", corpoDocumento(sessionId, "dato.docx", docxMinimo()));
  await ingresso.promise;
  const chiusura = post("/api/chiudi", { sessionId });
  await arrestoIniziato.promise;
  await new Promise((risolvi) => setTimeout(risolvi, 30));
  assert.equal(arrestata, false, "La chiusura deve attendere la richiesta non ancora registrata nella coda worker.");
  rilascio.resolve();
  assert.equal((await pendente).status, 409);
  assert.equal((await chiusura).status, 200);
  assert.equal(risultatoEstrazione.motivo, "sessione chiusa");
  assert.equal(reale.attivi, 0);
  assert.deepEqual(await readdir(cartella), filePrima);
});

test("libreria: chiusura dopo sidecar impedisce di pubblicare la scheda wiki", async (t) => {
  let attiva = true;
  const { aggiungi, cartella } = await prepara(t, { scriviAtomico: async (percorso, contenuto, opzioni) => {
    await scriviFileAtomico(percorso, contenuto, opzioni);
    if (percorso.endsWith(".testo.md")) attiva = false;
  } });
  const wiki = join(cartella, "wiki", "sources");
  await mkdir(wiki, { recursive: true });
  await assert.rejects(aggiungi("dato.docx", docxMinimo(), { ancoraValida: () => attiva }), (errore) => errore.statusHttp === 409);
  assert.deepEqual(await readdir(wiki), []);
});

test("API libreria: C1 rifiutato prima di prenotare quota e idempotenza", async (t) => {
  const { post, avvia } = await preparaApi(t);
  const sessionId = await avvia();
  const corpo = corpoDocumento(sessionId, "escluso.exe");
  const invalido = await post("/api/libreria/indicizza", { ...corpo, percorsoRelativo: "cartella\u0085/escluso.exe" });
  assert.equal(invalido.status, 400);
  const valido = await post("/api/libreria/indicizza", corpo);
  assert.equal(valido.status, 200, JSON.stringify(valido.body));
  assert.equal(valido.body.esito, "saltato");
  for (let numero = 1; numero < 200; numero += 1) {
    const risposta = await post("/api/libreria/indicizza", corpoDocumento(sessionId, "escluso.exe", Buffer.from(String(numero)), corpo.operazioneId));
    assert.equal(risposta.status, 200, "Il percorso invalido non deve consumare quota: " + numero);
  }
});

test("API libreria: chiusura fallita conserva quote e risultati, ritenta annullati senza ricontarli", async (t) => {
  let segnalaAvvio;
  let annullaEstrazione;
  let primoTentativo = true;
  const avviata = new Promise((risolvi) => { segnalaAvvio = risolvi; });
  const gestoreEstrazione = {
    estrai: async (_id, documento) => {
      if (documento.nome === "da-riprovare.docx" && primoTentativo) {
        primoTentativo = false;
        return new Promise((risolvi) => { annullaEstrazione = risolvi; segnalaAvvio(); });
      }
      return estraiDocumento(documento);
    },
    chiudiSessione: async () => { annullaEstrazione?.({ stato: "errore", annullata: true, motivo: "Chiusura" }); },
    chiudi: async () => {},
  };
  const { post, avvia, ponte } = await preparaApi(t, { gestoreEstrazione });
  const sessionId = await avvia();
  const completato = corpoDocumento(sessionId);
  const risultatoCompletato = await post("/api/libreria/indicizza", completato);
  assert.equal(risultatoCompletato.body.esito, "indicizzato");
  const daRiprovare = corpoDocumento(sessionId, "da-riprovare.docx", docxMinimo());
  for (const operazioneId of [completato.operazioneId, daRiprovare.operazioneId]) {
    for (let numero = 0; numero < 199; numero += 1) {
      const risposta = await post("/api/libreria/indicizza", corpoDocumento(sessionId, "escluso.exe", Buffer.from(String(numero)), operazioneId));
      assert.equal(risposta.status, 200);
    }
  }
  const pendente = post("/api/libreria/indicizza", daRiprovare);
  await avviata;
  const sessione = ponte.sessioni.get(sessionId);
  const fermaOriginale = sessione.ferma;
  sessione.ferma = async () => { throw new Error("Arresto Pi fallito nel test"); };
  let chiusura;
  try { chiusura = await post("/api/chiudi", { sessionId }); }
  finally { sessione.ferma = fermaOriginale; }
  assert.equal(chiusura.status, 500);
  assert.equal((await pendente).status, 409);
  assert.equal(sessione.libreriaInChiusura, false);
  assert.deepEqual(await post("/api/libreria/indicizza", completato), risultatoCompletato);
  assert.equal((await post("/api/libreria/indicizza", daRiprovare)).status, 200);
  for (const operazioneId of [completato.operazioneId, daRiprovare.operazioneId]) {
    const oltre = await post("/api/libreria/indicizza", corpoDocumento(sessionId, "oltre.exe", Buffer.from("oltre"), operazioneId));
    assert.equal(oltre.status, 429, "Il limite resta 200 anche dopo il tentativo di chiusura.");
  }
});

test("libreria: indice oltre 32 MiB in UTF-8 rifiutato prima di pubblicare documenti", async (t) => {
  const { aggiungi, cartella } = await prepara(t);
  const precedente = await aggiungi("precedente.txt", "precedente");
  const limite = 32 * 1024 * 1024;
  const voce = {
    ...precedente.voce,
    percorso_relativo_origine: "origine/" + "à".repeat(4000),
    estrazione: { ...precedente.voce.estrazione, motivo: "à".repeat(4000) },
  };
  const campione = JSON.stringify({ versione: 1, voci: { ["0".repeat(32)]: voce } }, null, 2) + "\n";
  const doppio = JSON.stringify({ versione: 1, voci: { ["0".repeat(32)]: voce, ["1".repeat(32)]: voce } }, null, 2) + "\n";
  const incremento = Buffer.byteLength(doppio) - Buffer.byteLength(campione);
  const numero = Math.ceil((limite + 1024 - Buffer.byteLength(campione)) / incremento) + 1;
  assert.ok(numero < 5000, "La prova usa poche migliaia di voci con metadati lunghi validi.");
  const indice = { versione: 1, voci: {} };
  for (let posizione = 0; posizione < numero; posizione += 1) {
    indice.voci[posizione.toString(16).padStart(32, "0")] = voce;
  }
  const compatto = JSON.stringify(indice);
  assert.ok(Buffer.byteLength(compatto) < limite, "L'indice sorgente deve essere leggibile.");
  assert.ok(Buffer.byteLength(JSON.stringify(indice, null, 2) + "\n") > limite, "La pubblicazione supererebbe il limite in byte UTF-8.");
  const percorsoIndice = join(cartella, ".ingest-index.json");
  await writeFile(percorsoIndice, compatto);
  await assert.rejects(aggiungi("nuovo.txt", "nuovo contenuto"), (errore) => errore.statusHttp === 413 && /32 MiB/.test(errore.message));
  await assert.rejects(readFile(join(cartella, "raw", "documenti", "nuovo.txt")), { code: "ENOENT" });
  assert.equal(impronta("sha256", await readFile(percorsoIndice)), impronta("sha256", compatto));
  assert.equal(await readFile(precedente.voce.percorso, "utf8"), "precedente");
});
