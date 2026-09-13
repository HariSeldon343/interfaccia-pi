import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONSIGLIO = require(join(RADICE, "app", "public", "consiglio-core.js"));
const ALLEGATI = require(join(RADICE, "app", "public", "attachment-core.js"));
const LINK_CORE = require(join(RADICE, "app", "public", "link-core.js"));
const frontend = await readFile(join(RADICE, "app", "public", "app.js"), "utf8");

// Estrae il corpo di una funzione reale di app.js: le prove sul DOM girano sul
// codice che la GUI esegue davvero, non su una copia scritta nel test.
function corpoFunzione(nome) {
  const inizio = frontend.indexOf(`function ${nome}(`);
  assert.notEqual(inizio, -1, `manca la funzione ${nome}`);
  const aperturaParametri = frontend.indexOf("(", inizio);
  let profonditaParametri = 0;
  let fineParametri = -1;
  for (let indice = aperturaParametri; indice < frontend.length; indice += 1) {
    if (frontend[indice] === "(") profonditaParametri += 1;
    if (frontend[indice] === ")") profonditaParametri -= 1;
    if (profonditaParametri === 0) {
      fineParametri = indice;
      break;
    }
  }
  assert.notEqual(fineParametri, -1, `la firma di ${nome} non è chiusa`);
  const apertura = frontend.indexOf("{", fineParametri);
  let profondita = 0;
  for (let indice = apertura; indice < frontend.length; indice += 1) {
    if (frontend[indice] === "{") profondita += 1;
    if (frontend[indice] === "}") profondita -= 1;
    if (profondita === 0) return frontend.slice(apertura + 1, indice);
  }
  assert.fail(`la funzione ${nome} non è chiusa`);
}

function creaNodo(tag, classe = "", contenuto = null) {
  const nodo = {
    tag,
    className: classe || "",
    textContent: contenuto == null ? "" : String(contenuto),
    children: [],
    attributi: {},
    dataset: {},
    disabled: false,
    hidden: false,
    title: "",
    value: "",
    onclick: null,
    onchange: null,
    classList: {
      add(nome) {
        nodo.className = `${nodo.className} ${nome}`.trim();
      },
    },
    setAttribute(nome, valore) {
      nodo.attributi[nome] = String(valore);
    },
    getAttribute(nome) {
      return Object.hasOwn(nodo.attributi, nome) ? nodo.attributi[nome] : null;
    },
    removeAttribute(nome) {
      delete nodo.attributi[nome];
    },
    appendChild(figlio) {
      nodo.children.push(figlio);
      return figlio;
    },
    append(...figli) {
      nodo.children.push(...figli);
    },
    replaceChildren(...figli) {
      nodo.children = figli;
    },
    querySelector() {
      return null;
    },
    focus() {},
  };
  return nodo;
}

const tutti = (nodo) => [nodo, ...nodo.children.flatMap(tutti)];
const testoDi = (nodo) => tutti(nodo).map((voce) => voce.textContent).join(" | ");

function ambienteFunzioni(ambiente, dichiarazioni) {
  const sorgente = dichiarazioni.map(({ nome, asincrona = false, firma }) => (
    `${asincrona ? "async " : ""}function ${nome}(${firma}) { ${corpoFunzione(nome)} }`
  )).join("\n");
  const nomi = dichiarazioni.map(({ nome }) => nome).join(", ");
  return new Function("ambiente", `
    const { ${Object.keys(ambiente).join(", ")} } = ambiente;
    ${sorgente}
    return { ${nomi} };
  `)(ambiente);
}

// --- Passo 1: riduzione dello stato con il controllo su seq e su revisione ---

function statoConUnLavoro() {
  const stato = CONSIGLIO.applicaSnapshotConsiglio(CONSIGLIO.statoIniziale(), [
    {
      id: "consiglio:L1",
      nomeSessione: "Risultato",
      attiva: false,
      cartella: "C:\\finta\\progetto",
      consiglio: {
        lavoroId: "L1",
        stato: "raccolta",
        revisione: 1,
        seq: 5,
        tipo: "codice",
        motivo: null,
        controllo: null,
        azioni: { approva: false, rifai: false, annulla: true },
      },
    },
  ]);
  return stato;
}

test("un evento con seq minore non cambia lo stato", () => {
  const stato = statoConUnLavoro();
  assert.equal(stato.lavori.L1.stato, "raccolta");
  assert.equal(stato.lavori.L1.seq, 5);
  const esito = CONSIGLIO.applicaEventoConsiglio(stato, {
    type: "gui_consiglio_stato",
    lavoroId: "L1",
    revisione: 1,
    seq: 4,
    stato: "preparazione",
    azioni: { approva: false, rifai: false, annulla: true },
  });
  assert.equal(esito.applicato, false);
  assert.equal(esito.stato, stato, "uno stato non applicato non deve nemmeno essere ricopiato");
  assert.equal(esito.stato.lavori.L1.stato, "raccolta");
  const avanti = CONSIGLIO.applicaEventoConsiglio(stato, {
    type: "gui_consiglio_stato",
    lavoroId: "L1",
    revisione: 1,
    seq: 6,
    stato: "fusione",
    azioni: { approva: false, rifai: false, annulla: true },
  });
  assert.equal(avanti.applicato, true);
  assert.equal(avanti.stato.lavori.L1.stato, "fusione");
  assert.equal(avanti.stato.lavori.L1.seq, 6);
  assert.equal(stato.lavori.L1.stato, "raccolta", "la riduzione non deve mutare lo stato ricevuto");
});

test("un evento di una revisione vecchia viene ignorato", () => {
  const stato = CONSIGLIO.applicaEventoConsiglio(statoConUnLavoro(), {
    type: "gui_consiglio_stato",
    lavoroId: "L1",
    revisione: 2,
    seq: 20,
    stato: "preparazione",
    azioni: { approva: false, rifai: false, annulla: true },
  }).stato;
  assert.equal(stato.lavori.L1.revisione, 2);
  const vecchio = CONSIGLIO.applicaEventoConsiglio(stato, {
    type: "gui_consiglio_ruolo",
    lavoroId: "L1",
    revisione: 1,
    seq: 21,
    roleId: "consigliere-1",
    guiSessionId: "s1",
    stato: "completato",
    tentativo: 0,
  });
  assert.equal(vecchio.applicato, false);
  assert.deepEqual(vecchio.stato.lavori.L1.ruoli, {});
});

// Rifai alza la revisione senza alzare seq: una lettura di stato partita per la
// revisione vecchia arriva con lo stesso seq e, guardando solo quello, si
// riprenderebbe la bozza superata insieme al suo Approva.
test("una lettura di stato di una revisione superata non riporta indietro il risultato", () => {
  const prima = statoCompleto();
  assert.equal(prima.lavori.L1.revisione, 1);
  assert.equal(prima.lavori.L1.risultato.testo, "Testo fuso del consiglio.");
  const dopo = CONSIGLIO.registraNuovaRevisione(prima, { lavoroId: "L1", revisione: 2 });
  assert.equal(dopo.lavori.L1.seq, prima.lavori.L1.seq, "una revisione nuova non cambia seq");

  const esito = CONSIGLIO.applicaDettaglioConsiglio(dopo, { ...DETTAGLIO, seq: dopo.lavori.L1.seq });
  assert.equal(esito.applicato, false, "la lettura sorpassata non si applica");
  assert.equal(esito.stato, dopo, "uno stato non applicato non deve nemmeno essere ricopiato");
  const lavoro = esito.stato.lavori.L1;
  assert.equal(lavoro.revisione, 2);
  assert.equal(lavoro.stato, "preparazione");
  assert.equal(lavoro.risultato, null, "il testo fuso della revisione 1 non torna indietro");
  assert.equal(lavoro.controllo, null);
  assert.deepEqual(lavoro.contributi, []);
  assert.equal(lavoro.dettaglioDaLeggere, true, "il lavoro resta da leggere, così chi legge riprova");
  const vista = CONSIGLIO.vistaRisultato(lavoro);
  assert.equal(vista.azioni.find((azione) => azione.chiave === "approva").attivo, false);

  // La lettura della revisione corrente, invece, entra anche a parità di seq:
  // è l'unica cosa che porta il testo fuso, che nessun evento trasporta.
  const corrente = CONSIGLIO.applicaDettaglioConsiglio(dopo, {
    ...DETTAGLIO,
    lavoro: { ...DETTAGLIO.lavoro, revisione: 2, stato: "bozza_valida", motivo: null },
    controllo: { tipo: "test", esito: "pass", motivi: [], logTroncato: null, impronteFile: [], at: "2026-09-11T09:00:00.000Z" },
    azioni: { approva: true, rifai: true, annulla: true },
    seq: dopo.lavori.L1.seq,
  });
  assert.equal(corrente.applicato, true);
  assert.equal(corrente.stato.lavori.L1.risultato.testo, "Testo fuso del consiglio.");
  assert.equal(corrente.stato.lavori.L1.revisione, 2);
});

// --- Passo 2: schede dei ruoli ---

const RUOLO_IN_ATTESA = {
  roleId: "consigliere-1",
  tipo: "consigliere",
  ordine: 1,
  provider: "finto",
  modello: "alfa",
  nomeModello: "Alfa",
  stato: "attesa_provider",
  tentativo: 1,
  attesaProvider: { tentativo: 2, massimo: 4 },
  ripetizione: { numero: 1, su: 1 },
};

function ambienteFascia(sessione, ruoliPerSessione, lavori) {
  const fascia = creaNodo("div");
  const ambiente = {
    APP: { consiglio: { lavori, ruoliPerSessione } },
    CONSIGLIO_CORE: CONSIGLIO,
    DOM: { fasciaConsiglio: fascia },
    crea: creaNodo,
  };
  const interfaccia = ambienteFunzioni(ambiente, [
    { nome: "livelloRigaRuolo", firma: "riga, ruolo" },
    { nome: "disegnaFasciaConsiglio", firma: "sessione" },
  ]);
  interfaccia.disegnaFasciaConsiglio(sessione);
  return fascia;
}

