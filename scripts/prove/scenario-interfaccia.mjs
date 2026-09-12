import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { VERSIONE_HOST } from "../../app/versione-host.mjs";
import { prepara as preparaEstensioni } from "./scenario-estensioni.mjs";

// Contratto dell'avviatore P1: prepara crea soltanto fixture nel profilo isolato;
// verifica usa le API del Pi finto. Il browser e il lettore di schermo sono una
// prova del titolare: nessun PASS automatico viene attribuito ai gesti della UI.
export const MAPPA_COMANDI = [
  { id: "01-ricerca", origine: "Ricerca comandi", accesso: "Laterale: Comandi; / nel composer; Ctrl+K",
    selettori: ["#btn-cerca-comandi"], comandi: [],
    prova: "Apri Comandi con Invio e con Ctrl+K; poi digita / nel composer. La lista e i gestori coincidono. Frecce, Tab, Invio, Barra ed Esc funzionano; chiudendo ritorna la bozza precedente." },
  { id: "02-aiuto", origine: "hotkeys, changelog", accesso: "Laterale: Aiuto",
    selettori: ["#btn-aiuto"], comandi: ["hotkeys", "changelog"],
    prova: "Apri Aiuto: raggiungi Scorciatoie e Novità. Nell'app desktop la versione numerica ricevuta da updater_status.currentVersion deve coincidere con versioneHostAttesa nella scheda; il valore atteso della fixture viene da app/versione-host.mjs e package.json. Non valgono la versione del protocollo del ponte o di Pi, né la sola parola Versione. Verifica zero updater_check, updater_download o updater_install all'apertura di Aiuto. Nel browser verifica la stessa versione host numerica ricevuta dal campo versioneHost di /api/stato. Registra separatamente l'esito desktop e browser. Apri e chiudi entrambe le finestre, verificando il ritorno del fuoco a un controllo visibile e connesso." },
  { id: "03-cartella", origine: "Apri cartella duplicato", accesso: "Composer: Cartella; laterale: Apri cartella",
    selettori: ["#btn-apri-cartella"], comandi: [],
    prova: "Raggiungi il selettore da entrambe le entrate; scegli le due cartelle chiamate progetto nelle fixture. I gruppi mostrano i percorsi per distinguerle. Annullare conserva bozza e allegati." },
  { id: "04-documenti", origine: "Importa, Condividi, Copia risposta, Esporta, Rinomina, Libera spazio, Uso e costo",
    accesso: "Menu ... della conversazione", selettori: ["#btn-menu-conversazione", "#menu-conversazione"],
    comandi: ["import", "share", "copy", "export", "name", "compact", "session"],
    prova: "Apri ogni voce indicata: Rinomina, Esporta, Importa, Condividi, Libera spazio, Uso e costo, Copia ultima risposta. Verifica finestra, download, copia o motivo del limite restituito dal Pi finto. La tredicesima voce Controlli avanzati apre gli stessi controlli raggiungibili da Comandi > Avanzati. Annulla conferme e pubblicazioni; non usare account o servizi esterni." },
  { id: "05-rami", origine: "Crea versione, Duplica, Albero, Cronologia e rami", accesso: "Menu ... della conversazione",
    selettori: ["#menu-conversazione", "#btn-albero"], comandi: ["new", "clone", "fork-message", "tree", "history"],
    prova: "Nella cartella isolata produci una risposta sintetica del solo Pi finto, quindi prepara una bozza riconoscibile. Ricomincia qui deve aprire la conferma della nuova conversazione: Annulla ed Esc non mandano new_session o fork e conservano contesto e bozza. Riapri e conferma: passa una sola richiesta new_session, nessun fork e nessun prompt; la conversazione precedente resta salvata. Da una conversazione con messaggi, Crea versione da un messaggio apre il selettore scegliFork tramite /api/forche: prima della scelta non manda fork; una scelta manda un solo fork con entryId, nessun new_session o prompt, e rimette il testo ricevuto nella bozza. Duplica usa clone; Mostra albero e Cronologia e rami raggiungono l'albero o un motivo leggibile. Conserva separatamente le evidenze delle cinque voci, senza credenziali." },
  { id: "06-avanzati", origine: "Impostazioni, Modelli rapidi, Fiducia cartella, account, Ricarica, Aggiornamenti",
    accesso: "Laterale: Comandi > Avanzati", selettori: ["#gruppo-comandi", "#btn-avanzati"],
    comandi: ["settings", "scoped-models", "trust", "login", "logout", "reload"],
    prova: "Apri Impostazioni, Modelli rapidi, Fiducia cartella, Accedi, Esci dall'account, Ricarica risorse e Aggiornamenti. Verifica che raggiungano i gestori e mostrino uno stato o motivo leggibile; annulla login/logout, installazioni e aggiornamenti. Il collegamento Impostazioni nel piede resta raggiungibile." },
  { id: "07-shell-rpc", origine: "Shell diretta, !, !!, Protocollo RPC", accesso: "Comandi > Avanzati",
    selettori: ["#btn-avanzati"], comandi: [],
    prova: "Raggiungi Shell diretta e Protocollo RPC completo, leggi l'avviso di sicurezza senza eseguire shell o RPC. In Scorciatoie verifica le forme ! e !!; preparale nella bozza e cancellale senza inviare." },
  { id: "08-composer", origine: "Modello, Ragionamento, Ferma duplicati", accesso: "Composer",
    selettori: ["#btn-modello", "#btn-ragionamento", "#btn-apri-cartella", "#btn-ferma"], comandi: ["model"],
    prova: "Ogni controllo compare una sola volta nel composer. Apri modello e ragionamento, scegli solo valori letti dal catalogo e chiudi con Esc. Durante un lavoro Ferma resta raggiungibile; Esc non attiva Ferma." },
  { id: "09-conversazioni", origine: "Nuova conversazione, Conversazioni salvate, Chiudi sessione", accesso: "Laterale: pulsante, elenco, ricerca, Carica altre, chiusura sulla riga",
    selettori: ["#btn-nuova-conversazione", "#cerca-conversazioni", "#lista-conversazioni", "#btn-carica-altre"],
    comandi: ["new", "resume", "quit"],
    prova: "Cerca Oltre ottanta P3, apri la riga e verifica che non sia duplicata fra aperte e salvate. Azzera la ricerca, usa Carica altre fino alla stessa riga. Apri due conversazioni, prepara bozze e allegati diversi, cambia riga, ricarica e chiudi solo la prima: l'altra conserva identità, bozza e allegati." },
  { id: "10-skill", origine: "Skills disponibili e Cerca", accesso: "Ricerca comandi, elenco skill con origine",
    selettori: ["#btn-cerca-comandi"], comandi: [],
    prova: "Cerca skill:test in Comandi e verifica il gestore della palette. Ogni voce deve mostrare l'origine ricevuta oppure dichiarare che non è disponibile: il Pi finto fornisce skill:test senza un percorso e non ricava il catalogo dalle fixture installate. Nel pannello Estensioni verifica separatamente l'origine della skill prova-estensioni e della risorsa personale disattivata." },
  { id: "11-agenti", origine: "Chiedi al consiglio", accesso: "Composer: pulsante Agenti diviso",
    selettori: ["#btn-allega", "#btn-agenti", "#elenco-preimpostazioni-agenti"], comandi: [],
    prova: "Dopo + ci sono il primario Agenti e la freccia Scegli la preimpostazione del modulo P2. Raggiungi Gestisci con le frecce; scegli con Invio o Barra. Ctrl+Maiusc+Invio nel composer avvia un solo lavoro e nessun invio ordinario; fuori dal composer non avvia nulla." },
  { id: "12-estensione-iso", origine: "Sistema guidato", accesso: "Sezione laterale delle sole estensioni attive",
    selettori: ["#pannello-ospite", "#frame-pannello-ospite"], comandi: ["sistema"],
    prova: "All'avvio e con il solo pacchetto risorse non esistono voci ISO, Sistema Guidato o diari nella navigazione e nelle azioni iniziali. L'ospite è vuoto finché non apri Estensioni. Il ramo positivo Sistema Guidato richiede una fixture backend conforme: dopo Attiva e Applica compare una sola voce, Apri usa /sistema con il sandbox esistente. Apri dalla voce laterale con Invio: la rilettura dell'elenco durante l'apertura non perde l'invocante; Tab resta nell'ospite, Esc e Chiudi restituiscono il fuoco alla voce Sistema Guidato attualmente connessa. Ripeti dopo Ricarica e dopo un aggiornamento dell'elenco; se l'estensione viene disattivata e la voce scompare, la chiusura porta a Estensioni nel piede. Dopo Disattiva e Applica la voce scompare. Registrare separatamente il ramo positivo e il ritorno del fuoco come non eseguiti se la fixture manca." },
];

export const PROVE_BROWSER = [
  { id: "avvio-reale", prova: "Collega Edge headless al ponte isolato e registra gli errori JavaScript dalla navigazione: devono essere zero. Verifica che #lista-conversazioni e #lista-esempi abbiano figli, che #btn-menu-conversazione, #btn-aiuto e #btn-carica-altre abbiano gestori e che #accesso-estensioni sia montato. Ripeti sugli scenari base e interfaccia; i controlli API e i contratti isolati non sostituiscono questa prova." },
  { id: "tre-zone", prova: "All'apertura identifica laterale, conversazione e composer. Non c'è barra delle schede e il menu ... nasce chiuso. Conserva una schermata della vista iniziale e una della conversazione con menu aperto." },
  { id: "azioni-iniziali", prova: "Con bozza vuota attiva separatamente le quattro azioni iniziali. Ciascuna prepara contesto o bozza, non invia prompt. Verifica nel pannello Rete l'assenza di /api/comando con type=prompt (anche con streamingBehavior=steer/followUp) e di /api/consiglio/avvia; annulla il selettore quando richiesto." },
  { id: "stati-righe", prova: "Confronta stati visibili aperta, al lavoro, in attesa e chiusa con lo stato reale. Per l'attesa invia /dialog-test soltanto al Pi finto: il dialogo deve prendere il fuoco, senza mostrare la sessione come ferma. Per il lavoro usa la cartella con consiglio-settled-lento. Registra gli stati non osservati, senza darli per passati." },
  { id: "scorciatoie", prova: "Con due conversazioni aperte premi Ctrl+Alt+Su e Ctrl+Alt+Giù: ogni gesto cambia una sola riga. Ctrl+Alt+N crea una sola conversazione. Ctrl+K apre la palette; Maiusc+Invio aggiunge una riga, Ctrl+V conserva testo e allegati. Durante composizione IME nessuna scorciatoia invia." },
  { id: "menu-tastiera", prova: "Metti il fuoco su ...; apri con Invio, percorri tutte le 13 voci con frecce, Home e Fine e chiudi con Esc. Il fuoco torna a ...; ripeti aprendo con Barra. Tab e Maiusc+Tab chiudono il menu e fanno avanzare il fuoco nella rispettiva direzione, senza richiedere un secondo Tab e senza rimetterlo nella voce appena nascosta." },
  { id: "priorita-tasti", prova: "Apri una finestra dalla palette o da un menu e premi Esc una volta: si chiude solo il livello più interno. Con Pi al lavoro premi Esc senza finestre: nessuna chiamata di arresto. Ripeti con Agenti/Gestisci e con un dialogo del Pi finto. Nel pannello Rete ogni Ctrl+Maiusc+Invio produce al massimo un /api/consiglio/avvia e zero /api/comando con type=prompt (anche con streamingBehavior=steer/followUp)." },
  { id: "finestre-fuoco", prova: "Per ogni finestra sovrapposta verifica aria-modal=true con il lettore di schermo, fuoco sul primo elemento utile, Tab e Maiusc+Tab trattenuti, Esc e Chiudi con ritorno al controllo invocante. Nei gruppi di scelta prova radio native o frecce, Invio e Barra con un solo tabindex=0." },
  { id: "laterale-stretto", prova: "A 900×600 il pulsante #btn-menu apre e richiude il laterale. Verifica la chiusura con clic sul velo e con Esc anche nella schermata iniziale, dove #conversazione è nascosto. Ripeti a tastiera: il fuoco resta raggiungibile; nessun comando della mappa scompare. Ricerca ed elenco lungo scorrono fino a Carica altre; modello, ragionamento, cartella, +, Agenti, Invia/Ferma vanno a capo e restano raggiungibili." },
  { id: "zoom-reale", prova: "Imposta l'ingrandimento del browser al 200% mediante il suo menu, non con CSS zoom né con emulazione della scala del dispositivo. Ripercorri tutte le 12 righe della mappa e verifica anche 900×600 al 200%. Il composer non copre comandi o dialoghi; lo scorrimento porta a tutti i controlli e il suggerimento resta leggibile." },
  { id: "estensioni", prova: "Apri Estensioni nel piede: il contenuto è nell'ospite. Installa pulito dalle fixture, verifica Attiva, Disattiva, Apri, Aggiorna da cartella e Rimuovi. Leggi anteprime e origine; Applica, aggiorna con aggiornamento, poi disattiva e rimuovi. Nessuna risorsa personale o dato viene eliminato. Conserva una schermata del pannello." },
  { id: "consiglio-snapshot", prova: "Nella cartella Agenti delle fixture prepara una richiesta sintetica e avvia Rapido. Sotto il lavoro si trovano Risultato, Consigliere 1, altri consiglieri e Scrittore; F5 conserva appartenenza e ordine senza ruoli sciolti fra le conversazioni." },
  { id: "approva-bozza", prova: "Accanto ad Approva leggi esattamente Metti nella bozza, non invia. Cambia la bozza sorgente dopo l'avvio: Approva offre Sostituisci la bozza e Copia risultato. Prova prima Copia, poi Sostituisci su un secondo lavoro, recupera il testo precedente e verifica zero invii ordinari. Con la sorgente chiusa compare un avviso, senza invio." },
  { id: "console-lettore", prova: "Per ciascuna vista e modalità usa il lettore di schermo: titoli, stati delle righe, selezione, nomi dei pulsanti e finestre sono annunciati. Conserva eventuali errori console, schermate, tabella degli esiti e richieste rilevanti senza token o credenziali." },
];