test("la scheda di un ruolo mostra lo stato a parole", () => {
  const fascia = ambienteFascia(
    { id: "s1", consiglio: { lavoroId: "L1", roleId: "consigliere-1", ruolo: "consigliere" } },
    { s1: { lavoroId: "L1", roleId: "consigliere-1", ruolo: "consigliere" } },
    { L1: { lavoroId: "L1", ruoli: { "consigliere-1": { ...RUOLO_IN_ATTESA, stato: "in_corso" } } } },
  );
  assert.equal(fascia.hidden, false);
  const testi = fascia.children.map((nodo) => nodo.textContent);
  assert.equal(testi[0], "Consigliere 1, Alfa");
  assert.ok(testi.includes("Stato: Sta rispondendo"), testi.join(" | "));
  assert.ok(
    fascia.children.some((nodo) => nodo.className.includes("livello-lavoro")),
    "lo stato deve portare anche un livello, ma il testo resta leggibile da solo",
  );
  const senzaRuolo = ambienteFascia({ id: "s9" }, {}, {});
  assert.equal(senzaRuolo.hidden, true);
  assert.deepEqual(senzaRuolo.children, []);
});

test("la scheda del ruolo mostra il dettaglio SSE sotto al motivo come nota", () => {
  const errore = "Il provider finto ha rifiutato l'accesso: controlla le credenziali in Pi.";
  const dettaglio = "401 authentication_error: invalid x-api-key";
  const evento = {
    type: "gui_consiglio_ruolo", lavoroId: "L1", revisione: 1, seq: 6,
    roleId: "consigliere-1", guiSessionId: "s1", stato: "errore", tentativo: 0,
    errore, dettaglio,
  };
  const stato = CONSIGLIO.applicaEventoConsiglio(statoConUnLavoro(), evento).stato;
  assert.equal(stato.lavori.L1.ruoli["consigliere-1"].dettaglio, dettaglio);
  const fascia = ambienteFascia(
    { id: "s1", consiglio: { lavoroId: "L1", roleId: "consigliere-1" } },
    { s1: { lavoroId: "L1", roleId: "consigliere-1" } },
    stato.lavori,
  );
  const indiceMotivo = fascia.children.findIndex((nodo) => nodo.textContent === "Motivo: " + errore);
  assert.notEqual(indiceMotivo, -1);
  const nota = fascia.children[indiceMotivo + 1];
  assert.equal(nota.textContent, "Dettaglio tecnico: " + dettaglio);
  assert.equal(nota.tag, "p");
  assert.ok(nota.className.split(/\s+/u).includes("nota"));
  const completato = CONSIGLIO.applicaEventoConsiglio(stato, {
    ...evento, seq: 7, stato: "completato", errore: null, dettaglio: null,
  }).stato.lavori.L1.ruoli["consigliere-1"];
  assert.equal(completato.dettaglio, null);
  assert.equal(CONSIGLIO.righeRuolo(completato).some((riga) => riga.chiave === "dettaglio"), false);
});

test("la lettura HTTP conserva il dettaglio tecnico e non sovrascrive un evento più recente", () => {
  const dettaglio = "402 Insufficient credits";
  const risposta = {
    ...DETTAGLIO,
    ruoli: DETTAGLIO.ruoli.map((ruolo) => ruolo.roleId === "consigliere-2" ? { ...ruolo, dettaglio } : ruolo),
  };
  const stato = CONSIGLIO.applicaDettaglioConsiglio(statoConUnLavoro(), risposta).stato;
  assert.equal(stato.lavori.L1.ruoli["consigliere-2"].dettaglio, dettaglio);
  const recente = CONSIGLIO.applicaEventoConsiglio(stato, {
    type: "gui_consiglio_ruolo", lavoroId: "L1", revisione: 1, seq: 10,
    roleId: "consigliere-2", stato: "errore", dettaglio: "401 authentication_error",
  }).stato;
  const sorpassato = CONSIGLIO.applicaDettaglioConsiglio(recente, risposta).stato;
  assert.equal(sorpassato.lavori.L1.ruoli["consigliere-2"].dettaglio, "401 authentication_error");
});

test("attesa del provider e ripetizione del consiglio sono righe distinte", () => {
  const righe = CONSIGLIO.righeRuolo(RUOLO_IN_ATTESA);
  const attesa = righe.find((riga) => riga.chiave === "attesa-provider");
  const ripetizione = righe.find((riga) => riga.chiave === "ripetizione");
  assert.equal(attesa.testo, "Attesa del provider, tentativo 2 di 4");
  assert.equal(ripetizione.testo, "Ripetizione del consiglio 1 di 1");
  assert.notEqual(attesa.testo, ripetizione.testo);

  const fascia = ambienteFascia(
    { id: "s1", consiglio: { lavoroId: "L1", roleId: "consigliere-1", ruolo: "consigliere" } },
    { s1: { lavoroId: "L1", roleId: "consigliere-1", ruolo: "consigliere" } },
    { L1: { lavoroId: "L1", ruoli: { "consigliere-1": RUOLO_IN_ATTESA } } },
  );
  const testi = fascia.children.map((nodo) => nodo.textContent);
  assert.ok(testi.includes("Attesa del provider, tentativo 2 di 4"), testi.join(" | "));
  assert.ok(testi.includes("Ripetizione del consiglio 1 di 1"), testi.join(" | "));
  assert.equal(
    new Set(testi).size,
    testi.length,
    "le due attese non devono collassare in una riga sola",
  );
});

test("sulla scheda di un ruolo l'invio è disattivato", () => {
  assert.equal(CONSIGLIO.invioManualeConsentito({ id: "s1" }), true);
  assert.equal(
    CONSIGLIO.invioManualeConsentito({ id: "s1", consiglio: { lavoroId: "L1", roleId: "consigliere-1" } }),
    false,
  );
  assert.equal(CONSIGLIO.invioManualeConsentito({ id: "consiglio:L1", schedaRisultato: true }), false);

  const corpo = corpoFunzione("aggiornaInterfacciaAttiva");
  const inizio = corpo.indexOf("const composerScrivibile");
  assert.notEqual(inizio, -1, "manca il calcolo di composerScrivibile");
  const fine = corpo.indexOf(");", inizio);
  const calcolo = corpo.slice(inizio, fine);
  assert.match(
    calcolo,
    /CONSIGLIO_CORE\.invioManualeConsentito\(sessione\)/,
    "il composer deve spegnersi sulle sessioni di ruolo, non solo nei pulsanti",
  );
  assert.match(corpo, /sessione\?\.consiglio\?\.roleId/, "va detto in chiaro perché l'invio è spento");
});

// --- Passi 3 e 4: scheda Risultato ---

const CONTRIBUTI = [
  { roleId: "consigliere-1", provider: "finto", modello: "alfa", testo: "prima idea", stopReason: "stop", incluso: true, errore: null },
  { roleId: "consigliere-2", provider: "finto", modello: "beta", testo: "", stopReason: "error", incluso: false, errore: "Il provider ha rifiutato." },
];

const DETTAGLIO = {
  lavoro: {
    lavoroId: "L1",
    sourceSessionId: "sorgente",
    workspace: "C:\\finta\\progetto",
    tipo: "codice",
    stato: "bozza_bloccata",
    revisione: 1,
    motivo: "Il controllo automatico non è passato.",
    piano: { origine: "npm", comando: "node npm-cli.js run test" },
    git: { disponibile: true, motivo: null },
    consenso: { accettato: true, at: "2026-09-11T08:00:00.000Z", testo: "" },
    problemi: [],
  },
  ruoli: [
    { roleId: "consigliere-1", tipo: "consigliere", ordine: 1, provider: "finto", modello: "alfa", nomeModello: "Alfa", guiSessionId: "s1", stato: "completato", tentativo: 0, attesaFinoA: null, errore: null },
    { roleId: "consigliere-2", tipo: "consigliere", ordine: 2, provider: "finto", modello: "beta", nomeModello: "Beta", guiSessionId: "s2", stato: "errore", tentativo: 1, attesaFinoA: null, errore: "Il provider ha rifiutato." },
    { roleId: "scrittore", tipo: "scrittore", ordine: 3, provider: "finto", modello: "gamma", nomeModello: "Gamma", guiSessionId: "s3", stato: "completato", tentativo: 0, attesaFinoA: null, errore: null },
  ],
  contributi: CONTRIBUTI,
  risultato: {
    testo: "Testo fuso del consiglio.",
    provenienza: [
      { parte: "Introduzione", contributo: "consigliere-1", cosaHoPreso: "la definizione", perche: "era la più precisa" },
    ],
    scartati: [
      { contributo: "consigliere-2", cosaHoLasciatoFuori: "la digressione", perche: "fuori richiesta" },
    ],
    fileModificati: ["app/finto.mjs"],
    eval: [
      { codice: "E1", segnata: true, descrizione: "la risposta copre la richiesta", evidenza: "sezione uno" },
    ],
    risultatoHash: "impronta-1",
  },
  controllo: {
    tipo: "test",
    esito: "fail",
    motivi: ["Il comando dei test è uscito con codice 1."],
    logTroncato: "...",
    impronteFile: [],
    at: "2026-09-11T08:05:00.000Z",
  },
  azioni: { approva: false, rifai: true, annulla: true },
  seq: 9,
};

function statoCompleto() {
  const iniziale = CONSIGLIO.applicaSnapshotConsiglio(CONSIGLIO.statoIniziale(), [
    {
      id: "consiglio:L1",
      nomeSessione: "Risultato",
      attiva: false,
      cartella: "C:\\finta\\progetto",
      consiglio: {
        lavoroId: "L1",
        stato: "bozza_bloccata",
        revisione: 1,
        seq: 9,
        tipo: "codice",
        motivo: "Il controllo automatico non è passato.",
        controllo: { tipo: "test", esito: "fail", motivi: ["Il comando dei test è uscito con codice 1."] },
        azioni: { approva: false, rifai: true, annulla: true },
      },
    },
  ]);
  return CONSIGLIO.applicaDettaglioConsiglio(iniziale, DETTAGLIO).stato;
}

function disegnaPannello(stato, idScheda = "consiglio:L1", { sessioni = new Map(), richieste = [] } = {}) {
  const sessione = { id: idScheda, schedaRisultato: true, cartella: "C:\\finta\\progetto", vista: creaNodo("div") };
  const ambiente = {
    APP: { consiglio: stato, sessioni },
    CONSIGLIO_CORE: CONSIGLIO,
    LINK_CORE,
    crea: creaNodo,
    document: { createTextNode: (testo) => creaNodo("#text", null, testo), createElement: creaNodo },
    destinazioneLinkGui: LINK_CORE.destinazioneLinkGui,
    prossimaDestinazioneAutomatica: LINK_CORE.prossimaDestinazioneAutomatica,
    chiedi: async (via, opzioni) => { richieste.push({ via, ...opzioni }); },
    toast: (messaggio) => assert.fail(messaggio),
    testoErrore: (errore) => errore.message,
    approvaConsiglioDallaScheda: () => {},
    rifaiConsiglioDallaScheda: () => {},
    annullaConsiglioDallaScheda: () => {},
  };
  const interfaccia = ambienteFunzioni(ambiente, [
    { nome: "collegaBrowserSistema", firma: 'collegamento, href, { sessionId = null, tipo = "web", dopoApertura = null } = {}' },
    { nome: "collegaDestinazioneGui", firma: "collegamento, valore, { sessionId = null, consentiRelativo = false, dopoApertura = null } = {}" },
    { nome: "creaCollegamentoGui", firma: "etichetta, valore, contestoLink = {}" },
    { nome: "aggiungiTestoAutolink", firma: "contenitore, testo, contestoLink" },
    { nome: "aggiungiTestoConACapo", firma: "contenitore, testo, contestoLink = {}" },
    { nome: "aggiungiInline", firma: "contenitore, testo, contestoLink = {}" },
    { nome: "renderMarkdown", firma: "contenitore, testo, { sessione = null } = {}" },
    { nome: "sezioneConsiglio", firma: "titolo" },
    { nome: "tabellaConsiglio", firma: "intestazioni, righe, celle" },
    { nome: "disegnaSchedaRisultato", firma: "sessione" },
  ]);
  return interfaccia.disegnaSchedaRisultato(sessione);
}

test("i link locali del testo fuso aprono i file nella conversazione sorgente", async () => {
  const stato = statoCompleto();
  stato.lavori.L1.risultato = { ...stato.lavori.L1.risultato, testo: "[nota](./nota.md)" };
  const sorgente = { id: "sorgente", cartella: "C:\\finta\\progetto" };
  const richieste = [];
  const pannello = disegnaPannello(stato, "consiglio:L1", {
    sessioni: new Map([[sorgente.id, sorgente]]), richieste,
  });
  const nota = tutti(pannello).find((nodo) => nodo.className === "link-locale" && nodo.textContent === "nota");
  assert.ok(nota, "il Markdown deve costruire un pulsante per il file relativo");
  await nota.onclick({ preventDefault() {} });
  assert.deepEqual(richieste, [{
    via: "/api/apri-url", corpo: { url: "./nota.md", confirmed: true, sessionId: "sorgente" },
  }], "l'apertura usa l'identità della conversazione pi, non della scheda Risultato");
});

test("senza sorgente aperta il testo fuso conserva il relativo come testo e apre gli assoluti senza sessionId", async () => {
  const stato = statoCompleto();
  stato.lavori.L1.risultato = {
    ...stato.lavori.L1.risultato, testo: "[nota](./nota.md) e [assoluta](C:/finta/progetto/nota.md)",
  };
  const richieste = [];
  const pannello = disegnaPannello(stato, "consiglio:L1", { richieste });
  const collegamenti = tutti(pannello).filter((nodo) => nodo.className === "link-locale");
  assert.deepEqual(collegamenti.map((nodo) => nodo.textContent), ["assoluta"]);
  assert.ok(tutti(pannello).some((nodo) => nodo.tag === "#text" && nodo.textContent === "nota"));
  await collegamenti[0].onclick({ preventDefault() {} });
  assert.deepEqual(richieste, [{
    via: "/api/apri-url", corpo: { url: "C:/finta/progetto/nota.md", confirmed: true },
  }]);
});

test("la scheda risultato si disegna dalla voce di snapshot con il campo consiglio", () => {
  const stato = statoCompleto();
  assert.equal(stato.lavori.L1.stato, "bozza_bloccata");
  const pannello = disegnaPannello(stato);
  const testo = testoDi(pannello);
  assert.match(testo, /Risultato del consiglio/);
  assert.match(testo, /Bozza bloccata/);
  assert.match(testo, /Testo fuso del consiglio\./);
  assert.match(testo, /Revisione 1/);
  assert.match(testo, /app\/finto\.mjs/);
  assert.match(testo, /Il provider ha rifiutato\./, "un contributo scartato va detto, non nascosto");
});

test("un lavoro interrotto mostra i file che Rifai riporterebbe indietro", () => {
  // Forma della proposta letta dal ponte: {proposto, file, motivo}.
  const stato = CONSIGLIO.applicaSnapshotConsiglio(CONSIGLIO.statoIniziale(), [
    {
      id: "consiglio:L2",
      nomeSessione: "Risultato",
      attiva: false,
      cartella: "C:\\finta\\progetto",
      consiglio: {
        lavoroId: "L2",
        stato: "interrotto",
        revisione: 1,
        seq: 3,
        tipo: "codice",
        motivo: "Il ponte si è chiuso mentre il consiglio lavorava.",
        controllo: null,
        ripristino: { proposto: true, file: ["app/finto.mjs"], motivo: null },
        azioni: { approva: false, rifai: true, annulla: false },
      },
    },
  ]);
  const vista = CONSIGLIO.vistaRisultato(stato.lavori.L2);
  assert.equal(vista.stato.testo, "Interrotto");
  assert.deepEqual(vista.ripristino, { proposto: true, file: ["app/finto.mjs"], motivo: null });
  const testo = testoDi(disegnaPannello(stato, "consiglio:L2"));
  assert.match(testo, /Ripristino proposto/);
  assert.match(testo, /app\/finto\.mjs/);
  assert.match(testo, /prima te lo chiedo/, "il ripristino non parte da solo");
});

test("la scheda risultato non diventa la scheda di ripiego se esiste una sessione vera", () => {
  // Il ponte manda le schede Risultato in coda alle sessioni vere: è proprio
  // quella posizione a renderle il ripiego naturale se non si filtrano.
  const sessioni = new Map([
    ["sorgente", { id: "sorgente", attiva: true }],
    ["consiglio:L1", { id: "consiglio:L1", schedaRisultato: true, attiva: false }],
  ]);
  const ambiente = { APP: { sessioni }, CONSIGLIO_CORE: CONSIGLIO };
  const interfaccia = ambienteFunzioni(ambiente, [{ nome: "idSessioneDiRipiego", firma: "" }]);
  assert.equal(interfaccia.idSessioneDiRipiego(), "sorgente");

  // Anche quando la conversazione vera è chiusa, la scheda senza processo non
  // deve prendere il suo posto.
  sessioni.get("sorgente").attiva = false;
  assert.equal(interfaccia.idSessioneDiRipiego(), "sorgente");

  sessioni.delete("sorgente");
  assert.equal(
    interfaccia.idSessioneDiRipiego(),
    "consiglio:L1",
    "restando solo la scheda Risultato, meglio quella che nessuna scheda",
  );
});

test("la tabella di provenienza mostra il modello che arriva dal server", () => {
  const stato = statoCompleto();
  const vista = CONSIGLIO.vistaRisultato(stato.lavori.L1);
  assert.deepEqual(vista.provenienza.intestazioni, [
    "Parte del risultato", "Contributo", "Modello", "Cosa ho preso", "Perché",
  ]);
  assert.equal(vista.provenienza.righe[0].modello, "Alfa");
  assert.equal(vista.scartati.righe[0].modello, "Beta");

  const pannello = disegnaPannello(stato);
  const tabelle = tutti(pannello).filter((nodo) => nodo.tag === "table");
  const provenienza = tabelle.find((tabella) => testoDi(tabella).includes("Cosa ho preso"));
  assert.ok(provenienza, "manca la tabella di provenienza");
  const testo = testoDi(provenienza);
  assert.match(testo, /Modello/);
  assert.match(testo, /Alfa/);
  const nota = tutti(pannello).find((nodo) => nodo.textContent.includes("La colonna Modello la scrive il ponte"));
  assert.ok(nota, "va detto che il modello lo dichiara il ponte, non lo scrittore");
});

test("un controllo fail disabilita Approva e ne scrive il motivo", () => {
  const stato = statoCompleto();
  const vista = CONSIGLIO.vistaRisultato(stato.lavori.L1);
  const approva = vista.azioni.find((azione) => azione.chiave === "approva");
  assert.equal(approva.attivo, false);
  assert.match(approva.motivo, /Il comando dei test è uscito con codice 1\./);

  const pannello = disegnaPannello(stato);
  const bottoni = tutti(pannello).filter((nodo) => nodo.tag === "button");
  const bottoneApprova = bottoni.find((nodo) => nodo.textContent === "Approva");
  const bottoneRifai = bottoni.find((nodo) => nodo.textContent === "Rifai");
  assert.equal(bottoneApprova.disabled, true);
  assert.equal(bottoneRifai.disabled, false, "Rifai resta la via d'uscita quando il controllo non passa");
  assert.match(testoDi(pannello), /Approva non è disponibile\..*codice 1/s);
});

// --- Passo 5: consenso ---

const CONSENSO_CON_GIT = [
  "Lo scrittore del consiglio modificherà i file della cartella C:\\finta\\progetto.",
  "Al termine il ponte eseguirà questo comando, con i permessi del tuo account e, trattandosi di uno script npm, attraverso il processore comandi di sistema: C:\\finto\\node.exe C:\\finto\\npm-cli.js run test",
  "Richiesta, istruzioni e contributi restano salvati in chiaro in C:\\finto\\.pi\\gui\\consigli fino a trenta giorni.",
  "Se lo chiedi, con Rifai posso riportare allo stato di adesso i soli file che il consiglio dichiara di aver modificato.",
].join("\n");