function verificaRadice(radice, percorso) {
  const relativo = relative(radice, percorso);
  assert.ok(relativo && !isAbsolute(relativo) && relativo !== ".." && !relativo.startsWith(".." + sep), "la fixture deve restare nella radice temporanea");
}

export async function prepara(contesto) {
  const { temporanea, home, cliPi, radice } = contesto;
  assert.equal(cliPi, join(radice, "tests", "fake-pi.mjs"), "lo scenario richiede esclusivamente Pi finto");
  verificaRadice(temporanea, home);
  const estensioni = await preparaEstensioni(contesto);
  const archivio = join(home, ".pi", "agent", "sessions", "interfaccia-p3");
  const cartelle = {
    prima: join(temporanea, "cartelle", "primo", "progetto"),
    seconda: join(temporanea, "cartelle", "secondo", "progetto"),
    rara: join(temporanea, "cartelle", "poco-usata"),
    senza: join(temporanea, "senza-cartella", "archivio-p3"),
    agenti: join(temporanea, "cartelle", "consiglio-catalogo-due-consiglio-uscita-valida-consiglio-settled-lento-interfaccia"),
  };
  for (const percorso of [archivio, ...Object.values(cartelle)]) {
    verificaRadice(temporanea, percorso);
    await mkdir(percorso, { recursive: true });
  }
  const allegato = join(cartelle.prima, "nota-sintetica.md");
  await writeFile(allegato, "Allegato sintetico P3. Nessun dato reale.\n", "utf8");
  const salvate = [];
  for (let indice = 0; indice < 95; indice++) {
    const id = "interfaccia-p3-" + String(indice).padStart(3, "0");
    const nome = indice === 94 ? "Oltre ottanta P3" : "Conversazione sintetica " + String(indice + 1).padStart(3, "0");
    const cwd = indice === 94 ? cartelle.rara : indice < 42 ? cartelle.prima : indice < 84 ? cartelle.seconda : cartelle.senza;
    const percorso = join(archivio, id + ".jsonl");
    const data = new Date(Date.UTC(2026, 0, 1) - indice * 1000);
    await writeFile(percorso, [
      { type: "session", id, cwd, timestamp: data.toISOString() },
      { type: "session_info", name: nome },
      { type: "message", id: "utente-" + indice, parentId: null, timestamp: data.toISOString(), message: { role: "user", content: [{ type: "text", text: "Nota sintetica per l'elenco delle conversazioni." }], timestamp: data.getTime() } },
    ].map(JSON.stringify).join("\n") + "\n", "utf8");
    await utimes(percorso, data, data);
    salvate.push({ id, nome, percorso, cwd });
  }
  const schedaBrowser = {
    stato: "da-eseguire", comando: "node scripts/prova-gui-isolata.mjs --port 4679 --scenario interfaccia",
    versioneHostAttesa: VERSIONE_HOST,
    fonteVersioneHost: "app/versione-host.mjs legge package.json.version del rilascio",
    modalita: ["dimensioni ordinarie, solo tastiera", "900×600, solo tastiera", "zoom browser 200%, solo tastiera", "900×600 e zoom browser 200%", "lettore di schermo"],
    mappa: MAPPA_COMANDI.map((riga) => ({ ...riga, esiti: {}, stato: "da-eseguire" })),
    prove: PROVE_BROWSER.map((prova) => ({ ...prova, stato: "da-eseguire", evidenza: "" })),
    limite: "Le fixture P1 includono un pacchetto risorse e pannelli da rifiutare; non includono un Sistema Guidato funzionante. Il ramo positivo ISO resta distinto e non eseguito finché manca una fixture backend conforme.",
  };
  const scheda = join(temporanea, "scheda-browser-interfaccia.json");
  await writeFile(scheda, JSON.stringify(schedaBrowser, null, 2) + "\n", "utf8");
  const istruzioni = [
    "SCENARIO INTERFACCIA: controlli API automatici e prove browser separate. Nessuna prova browser è già passata.",
    "Apri l'indirizzo stampato dall'avviatore; conserva il comando e la riga Prova isolata, poi schermate ed esiti prima di arrestare l'avviatore, che elimina la propria cartella temporanea.",
    "L'archivio contiene 95 conversazioni; Oltre ottanta P3 è la più vecchia e non sta nella prima pagina di 80. La lettura dell'elenco deve lasciare zero processi fino all'apertura esplicita di una riga.",
    "Il Pi finto non ricostruisce il transcript dai JSONL delle fixture: questi verificano elenco e riapertura. Per provare le azioni sui messaggi, produci prima una risposta sintetica nella conversazione aperta.",
    "Il menu Rete serve a contare le richieste; non salvare token negli allegati al rapporto. Non autenticarti, non pubblicare e non eseguire shell o RPC.",
    "Versione numerica attesa in Aiuto: " + VERSIONE_HOST + " (app/versione-host.mjs, package.json.version). La versione di Pi e il numero del protocollo del ponte non sono versioni dell'app. La disponibilità nel desktop e nel browser va registrata separatamente.",
    "Cartelle omonime: " + cartelle.prima + " | " + cartelle.seconda,
    "Cartella per Agenti e stato di lavoro: " + cartelle.agenti,
    "Allegato sintetico: " + allegato,
    ...Object.entries(estensioni.cartelle).filter(([nome]) => ["pulito", "aggiornamento"].includes(nome)).map(([nome, percorso]) => "Pacchetto " + nome + ": " + percorso),
    "Scheda degli esiti da compilare: " + scheda,
    ...PROVE_BROWSER.map((prova) => "PROVA " + prova.id + ": " + prova.prova),
    ...MAPPA_COMANDI.map((riga) => "MAPPA " + riga.id + " — " + riga.accesso + ": " + riga.prova),
    "Ripeti la mappa riga per riga in tutte le modalità della scheda. Scrivi PASS, FAIL o NON ESEGUITO per ogni riga con la sua evidenza; una voce non verificata non chiude il passaggio.",
  ];
  await writeFile(join(temporanea, "istruzioni-interfaccia.txt"), istruzioni.join("\n\n") + "\n", "utf8");
  return { cartelle, allegato, salvate, estensioni: estensioni.cartelle, risorsaPersonale: estensioni.percorso, scheda, istruzioni };
}

export async function verifica({ fixture, api, ponte, cliPi, radice, temporanea }) {
  assert.equal(cliPi, join(radice, "tests", "fake-pi.mjs"));
  const statoPrima = await api("/api/stato");
  assert.equal(statoPrima.stato, 200);
  assert.equal(statoPrima.corpo.versioneHost, VERSIONE_HOST, "la versione host HTTP viene dal rilascio, non dal protocollo del ponte");
  assert.deepEqual(statoPrima.corpo.sessioni, [], "la prova inizia senza conversazioni aperte");
  assert.equal(ponte.sessioni.size, 0);
  const elencoPagine = [];
  let cursore;
  let numeroPagine = 0;
  do {
    const risposta = await api("/api/sessioni-salvate", { limite: 80, ...(cursore ? { cursore } : {}) });
    assert.equal(risposta.stato, 200, JSON.stringify(risposta.corpo));
    assert.equal(risposta.corpo.sessioni.length, numeroPagine === 0 ? 80 : 15);
    if (numeroPagine === 0) assert.ok(!risposta.corpo.sessioni.some((riga) => riga.id === "interfaccia-p3-094"));
    elencoPagine.push(...risposta.corpo.sessioni);
    cursore = risposta.corpo.prossimoCursore;
    numeroPagine++;
    assert.ok(numeroPagine <= 2, "la paginazione delle fixture deve terminare senza cicli");
    assert.equal(ponte.sessioni.size, 0, "Carica altre non crea sessioni Pi");
  } while (cursore);
  assert.equal(elencoPagine.length, 95);
  assert.equal(new Set(elencoPagine.map((riga) => riga.id)).size, 95, "nessun duplicato fra pagine");
  assert.equal(elencoPagine.at(-1).id, "interfaccia-p3-094");
  const ricerca = await api("/api/sessioni-salvate", { ricerca: "Oltre ottanta P3", limite: 80 });
  assert.equal(ricerca.stato, 200);
  assert.deepEqual(ricerca.corpo.sessioni.map((riga) => riga.id), ["interfaccia-p3-094"]);
  assert.equal(ricerca.corpo.prossimoCursore, null);
  const rara = await api("/api/sessioni-salvate", { cartella: fixture.cartelle.rara, limite: 80 });
  assert.equal(rara.stato, 200);
  assert.deepEqual(rara.corpo.sessioni.map((riga) => riga.id), ["interfaccia-p3-094"]);
  const senzaCartella = elencoPagine.filter((riga) => riga.senzaCartella);
  assert.equal(senzaCartella.length, 10);
  assert.ok(senzaCartella.every((riga) => riga.cwd === null), "il ponte non espone directory tecniche per Senza cartella");
  const estensioni = await api("/api/estensioni");
  assert.equal(estensioni.stato, 200);
  assert.deepEqual(estensioni.corpo.estensioni, [], "le fixture su disco non installano estensioni implicitamente");
  assert.equal(estensioni.corpo.risorsePersonali.find((risorsa) => risorsa.percorso === fixture.risorsaPersonale)?.attiva, false);
  const statoDopo = await api("/api/stato");
  assert.equal(statoDopo.stato, 200);
  assert.equal(statoDopo.corpo.versioneHost, VERSIONE_HOST);
  assert.deepEqual(statoDopo.corpo.sessioni, []);
  assert.equal(ponte.sessioni.size, 0, "ricerca ed elenco non avviano sessioni");
  assert.equal(ponte.terminali.size, 0);
  await writeFile(join(temporanea, "evidenza-api-interfaccia.json"), JSON.stringify({
    automatico: { stato: "pass", versioneHost: statoDopo.corpo.versioneHost, pagine: [80, 15], totali: 95, idRicercato: ricerca.corpo.sessioni[0].id, senzaCartella: senzaCartella.length, sessioniPrima: 0, sessioniDopo: 0, estensioniInstallate: 0 },
    browser: { stato: "da-eseguire", scheda: fixture.scheda, mappaRighe: MAPPA_COMANDI.length, prove: PROVE_BROWSER.length },
  }, null, 2) + "\n", "utf8");
  console.log("PASS API: 95 conversazioni in due pagine, ricerca oltre l'ottantesima, Senza cartella senza percorso tecnico, zero sessioni create. Mappa, layout, tastiera, zoom e lettore di schermo: DA ESEGUIRE nel browser.");
}