const CONSENSO_SENZA_GIT = [
  "Lo scrittore del consiglio modificherà i file della cartella C:\\finta\\progetto.",
  "Al termine il ponte eseguirà questo comando, con i permessi del tuo account e, trattandosi di uno script npm, attraverso il processore comandi di sistema: C:\\finto\\node.exe C:\\finto\\npm-cli.js run test",
  "Richiesta, istruzioni e contributi restano salvati in chiaro in C:\\finto\\.pi\\gui\\consigli fino a trenta giorni.",
  "Il ripristino con git non è possibile (l'eseguibile git non risponde su questo computer): i file modificati restano come sono.",
].join("\n");

test("il consenso mostra il comando congelato e la riga sul salvataggio", () => {
  const vista = CONSIGLIO.vistaConsenso(CONSENSO_CON_GIT);
  assert.equal(vista.comando, "C:\\finto\\node.exe C:\\finto\\npm-cli.js run test");
  const chiavi = vista.righe.map((riga) => riga.chiave);
  assert.deepEqual(chiavi, ["file", "comando", "salvataggio", "ripristino-promesso"]);
  const comando = vista.righe.find((riga) => riga.chiave === "comando");
  assert.match(comando.testo, /con i permessi del tuo account/);
  assert.match(comando.testo, /processore comandi di sistema/);
  const salvataggio = vista.righe.find((riga) => riga.chiave === "salvataggio");
  assert.match(salvataggio.testo, /consigli/);
  assert.match(salvataggio.testo, /fino a trenta giorni/);
  assert.equal(vista.ripristinoPromesso, true);
});

test("senza ripristino possibile la promessa non compare", () => {
  const vista = CONSIGLIO.vistaConsenso(CONSENSO_SENZA_GIT);
  assert.equal(vista.ripristinoPromesso, false);
  assert.equal(vista.righe.some((riga) => riga.chiave === "ripristino-promesso"), false);
  const riga = vista.righe.find((riga) => riga.chiave === "ripristino-assente");
  assert.match(riga.testo, /non è possibile/);
  assert.equal(
    vista.righe.some((riga) => /posso riportare allo stato di adesso/.test(riga.testo)),
    false,
    "senza git non si promette un ripristino",
  );
});

test("il consenso si chiede una volta sola e riusa lo stesso operationId", async () => {
  const chiamate = [];
  let consensiChiesti = 0;
  const esito = await CONSIGLIO.avviaConsiglio({
    sourceSessionId: "sorgente",
    prompt: "richiesta",
    tipo: "codice",
    operationId: "op-consiglio-1",
    chiama: async (via, corpo) => {
      chiamate.push({ via, corpo });
      if (chiamate.length === 1) {
        return { ok: false, codice: "consenso-mancante", messaggio: "Serve il consenso.", consenso: CONSENSO_CON_GIT };
      }
      return { ok: true, dati: { lavoroId: "L1", revisione: 1, stato: "preparazione" } };
    },
    chiediConsenso: async (vista) => {
      consensiChiesti += 1;
      assert.equal(vista.comando, "C:\\finto\\node.exe C:\\finto\\npm-cli.js run test");
      return true;
    },
  });
  assert.equal(esito.avviato, true);
  assert.equal(consensiChiesti, 1);
  assert.equal(chiamate.length, 2);
  assert.equal(chiamate[0].corpo.operationId, chiamate[1].corpo.operationId);
  assert.equal(chiamate[0].corpo.consenso, undefined);
  assert.equal(chiamate[1].corpo.consenso, true);

  const rifiutato = await CONSIGLIO.avviaConsiglio({
    sourceSessionId: "sorgente",
    prompt: "richiesta",
    tipo: "codice",
    operationId: "op-consiglio-2",
    chiama: async () => ({ ok: false, codice: "consenso-mancante", consenso: CONSENSO_SENZA_GIT }),
    chiediConsenso: async () => false,
  });
  assert.equal(rifiutato.avviato, false);
  assert.equal(rifiutato.codice, "consenso-rifiutato");
});

// Forme restituite da /api/allega-file (server.mjs) e aggiunte da
// indicizzaIngressiLibreria (app.js): il caricamento vive fuori dal workspace.
const CARICAMENTO_CONSIGLIO = {
  tipo: "file", id: "12345678-1234-4234-8234-123456789012", token: "12345678-1234-4234-8234-123456789013",
  ownerSessionId: "sorgente", nome: "caricato.txt", mimeType: "text/plain", dimensione: 21,
  percorso: "C:/profilo/.pi/gui/allegati/" + "a".repeat(64) + "/12345678-1234-4234-8234-123456789012-caricato.txt",
};
const LIBRERIA_CONSIGLIO = {
  tipo: "file", origineLibreria: true, nome: "rapporto.pdf.testo.md", mimeType: "text/markdown", dimensione: 47,
  percorso: "C:/profilo/.pi/gui/libreria/raw/documenti/rapporto.pdf.testo.md",
  percorsoIndice: "C:/profilo/.pi/gui/libreria/.ingest-index.json",
};

test("un allegato non ammesso blocca l'avvio con il motivo e non viene mai ignorato", async () => {
  const bozza = "Confronta le informazioni allegate.";
  const riferimento = { tipo: "file", nome: "nota.md", percorso: "C:/lavoro/nota.md", dimensione: 21 };
  const immagine = { nome: "schermata.png", mimeType: "image/png", data: "cHJvdmE=" };
  assert.equal(ALLEGATI.allegatoImmagine(immagine), true, "la fixture usa la forma immagine reale, senza tipo");
  assert.equal(ALLEGATI.allegatoFile(CARICAMENTO_CONSIGLIO), true, "la fixture usa la forma di un caricamento reale");
  const rifiutati = [
    [immagine, /è un'immagine/u],
    [CARICAMENTO_CONSIGLIO, /caricamento esterno/u],
    [{ tipo: "file", nome: "vicino.md", percorso: "C:/lavoro-altro/vicino.md" }, /cartella di lavoro/u],
    [{ tipo: "file", nome: "uscita.md", percorso: "C:/lavoro/../fuori/uscita.md" }, /cartella di lavoro/u],
    [{ tipo: "file", nome: "flusso.md", percorso: "C:/lavoro/nota.md:flusso" }, /cartella di lavoro/u],
    [{ tipo: "file", nome: "ambiguo.md", percorso: "C:/lavoro./ambiguo.md" }, /cartella di lavoro/u],
    [{ tipo: "file", nome: "binario.pdf", percorso: "C:/lavoro/binario.pdf", mimeType: "application/pdf" }, /non è un riferimento a un file di testo/u],
    [{ ...LIBRERIA_CONSIGLIO, percorso: "C:/fuori/nota.md" }, /radice della libreria/u],
    [{ ...LIBRERIA_CONSIGLIO, percorsoIndice: "C:/profilo/.pi/gui/libreria/../.ingest-index.json" }, /radice della libreria/u],
    [{ tipo: "testo", nome: "testo senza percorso", testo: "Non copiare questo contenuto nel prompt." }, /cartella di lavoro/u],
    [{ nome: "sconosciuto" }, /cartella di lavoro/u],
  ];
  for (const [rifiutato, motivo] of rifiutati) {
    const sessione = { bozza, allegati: [riferimento, rifiutato], allegatiLibreria: [] };
    const prima = structuredClone(sessione);
    let chiamate = 0;
    let consensi = 0;
    const esito = await CONSIGLIO.avviaConsiglio({
      sourceSessionId: "sorgente", prompt: sessione.bozza, workspace: "C:/lavoro",
      allegati: sessione.allegati, allegatiLibreria: sessione.allegatiLibreria,
      tipo: "codice", operationId: "op-allegato-non-ammesso",
      chiama: async () => { chiamate += 1; return { ok: true }; },
      chiediConsenso: async () => { consensi += 1; return true; },
    });
    assert.equal(esito.avviato, false, rifiutato.nome);
    assert.equal(esito.codice, "allegato-non-ammesso");
    assert.ok(esito.messaggio.includes(rifiutato.nome), "il messaggio identifica il chip che blocca");
    assert.match(esito.messaggio, motivo);
    assert.ok(esito.messaggio.includes(`"${rifiutato.nome}"`), "il nome del chip usa virgolette dritte");
    assert.match(esito.messaggio, /La bozza e tutti gli allegati sono conservati/u);
    assert.equal(chiamate, 0, "nessun avvio parziale, neppure con un primo allegato ammesso");
    assert.equal(consensi, 0, "il blocco precede anche il consenso");
    assert.deepEqual(sessione, prima, "bozza, chip e dati per l'invio ordinario restano intatti");
  }
});

test("file testuali e voci reali della libreria arrivano solo per riferimento senza contenuti o credenziali", async () => {
  const allegati = [
    { tipo: "file", nome: "nota.md", percorso: "C:\\Lavoro\\nota.md", mimeType: "text/markdown", dimensione: 35, impronta: "hash-sintetico", token: "segreto", ownerSessionId: "sorgente" },
  ];
  const libreria = [
    { ...LIBRERIA_CONSIGLIO },
    { ...LIBRERIA_CONSIGLIO, nome: "seconda.md", percorso: "C:/lavoro/raw/documenti/seconda.md", percorsoIndice: "C:/lavoro/.ingest-index.json", dimensione: 7 },
  ];
  const prima = structuredClone({ allegati, libreria });
  const chiamate = [];
  const esito = await CONSIGLIO.avviaConsiglio({
    sourceSessionId: "sorgente", prompt: "Confronta.", workspace: "C:/lavoro",
    allegati, allegatiLibreria: libreria, operationId: "op-allegati-ammessi",
    chiama: async (via, corpo) => { chiamate.push({ via, corpo }); return { ok: true, dati: { lavoroId: "L1" } }; },
  });
  assert.equal(esito.avviato, true);
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0].corpo.prompt, "Confronta.");
  assert.deepEqual(chiamate[0].corpo.allegati, [
    { percorso: "C:\\Lavoro\\nota.md", nome: "nota.md", dimensione: 35, impronta: "hash-sintetico" },
    { percorso: LIBRERIA_CONSIGLIO.percorso, nome: LIBRERIA_CONSIGLIO.nome, dimensione: 47 },
    { percorso: "C:/lavoro/raw/documenti/seconda.md", nome: "seconda.md", dimensione: 7 },
  ]);
  assert.equal(JSON.stringify(chiamate).includes("segreto"), false);
  assert.deepEqual({ allegati, libreria }, prima);
  assert.equal(CONSIGLIO.preparaAllegatiConsiglio({ allegati }).ok, false, "senza cartella un riferimento ordinario non è ammesso");
  assert.equal(CONSIGLIO.preparaAllegatiConsiglio({ allegatiLibreria: [LIBRERIA_CONSIGLIO] }).ok, true, "la voce di libreria conserva il riferimento anche senza cartella");
  assert.equal(CONSIGLIO.preparaAllegatiConsiglio({ workspace: "/lavoro", allegati: [{ percorso: "/Lavoro/nota.md" }] }).ok, false, "i percorsi POSIX rispettano le maiuscole");
  assert.equal(CONSIGLIO.preparaAllegatiConsiglio({ workspace: "\\\\host\\condivisa", allegati: [{ percorso: "\\\\HOST\\condivisa\\nota.md" }] }).ok, true);
});

test("anche un allegato con testo incorporato conserva soltanto i metadati del riferimento", async () => {
  const contenuto = "Contenuto sintetico riservato al file.";
  const chiamate = [];
  const esito = await CONSIGLIO.avviaConsiglio({
    sourceSessionId: "sorgente", prompt: "Confronta.", workspace: "C:/lavoro", operationId: "op-solo-riferimento",
    allegati: [{ tipo: "testo", nome: "nota.txt", percorso: "C:/lavoro/nota.txt", testo: contenuto, text: contenuto, contenuto }],
    chiama: async (via, corpo) => { chiamate.push(corpo); return { ok: true }; },
  });
  assert.equal(esito.avviato, true);
  assert.equal(chiamate[0].prompt, "Confronta.");
  assert.deepEqual(chiamate[0].allegati, [{ percorso: "C:/lavoro/nota.txt", nome: "nota.txt" }]);
  assert.equal(JSON.stringify(chiamate).includes(contenuto), false, "il contenuto non finisce né nel prompt né nei metadati");
});

test("la preimpostazione e gli allegati restano congelati durante il consenso e il campo resta facoltativo", async () => {
  const preimpostazione = { id: "rapido", versione: 3, nome: "Rapido" };
  const allegati = [{ tipo: "file", nome: "nota.md", percorso: "C:/lavoro/nota.md" }];
  const chiamate = [];
  await CONSIGLIO.avviaConsiglio({
    sourceSessionId: "sorgente", prompt: "Richiesta sintetica.", tipo: "codice",
    operationId: "op-preset-consenso", preimpostazione, allegati, workspace: "C:/lavoro",
    chiama: async (via, corpo) => {
      chiamate.push(structuredClone(corpo));
      return chiamate.length === 1
        ? { ok: false, codice: "consenso-mancante", consenso: CONSENSO_CON_GIT }
        : { ok: true, dati: { lavoroId: "L1" } };
    },
    chiediConsenso: async () => {
      preimpostazione.versione = 4;
      preimpostazione.id = "altro";
      allegati[0].percorso = "C:/fuori/nota.md";
      return true;
    },
  });
  assert.equal(chiamate.length, 2);
  assert.deepEqual(chiamate[0].preimpostazione, { id: "rapido", versione: 3 });
  assert.deepEqual(chiamate[1], { ...chiamate[0], consenso: true });
  const compatibili = [];
  await CONSIGLIO.avviaConsiglio({
    sourceSessionId: "sorgente", prompt: "Richiesta senza preset.", operationId: "op-compatibile",
    chiama: async (via, corpo) => { compatibili.push(corpo); return { ok: true }; },
  });
  assert.deepEqual(compatibili, [{ sourceSessionId: "sorgente", prompt: "Richiesta senza preset.", operationId: "op-compatibile", tipo: "testo" }]);
});

test("anche l'ingresso precedente verifica il contesto degli allegati collegato dal montaggio", async () => {
  let richieste = 0;
  let sblocca;
  const coda = new Promise((resolve) => { sblocca = resolve; });
  const chiama = async () => { richieste += 1; return { ok: true }; };
  const scollega = CONSIGLIO.collegaContestoAllegatiConsiglio(chiama, async (sourceSessionId) => {
    assert.equal(sourceSessionId, "sorgente");
    await coda;
    return { workspace: "C:/lavoro", allegati: [{ nome: "immagine.png", mimeType: "image/png", data: "cHJvdmE=" }] };
  });
  const avvio = CONSIGLIO.avviaConsiglio({ sourceSessionId: "sorgente", prompt: "Bozza intatta.", operationId: "op-legacy", chiama });
  assert.equal(richieste, 0, "il vecchio ingresso attende la lettura degli allegati");
  sblocca();
  assert.equal((await avvio).codice, "allegato-non-ammesso");
  assert.equal(richieste, 0);
  scollega();
  assert.equal((await CONSIGLIO.avviaConsiglio({ sourceSessionId: "sorgente", prompt: "Bozza intatta.", operationId: "op-legacy-libero", chiama })).avviato, true);
  assert.equal(richieste, 1, "lo smontaggio rimuove soltanto il proprio lettore");
});

test("nome e versione della preimpostazione congelata restano nello stato e nella vista dopo Rifai", () => {
  const preimpostazione = { id: "rapido", nome: "Rapido", versione: 3 };
  const dettaglio = { ...DETTAGLIO, lavoro: { ...DETTAGLIO.lavoro, preimpostazione } };
  const prima = CONSIGLIO.applicaDettaglioConsiglio(CONSIGLIO.statoIniziale(), dettaglio).stato;
  assert.deepEqual(prima.lavori.L1.preimpostazione, preimpostazione);
  preimpostazione.nome = "Nome cambiato nell'archivio";
  preimpostazione.versione = 4;
  const congelata = { id: "rapido", nome: "Rapido", versione: 3 };
  assert.deepEqual(prima.lavori.L1.preimpostazione, congelata, "lo stato non condivide l'oggetto ricevuto dal ponte");
  const dopo = CONSIGLIO.registraNuovaRevisione(prima, { lavoroId: "L1", revisione: 2 });
  const superata = CONSIGLIO.applicaDettaglioConsiglio(dopo, dettaglio);
  assert.equal(superata.applicato, false, "una risposta della revisione precedente resta scartata");
  assert.deepEqual(CONSIGLIO.vistaRisultato(superata.stato.lavori.L1).preimpostazione, congelata);
  const snapshot = CONSIGLIO.applicaSnapshotConsiglio(CONSIGLIO.statoIniziale(), [{
    id: "consiglio:L1", consiglio: { lavoroId: "L1", revisione: 2, seq: 14, preimpostazione: congelata },
  }]);
  assert.deepEqual(snapshot.lavori.L1.preimpostazione, congelata, "anche uno snapshot che espone i metadati li conserva");
  assert.equal(CONSIGLIO.vistaRisultato(statoCompleto().lavori.L1).preimpostazione, null, "i lavori precedenti restano senza preimpostazione");
});

// --- Passo 6: Approva ---

test("Approva scrive la bozza della conversazione sorgente e non invia nulla", async () => {
  const stato = statoCompleto();
  const lavoro = { ...stato.lavori.L1, azioni: { approva: true, rifai: true, annulla: true } };
  const chiamate = [];
  const bozze = [];
  const esito = await CONSIGLIO.approvaConsiglio({
    lavoro,
    operationId: "op-approva-1",
    chiama: async (via, corpo) => {
      chiamate.push({ via, corpo });
      return { ok: true, dati: { stato: "approvato", testo: "Testo fuso del consiglio.", approvatoIl: "2026-09-11T09:00:00.000Z" } };
    },
    scriviBozza: async (dati) => {
      bozze.push(dati);
      return true;
    },
  });
  assert.equal(esito.approvato, true);
  assert.deepEqual(chiamate.map((chiamata) => chiamata.via), ["/api/consiglio/approva"]);
  assert.deepEqual(chiamate[0].corpo, {
    operationId: "op-approva-1",
    lavoroId: "L1",
    revisione: 1,
    risultatoHash: "impronta-1",
  });
  assert.deepEqual(bozze, [{ sessionId: "sorgente", testo: "Testo fuso del consiglio." }]);

  const corpo = corpoFunzione("scriviBozzaConsiglio");
  assert.doesNotMatch(corpo, /\binvia\s*\(/, "Approva non deve inviare il testo a pi");
  assert.doesNotMatch(corpo, /api\/comando/, "Approva non deve passare da un comando RPC");
  assert.match(corpo, /salvaBozza\(sessione\)/);

  const sessione = { id: "sorgente", bozza: "", bozzaSporca: false, chiaveBozza: "chiave" };
  const input = creaNodo("textarea");
  const salvate = [];
  const interfaccia = ambienteFunzioni({
    APP: { sessioni: new Map([["sorgente", sessione]]), attivaId: "sorgente" },
    DOM: { input },
    ramificaLineageBozza: () => {},
    salvaBozza: (voce) => salvate.push(voce.bozza),
    adattaAltezza: () => {},
    aggiornaInterfacciaAttiva: () => {},
  }, [{ nome: "scriviBozzaConsiglio", firma: "{ sessionId, testo }" }]);
  assert.equal(interfaccia.scriviBozzaConsiglio({ sessionId: "sorgente", testo: "Testo fuso del consiglio." }), true);
  assert.equal(sessione.bozza, "Testo fuso del consiglio.");
  assert.equal(input.value, "Testo fuso del consiglio.");
  assert.deepEqual(salvate, ["Testo fuso del consiglio."]);
});

// La conversazione di partenza può essere stata chiusa mentre il consiglio
// lavorava: la bozza non viene scritta da nessuna parte e l'utente deve saperlo,
// perché il testo resta leggibile solo sulla scheda Risultato.
test("Approva senza la conversazione di partenza non promette la bozza", async () => {
  const stato = statoCompleto();
  const lavoro = { ...stato.lavori.L1, azioni: { approva: true, rifai: true, annulla: true } };
  const esito = await CONSIGLIO.approvaConsiglio({
    lavoro,
    operationId: "op-approva-2",
    chiama: async () => ({ ok: true, dati: { stato: "approvato", testo: "Testo fuso del consiglio." } }),
    scriviBozza: async () => false,
  });
  assert.equal(esito.approvato, true);
  assert.equal(esito.bozzaScritta, false, "l'esito deve dire che la bozza non è stata scritta");

  const scritto = await CONSIGLIO.approvaConsiglio({
    lavoro,
    operationId: "op-approva-3",
    chiama: async () => ({ ok: true, dati: { stato: "approvato", testo: "Testo fuso del consiglio." } }),
    scriviBozza: async () => true,
  });
  assert.equal(scritto.bozzaScritta, true);

  // Il messaggio che l'utente legge viene dal codice vero della scheda, con la
  // scrittura della bozza vera: senza la conversazione di partenza in
  // APP.sessioni, scriviBozzaConsiglio non trova dove scrivere.
  const toast = [];
  const ambiente = {
    APP: { consiglio: { lavori: { L1: lavoro } }, sessioni: new Map(), attivaId: null },
    CONSIGLIO_CORE: CONSIGLIO,
    DOM: { input: creaNodo("textarea") },
    chiamaConsiglio: async () => ({ ok: true, dati: { stato: "approvato", testo: "Testo fuso del consiglio." } }),
    toast: (messaggio, tipo = "") => toast.push({ messaggio, tipo }),
    attivaSessione: () => assert.fail("non c'è nessuna conversazione di partenza da attivare"),
    aggiornaDettaglioConsiglio: () => Promise.resolve(true),
    ramificaLineageBozza: () => {},
    salvaBozza: () => {},
    adattaAltezza: () => {},
    aggiornaInterfacciaAttiva: () => {},
  };
  const interfacciaScheda = ambienteFunzioni(ambiente, [
    { nome: "scriviBozzaConsiglio", firma: "{ sessionId, testo }" },
    { nome: "approvaConsiglioDallaScheda", asincrona: true, firma: "lavoroId" },
  ]);
  await interfacciaScheda.approvaConsiglioDallaScheda("L1");
  assert.equal(toast.length, 1);
  assert.equal(toast[0].tipo, "avviso");
  assert.match(toast[0].messaggio, /non è più aperta/);
  assert.doesNotMatch(toast[0].messaggio, /pronto da inviare/,
    "senza bozza scritta non si può promettere un testo pronto da inviare");

  const sessione = { id: "sorgente", bozza: "", bozzaSporca: false, chiaveBozza: "chiave" };
  ambiente.APP.sessioni.set("sorgente", sessione);
  let attivata = null;
  ambiente.attivaSessione = (id) => { attivata = id; };
  const conSorgente = ambienteFunzioni(ambiente, [
    { nome: "scriviBozzaConsiglio", firma: "{ sessionId, testo }" },
    { nome: "approvaConsiglioDallaScheda", asincrona: true, firma: "lavoroId" },
  ]);
  await conSorgente.approvaConsiglioDallaScheda("L1");
  assert.equal(attivata, "sorgente");
  assert.equal(sessione.bozza, "Testo fuso del consiglio.");
  assert.equal(toast[1].tipo, "");
  assert.match(toast[1].messaggio, /pronto da inviare o copiare/);
});

// --- Passo 7: Rifai ---

test("Rifai conserva la revisione precedente e mostra le nuove assegnazioni", async () => {
  const stato = statoCompleto();
  const esito = await CONSIGLIO.rifaiConsiglio({
    lavoro: stato.lavori.L1,
    istruzioni: "Più corto, e cita le fonti.",
    ripristina: false,
    operationId: "op-rifai-1",
    chiama: async (via, corpo) => {
      assert.equal(via, "/api/consiglio/rifai");
      assert.equal(corpo.revisioneAttesa, 1);
      assert.equal(corpo.istruzioni, "Più corto, e cita le fonti.");
      return { ok: true, dati: { lavoroId: "L1", revisione: 2, stato: "preparazione", ripristino: { possibile: false, file: [] } } };
    },
    chiediConferma: async () => assert.fail("senza ripristino non si chiede conferma"),
  });
  assert.equal(esito.rifatto, true);
  assert.equal(esito.revisionePrecedente, 1);
  assert.equal(esito.revisione, 2);

  const dopo = CONSIGLIO.registraNuovaRevisione(stato, { lavoroId: "L1", revisione: 2 });
  assert.equal(dopo.lavori.L1.revisione, 2);
  assert.equal(dopo.lavori.L1.storico.length, 1);
  assert.equal(dopo.lavori.L1.storico[0].revisione, 1);
  assert.equal(dopo.lavori.L1.storico[0].risultato.testo, "Testo fuso del consiglio.");
  assert.equal(dopo.lavori.L1.risultato, null, "la revisione nuova non eredita il risultato vecchio");
  // La scheda si ridisegna subito dopo, prima che il ponte risponda: i pulsanti
  // non possono restare quelli della revisione chiusa.
  const appena = CONSIGLIO.vistaRisultato(dopo.lavori.L1);
  assert.equal(appena.azioni.find((azione) => azione.chiave === "approva").attivo, false,
    "senza bozza non c'è niente da approvare");
  assert.equal(appena.azioni.find((azione) => azione.chiave === "approva").motivo,
    "Il consiglio sta ancora lavorando.");
  assert.equal(appena.azioni.find((azione) => azione.chiave === "rifai").attivo, false);
  assert.equal(appena.azioni.find((azione) => azione.chiave === "annulla").attivo, true,
    "una revisione in corso si può annullare");

  const nuovoDettaglio = {
    ...DETTAGLIO,
    lavoro: { ...DETTAGLIO.lavoro, stato: "raccolta", revisione: 2, motivo: null },
    ruoli: [
      { roleId: "consigliere-1", tipo: "consigliere", ordine: 1, provider: "finto", modello: "delta", nomeModello: "Delta", guiSessionId: "s4", stato: "in_corso", tentativo: 0, attesaFinoA: null, errore: null },
      { roleId: "scrittore", tipo: "scrittore", ordine: 2, provider: "finto", modello: "gamma", nomeModello: "Gamma", guiSessionId: "s5", stato: "preparazione", tentativo: 0, attesaFinoA: null, errore: null },
    ],
    contributi: [],
    risultato: null,
    controllo: null,
    azioni: { approva: false, rifai: false, annulla: true },
    seq: 30,
  };
  const aggiornato = CONSIGLIO.applicaDettaglioConsiglio(dopo, nuovoDettaglio).stato;
  const vista = CONSIGLIO.vistaRisultato(aggiornato.lavori.L1);
  assert.deepEqual(
    vista.assegnazioni.map((voce) => `${voce.etichetta}: ${voce.modello}`),
    ["Consigliere 1: Delta", "Scrittore: Gamma"],
  );
  assert.deepEqual(vista.storico, [{ revisione: 1, stato: "Bozza bloccata" }]);
  assert.match(testoDi(disegnaPannello(aggiornato)), /Consigliere 1 \| Delta/);
});

test("Rifai mostra i file da ripristinare e non procede senza conferma", async () => {
  const stato = statoCompleto();
  const chiamate = [];
  let elencoMostrato = null;
  const esito = await CONSIGLIO.rifaiConsiglio({
    lavoro: stato.lavori.L1,
    istruzioni: null,
    ripristina: true,
    operationId: "op-rifai-2",
    chiama: async (via, corpo) => {
      chiamate.push(corpo);
      return {
        ok: true,
        dati: {
          lavoroId: "L1",
          revisione: 1,
          stato: "bozza_bloccata",
          ripristino: { possibile: true, file: ["app/finto.mjs", "app/altro.mjs"], conferma: "richiesta" },
        },
      };
    },
    chiediConferma: async ({ file }) => {
      elencoMostrato = file;
      return false;
    },
  });
  assert.equal(esito.rifatto, false);
  assert.equal(esito.codice, "ripristino-non-confermato");
  assert.deepEqual(elencoMostrato, ["app/finto.mjs", "app/altro.mjs"]);
  assert.deepEqual(esito.file, ["app/finto.mjs", "app/altro.mjs"]);
  assert.equal(chiamate.length, 1, "senza conferma non si richiama il ponte");
  assert.equal(chiamate[0].confermaRipristino, undefined);

  const chiamateConfermate = [];
  const confermato = await CONSIGLIO.rifaiConsiglio({
    lavoro: stato.lavori.L1,
    istruzioni: null,
    ripristina: true,
    operationId: "op-rifai-3",
    chiama: async (via, corpo) => {
      chiamateConfermate.push(corpo);
      if (chiamateConfermate.length === 1) {
        return {
          ok: true,
          dati: { ripristino: { possibile: true, file: ["app/finto.mjs"], conferma: "richiesta" } },
        };
      }
      return { ok: true, dati: { lavoroId: "L1", revisione: 2, stato: "preparazione", ripristino: { possibile: true, eseguito: true, file: ["app/finto.mjs"] } } };
    },
    chiediConferma: async () => true,
  });
  assert.equal(confermato.rifatto, true);
  assert.equal(chiamateConfermate.length, 2);
  assert.equal(chiamateConfermate[1].confermaRipristino, true);
  assert.deepEqual(confermato.fileRipristinati, ["app/finto.mjs"]);
});

// Ambiente per le letture di stato: APP, il modulo del consiglio e i doppi dei
// pochi appigli che le due funzioni vere usano.
function ambienteLetture(stato, chiamaConsiglio) {
  const toast = [];
  const ridisegnate = [];
  const ambiente = {
    APP: { consiglio: stato, dettagliConsiglioInCorso: new Map(), sessioni: new Map() },
    CONSIGLIO_CORE: CONSIGLIO,
    chiamaConsiglio,
    ridisegnaConsiglio: (lavoroId) => ridisegnate.push(lavoroId),
    toast: (messaggio, tipo = "") => toast.push({ messaggio, tipo }),
    chiediTesto: async () => "Più corto, e cita le fonti.",
    chiediConfermaRipristino: async () => true,
  };
  const interfaccia = ambienteFunzioni(ambiente, [
    { nome: "aggiornaDettaglioConsiglio", firma: "lavoroId" },
    { nome: "leggiDettaglioConsiglio", asincrona: true, firma: "lavoroId, riprova" },
    { nome: "rifaiConsiglioDallaScheda", asincrona: true, firma: "lavoroId" },
  ]);
  return { ambiente, interfaccia, toast, ridisegnate };
}

// Il rilievo in chiaro: con una lettura già in volo, l'attesa di Rifai tornava
// subito e il messaggio annunciava la revisione nuova senza le assegnazioni,
// che erano appena state azzerate.
test("Rifai attende la lettura già in volo e solo allora elenca le assegnazioni", async () => {
  const stato = statoCompleto();
  let sblocca;
  const primaLettura = new Promise((risolvi) => { sblocca = risolvi; });
  const letture = [];
  const chiamaConsiglio = async (via, corpo) => {
    if (via === "/api/consiglio/rifai") return { ok: true, dati: { lavoroId: "L1", revisione: 2, stato: "preparazione" } };
    letture.push(corpo);
    if (letture.length === 1) return primaLettura;
    return {
      ok: true,
      dati: {
        ...DETTAGLIO,
        lavoro: { ...DETTAGLIO.lavoro, revisione: 2, stato: "raccolta", motivo: null },
        ruoli: [
          { roleId: "consigliere-1", tipo: "consigliere", ordine: 1, provider: "finto", modello: "delta", nomeModello: "Delta", guiSessionId: "s4", stato: "in_corso", tentativo: 0 },
          { roleId: "scrittore", tipo: "scrittore", ordine: 2, provider: "finto", modello: "gamma", nomeModello: "Gamma", guiSessionId: "s5", stato: "preparazione", tentativo: 0 },
        ],
        contributi: [],
        risultato: null,
        controllo: null,
        azioni: { approva: false, rifai: false, annulla: true },
        seq: 30,
      },
    };
  };
  const { ambiente, interfaccia, toast } = ambienteLetture(stato, chiamaConsiglio);

  const inVolo = interfaccia.aggiornaDettaglioConsiglio("L1");
  assert.equal(letture.length, 1);
  assert.equal(interfaccia.aggiornaDettaglioConsiglio("L1"), inVolo,
    "chi arriva a lettura aperta riceve quella promessa, non un ritorno immediato");
  assert.equal(letture.length, 1, "una lettura in volo non si duplica");

  const rifai = interfaccia.rifaiConsiglioDallaScheda("L1");
  await new Promise((risolvi) => setTimeout(risolvi, 0));
  assert.equal(toast.length, 0, "il messaggio non può uscire prima della lettura");
  assert.equal(ambiente.APP.consiglio.lavori.L1.revisione, 2);
  // La lettura in volo era partita per la revisione 1: arriva tardi e non vale
  // più, quindi la catena ne fa una seconda invece di lasciare la scheda ferma.
  sblocca({ ok: true, dati: { ...DETTAGLIO, seq: 9 } });
  await rifai;
  assert.equal(letture.length, 2, "dopo una lettura sorpassata se ne fa una sola in più");
  assert.equal(ambiente.APP.consiglio.lavori.L1.risultato, null, "la bozza della revisione 1 non torna indietro");
  assert.equal(toast.length, 1);
  assert.match(toast[0].messaggio, /^Revisione 2 avviata: Consigliere 1 con Delta, Scrittore con Gamma$/, toast[0].messaggio);
  assert.equal(ambiente.APP.dettagliConsiglioInCorso.size, 0, "a lettura finita la chiave si libera");
});

test("una lettura di stato fallita avvisa dopo un solo ritentativo", async () => {
  const stato = statoCompleto();
  const letture = [];
  const { ambiente, interfaccia, toast } = ambienteLetture(stato, async (via) => {
    letture.push(via);
    return { ok: false, codice: "errore", messaggio: "Il ponte locale non risponde." };
  });
  const esito = await interfaccia.aggiornaDettaglioConsiglio("L1");
  assert.equal(esito, false);
  assert.equal(letture.length, 2, "un tentativo e un solo ritentativo, non un ciclo");
  assert.equal(toast.length, 1, "l'errore si dice una volta, non si ingoia");
  assert.equal(toast[0].tipo, "errore");
  assert.match(toast[0].messaggio, /Non riesco a leggere il risultato del consiglio: Il ponte locale non risponde\./);
  assert.equal(ambiente.APP.consiglio.lavori.L1.dettaglioDaLeggere, false,
    "lo stato precedente resta quello che era: qui era già stato letto");
  assert.equal(ambiente.APP.dettagliConsiglioInCorso.size, 0);
  assert.equal(await interfaccia.aggiornaDettaglioConsiglio(null), false, "senza lavoro non si chiama il ponte");
  assert.equal(letture.length, 2);
});

// --- Passo 8: pannello dei ruoli ---

const RISPOSTA_RUOLI = {
  version: 3,
  configurazione: {
    schemaVersion: 1,
    version: 3,
    consiglieri: [{ roleId: "consigliere-1", model: null, thinking: null }],
    scrittore: { roleId: "scrittore", model: { provider: "finto", modelId: "alfa" }, thinking: "high" },
  },
  effettive: {
    consiglieri: [{ roleId: "consigliere-1", tipo: "consigliere", ordine: 1, provider: "finto", modello: "beta", nomeModello: "Beta", thinking: null, automatico: true, nonDisponibile: null }],
    scrittore: { roleId: "scrittore", tipo: "scrittore", ordine: 2, provider: "finto", modello: "alfa", nomeModello: "Alfa", thinking: "high", automatico: false, nonDisponibile: null },
  },
  catalogo: [
    { provider: "finto", modelId: "alfa", nome: "Alfa" },
    { provider: "finto", modelId: "beta", nome: "Beta" },
  ],
  problemi: [],
  avvioPossibile: true,
  cartellaLavori: "C:\\finto\\.pi\\gui\\consigli",
};

test("il pannello elenca i modelli del catalogo ricevuto", () => {
  const vista = CONSIGLIO.vistaPannelloRuoli(RISPOSTA_RUOLI);
  assert.deepEqual(vista.catalogo.map((voce) => voce.chiave), ["finto/alfa", "finto/beta"]);
  assert.deepEqual(vista.righe.map((riga) => riga.etichetta), ["Consigliere 1", "Scrittore"]);
  assert.equal(vista.righe[0].modelloScelto, null);
  assert.equal(vista.righe[1].modelloScelto, "finto/alfa");
  assert.match(vista.rigaSalvataggio, /consigli/);

  const contenitore = creaNodo("section");
  const stato = { vista, bozza: CONSIGLIO.bozzaRuoli(vista), livelli: ["low", "high"] };
  const interfaccia = ambienteFunzioni({
    CONSIGLIO_CORE: CONSIGLIO,
    crea: creaNodo,
    traduciLivello: (livello) => (livello === "high" ? "alto" : "basso"),
  }, [{ nome: "disegnaPannelloRuoliConsiglio", firma: "contenitore, stato, azioni" }]);
  interfaccia.disegnaPannelloRuoliConsiglio(contenitore, stato, {
    segnaModificato: () => {},
    aggiungi: () => {},
    togli: () => {},
    muovi: () => {},
  });
  const selezioni = tutti(contenitore).filter((nodo) => nodo.tag === "select");
  assert.equal(selezioni.length, 4, "un modello e un ragionamento per ciascuno dei due ruoli");
  const opzioniModello = selezioni[0].children.map((opzione) => opzione.value);
  assert.deepEqual(opzioniModello, ["", "finto/alfa", "finto/beta"]);
  assert.deepEqual(
    selezioni[0].children.map((opzione) => opzione.textContent),
    ["Automatico", "Alfa", "Beta"],
  );
  assert.equal(selezioni[2].value, "finto/alfa", "lo scrittore mostra il modello che ha salvato");
  assert.match(testoDi(contenitore), /consigli/, "va detto dove finiscono i lavori");

  const corpo = CONSIGLIO.corpoConfigurazioneRuoli(vista, stato.bozza);
  assert.deepEqual(corpo, {
    expectedVersion: 3,
    consiglieri: [{ roleId: "consigliere-1", model: null, thinking: null }],
    scrittore: { roleId: "scrittore", model: { provider: "finto", modelId: "alfa" }, thinking: "high" },
  });
});

// La prima lettura del pannello è una GET. Il banco esercita la catena vera
// apriPannelloRuoliConsiglio -> chiamaConsiglio -> chiedi, con un fetch finto
// che legge il corpo come lo legge il ponte (app/server.mjs, leggiCorpo): una
// POST con un corpo che non è un oggetto è un 400, non una lettura.
test("il pannello dei ruoli legge con una GET e salva con una POST", async () => {
  const richieste = [];
  let versione = 3;
  const fetchFinto = async (via, opzioni = {}) => {
    const metodo = opzioni.method || "GET";
    const grezzo = Object.hasOwn(opzioni, "body") ? opzioni.body : null;
    richieste.push({ via, metodo, grezzo });
    if (metodo === "POST") {
      let letto;
      try {
        letto = grezzo ? JSON.parse(grezzo) : {};
      } catch {
        letto = undefined;
      }
      if (!letto || typeof letto !== "object" || Array.isArray(letto)) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ errore: "Corpo JSON non valido: serve un oggetto", codice: "schema" }),
        };
      }
      versione = letto.expectedVersion + 1;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...RISPOSTA_RUOLI, version: versione, configurazione: { ...RISPOSTA_RUOLI.configurazione, version: versione } }),
    };
  };
  const contenitore = creaNodo("section");
  const interfaccia = ambienteFunzioni({
    APP: { sessioni: new Map(), clientId: "c1", replayId: "r1", tokenApi: "t1" },
    CONSIGLIO_CORE: CONSIGLIO,
    crea: creaNodo,
    fetch: fetchFinto,
    traduciLivello: (livello) => livello,
    testoErrore: (errore) => errore.message,
    ponteNonRaggiungibile: () => {},
    programmaRiconnessione: () => {},
    erroreConEsitoIgnoto: (messaggio) => new Error(messaggio),
  }, [
    { nome: "chiedi", asincrona: true, firma: "via, { corpo, signal } = {}" },
    { nome: "chiamaConsiglio", asincrona: true, firma: "via, corpo" },
    { nome: "disegnaPannelloRuoliConsiglio", firma: "contenitore, stato, azioni" },
    { nome: "apriPannelloRuoliConsiglio", asincrona: true, firma: "contenitore, sessionId" },
  ]);

  await interfaccia.apriPannelloRuoliConsiglio(contenitore, "sorgente");
  assert.equal(richieste.length, 1);
  assert.equal(richieste[0].metodo, "GET", "la prima lettura non deve essere una POST");
  assert.equal(richieste[0].via, "/api/consiglio/ruoli?sessionId=sorgente");
  assert.equal(richieste[0].grezzo, null, "una GET non porta corpo");
  const messaggio = tutti(contenitore).find((nodo) => nodo.getAttribute("role") === "status");
  assert.match(messaggio.textContent, /^Versione 3\./, messaggio.textContent);
  assert.doesNotMatch(testoDi(contenitore), /Non riesco a leggere i ruoli del consiglio/);
  assert.ok(tutti(contenitore).some((nodo) => nodo.tag === "select"), "il pannello deve essersi riempito");

  const salva = tutti(contenitore).find((nodo) => nodo.textContent === "Salva i ruoli del consiglio");
  assert.equal(salva.disabled, true, "senza modifiche non c'è niente da salvare");
  const selezione = tutti(contenitore).filter((nodo) => nodo.tag === "select")[0];
  selezione.value = "finto/beta";
  selezione.onchange();
  assert.equal(salva.disabled, false);
  await salva.onclick();
  assert.equal(richieste.length, 2);
  assert.equal(richieste[1].metodo, "POST");
  assert.equal(richieste[1].via, "/api/consiglio/ruoli");
  const inviato = JSON.parse(richieste[1].grezzo);
  assert.equal(inviato.expectedVersion, 3);
  assert.equal(inviato.sourceSessionId, "sorgente");
  assert.deepEqual(inviato.consiglieri, [{ roleId: "consigliere-1", model: { provider: "finto", modelId: "beta" }, thinking: null }]);
  assert.match(messaggio.textContent, /^Versione 4\./, "dopo il salvataggio si rilegge la versione nuova");
});

test("il pannello avvisa sui modelli ripetuti e su quelli spariti dal catalogo", () => {
  const ripetuto = CONSIGLIO.vistaPannelloRuoli({
    ...RISPOSTA_RUOLI,
    effettive: {
      consiglieri: [{ roleId: "consigliere-1", tipo: "consigliere", ordine: 1, provider: "finto", modello: "alfa", nomeModello: "Alfa" }],
      scrittore: { roleId: "scrittore", tipo: "scrittore", ordine: 2, provider: "finto", modello: "alfa", nomeModello: "Alfa" },
    },
  });
  assert.ok(
    ripetuto.avvisi.some((avviso) => /Consigliere 1 e Scrittore usano lo stesso modello/.test(avviso)),
    ripetuto.avvisi.join(" | "),
  );

  const sparito = CONSIGLIO.vistaPannelloRuoli({
    ...RISPOSTA_RUOLI,
    effettive: {
      ...RISPOSTA_RUOLI.effettive,
      consiglieri: [{ roleId: "consigliere-1", tipo: "consigliere", ordine: 1, provider: "finto", modello: "beta", nomeModello: "Beta", nonDisponibile: "finto/gamma" }],
    },
    problemi: [{ roleId: "consigliere-1", codice: "modello-non-disponibile", messaggio: "Il modello finto/gamma assegnato a consigliere-1 non è più disponibile: il ruolo torna al modello predefinito." }],
  });
  assert.ok(sparito.avvisi.some((avviso) => avviso.includes("Non disponibile")), sparito.avvisi.join(" | "));
  assert.equal(sparito.righe[0].nonDisponibile, "finto/gamma");
});

// Un identificativo di modello scritto a mano nel client è la via più corta per
// una GUI che promette modelli che il ponte non ha.
const FAMIGLIE_MODELLO = "(?:gpt|claude|gemini|llama|qwen|mistral|deepseek|grok|kimi|glm|phi|codestral|command|nova|o[0-9])";
const IDENTIFICATIVO_MODELLO = new RegExp(
  `^(?:[a-z][a-z0-9_-]*\\/)?${FAMIGLIE_MODELLO}-[a-z0-9][a-z0-9.:_-]*$`,
);

test("nessun identificativo di modello è scritto a mano in app/public", async () => {
  const cartella = join(RADICE, "app", "public");
  const nomi = (await readdir(cartella)).filter((nome) => /\.(?:js|html)$/.test(nome));
  assert.ok(nomi.includes("consiglio-core.js"), "il modulo del consiglio deve essere fra i file controllati");
  const trovati = [];
  for (const nome of nomi) {
    const codice = await readFile(join(cartella, nome), "utf8");
    for (const corrispondenza of codice.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g)) {
      const valore = corrispondenza[2].trim();
      if (IDENTIFICATIVO_MODELLO.test(valore)) trovati.push(`${nome}: ${valore}`);
    }
  }
  assert.deepEqual(trovati, [], "i modelli arrivano dal catalogo del ponte, non da una lista nel client");

  const consiglioCore = await readFile(join(cartella, "consiglio-core.js"), "utf8");
  assert.doesNotMatch(consiglioCore, /modelId:\s*["'`]/, "nessuna coppia provider e modello scritta nel client");
  assert.match(consiglioCore, /elenco\(risposta\?\.catalogo\)/, "il catalogo si legge dalla risposta del ponte");
  assert.match(
    corpoFunzione("disegnaPannelloRuoliConsiglio"),
    /for \(const candidato of vista\.catalogo\)/,
    "le opzioni del pannello sono quelle del catalogo ricevuto",
  );
});

// --- Passo 9: riconnessione ---

test("dopo due snapshot consecutivi la scheda risultato è ancora nello stato ricostruito", () => {
  const voci = [
    { id: "sorgente", nomeSessione: "Conversazione", attiva: true },
    {
      id: "s1",
      nomeSessione: "Consigliere 1, Alfa",
      attiva: true,
      consiglio: { lavoroId: "L1", roleId: "consigliere-1", ruolo: "consigliere", invioManuale: false },
    },
    {
      id: "consiglio:L1",
      nomeSessione: "Risultato",
      attiva: false,
      cartella: "C:\\finta\\progetto",
      consiglio: {
        lavoroId: "L1",
        stato: "bozza_valida",
        revisione: 1,
        seq: 12,
        tipo: "codice",
        motivo: null,
        controllo: { tipo: "test", esito: "pass", motivi: [] },
        azioni: { approva: true, rifai: true, annulla: true },
      },
    },
  ];
  let stato = CONSIGLIO.applicaSnapshotConsiglio(CONSIGLIO.statoIniziale(), voci, { sostituisci: true });
  stato = CONSIGLIO.applicaDettaglioConsiglio(stato, {
    ...DETTAGLIO,
    lavoro: { ...DETTAGLIO.lavoro, stato: "bozza_valida", motivo: null },
    controllo: { tipo: "test", esito: "pass", motivi: [], logTroncato: null, impronteFile: [], at: "2026-09-11T08:05:00.000Z" },
    azioni: { approva: true, rifai: true, annulla: true },
    seq: 12,
  }).stato;
  // Due aggiornamenti di pagina di fila: lo stesso snapshot arriva due volte.
  stato = CONSIGLIO.applicaSnapshotConsiglio(stato, voci, { sostituisci: true });
  stato = CONSIGLIO.applicaSnapshotConsiglio(stato, voci, { sostituisci: true });
  assert.deepEqual(Object.keys(stato.lavori), ["L1"]);
  assert.equal(stato.lavori.L1.stato, "bozza_valida");
  assert.equal(stato.lavori.L1.seq, 12);
  assert.equal(stato.lavori.L1.risultato.testo, "Testo fuso del consiglio.");
  assert.deepEqual(stato.ruoliPerSessione.s1, { lavoroId: "L1", roleId: "consigliere-1", ruolo: "consigliere" });
  const vista = CONSIGLIO.vistaRisultato(stato.lavori.L1);
  assert.equal(vista.azioni.find((azione) => azione.chiave === "approva").attivo, true);

  // Il lavoro che il ponte non manda più sparisce, come le sessioni vere.
  const svuotato = CONSIGLIO.applicaSnapshotConsiglio(stato, [voci[0]], { sostituisci: true });
  assert.deepEqual(Object.keys(svuotato.lavori), []);
  const senzaSostituzione = CONSIGLIO.applicaSnapshotConsiglio(stato, [voci[0]]);
  assert.deepEqual(Object.keys(senzaSostituzione.lavori), ["L1"]);
});

test("la scheda Risultato non nasce nel browser ma dalla voce dello snapshot", () => {
  assert.match(
    corpoFunzione("creaSessione"),
    /CONSIGLIO_CORE\.voceSchedaRisultato\(meta\)/,
    "la scheda si crea solo quando il ponte la manda",
  );
  assert.match(corpoFunzione("applicaSnapshot"), /applicaSnapshotConsiglio\(APP\.consiglio, sessioni \|\| \[\], \{ sostituisci \}\)/);
  const corpoEvento = corpoFunzione("gestisciEvento");
  assert.match(corpoEvento, /startsWith\("gui_consiglio_"\)/, "gli eventi del consiglio non sono eventi di sessione");
  // Lo snapshot arriva solo all'apertura del canale: una finestra già collegata
  // deve rileggere lo stato invece di inventarsi la scheda.
  assert.match(
    corpoFunzione("applicaEventoConsiglioGui"),
    /!APP\.sessioni\.has\(scheda\)[\s\S]*?aggiornaDalPonte\(\{ sostituisci: true \}\)/,
  );
});
