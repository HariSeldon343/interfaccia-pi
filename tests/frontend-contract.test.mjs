import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, frontend, stile, linkCore, clipboardCore, viewCore, attachmentCore] = await Promise.all([
  readFile(join(RADICE, "app", "public", "index.html"), "utf8"),
  readFile(join(RADICE, "app", "public", "app.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "stile.css"), "utf8"),
  readFile(join(RADICE, "app", "public", "link-core.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "clipboard-core.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "view-core.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "attachment-core.js"), "utf8"),
]);

function attributi(testo) {
  const risultato = new Map();
  const espressione = /(?:^|\s)([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const corrispondenza of testo.matchAll(espressione)) {
    risultato.set(
      corrispondenza[1].toLowerCase(),
      corrispondenza[2] ?? corrispondenza[3] ?? corrispondenza[4] ?? null,
    );
  }
  return risultato;
}

function elementi(testo) {
  return [...testo.matchAll(/<([a-z][\w-]*)\b([^<>]*)>/gi)].map((corrispondenza) => ({
    tag: corrispondenza[1].toLowerCase(),
    attributi: attributi(corrispondenza[2]),
    apertura: corrispondenza[0],
    indice: corrispondenza.index,
    fine: corrispondenza.index + corrispondenza[0].length,
  }));
}

const elementiHtml = elementi(html);

function elementoConId(id) {
  return elementiHtml.find((elemento) => elemento.attributi.get("id") === id);
}

function corpoElementoSemplice(id) {
  const elemento = elementoConId(id);
  assert.ok(elemento, `manca #${id}`);
  const chiusura = `</${elemento.tag}>`;
  const fine = html.toLowerCase().indexOf(chiusura, elemento.fine);
  assert.notEqual(fine, -1, `manca la chiusura di #${id}`);
  return html.slice(elemento.fine, fine);
}

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
  assert.notEqual(fineParametri, -1, `la firma di ${nome} non e chiusa`);
  const apertura = frontend.indexOf("{", fineParametri);
  let profondita = 0;
  for (let indice = apertura; indice < frontend.length; indice += 1) {
    if (frontend[indice] === "{") profondita += 1;
    if (frontend[indice] === "}") profondita -= 1;
    if (profondita === 0) return frontend.slice(apertura + 1, indice);
  }
  assert.fail(`la funzione ${nome} non e chiusa`);
}

test("il redesign conserva tutti gli ID statici richiesti dal frontend", () => {
  const idHtml = elementiHtml
    .map((elemento) => elemento.attributi.get("id"))
    .filter(Boolean);
  const duplicati = idHtml.filter((id, indice) => idHtml.indexOf(id) !== indice);
  assert.deepEqual([...new Set(duplicati)], [], "gli ID HTML devono essere univoci");

  const selettoriId = [
    ...frontend.matchAll(/\$\(\s*["']#([\w-]+)["']\s*\)/g),
  ].map((corrispondenza) => corrispondenza[1]);
  assert.ok(selettoriId.length >= 30, "il controllo deve coprire la mappa DOM reale di app.js");
  for (const id of new Set(selettoriId)) {
    assert.ok(idHtml.includes(id), `app.js usa #${id}, ma index.html non lo espone`);
  }

  for (const id of [
    "schede",
    "conversazione",
    "annuncio-risposta",
    "input",
    "btn-invia",
    "btn-allega",
    "menu-azioni-composer",
    "azione-allega-file",
    "azione-allega-immagine",
    "azione-richiama-skill",
    "azione-comandi-estensioni",
    "azione-ricarica-risorse",
    "scegli-file",
    "scegli-immagini",
    "allegati",
    "invii-verifica",
    "avvisi",
    "coda",
    "modo-coda",
    "invio-occupato",
    "spia",
    "eti-stato",
    "eti-cartella",
    "eti-percorso",
    "eti-modello",
    "eti-ragionamento",
    "stato-sessione-tui",
    "stato-cwd",
    "stato-uso",
    "contesto-info",
    "stato-modello-tui",
    "composer-shell",
    "palette-comandi",
    "lista-palette-comandi",
    "stato-palette-comandi",
    "suggerimento",
    "lista-comandi",
    "nota-comandi",
    "btn-ricarica-risorse",
    "btn-cerca-comandi",
    "btn-modello",
    "btn-ragionamento",
    "btn-controlli",
    "btn-ferma-top",
    "stati-estensioni",
    "widget-sopra",
    "widget-sotto",
    "velo",
    "modale",
    "modale-titolo",
    "modale-corpo",
    "modale-piede",
    "modale-chiudi",
    "toast-area",
  ]) {
    assert.ok(idHtml.includes(id), `manca il punto di integrazione #${id}`);
  }
});

test("una nuova scheda puo riusare la stessa cartella senza riusare la conversazione", () => {
  const nuovaScheda = corpoFunzione("avviaNuovaSchedaNelContestoCorrente");
  assert.match(nuovaScheda, /corrente\?\.cartella\s*&&\s*!corrente\.senzaCartella/);
  assert.match(nuovaScheda, /avviaSessione\(corrente\.cartella,\s*\{\s*forzaNuova:\s*true\s*\}\)/);
  assert.match(nuovaScheda, /senzaCartella:\s*true,\s*forzaNuova:\s*true/);

  const explorer = corpoFunzione("apriSceltaCartella");
  assert.match(explorer, /avviaSessione\(stato\.selezionata\.percorso,[\s\S]*?forzaNuova:\s*true/);
  assert.match(frontend, /\$\("#btn-nuova-chat"\)\.onclick\s*=\s*avviaNuovaSchedaNelContestoCorrente/);
});

test("il primo avvio si autoripara senza duplicare la sessione o bloccare il composer", () => {
  assert.match(html, /<script src="\/startup-core\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);

  const assicura = corpoFunzione("assicuraSessioneIniziale");
  assert.match(assicura, /STARTUP_CORE\.assicuraSessioneIniziale/);
  assert.match(assicura, /forzaNuova:\s*false/,
    "il retry del bootstrap deve riusare l'eventuale sessione creata dalla POST ambigua");
  assert.match(assicura, /propagaErrore:\s*true/,
    "un fallimento automatico deve arrivare al ciclo di riconnessione");

  const bootstrap = corpoFunzione("avvio");
  const reconnect = corpoFunzione("risincronizzaDopoRiconnessione");
  assert.match(bootstrap, /assicuraSessioneIniziale\(\{\s*sincronizza:\s*false\s*\}\)/);
  assert.match(reconnect, /assicuraSessioneIniziale\(\{\s*sincronizza:\s*false\s*\}\)/);
  assert.match(bootstrap, /sincronizzaSessioniUtilizzabili\(\)/,
    "la nuova sessione deve essere sincronizzata una volta sola e verificata");
  assert.match(reconnect, /sincronizzaSessioniUtilizzabili\(\)/);
  assert.match(reconnect, /aggiornaDalPonte\(\{\s*sostituisci:\s*true\s*\}\)[\s\S]*sessioniUtilizzabili/,
    "il reconnect deve ricontrollare lo snapshot dopo la sincronizzazione");

  const sincronizzaTutte = corpoFunzione("sincronizzaSessioniUtilizzabili");
  assert.match(sincronizzaTutte, /esiti\[indice\]\s*===\s*true/);
  assert.match(sincronizzaTutte, /if \(!riuscite\.length\)[\s\S]*throw new Error/,
    "un catalogo modelli non verificato non puo dichiarare guarito il bootstrap");

  const trasporto = corpoFunzione("chiedi");
  assert.ok((trasporto.match(/programmaRiconnessione\(\)/g) || []).length >= 2,
    "gli errori di trasporto e di conferma devono sempre avviare l'autoriparazione");

  const sincronizza = corpoFunzione("sincronizzaSessione");
  assert.match(sincronizza, /richiestaSincronizzazione/);
  assert.match(sincronizza, /finally\s*\{/);
  assert.match(sincronizza, /void caricaCapacita\(sessione\)/,
    "il catalogo accessorio non deve prolungare il blocco principale");

  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  const gateComposer = interfaccia.slice(
    interfaccia.indexOf("const composerScrivibile"),
    interfaccia.indexOf("const utilizzabile"),
  );
  assert.doesNotMatch(gateComposer, /sincronizzazione/,
    "durante la sincronizzazione deve essere possibile preparare la bozza");
  assert.match(gateComposer, /avvioCompletato\s*!==\s*false/,
    "una sessione half-started non deve accettare testo che il rollback renderebbe irraggiungibile");
  assert.match(interfaccia, /mutazioniUtilizzabili[\s\S]*!sessione\?\.sincronizzazione/,
    "invio e cambio modello restano protetti finche la sincronizzazione non termina");
});

test("la struttura Codex-like mantiene i contratti accessibili della conversazione", () => {
  const conversazione = elementoConId("conversazione");
  assert.equal(conversazione?.attributi.get("role"), "log");
  assert.equal(conversazione?.attributi.get("aria-live"), "polite");
  assert.equal(conversazione?.attributi.get("aria-relevant"), "additions");
  assert.equal(conversazione?.attributi.get("tabindex"), "0");

  const stato = elementoConId("stato");
  assert.equal(stato?.attributi.get("role"), "status");
  assert.equal(stato?.attributi.get("aria-live"), "polite");

  const avvisi = elementoConId("avvisi");
  assert.equal(avvisi?.attributi.get("role"), "alert");
  assert.equal(avvisi?.attributi.get("aria-live"), "assertive");

  const annuncio = elementoConId("annuncio-risposta");
  assert.equal(annuncio?.attributi.get("aria-live"), "polite");
  assert.equal(annuncio?.attributi.get("aria-atomic"), "true");

  assert.equal(elementoConId("input")?.tag, "textarea");
  const input = elementoConId("input");
  assert.equal(input?.attributi.get("aria-controls"), "lista-palette-comandi");
  assert.equal(input?.attributi.get("aria-expanded"), "false");
  assert.equal(input?.attributi.get("aria-autocomplete"), "list");
  assert.equal(input?.attributi.get("aria-haspopup"), "listbox");
  assert.equal(input?.attributi.get("aria-describedby"), "suggerimento");
  assert.equal(elementoConId("palette-comandi")?.attributi.has("hidden"), true);
  assert.equal(elementoConId("lista-palette-comandi")?.attributi.get("role"), "listbox");
  assert.equal(elementoConId("stato-palette-comandi")?.attributi.get("role"), "status");
  assert.ok(
    elementiHtml.some((elemento) =>
      elemento.tag === "label" && elemento.attributi.get("for") === "input"),
    "la textarea deve conservare un'etichetta associata",
  );

  const modale = elementoConId("modale");
  assert.equal(modale?.attributi.get("role"), "dialog");
  assert.equal(modale?.attributi.get("aria-modal"), "true");
  assert.equal(modale?.attributi.get("aria-labelledby"), "modale-titolo");

  for (const elemento of elementiHtml) {
    for (const attributo of ["aria-controls", "aria-labelledby"]) {
      const riferimenti = elemento.attributi.get(attributo)?.split(/\s+/).filter(Boolean) || [];
      for (const id of riferimenti) {
        assert.ok(elementoConId(id), `${attributo} punta all'ID inesistente #${id}`);
      }
    }
  }
});

test("la barra TUI conserva per sessione cwd, contesto, modello e statistiche", () => {
  const barra = elementoConId("stato-sessione-tui");
  assert.equal(barra?.attributi.get("role"), "status");
  assert.equal(barra?.attributi.get("aria-live"), "polite");
  assert.equal(barra?.attributi.get("aria-atomic"), "true");
  const corpo = corpoElementoSemplice("stato-sessione-tui");
  for (const id of ["stato-cwd", "stato-uso", "contesto-info", "stato-modello-tui"]) {
    assert.match(corpo, new RegExp(`\\bid=["']${id}["']`), `manca #${id} nella barra TUI`);
  }

  const disegna = corpoFunzione("disegnaBarraStatoSessione");
  assert.match(disegna, /sessione\.statoRpc\?\.cwd\s*\|\|\s*sessione\.cartella/,
    "il percorso RPC deve avere il fallback alla cartella canonica");
  assert.match(disegna, /sessione\.provider/);
  assert.match(disegna, /sessione\.modello/);
  assert.match(disegna, /sessione\.ragionamento/);
  assert.match(corpoFunzione("testoContestoSessione"), /contextUsage/);
  assert.match(corpoFunzione("testoContestoSessione"), /Math\.max\(0,\s*finestra\s*-\s*usati\)/,
    "la barra deve mostrare anche il contesto rimanente");
  assert.match(corpoFunzione("testoContestoSessione"), /ultimoUso\?\.totalTokens/,
    "durante lo streaming il contesto deve avanzare senza attendere agent_settled");
  assert.match(corpoFunzione("testoContestoSessione"), /autoCompactionEnabled\s*===\s*true/,
    "la barra deve mostrare l'indicatore auto come il footer TUI");
  assert.match(corpoFunzione("testoContestoSessione"), /contesto\?\.tokens\s*==\s*null\s*\?\s*NaN/,
    "dopo una compaction tokens=null non deve essere trasformato in un falso zero");
  const finestra = corpoFunzione("finestraModelloSessione");
  assert.match(finestra, /VISTA_CORE\.finestraContestoModelloCorrente/,
    "la finestra deve essere risolta dal core che lega i dati all'identita del modello corrente");
  assert.match(finestra, /modelloStatistiche:\s*sessione\?\.modelloStatistiche/,
    "le statistiche possono contribuire soltanto insieme al modello che le ha prodotte");
  assert.match(stile, /\.stato-sessione-tui\s*\{/);
  assert.match(stile, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  const uso = corpoFunzione("testoUsoSessione");
  for (const simbolo of ["↑", "↓", "R", "W", "CH"]) assert.match(uso, new RegExp(simbolo));
  assert.match(corpoFunzione("mostraUsoBreve"), /ultimoCacheHitPercento/);
});

test("le statistiche si aggiornano fail-soft dopo sync e agent_settled, non durante i delta", () => {
  const aggiorna = corpoFunzione("aggiornaStatisticheSessione");
  assert.match(aggiorna, /type:\s*["']get_session_stats["']/);
  assert.match(aggiorna, /statisticheInCaricamento/,
    "le letture concorrenti devono essere riunite per sessione");
  assert.match(aggiorna, /catch\s*\{/,
    "un errore accessorio non deve cancellare l'ultima fotografia valida");
  assert.doesNotMatch(aggiorna, /statisticheSessione\s*=\s*null/);

  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(risposta, /evento\.command\s*===\s*["']get_session_stats["']/);
  assert.match(risposta, /sessione\.statisticheSessione\s*=\s*dati/);
  assert.match(risposta, /revisioneRichiesta\s*===\s*Number\(sessione\.revisioneModello/,
    "una risposta statistica tardiva non deve contaminare il modello appena selezionato");
  assert.match(risposta, /VISTA_CORE\.chiaveModello\(modelloRichiesta\)/,
    "provider e ID richiesti devono coincidere con quelli ancora correnti");

  const sync = corpoFunzione("sincronizzaSessione");
  const fineSync = sync.indexOf("sessione.sincronizzazione = false");
  const statisticheDopoSync = sync.indexOf("void aggiornaStatisticheSessione(sessione)");
  assert.ok(fineSync >= 0 && statisticheDopoSync > fineSync,
    "get_session_stats non deve allungare la sincronizzazione principale");

  const eventi = corpoFunzione("gestisciEvento");
  const settled = eventi.indexOf('evento.type === "agent_settled"');
  const richiesta = eventi.indexOf("aggiornaStatisticheSessione(sessione)", settled);
  const delta = eventi.indexOf('evento.type === "message_update"');
  assert.ok(settled >= 0 && richiesta > settled && richiesta < delta,
    "le statistiche devono partire in differita alla fine del turno");
  const ramoDelta = eventi.slice(delta, eventi.indexOf('evento.type === "message_end"', delta));
  assert.doesNotMatch(ramoDelta, /aggiornaStatisticheSessione/,
    "la lettura delle statistiche non deve rallentare il primo delta");
});

test("la sincronizzazione finale assorbe soltanto i conflitti transitori della cronologia", () => {
  const finale = corpoFunzione("sincronizzaMessaggiFinali");
  assert.match(finale, /\[409,\s*423\]\.includes\(errore\?\.statusHttp\)/,
    "message_end e agent_settled possono incontrare sia un 409 sia un 423 transitorio");
  assert.match(finale, /tentativiTransitori\s*<\s*2/,
    "i retry devono essere limitati per non nascondere un conflitto persistente");
  assert.match(finale, /setTimeout\(risolvi,\s*100\s*\*\s*tentativiTransitori\)/,
    "la rilettura deve lasciare al JSONL il tempo di stabilizzarsi");
  assert.match(finale, /else if \(errore\?\.statusHttp !== 423\)[\s\S]*mostraErroreCronologia/,
    "un 409 persistente deve continuare a essere mostrato come errore reale");
});

test("il primo delta e visibile subito e il ragionamento resta compatto", () => {
  const delta = corpoFunzione("gestisciDelta");
  assert.match(delta, /const primoDelta = !sessione\.bloccoTesto/);
  assert.match(delta, /primoDelta[\s\S]*appendChild\(document\.createTextNode\(aggiornamento\.delta\)\)/,
    "il primo token testuale deve essere scritto subito nel DOM");
  assert.match(delta, /else\s*\{[\s\S]*deltaTestoInAttesa[\s\S]*pianificaDelta/,
    "i delta successivi restano raggruppati per contenere i reflow");
  assert.match(corpoFunzione("apriRagionamento"), /box\.open\s*=\s*Boolean\(testo\s*&&\s*sessione\.ragionamentiAperti/,
    "il ragionamento deve restare compatto finche l'utente non lo apre");
  assert.doesNotMatch(corpoFunzione("chiudiRagionamento"), /box\.open\s*=\s*false/,
    "la fine del ragionamento non deve annullare una scelta esplicita dell'utente");
});

test("solo l'attivita tecnica in corso mostra un avanzamento grafico discreto", () => {
  const creaGruppo = corpoFunzione("ottieniGruppoAttivita");
  assert.match(creaGruppo, /stato\.setAttribute\(["']role["'],\s*["']status["']\)/);
  assert.match(creaGruppo, /stato\.setAttribute\(["']aria-live["'],\s*["']polite["']\)/);
  assert.match(creaGruppo, /stato\.setAttribute\(["']aria-atomic["'],\s*["']true["']\)/);
  assert.doesNotMatch(creaGruppo, /conteggio\.setAttribute\(["']aria-live["']/,
    "il conteggio ad alta frequenza non deve produrre annunci continui");
  const aggiorna = corpoFunzione("aggiornaGruppoAttivita");
  assert.match(aggiorna, /const attivitaInCorso\s*=\s*inCorso\s*\|\|\s*!gruppo\.finalizzato/);
  assert.match(aggiorna, /classList\.toggle\(["']in-corso["'],\s*attivitaInCorso\)/,
    "un tentativo fallito non deve spegnere l'animazione mentre il gruppo continua");
  assert.match(aggiorna, /classList\.toggle\(["']con-avvisi["'],\s*stato\.livello === ["']avviso["']\)/,
    "avanzamento e avviso devono poter coesistere");
  assert.match(stile, /\.gruppo-attivita\.in-corso \.stato::after\s*\{/,
    "lo stato attivo deve avere un indicatore pulsante");
  assert.match(stile, /\.gruppo-attivita\.in-corso > summary::after\s*\{/,
    "il gruppo attivo deve avere una luce di avanzamento");
  assert.match(stile, /@keyframes respiro-attivita/);
  assert.match(stile, /@keyframes avanzamento-attivita/);
  assert.doesNotMatch(stile, /\.gruppo-attivita:not\(\.in-corso\)[^{]*animation/,
    "i gruppi completati devono restare statici");
  const ridotto = stile.slice(stile.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(ridotto, /\.gruppo-attivita\.in-corso \.stato::after[\s\S]*?animation:\s*none/);
  assert.match(ridotto, /\.gruppo-attivita\.in-corso > summary::after[\s\S]*?animation:\s*none/);
});

test("il trasferimento al terminale distingue la chat nuova e guida il blocco multi-finestra", () => {
  const controlli = corpoFunzione("apriControlliAvanzati");
  assert.match(controlli, /Nuova conversazione nel terminale/);
  assert.match(controlli, /Sposta questa conversazione nel terminale/);
  const handoff = corpoFunzione("passaConversazioneAlTerminale");
  assert.match(handoff, /HANDOFF_CLIENT_RECONNECT_GRACE/);
  assert.match(handoff, /retryAfterMs/);
  assert.match(handoff, /HANDOFF_OTHER_CLIENT_CONNECTED/);
  assert.match(handoff, /Chiudi l'altra finestra di Interfaccia Pi/);
  const chiedi = corpoFunzione("chiedi");
  assert.match(chiedi, /errore\.retryAfterMs/);
  assert.match(chiedi, /errore\.blocker/);
});

test("Skills e comandi sono un elenco nativo a scomparsa, chiuso inizialmente", () => {
  const gruppo = elementoConId("gruppo-comandi");
  assert.equal(gruppo?.tag, "details", "#gruppo-comandi deve usare disclosure nativa");
  assert.equal(gruppo?.attributi.has("open"), false, "l'elenco non deve occupare spazio all'avvio");

  const corpo = corpoElementoSemplice("gruppo-comandi");
  assert.match(corpo, /^\s*<summary\b/i, "summary deve essere il primo figlio del details");
  const sommario = corpo.match(/^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
  assert.ok(sommario, "manca il summary del pannello Skills");
  assert.match(sommario[1].replace(/<[^>]+>/g, " "), /skills|comandi di pi/i);
  assert.doesNotMatch(sommario[1], /<(?:button|input|select|textarea|a)\b/i,
    "summary non deve contenere altri controlli interattivi");

  for (const id of ["nota-comandi", "lista-comandi", "btn-cerca-comandi"]) {
    assert.match(corpo, new RegExp(`\\bid=["']${id}["']`), `#${id} deve restare nel pannello`);
  }
  const cerca = elementoConId("btn-cerca-comandi");
  assert.equal(cerca?.tag, "button");
  assert.equal(cerca?.attributi.get("type"), "button");
});

test("le skill restano selezionabili con nome e spiegazione in linguaggio naturale", () => {
  const descrizione = corpoFunzione("descrizioneComando");
  assert.match(descrizione, /comando\.description/,
    "la descrizione fornita dalla skill deve avere priorita");
  assert.match(descrizione, /comando\.source === ["']skill["']/);
  assert.match(descrizione, /competenza specializzata/i);
  assert.match(descrizione, /comando\.source === ["']prompt["']/);
  assert.match(descrizione, /procedura guidata/i);
  assert.doesNotMatch(descrizione, /skill:graphify|skill:bonifica-vault/,
    "le descrizioni delle skill devono arrivare dal catalogo di pi");

  const bottone = corpoFunzione("bottoneComando");
  assert.match(bottone, /crea\(["']button["'],\s*["']voce["']/);
  assert.match(bottone, /\.type\s*=\s*["']button["']/);
  assert.match(bottone, /titoloComando\(comando\)/,
    "la skill deve mostrare un nome leggibile");
  assert.match(bottone, /descrizioneComando\(comando\)/,
    "la skill deve mostrare la spiegazione naturale");
  assert.match(bottone, /inserisciComandoNelComposer/,
    "pannello e palette devono usare lo stesso completamento sicuro");
  assert.match(bottone, /chiaveComando\(comando\)/,
    "la selezione deve distinguere sorgenti omonime");

  const elenco = corpoFunzione("disegnaComandi");
  assert.match(elenco, /\["skill",\s*"prompt"\]\.includes\(comando\.source\)/,
    "il pannello semplice deve contenere soltanto skill e prompt");
  assert.match(elenco, /utilizzabili\.slice\(0,\s*8\)/,
    "l'anteprima deve restare limitata");
  assert.match(elenco, /btnCercaComandi\.hidden\s*=\s*utilizzabili\.length\s*<=\s*8/,
    "la ricerca completa deve comparire solo quando serve");
  assert.match(frontend, /DOM\.btnCercaComandi\.onclick\s*=\s*\(\)\s*=>\s*apriRicercaComandi\(\)/);

  const ricerca = corpoFunzione("apriRicercaComandi");
  assert.match(frontend, /titolo\s*=\s*["']Comandi e skill di questa conversazione["']/);
  assert.match(frontend, /etichettaRicerca\s*=\s*["']Cerca comandi e skill["']/);
  assert.match(ricerca, /new Set\(fonti\)/,
    "lo stesso selettore deve accettare filtri di sorgente espliciti");
  assert.match(ricerca, /filtraCatalogoComandi\(/,
    "la ricerca deve riusare la normalizzazione del catalogo autorevole");
});

test("il pulsante + apre un menu rapido accessibile senza fingere di installare estensioni", () => {
  const apertura = elementoConId("btn-allega");
  assert.equal(apertura?.tag, "button");
  assert.equal(apertura?.attributi.get("aria-haspopup"), "menu");
  assert.equal(apertura?.attributi.get("aria-expanded"), "false");
  assert.equal(apertura?.attributi.get("aria-controls"), "menu-azioni-composer");
  assert.match(apertura?.attributi.get("aria-label") || "", /allega file|azioni/i);

  const menu = elementoConId("menu-azioni-composer");
  assert.equal(menu?.attributi.get("role"), "menu");
  assert.equal(menu?.attributi.has("hidden"), true);
  const corpoMenu = corpoElementoSemplice("menu-azioni-composer");
  for (const [id, testo] of [
    ["azione-allega-file", /allega file/i],
    ["azione-allega-immagine", /allega immagine/i],
    ["azione-richiama-skill", /richiama skill o procedura/i],
    ["azione-comandi-estensioni", /comandi estensioni/i],
    ["azione-ricarica-risorse", /ricarica dopo installazione/i],
  ]) {
    const voce = elementoConId(id);
    assert.equal(voce?.tag, "button");
    assert.equal(voce?.attributi.get("type"), "button");
    assert.equal(voce?.attributi.get("role"), "menuitem");
    assert.equal(voce?.attributi.get("tabindex"), "-1");
    assert.match(corpoMenu, new RegExp(`id=["']${id}["'][\\s\\S]*?${testo.source}`, "i"));
  }
  assert.doesNotMatch(corpoMenu, /installa(?:re|zione) estension/i,
    "il menu non deve promettere una funzione di installazione inesistente");
  assert.match(corpoMenu, /gia installate o configurate/i,
    "il reload deve essere descritto come riscoperta di risorse gia presenti");

  const picker = corpoFunzione("eseguiAzioneMenuComposer");
  assert.match(picker, /fonti:\s*\["skill",\s*"prompt"\]/,
    "skill e prompt devono provenire dal catalogo della sessione");
  assert.match(picker, /fonti:\s*\["extension"\]/,
    "il pannello estensioni deve usare soltanto source=extension");
  assert.match(picker, /mostraDisponibilita:\s*true/,
    "i comandi estensione devono dichiarare GUI o terminale");
  assert.match(picker, /conservaBozzaComeArgomenti:\s*true/,
    "scegliere dal menu + non deve cancellare il testo gia scritto");
  assert.match(picker, /ricaricaRisorsePi\(\)/,
    "Ricarica dopo installazione deve riusare il workflow sicuro esistente");

  const inserimento = corpoFunzione("inserisciComandoNelComposer");
  assert.match(inserimento, /conservaBozzaComeArgomenti\s*\?\s*DOM\.input\.value\.trim\(\)/,
    "la bozza deve diventare l'argomento della skill o estensione selezionata");
  assert.match(inserimento, /argomentiEsistenti/,
    "il comando scelto deve conservare la bozza nel composer");

  const apri = corpoFunzione("apriMenuAzioniComposer");
  assert.match(apri, /chiudiPaletteComandi\(\)/,
    "menu rapido e palette slash non devono sovrapporsi");
  assert.match(apri, /aria-expanded["'],\s*["']true/);
  const chiudi = corpoFunzione("chiudiMenuAzioniComposer");
  assert.match(chiudi, /aria-expanded["'],\s*["']false/);
  assert.match(chiudi, /ripristinaFocus/);
  const sposta = corpoFunzione("spostaFocusMenuAzioniComposer");
  assert.match(sposta, /inizio/);
  assert.match(sposta, /fine/);
  for (const tasto of ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab"]) {
    assert.match(frontend, new RegExp(`menuAzioniComposer[\\s\\S]{0,1800}evento\\.key === ["']${tasto}["']`),
      `manca la gestione ${tasto} nel menu rapido`);
  }
  assert.match(frontend, /menuAzioniComposer\.contains\(evento\.target\)/,
    "un click esterno deve chiudere il menu");
  for (const classe of ["menu-azioni-composer", "menu-azione-composer", "disponibilita-comando"]) {
    assert.match(stile, new RegExp(`\\.${classe}(?:[^\\w-]|$)`), `manca lo stile .${classe}`);
  }
});

test("file generici e immagini possono essere scelti o trascinati senza mostrare il marcatore tecnico", () => {
  assert.ok(html.indexOf("/attachment-core.js") < html.indexOf("/app.js"),
    "il codec degli allegati deve essere disponibile prima del frontend");
  assert.match(attachmentCore, /<pi_gui_files_v1>/);
  assert.match(attachmentCore, /creaMessaggioConFile/);
  assert.match(attachmentCore, /separaMessaggioConFile/);

  const picker = elementoConId("scegli-file");
  assert.equal(picker?.tag, "input");
  assert.equal(picker?.attributi.get("type"), "file");
  assert.equal(picker?.attributi.has("multiple"), true);
  assert.equal(picker?.attributi.has("hidden"), true);
  assert.match(corpoFunzione("eseguiAzioneMenuComposer"), /DOM\.scegliFile\.click\(\)/);

  const aggiungi = corpoFunzione("aggiungiFile");
  assert.match(aggiungi, /LIMITE_FILE_ALLEGATO/);
  assert.match(aggiungi, /leggiFileBase64/);
  assert.match(aggiungi, /chiedi\(["']\/api\/allega-file["']/);
  assert.match(aggiungi, /risposta\?\.allegato/);
  assert.match(aggiungi, /riferimentiFileServer\(\[caricato\]\)/,
    "ogni upload deve ricevere anche il token opaco di proprieta");
  assert.match(aggiungi, /caricato\.ownerSessionId !== sessione\.id/,
    "ogni upload deve dichiarare anche la sessione server proprietaria");
  assert.match(aggiungi, /eliminaFilePendentiBestEffort/,
    "un upload abbandonato durante una race deve essere cancellato best-effort");
  assert.match(aggiungi, /APP\.sessioni\.get\(sessione\.id\) === sessione/,
    "cambiare scheda durante l'upload non deve scartare il file della scheda di origine");
  assert.doesNotMatch(aggiungi, /sessioneAttiva\(\) !== sessione/,
    "la validita dell'upload dipende dall'esistenza della scheda, non dal fatto che sia visibile");
  const invio = corpoFunzione("invia");
  assert.match(invio, /creaMessaggioConFile\(testoInvio,\s*fileAllegati\)/,
    "Pi deve ricevere i percorsi locali in un envelope strutturato");
  assert.match(invio, /message:\s*testoRpc/);
  assert.match(invio, /piGuiFileRefs:\s*riferimentiFilePrompt\.length/,
    "il ponte deve preparare e finalizzare gli stessi file del prompt");
  assert.match(invio, /riferimentiFilePrompt\.length !== fileAllegati\.length/,
    "un file senza token non deve essere inviato come percorso non protetto");
  assert.match(frontend, /chiedi\(["']\/api\/gestisci-file-allegati["']/);
  const adozione = corpoFunzione("adottaFilePendentiBozza");
  assert.match(adozione, /chiedi\(["']\/api\/adotta-file-allegati["']/);
  assert.match(adozione, /ownerSessionId:\s*allegato\.ownerSessionId/);
  assert.match(adozione, /adottato\.ownerSessionId !== sessione\.id/);
  assert.match(adozione, /adottato\.token === origine\.allegato\.token/,
    "l'adozione deve esigere la rotazione del token");
  const ripristino = corpoFunzione("ripristinaFotografiaAllegatiBozza");
  assert.match(ripristino, /await adottaFilePendentiBozza/,
    "il restore deve adottare i file prima di renderli nuovamente inviabili");
  assert.match(ripristino, /forzaCopia:\s*copiaPerAltroDocumento/,
    "una seconda finestra deve ricevere pending server distinti");
  assert.ok(
    ripristino.indexOf("await adottaFilePendentiBozza")
      < ripristino.indexOf("sessione.allegati = raccolti.map"),
    "l'adozione deve precedere la pubblicazione degli allegati nella sessione",
  );
  assert.match(corpoFunzione("disegnaAllegati"), /eliminaFilePendentiBestEffort/,
    "rimuovere un file dalla bozza deve chiedere la cancellazione server-side");
  const chiusura = corpoFunzione("chiudiSessione");
  assert.match(chiusura, /const filePendenti = riferimentiFileServer\(sessione\.allegati\)/);
  assert.match(chiusura, /filePendenti\.length \? \{ filePendenti \}/,
    "la chiusura deve consegnare i token pending al server prima di eliminare la bozza locale");
  assert.match(chiusura, /allegat\$\{sessione\.allegati\.length === 1 \? ["']o["'] : ["']i["']\}/,
    "la conferma di chiusura deve parlare di allegati, non soltanto di immagini");
  assert.match(chiusura, /esitoChiusura\?\.pendingNonEliminati/,
    "un cleanup parziale dopo lo stop deve chiudere comunque la scheda e mostrare un avviso");
  assert.match(chiusura, /dimenticaBozza\(sessione,\s*\{ preservaInviiPendenti: true \}\)/,
    "la chiusura deve scartare la bozza corrente senza eliminare le copie degli invii da verificare");
  const dimentica = corpoFunzione("dimenticaBozza");
  assert.match(dimentica, /sessione\.inviiPendenti\.length && !preservaInviiPendenti/);
  assert.match(dimentica, /if \(!preservaInviiPendenti\) \{[\s\S]*sessione\.inviiPendenti = \[\]/,
    "i record storici degli invii devono essere indipendenti dal bundle della bozza confermata");
  assert.match(corpoFunzione("aggiungiMessaggio"), /separaMessaggioConFile/,
    "la cronologia deve mostrare il prompt umano e i file, non l'envelope interno");

  assert.match(frontend, /document\.addEventListener\(["']dragenter["']/);
  assert.match(frontend, /document\.addEventListener\(["']dragover["']/);
  assert.match(frontend, /document\.addEventListener\(["']drop["']/);
  assert.match(frontend, /accodaAggiuntaAllegati\(evento\.dataTransfer\?\.files/);
  assert.match(stile, /\.composer-shell\.trascinamento-file/);
  assert.match(frontend, /setInterval\(rinnovaFileBozzeAperte,\s*INTERVALLO_RINNOVO_FILE_BOZZA_MS\)/,
    "una bozza ancora aperta deve rinnovare periodicamente i propri pending");
  assert.match(frontend, /visibilityState === ["']visible["'][\s\S]{0,100}rinnovaFileBozzeAperte/,
    "il ritorno alla finestra deve rinnovare i pending prima del TTL");
});

test("un drop misto resta legato alla scheda di origine anche durante gli await", () => {
  const misto = corpoFunzione("accodaAggiuntaAllegati");
  assert.match(misto, /const sessione = sessioneAttiva\(\)/);
  assert.match(misto, /await accodaAggiuntaFile\(generici,\s*sessione\)/);
  assert.match(misto, /await accodaAggiuntaImmagini\(immagini,\s*sessione\)/);

  const immagini = corpoFunzione("aggiungiImmagini");
  assert.match(immagini, /APP\.sessioni\.get\(sessione\.id\) === sessione/);
  assert.match(immagini, /sessione\.chiaveBozza === chiaveAttesa/);
  assert.doesNotMatch(immagini, /sessioneAttiva\(\) !== sessione/,
    "la lettura FileReader non deve spostare l'immagine sulla scheda diventata visibile");
  assert.ok(
    immagini.indexOf("sessioneAncoraValida()")
      < immagini.indexOf("await Promise.all(accettati.map(leggiImmagine))"),
    "la scheda di origine va verificata sia prima sia dopo FileReader",
  );
  assert.ok(
    immagini.lastIndexOf("sessioneAncoraValida()")
      > immagini.indexOf("await Promise.all(accettati.map(leggiImmagine))"),
    "la scheda di origine va ricontrollata dopo FileReader",
  );
});

test("Ctrl+V incolla screenshot come allegati senza intercettare il normale testo", () => {
  assert.match(html, /Ctrl\+V per incollare uno screenshot/i,
    "il composer deve rendere la funzione scopribile");
  assert.match(frontend, /SUGGERIMENTO_PREDEFINITO\s*=\s*["'][^"']*Ctrl\+V/,
    "il suggerimento deve restare visibile dopo aver chiuso la palette comandi");

  assert.ok(html.indexOf("/clipboard-core.js") < html.indexOf("/app.js"),
    "il core della clipboard deve essere caricato prima del frontend");
  assert.match(clipboardCore, /clipboardData\.items/,
    "la sorgente primaria deve essere DataTransferItemList");
  assert.match(clipboardCore, /getAsFile/);
  assert.match(clipboardCore, /clipboardData\.files/,
    "serve il fallback DataTransfer.files di WebView2");
  assert.match(clipboardCore, /TIPI_IMMAGINE_SUPPORTATI/,
    "il paste non deve ampliare i MIME gia ammessi dal selettore");

  const inizio = frontend.indexOf('DOM.input.addEventListener("paste"');
  const fine = frontend.indexOf('DOM.input.addEventListener("input"', inizio);
  assert.ok(inizio >= 0 && fine > inizio, "manca il gestore paste del composer");
  const gestore = frontend.slice(inizio, fine);
  assert.ok(gestore.indexOf("if (!immagini.length) return") < gestore.indexOf("preventDefault"),
    "incollare solo testo deve mantenere il comportamento nativo del textarea");
  assert.match(gestore, /DOM\.azioneAllegaImmagine\.disabled/,
    "Ctrl+V deve rispettare gli stessi blocchi del pulsante allega");
  assert.match(gestore, /await accodaAggiuntaImmagini\(immagini\)/,
    "file picker e clipboard devono condividere limiti, persistenza e anteprima");
  assert.match(gestore, /testoAssociato/,
    "la policy image-first delle clipboard miste deve essere comunicata all'utente");
  assert.doesNotMatch(gestore, /navigator\.clipboard\.read/,
    "il paste esplicito non deve richiedere permessi permanenti alla clipboard");

  const coda = corpoFunzione("accodaAggiuntaImmagini");
  assert.ok(coda.indexOf("importazioniImmaginiInCorso") < coda.indexOf(".then("),
    "il latch deve essere visibile prima dell'avvio asincrono di FileReader");
  assert.match(coda, /codaImportazioneImmagini/);
  const invio = corpoFunzione("invia");
  assert.ok(invio.indexOf("codaImportazioneImmagini") < invio.indexOf("codaAllegatiBozza"),
    "Invio deve attendere prima la lettura e poi la persistenza dello screenshot");
  assert.ok(invio.indexOf("codaImportazioneImmagini") < invio.indexOf("allegatiInviati"),
    "la fotografia degli allegati non puo precedere il completamento del paste");
  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  assert.match(interfaccia, /!sessione\.importazioniImmaginiInCorso/,
    "il composer deve restare bloccato durante la breve acquisizione asincrona");
});

test("la vista compatta viene caricata prima del frontend", () => {
  assert.ok(html.indexOf('/view-core.js') < html.indexOf('/app.js'));
  assert.match(frontend, /globalThis\.PiGuiViewCore/);
  assert.match(viewCore, /pulisciRispostaAgente/);
  assert.match(viewCore, /statoAttivita/);
});

test("la GUI non lascia che Pi trasformi silenziosamente gli allegati in image omitted", () => {
  const corrente = corpoFunzione("modelloCorrenteSessione");
  assert.match(corrente, /stato\.provider\s*===\s*sessione\.provider/,
    "un get_state precedente non deve decidere la capacita dopo un cambio modello a caldo");
  assert.match(corrente, /stato\.id\s*===\s*sessione\.modello/);
  const supporto = corpoFunzione("supportoImmaginiSessione");
  assert.match(supporto, /supportoImmaginiModello\(modelloCorrenteSessione\(sessione\)\)/,
    "la capacita deve essere tratta dai metadati autorevoli del modello");
  assert.match(clipboardCore, /supportoImmaginiModello/);
  assert.match(clipboardCore, /input\.includes\(["']image["']\)/);

  const avviso = corpoFunzione("avvisaModelloSenzaImmagini");
  assert.match(avviso, /supportoImmaginiSessione\(sessione\)\s*!==\s*false/,
    "un catalogo non ancora caricato non deve produrre un falso blocco");
  assert.match(avviso, /image omitted/,
    "il messaggio deve spiegare esattamente cio che farebbe Pi");
  assert.match(avviso, /Scegli modello/);

  const menu = corpoFunzione("eseguiAzioneMenuComposer");
  assert.ok(menu.indexOf("avvisaModelloSenzaImmagini") < menu.indexOf("scegliImmagini.click"),
    "il selettore file non deve aprirsi per un modello noto come solo testo");
  const coda = corpoFunzione("accodaAggiuntaImmagini");
  assert.ok(coda.indexOf("avvisaModelloSenzaImmagini") < coda.indexOf("importazioniImmaginiInCorso"),
    "anche paste e ritorno dal picker devono essere fermati prima di FileReader");
  const invio = corpoFunzione("invia");
  assert.ok(invio.indexOf("immaginiAllegate.length && avvisaModelloSenzaImmagini")
    < invio.indexOf("const allegatiInviati"),
  "il cambio modello a caldo deve lasciare le immagini in bozza senza bloccare i file generici");
});

test("Ricarica estensioni espone nella barra Strumenti il reload nativo e non perde la conversazione", () => {
  const ricarica = elementoConId("btn-ricarica-risorse");
  assert.equal(ricarica?.tag, "button");
  assert.equal(ricarica?.attributi.get("type"), "button");
  assert.equal(ricarica?.attributi.get("data-azione"), "ricarica");
  const inizioStrumenti = html.indexOf('<section class="gruppo gruppo-strumenti">');
  const fineStrumenti = html.indexOf("</section>", inizioStrumenti);
  assert.ok(
    ricarica.indice > inizioStrumenti && ricarica.indice < fineStrumenti,
    "il controllo deve essere una voce della barra Strumenti, non del pannello Skills",
  );
  const testoControllo = [
    ricarica?.attributi.get("aria-label") || "",
    ricarica?.attributi.get("title") || "",
    corpoElementoSemplice("btn-ricarica-risorse"),
  ].join(" ");
  for (const risorsa of ["estensioni", "skill", "prompt", "temi", "configurazioni"]) {
    assert.match(testoControllo, new RegExp(risorsa, "i"), `il controllo deve spiegare che ricarica ${risorsa}`);
  }
  assert.match(testoControllo, /senza (?:perdere|chiudere) la conversazione/i,
    "tooltip e nome accessibile devono rassicurare sulla conservazione della conversazione");
  assert.match(frontend, /btnRicaricaRisorse:\s*\$\(["']#btn-ricarica-risorse["']\)/,
    "il controllo deve essere incluso nella mappa DOM del frontend");
  const instradamento = corpoFunzione("eseguiAzione");
  assert.match(instradamento, /azione\s*===\s*["']ricarica["'][\s\S]*ricaricaRisorsePi\(\)/,
    "la voce Strumenti deve attivare il workflow dedicato attraverso data-azione");

  const workflow = corpoFunzione("ricaricaRisorsePi");
  assert.match(workflow, /trovaComandoCatalogo\(sessione,\s*["']reload["']\)/,
    "il refresh deve risolvere il built-in reload dal catalogo corrente");
  assert.match(workflow,
    /invocaComandoBuiltin\(sessione,\s*comando,\s*["']["'],\s*["']\/reload["']\)/,
    "le skill devono essere ricaricate dal built-in di Pi, non da una sola GET del catalogo");
  assert.doesNotMatch(workflow,
    /^\s*await\s+caricaCapacita\(sessione,\s*\{\s*refresh:\s*true\s*\}\)\s*;?\s*$/,
    "caricaCapacita da sola non ricarica le risorse di Pi");

  assert.match(workflow, /const\s+(?:snapshot|(?:catalogo|comandi)(?:Precedente|Verificato|Snapshot))\s*=/i,
    "prima del reload va conservata la fotografia del catalogo verificato");
  const gestioneErrore = workflow.match(/catch\s*(?:\([^)]*\))?\s*\{([\s\S]*)$/)?.[1] || "";
  assert.match(gestioneErrore, /sessione\.comandi\s*=/,
    "un reload fallito deve ripristinare esplicitamente i comandi precedenti");
  assert.match(gestioneErrore, /(?:catalogo|comandi)(?:Precedente|Verificato|Snapshot)|snapshot(?:\.(?:comandi|revisioneCapacita|capacitaComplete))?/i,
    "il ramo di errore deve riusare la fotografia, non svuotare il pannello");
  assert.doesNotMatch(gestioneErrore, /sessione\.comandi\s*=\s*\[\s*\]/,
    "un errore non deve cancellare le skill gia visibili");
  assert.match(workflow, /La conversazione resta aperta/,
    "l'avvio deve dare un feedback esplicito senza suggerire un riavvio");

  const esito = corpoFunzione("gestisciEsitoRpcBuiltin");
  assert.match(esito, /Estensioni, skill, prompt, temi e configurazioni ricaricati/,
    "l'esito positivo deve confermare tutte le risorse ricaricate");
  assert.match(esito, /conversazione e rimasta aperta/,
    "l'esito positivo deve confermare che la conversazione e stata conservata");

  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  assert.match(interfaccia,
    /DOM\.btnRicaricaRisorse\.disabled\s*=\s*!utilizzabile[\s\S]*sessione\?\.inEsecuzione|DOM\.btnRicaricaRisorse\.disabled\s*=\s*[^;]*sessione\?*\.?inEsecuzione/,
    "Ricarica estensioni deve essere disabilitato mentre Pi sta generando una risposta");
  assert.match(interfaccia, /btnRicaricaRisorse\.setAttribute\(["']aria-busy["']/,
    "il ricaricamento in corso deve essere comunicato alle tecnologie assistive");
  assert.match(interfaccia, /Ricaricamento…/,
    "l'etichetta visibile deve confermare che il comando e in corso");
});

test("la palette slash e inline, dinamica e completamente utilizzabile da tastiera", () => {
  assert.ok(html.indexOf("/palette-core.js") < html.indexOf("/app.js"),
    "il core puro deve essere caricato prima del frontend");
  const aggiorna = corpoFunzione("aggiornaPaletteComandi");
  assert.match(aggiorna, /analizzaRichiamoComando/);
  assert.match(aggiorna, /filtraCatalogoComandi\(sessione\.comandi/,
    "i risultati devono provenire dal catalogo della sessione");
  assert.match(aggiorna, /sessione\.revisioneCapacita/,
    "il rendering deve essere legato alla revisione della sessione");

  const selezione = corpoFunzione("inserisciComandoNelComposer");
  assert.match(selezione, /APP\.sessioni\.get\(sessionId\)/);
  assert.match(selezione, /sessione\.id !== APP\.attivaId/,
    "un click obsoleto non deve scrivere nella nuova scheda");
  assert.match(selezione, /trovaComandoPerChiave/,
    "la voce va riletta dal catalogo corrente");

  assert.match(frontend, /evento\.isComposing\s*\|\|\s*composizioneInputInCorso/);
  for (const tasto of ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab", "Enter"]) {
    assert.match(frontend, new RegExp(`evento\\.key === ["']${tasto}["']`), `manca la semantica ${tasto}`);
  }
  for (const classe of ["composer-shell", "palette-comandi", "palette-opzione", "palette-descrizione", "palette-categoria"]) {
    assert.match(stile, new RegExp(`\\.${classe}(?:[^\\w-]|$)`), `manca lo stile .${classe}`);
  }
  const regolaOpzione = stile.match(/\.palette-opzione\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(regolaOpzione, /width:\s*100%/,
    "ogni risultato deve occupare tutta la larghezza della palette");
  assert.match(regolaOpzione, /background:\s*transparent/,
    "lo sfondo globale dei button non deve creare righe irregolari");
});

test("built-in, estensioni verificate e shell vengono intercettati prima di cronologia e invii pendenti", () => {
  const invio = corpoFunzione("invia");
  const intercetta = invio.indexOf("gestisciComandoComposer");
  assert.ok(intercetta >= 0, "manca l'intercettazione del composer");
  assert.ok(intercetta < invio.indexOf("aggiungiMessaggio"));
  assert.ok(intercetta < invio.indexOf("registraInvioPendente"));

  const gestore = corpoFunzione("gestisciComandoComposer");
  assert.match(gestore, /!\{1,2\}/);
  assert.match(gestore, /excludeFromContext:\s*shell\[1\]\s*===\s*["']!!["']/);
  assert.match(gestore, /\["skill",\s*"prompt"\]/,
    "skill e prompt devono continuare lungo il normale invio");
  assert.match(gestore, /\["builtin",\s*"extension"\]\.includes\(comando\.source\)/,
    "built-in ed estensioni devono attraversare lo stesso endpoint verificato");
  assert.match(gestore, /invocaComandoBuiltin\(sessione,\s*comando,\s*richiamo\.arguments,\s*fotografia\)/,
    "la disponibilita GUI o terminale deve essere decisa dal catalogo autorevole del ponte");
  assert.doesNotMatch(gestore, /rpc\(\s*\{\s*type:\s*["']prompt["']/,
    "il frontend non deve inviare direttamente un comando extension grezzo");
  assert.match(gestore, /sessione\.allegati\.length/,
    "immagini e comandi non devono separarsi silenziosamente");

  const invoca = corpoFunzione("invocaComandoBuiltin");
  assert.match(invoca, /preparaAttesaRpcEsterna/);
  assert.ok(invoca.indexOf("preparaAttesaRpcEsterna") < invoca.indexOf("/api/invoca-comando"),
    "l'attesa SSE va registrata prima del POST");
  assert.ok(invoca.indexOf("registraInvioPendente") < invoca.indexOf("/api/invoca-comando"),
    "il registro exactly-once deve essere persistito prima del POST");
  assert.match(invoca, /creaRegistroComandoBuiltin/);
  assert.match(invoca, /lineageId:\s*sessione\.lineageId/);
  assert.match(invoca, /catalogRevision/);
  assert.match(invoca, /attesa\.stato\.conclusa/,
    "un ack anticipato deve restare autorevole se la risposta HTTP si perde");
  const attendeAck = invoca.indexOf("risultatoRpcAnticipato ?? await attesa.promessa");
  const risolveDopoAck = invoca.indexOf("dimenticaCopiaSicurezzaVerificata", attendeAck);
  assert.ok(attendeAck >= 0 && attendeAck < risolveDopoAck,
    "marker e safety draft non vanno risolti prima dell'ack RPC");
  assert.match(invoca, /erroreCatalogoComandiObsoleto/);
  assert.match(invoca, /caricaCapacita\(sessione, \{ refresh: false \}\)/,
    "un 409 stale aggiorna il catalogo senza rieseguire il comando");
  assert.doesNotMatch(invoca, /return\s+invocaComandoBuiltin\(/,
    "un comando con catalogo stale non deve avere auto-retry");

  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(risposta, /invioCorrelato\?\.origine === ["']builtin["']/);
  assert.match(risposta, /gestisciAckComandoBuiltinSenzaAttesa/,
    "ack live tardivi e guiReplay devono usare il registro persistito");
  const riconcilia = corpoFunzione("riconciliaInviiPendenti");
  assert.match(riconcilia, /invioRichiedeVerificaManuale/,
    "un built-in non deve essere scambiato per un normale messaggio user");
  assert.ok(
    riconcilia.indexOf("!sessione.inviiNascosti.has(invio.id)")
      < riconcilia.indexOf("dimenticaInvioPendente(sessione, invio.id)"),
    "la visibilita della safety-copy va letta prima che la riconciliazione la dimentichi",
  );
  assert.match(
    riconcilia,
    /if \(notificaRiconciliazione && sessione\.id === APP\.attivaId\)/,
    "la conferma di un normale invio live nascosto non deve produrre un toast di recupero",
  );
  const safety = corpoFunzione("dimenticaCopiaSicurezzaVerificata");
  assert.match(safety, /lineageRecordBozza\(recordSicurezza\) === invio\.lineageId/,
    "l'ack non deve cancellare una nuova bozza identica con lineage diversa");

  const bash = corpoFunzione("eseguiBash");
  assert.ok(bash.indexOf("registraInvioPendente") < bash.indexOf("await rpc"),
    "! e !! devono persistere il journal prima della POST RPC");
  assert.match(bash, /creaRegistroShell/);
  assert.match(bash, /id,\s*\n\s*operationId,\s*\n\s*excludeFromContext:\s*Boolean\(excludeFromContext\)/,
    "la shell deve riusare ID e operationId del journal e conservare la semantica !!");
  assert.match(risposta, /invioCorrelato\?\.origine === ["']shell["']/);
  assert.match(risposta, /gestisciAckShellSenzaAttesa/);

  const chiedi = corpoFunzione("chiedi");
  assert.match(chiedi, /errore\.statusHttp = risposta\.status/);
  assert.match(chiedi, /errore\.code = codice/);
});

test("le risposte rendono cliccabili web e percorsi locali senza navigazione diretta", () => {
  assert.ok(html.indexOf('src="/link-core.js"') < html.indexOf('src="/app.js"'),
    "il classificatore puro deve essere disponibile prima del renderer");
  assert.match(frontend, /globalThis\.PiGuiLinkCore/);
  assert.match(frontend, /prossimaDestinazioneAutomatica/);
  assert.match(linkCore, /\["http:",\s*"https:",\s*"mailto:"\]/);
  assert.match(linkCore, /url\.protocol === "file:"/);
  assert.match(linkCore, /consentiRelativo/);

  const creaLink = corpoFunzione("creaCollegamentoGui");
  assert.match(creaLink, /crea\("button",\s*"link-locale",\s*etichetta\)/,
    "un percorso locale non deve avere un href navigabile");
  assert.match(creaLink, /collegamento\.type = "button"/);

  const inline = corpoFunzione("aggiungiInline");
  assert.match(inline, /LINK_CORE\.creaEspressioneInline\(\)/);
  assert.match(inline, /LINK_CORE\.analizzaTokenCollegamento\(token\)/);
  assert.match(inline, /collegamento \|\| document\.createTextNode\(link\?\.etichetta \|\| token\)/,
    "un target non valido deve restare testo, non un anchor inerte");

  const render = corpoFunzione("renderMarkdown");
  assert.match(render, /sessionId:\s*sessione\?\.id/);
  assert.match(render, /sessione\?\.cartella\s*&&\s*!sessione\?\.senzaCartella/);
  const apertura = corpoFunzione("collegaBrowserSistema");
  assert.match(apertura, /confirmed:\s*true/);
  assert.match(apertura, /\.\.\.\(sessionId \? \{ sessionId \} : \{\}\)/);
  assert.match(apertura, /aria-busy/);
  assert.doesNotMatch(apertura, /href\s*=\s*tipo === "web"\s*\?/,
    "il percorso locale non deve avere un fallback href");

  assert.match(stile, /\.markdown \.link-locale/);
  assert.match(stile, /:focus-visible/);
  assert.match(stile, /\[aria-busy="true"\]/);
});

test("i workflow built-in e i segreti delle estensioni hanno superfici GUI dedicate", () => {
  const workflow = corpoFunzione("eseguiWorkflowComando");
  for (const azione of [
    "model-picker", "scoped-models-picker", "export-picker", "import-picker",
    "share-session", "show-changelog", "show-hotkeys", "fork-picker", "tree-picker",
    "project-trust", "provider-login", "provider-logout", "resume-picker", "close-session",
  ]) assert.match(workflow, new RegExp(azione), `workflow non cablato: ${azione}`);

  const dialogo = corpoFunzione("mostraProssimoDialogoEstensione");
  assert.match(dialogo, /evento\.sensitive\s*\?\s*["']password["']/,
    "le credenziali non devono essere visibili in chiaro");
  const autenticazione = corpoFunzione("mostraNotificaAutenticazione");
  assert.match(autenticazione, /auth_url/);
  assert.match(autenticazione, /device_code/);
  assert.match(autenticazione, /Copia codice/);
  assert.match(corpoFunzione("urlAutenticazioneSicuro"), /\["http:",\s*"https:"\]/,
    "i collegamenti di autenticazione devono avere protocolli web espliciti");
  assert.match(corpoFunzione("scegliRiassuntoNavigazioneAlbero"), /type:\s*["']navigate_tree["']/);
  assert.match(corpoFunzione("mostraAlberoSessione"), /type:\s*["']set_label["']/);
  assert.match(corpoFunzione("apriEsportazionePi"), /\.jsonl\$\/i/);
  assert.match(corpoFunzione("apriEsportazionePi"), /outputPath/);
});

test("il journal workflow resta aperto fino al vero side effect e riconcilia il replay durevole", () => {
  const invoca = corpoFunzione("invocaComandoBuiltin");
  const ramoWorkflow = invoca.slice(
    invoca.indexOf('dati?.mode === "workflow"'),
    invoca.indexOf('dati?.mode === "terminal"'),
  );
  assert.match(ramoWorkflow, /creaOperazioneWorkflow/);
  assert.doesNotMatch(ramoWorkflow, /dimenticaCopiaSicurezzaVerificata/,
    "il solo routing HTTP non deve risolvere il journal");

  const operazione = corpoFunzione("creaOperazioneWorkflow");
  assert.match(operazione, /operationIdPasso/);
  assert.match(operazione, /rpcId\s*=\s*idRpc\(\)/,
    "ogni RPC effettiva deve avere una correlation nuova");
  assert.match(operazione, /persistiInvioPendente\(sessione,\s*aggiornato\)/);
  assert.ok(operazione.indexOf("persistiInvioPendente") < operazione.indexOf("return rpc("),
    "step e operationId vanno persistiti prima di contattare Pi");
  assert.match(operazione, /mutating\s*=\s*!String/);
  assert.match(operazione, /workflowRisolviSuAck:\s*Boolean\(finalStep\)/);

  const poll = corpoFunzione("attendiOperazioneServer");
  assert.match(poll, /\/api\/stato-operazione/);
  assert.match(poll, /operation\.status === ["']completed["']/);
  const reload = corpoFunzione("riconciliaOperazioniPersistite");
  assert.match(reload, /workflowOperationId\s*\|\|\s*corrente\.operationId/);
  assert.match(reload, /aggiornaDaRisposta/,
    "l'esito durevole deve attraversare la stessa logica degli ack SSE");
  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(risposta, /workflowRpcId === evento\.id/);
  assert.match(risposta, /workflowRisolviSuAck === false/,
    "un ack di un passo intermedio non deve chiudere il workflow");
});

test("settings, modelli, tree e resume mantengono la parita operativa di Pi", () => {
  const settings = corpoFunzione("apriImpostazioniPi");
  for (const nome of [
    "autoCompaction", "autoRetry", "steeringMode", "followUpMode", "blockImages",
    "autoResizeImages", "enableSkillCommands", "transport", "httpIdleTimeoutMs",
  ]) assert.match(settings, new RegExp(nome), `impostazione Pi non esposta: ${nome}`);
  assert.match(settings, /step:\s*`settings:\$\{name\}`/);
  assert.match(settings, /caricaCapacita\(sessione,\s*\{ refresh: true \}\)/,
    "abilitare/disabilitare i comandi skill deve ricostruire il catalogo");

  const catalogo = corpoFunzione("preparaCatalogoModelliDinamico");
  assert.match(catalogo, /type:\s*["']refresh_models["']/);
  assert.ok(catalogo.indexOf("apriModale") < catalogo.indexOf("refresh_models"),
    "il picker deve aprirsi subito sulla fotografia corrente");
  assert.match(catalogo, /sessione\.modelli = snapshot/,
    "un refresh fallito non deve sostituire il catalogo verificato");
  assert.match(catalogo, /risultato\.onAggiorna\?\.\(\)/,
    "l'elenco aperto deve aggiornarsi senza perdere il filtro");

  const tree = corpoFunzione("scegliRiassuntoNavigazioneAlbero");
  for (const scelta of ["none", "summary", "custom"]) {
    assert.match(tree, new RegExp(`["']${scelta}["']`), `manca la scelta tree ${scelta}`);
  }
  assert.match(tree, /customInstructions/);
  assert.match(tree, /abort_branch_summary/);
  assert.match(tree, /esito\.editorText/);

  const resume = corpoFunzione("apriRipresaConversazione");
  assert.match(resume, /Apri in una nuova scheda/);
  assert.match(resume, /Riprendi in questa scheda/);
  assert.match(resume, /type:\s*["']switch_session["']/);
  assert.match(resume, /operationId/);
});

test("GPT-5.6 espone il contesto ufficiale esteso come scelta consapevole, non automatica", () => {
  const riconosci = corpoFunzione("modelloGpt56Configurabile");
  assert.match(riconosci, /PROVIDER_GPT_56/);
  assert.match(riconosci, /ID_GPT_56/);
  const gestione = corpoFunzione("creaGestioneContestoEstesoGpt");
  assert.match(gestione, /chiedi\(["']\/api\/contesto-esteso-gpt["'],\s*\{\s*corpo:\s*\{\s*\}\s*\}\)/,
    "aprire il picker deve soltanto leggere la configurazione");
  assert.match(gestione, /corpo:\s*\{\s*enabled,\s*sessionId:\s*sessione\.id\s*\}/,
    "la scrittura deve avvenire solo dopo l'azione esplicita dell'utente");
  assert.match(gestione, /confermaRichiesta\s*=\s*obiettivo/);
  assert.match(gestione, /Conferma 1,05M/);
  assert.match(gestione, /2× input e 1,5× output/,
    "il costo long-context API deve essere spiegato prima della conferma");
  assert.match(gestione, /Con OAuth questa GUI non presenta tale stima come una fattura/);
  assert.match(gestione, /sessione\.inEsecuzione/,
    "la configurazione non deve cambiare durante un'elaborazione");
  assert.match(gestione, /sessione\.compattazioneInCorso/,
    "la configurazione non deve cambiare durante una compattazione");
  assert.match(gestione, /corpo:\s*\{\s*enabled,\s*sessionId:\s*sessione\.id\s*\}/,
    "il bridge deve ricontrollare atomicamente che la conversazione sia inattiva");
  assert.match(gestione, /\["mixed",\s*"custom"\]/,
    "una configurazione esterna o mista deve essere riconosciuta senza sovrascriverla");
  assert.match(gestione, /stato\.conflict/,
    "anche il drift esterno dopo un'attivazione GUI deve bloccare nuove sovrascritture");
  assert.match(gestione, /Configurazione esterna protetta/);
  const ricarica = corpoFunzione("aggiornaCatalogoContestoGptSessione");
  assert.match(ricarica, /chiedi\(["']\/api\/ricarica-contesto-gpt["']/,
    "refresh, catalogo, rebind e verifica devono essere orchestrati dal server");
  assert.match(ricarica, /esito\.catalogoModelliDaRicaricare\s*===\s*true/,
    "la UI deve conservare il latch autorevole restituito dal server");
  assert.doesNotMatch(ricarica, /sessione\.contestoGptDaRicaricare\s*=\s*false/,
    "una semplice get_state lato client non deve poter azzerare il latch");
  assert.match(ricarica, /contestoGptDaRicaricare\s*=\s*true/);
  const tutte = corpoFunzione("aggiornaCataloghiContestoGptAperti");
  assert.match(tutte, /\[\.\.\.APP\.sessioni\.values\(\)\]/,
    "models.json e globale: tutte le schede aperte devono essere considerate");
  assert.match(tutte, /Promise\.allSettled/,
    "una scheda occupata non deve bloccare l'aggiornamento delle altre");
  assert.match(gestione,
    /if \(dati\.refreshRequired\)\s*\{\s*const esiti = await aggiornaCataloghiContestoGptAperti\(\)/,
    "dopo il salvataggio globale tutte le schede vanno marcate pending, anche se quella corrente inizia a lavorare");
  assert.match(frontend, /agent_settled[\s\S]*?contestoGptDaRicaricare[\s\S]*?aggiornaCatalogoContestoGptSessione/,
    "una scheda in lavoro deve applicare la configurazione quando torna inattiva");
  const riprova = corpoFunzione("programmaRiprovaContestoGpt");
  assert.match(riprova, /\[1_000,\s*3_000,\s*10_000\]/,
    "un errore transitorio su una scheda gia idle deve avere retry limitati e progressivi");
  assert.match(ricarica, /programmaRiprovaContestoGpt\(sessione\)/,
    "un refresh fallito non deve restare pending indefinitamente senza un nuovo agent_settled");
  assert.match(gestione, /1,05M configurato/,
    "lo stato globale non deve fingere che ogni sessione abbia gia adottato la finestra");
  assert.match(stile, /\.contesto-esteso-gpt\s*\{/);
  assert.match(stile, /\.azioni-contesto-esteso\s*\{/);
  const snapshot = corpoFunzione("applicaSnapshot");
  const unioneSnapshot = corpoFunzione("unisciSessione");
  assert.match(unioneSnapshot, /catalogoModelliDaRicaricare/,
    "dopo F5 il latch deve essere ripreso dal riassunto server-side");
  assert.match(snapshot, /aggiornaCatalogoContestoGptSessione/,
    "una nuova finestra deve riprendere automaticamente la verifica rimasta dirty");
});

test("l'albero della conversazione e raggiungibile direttamente dalla barra laterale", () => {
  const albero = elementoConId("btn-albero");
  assert.equal(albero?.tag, "button");
  assert.equal(albero?.attributi.get("type"), "button");
  assert.equal(albero?.attributi.get("data-azione"), "albero");
  assert.match(
    `${albero?.attributi.get("aria-label") || ""} ${corpoElementoSemplice("btn-albero").replace(/<[^>]+>/g, " ")}`,
    /(?:cronologia|rami|passaggi? precedenti?|torna)/i,
    "il pulsante deve spiegare che permette di tornare a passaggi o rami precedenti",
  );

  assert.match(frontend, /btnAlbero:\s*\$\(["']#btn-albero["']\)/,
    "il pulsante deve essere incluso nella mappa DOM del frontend");
  assert.match(
    corpoFunzione("eseguiAzione"),
    /azione\s*===\s*["']albero["'][\s\S]*?return\s+apriAlberoOppureSpiega\(sessione\)/,
    "l'azione laterale deve conservare un feedback anche quando Pi lavora",
  );

  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  const bloccoDisabilitazione = interfaccia.match(
    /DOM\.btnAlbero\.disabled\s*=([\s\S]*?);/,
  )?.[1] || "";
  assert.doesNotMatch(bloccoDisabilitazione, /sessione\.inEsecuzione|sessione\.compattazioneInCorso/,
    "il controllo non deve sembrare scomparso mentre Pi lavora");
  const occupato = corpoFunzione("apriAlberoOppureSpiega");
  assert.match(occupato, /alberoTemporaneamenteOccupato/);
  assert.match(occupato, /Cronologia e rami sono conservati/);
  const modale = corpoFunzione("mostraAlberoSessione");
  assert.match(modale, /voci visibili/);
  assert.match(modale, /tecniciNascosti/);
});

test("i riepiloghi di compattazione restano chiusi e vengono renderizzati solo su richiesta", () => {
  const render = corpoFunzione("renderCronologia");
  assert.match(render, /aggiungiRiepilogoContesto\(sessione,\s*"compaction"/);
  assert.match(render, /aggiungiRiepilogoContesto\(sessione,\s*"branch"/);
  assert.doesNotMatch(render, /Contesto precedente riassunto|Riepilogo del ramo precedente/);
  assert.ok(render.indexOf("finalizzaGruppoAttivita") < render.indexOf("riconciliaInviiPendenti"),
    "anche l'ultimo blocco tecnico ricostruito deve risultare concluso");
  const riepilogo = corpoFunzione("aggiungiRiepilogoContesto");
  assert.match(riepilogo, /crea\("details",\s*"riepilogo-contesto"\)/);
  assert.match(riepilogo, /box\.addEventListener\("toggle"/);
  assert.ok(riepilogo.indexOf("if (!box.open || renderizzato) return") < riepilogo.indexOf("renderMarkdown"));
  assert.match(stile, /\.riepilogo-contesto-corpo\s*\{[\s\S]*?max-height:/);
});

test("le cronologie grandi vengono renderizzate in batch senza perdere prompt o ordine", () => {
  assert.match(frontend, /const SOGLIA_RENDER_CRONOLOGIA_PROGRESSIVO\s*=\s*\d+/);
  assert.match(frontend, /const MESSAGGI_PER_BATCH_CRONOLOGIA\s*=\s*\d+/);
  const render = corpoFunzione("renderCronologia");
  assert.match(render, /const listaMessaggi\s*=\s*Array\.from\(messaggi\s*\|\|\s*\[\]\)/,
    "il render deve fotografare l'intera sequenza senza filtrarla o troncarla");
  assert.match(render,
    /!forzaSincrono[\s\S]*?listaMessaggi\.length\s*>=\s*SOGLIA_RENDER_CRONOLOGIA_PROGRESSIVO[\s\S]*?!sessione\.inEsecuzione[\s\S]*?!sessione\.compattazioneInCorso/,
    "solo una cronologia grande e ferma puo essere dilazionata");
  assert.match(render, /sessione\.generazioneRenderCronologia\s*=\s*generazione/);
  assert.match(render, /sessione\.annullaRenderCronologia\?\.\(\)/,
    "una nuova fotografia deve annullare il render precedente");
  assert.match(render, /sessione\.generazioneRenderCronologia\s*===\s*generazione/,
    "ogni batch deve appartenere ancora alla generazione corrente");
  assert.match(render,
    /while \(indice < fineBatch\)[\s\S]*?renderizzaMessaggio\(listaMessaggi\[indice\]\)[\s\S]*?indice \+= 1/,
    "i messaggi devono essere consumati uno alla volta nello stesso ordine del JSONL");
  assert.doesNotMatch(render, /listaMessaggi\.(?:sort|reverse|splice)\(/,
    "il percorso progressivo non deve riordinare o eliminare prompt");
  assert.match(render,
    /messaggio\.role === "user"[\s\S]*?testoDaContenuto\(messaggio\.content\)/,
    "il prompt originale completo deve continuare a essere la fonte del messaggio utente");
  assert.match(render,
    /if \(indice < listaMessaggi\.length\)[\s\S]*?requestAnimationFrame\(renderizzaBatch\)[\s\S]*?return;[\s\S]*?finalizza\(\)/,
    "riconciliazione e finalizzazione devono avvenire soltanto dopo l'ultimo batch");
  assert.match(render,
    /const finalizza[\s\S]*?finalizzaGruppoAttivita[\s\S]*?riconciliaInviiPendenti\(sessione, listaMessaggi\)/);

  const caricamento = corpoFunzione("caricaCronologiaSessione");
  assert.match(caricamento,
    /sessione\.messaggiSincronizzati\s*=\s*false;[\s\S]*?await renderCronologia\(sessione, messaggi,[\s\S]*?sessione\.messaggiSincronizzati\s*=\s*!parziale/,
    "la cronologia non puo risultare sincronizzata mentre il DOM e ancora parziale");
  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(risposta,
    /evento\.command === "get_messages"[\s\S]*?messaggiSincronizzati\s*=\s*false[\s\S]*?renderCronologia[\s\S]*?\.then\([\s\S]*?messaggiSincronizzati\s*=\s*true/,
    "anche il percorso RPC deve attendere il completamento reale del render");
});

test("durante il render progressivo la bozza resta scrivibile e tutte le mutazioni sono bloccate", () => {
  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  const gateComposer = interfaccia.slice(
    interfaccia.indexOf("const composerScrivibile"),
    interfaccia.indexOf("const utilizzabile"),
  );
  assert.doesNotMatch(gateComposer, /sincronizzazione|renderCronologiaInCorso/,
    "la sola ricostruzione progressiva non deve disabilitare la textarea");
  assert.match(interfaccia,
    /const mutazioniUtilizzabili\s*=\s*utilizzabile[\s\S]*?&&\s*!sessione\?\.sincronizzazione[\s\S]*?&&\s*!sessione\?\.renderCronologiaInCorso/);
  assert.match(interfaccia, /DOM\.input\.disabled\s*=\s*!composerScrivibile/);
  assert.match(interfaccia, /Ricostruisco la cronologia salvata:[^"']*bozza resta salvata/);
  assert.match(interfaccia,
    /DOM\.conversazione\.setAttribute\([\s\S]*?"aria-busy"[\s\S]*?sessione\?\.renderCronologiaInCorso/);
  for (const controllo of ["btnAllega", "btnInvia", "btnModello", "btnRagionamento", "btnControlli"]) {
    assert.match(interfaccia, new RegExp(`DOM\\.${controllo}\\.disabled\\s*=\\s*!mutazioniUtilizzabili`),
      `${controllo} deve restare bloccato finche la cronologia e parziale`);
  }

  const rpc = corpoFunzione("rpc");
  assert.match(rpc,
    /sessione\.renderCronologiaInCorso[\s\S]*?!String\(comando\?\.type[\s\S]*?startsWith\("get_"\)[\s\S]*?erroreRenderCronologiaInCorso/,
    "anche una modale gia aperta non deve aggirare il blocco delle mutazioni");
  const invio = corpoFunzione("invia");
  assert.match(invio, /if \(sessione\?\.renderCronologiaInCorso\)[\s\S]*?bozza resta salvata/);
  assert.match(invio,
    /await \(sessione\.codaAllegatiBozza[\s\S]*?if \(sessione\.renderCronologiaInCorso\)/,
    "il controllo deve essere ripetuto dopo le code asincrone degli allegati");
  assert.match(corpoFunzione("aggiungiFile"), /sessione\.renderCronologiaInCorso/);
  assert.match(corpoFunzione("aggiungiImmagini"), /sessione\.renderCronologiaInCorso/);

  const eventi = corpoFunzione("gestisciEvento");
  assert.match(eventi,
    /sessione\.renderCronologiaInCorso[\s\S]*?EVENTI_RIPRESA_DOPO_COMPATTAZIONE[\s\S]*?completaRenderCronologiaSincrono\?\.\(\)/,
    "se la sessione diventa live, la fotografia deve essere completata prima dei delta");
});

test("gli eventi live arrivati durante il download seguono una sola fotografia completa", () => {
  assert.match(frontend, /caricamentoCronologiaInCorso:\s*null/);

  const caricamento = corpoFunzione("caricaCronologiaSessione");
  const creaBarriera = caricamento.indexOf("sessione.caricamentoCronologiaInCorso = caricamentoCronologia");
  const avviaDownload = caricamento.indexOf('fetch("/api/cronologia"');
  const staccaCoda = caricamento.indexOf("staccaEventiCronologiaAccodati");
  const avviaRender = caricamento.indexOf("await renderCronologia");
  const sincronizzata = caricamento.indexOf("sessione.messaggiSincronizzati = !parziale");
  const riproduciCoda = caricamento.lastIndexOf("riproduciEventiCronologiaAccodati");
  assert.ok(creaBarriera >= 0 && creaBarriera < avviaDownload,
    "la barriera deve esistere prima che inizi il download NDJSON");
  assert.ok(staccaCoda > avviaDownload && staccaCoda < avviaRender,
    "gli eventi devono essere separati dalla barriera prima di ricostruire il DOM");
  assert.match(caricamento, /forzaSincrono:\s*eventiAccodati\.length\s*>\s*0/,
    "una coda live richiede una fotografia sincrona prima del replay");
  assert.ok(sincronizzata > avviaRender && sincronizzata < riproduciCoda,
    "i delta accodati devono essere riammessi solo dopo la sincronizzazione completa");

  const eventi = corpoFunzione("gestisciEvento");
  const accoda = eventi.indexOf("caricamentoCronologia.eventi.push(evento)");
  const gestisceLive = eventi.indexOf("const statoDiventatoLive");
  assert.ok(accoda >= 0 && accoda < gestisceLive,
    "un evento live non deve mutare la sessione mentre il download e ancora in corso");
  assert.match(eventi,
    /caricamentoCronologia\.richiesta\s*===\s*sessione\.richiestaCronologia[\s\S]*?evento\.type\s*!==\s*"response"[\s\S]*?startsWith\("gui_"\)[\s\S]*?eventi\.push\(evento\);\s*return;/,
    "solo la barriera corrente deve accodare gli eventi di timeline, senza bloccare RPC e lifecycle GUI");
});

test("il primo message_update che promuove un render progressivo non viene scartato", () => {
  const eventi = corpoFunzione("gestisciEvento");
  const promozione = eventi.indexOf("const renderCompletato = sessione.completaRenderCronologiaSincrono?.()");
  const abilitaDelta = eventi.indexOf("if (renderCompletato) sessione.messaggiSincronizzati = true", promozione);
  const primoDelta = eventi.indexOf('evento.type === "message_update"');
  assert.ok(promozione >= 0 && promozione < abilitaDelta && abilitaDelta < primoDelta,
    "la promozione deve rendere la fotografia sincronizzata nello stesso stack del primo delta");
});

test("la compattazione troppo breve produce un solo feedback neutro", () => {
  const evento = corpoFunzione("gestisciEvento");
  const inizio = evento.indexOf('evento.type === "compaction_end"');
  const fine = evento.indexOf('evento.type === "auto_retry_start"', inizio);
  const ramo = evento.slice(inizio, fine);
  assert.match(ramo, /presentaErroreCompattazione\(evento\.errorMessage\)/);
  assert.match(ramo, /compattazione\.nonNecessaria[\s\S]*?\{ nota: compattazione\.testo \}/,
    "Nothing to compact deve aggiornare il banner come nota, non come errore");

  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(
    risposta,
    /!\(avevaAttesa\s*&&\s*compattazione\?\.nonNecessaria\)/,
    "l'ack non deve creare un toast quando il chiamante attende questo esito noto",
  );

  const azione = corpoFunzione("eseguiAzione");
  assert.match(azione, /azione === "comprimi"[\s\S]*?presentaErroreCompattazione/);
  assert.match(azione, /if \(!compattazione\?\.nonNecessaria\)\s*\{[\s\S]*?toast\(/,
    "il catch non deve aggiungere un secondo toast per una chat troppo breve");
});

test("l'etichetta di ricalcolo si spegne appena PI riprende davvero il lavoro", () => {
  const ripresa = corpoFunzione("confermaRipresaDopoCompattazione");
  assert.match(ripresa, /sessione\?\.contestoDaRicalcolare/);
  assert.match(ripresa, /EVENTI_RIPRESA_DOPO_COMPATTAZIONE\.has\(tipoEvento\)/);
  assert.match(ripresa, /sessione\.contestoDaRicalcolare\s*=\s*false/);
  assert.match(ripresa, /disegnaBarraStatoSessione\(sessione\)/,
    "anche gli eventi delta, che hanno un fast path, devono aggiornare subito l'etichetta");
  for (const evento of [
    "message_update",
    "tool_execution_start",
    "bash_execution_update",
    "agent_settled",
  ]) {
    assert.match(frontend, new RegExp(`["']${evento}["']`), `manca l'evidenza di ripresa ${evento}`);
  }
  assert.match(corpoFunzione("gestisciEvento"),
    /confermaRipresaDopoCompattazione\(sessione,\s*evento\.type\)/);
  const statistiche = corpoFunzione("aggiornaStatisticheSessione");
  assert.match(statistiche,
    /sessione\.contestoDaRicalcolare[\s\S]*?!sessione\.inEsecuzione[\s\S]*?=\s*false/,
    "anche un ricalcolo accessorio fallito a sessione ferma non deve lasciare il testo per sempre");
});

test("durante la compattazione la bozza resta scrivibile ma non viene inviata", () => {
  assert.match(corpoFunzione("creaSessione"),
    /compattazioneInCorso:\s*Boolean\(meta\.compattazioneInCorso\)/,
    "un reload deve ereditare la barriera autorevole del server");
  assert.match(corpoFunzione("unisciSessione"),
    /["']compattazioneInCorso["']/,
    "anche gli snapshot successivi devono aggiornare la barriera autorevole");
  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  const definizioneScrittura = interfaccia.slice(
    interfaccia.indexOf("const composerScrivibile"),
    interfaccia.indexOf("const utilizzabile"),
  );
  assert.doesNotMatch(definizioneScrittura, /compattazioneInCorso/,
    "il riassunto non deve disabilitare la textarea");
  assert.match(interfaccia,
    /const utilizzabile\s*=\s*composerScrivibile\s*&&\s*!sessione\?\.compattazioneInCorso/,
    "invio, allegati e cambi di configurazione restano bloccati durante il riassunto");
  assert.match(interfaccia, /DOM\.input\.disabled\s*=\s*!composerScrivibile/);
  assert.match(interfaccia, /Scrivi pure:[^"']*bozza resta salvata/);
  const invio = corpoFunzione("invia");
  assert.match(invio, /if \(sessione\?\.compattazioneInCorso\)/,
    "Invio da tastiera deve rispettare lo stesso blocco del pulsante disabilitato");
  assert.match(invio, /La bozza e salvata/);
  assert.match(invio,
    /await \(sessione\.codaAllegatiBozza[\s\S]*?if \(sessione\.compattazioneInCorso\)/,
    "una compattazione iniziata durante gli await deve bloccare comunque il prompt RPC");
  assert.match(invio,
    /if \(sessione\.compattazioneInCorso\)[\s\S]*?bloccoCompattazione[\s\S]*?throw bloccoCompattazione;[\s\S]*?await rpc\(comando/,
    "l'ultima guardia deve trovarsi immediatamente nel tratto che precede il prompt RPC");
  assert.match(invio, /errore\?\.compattazioneInCorso[\s\S]*?messaggio\.msg\.remove\(\)/,
    "la race deve rimuovere l'anteprima ottimistica senza cancellare la bozza");
  const azioniLaterali = corpoFunzione("abilitaAzioni");
  assert.match(azioniLaterali,
    /azione === ["']nuova["']\s*&&\s*!sessione\?\.compattazioneInCorso/,
    "Nuova conversazione nella sidebar deve disabilitarsi durante la compattazione");
  assert.doesNotMatch(azioniLaterali,
    /\[[^\]]*["']nuova["'][^\]]*\]\.includes/,
    "Nuova conversazione non deve piu essere una deroga incondizionata");
  assert.match(invio,
    /if \(sessione\.contestoGptDaRicaricare\)[\s\S]*?await aggiornaCatalogoContestoGptSessione\(sessione\)[\s\S]*?if \(sessione\.contestoGptDaRicaricare\)/,
    "il primo prompt non deve partire con il vecchio limite se il refresh automatico e fallito");
});

test("lo stato locale non devia Pi e steer resta una scelta esplicita one-shot", () => {
  const stato = elementoConId("btn-stato-attivita");
  assert.equal(stato?.tag, "button");
  const statoAttivita = corpoFunzione("testoStatoAttivita");
  assert.match(statoAttivita, /nessuna percentuale inventata/i);
  assert.match(statoAttivita, /sessione\.gruppiTurno/,
    "lo stato deve contare tutti i gruppi del turno anche dopo un follow-up ottimistico");
  assert.match(frontend, /DOM\.btnStatoAttivita\.onclick\s*=\s*mostraStatoAttivita/);
  const opzioni = corpoElementoSemplice("modo-coda");
  assert.ok(opzioni.indexOf('value="followUp"') < opzioni.indexOf('value="steer"'));
  assert.match(opzioni, /non interrompe/);
  assert.match(opzioni, /può deviare/);
  assert.match(frontend, /Intervenire nel lavoro in corso\?/);
  const invio = corpoFunzione("invia");
  assert.match(invio, /modoScelto === "steer"[\s\S]*?sessione\.modoCoda = "followUp"/);
});

test("la barra distingue la stima tariffaria dall'addebito OAuth", () => {
  const uso = corpoFunzione("testoUsoSessione");
  assert.match(uso, /VISTA_CORE\.presentaCosto\(costo, provider\)/);
  const barra = corpoFunzione("disegnaBarraStatoSessione");
  assert.match(barra, /input non in cache/);
  assert.match(barra, /sessione\.spiegazioneCosto/);
  const statistiche = corpoFunzione("mostraStatistiche");
  assert.match(statistiche, /Costo equivalente stimato/);
  assert.match(frontend, /mostraStatistiche\(statistiche, sessione\)/,
    "la risposta asincrona deve conservare la sessione che ha prodotto i dati");
  assert.match(frontend, /mostraStatistiche\(risultato, sessione\)/);
});

test("il pulsante Modello non usa il PointerEvent come filtro di ricerca", () => {
  assert.match(
    frontend,
    /DOM\.btnModello\.onclick\s*=\s*\(\)\s*=>\s*apriSceltaModello\(\)/,
  );
  assert.doesNotMatch(frontend, /DOM\.btnModello\.onclick\s*=\s*apriSceltaModello\s*;/);
});

test("le modali prendono subito il focus e i workflow tornano al composer", () => {
  const apertura = corpoFunzione("apriModale");
  assert.match(apertura, /sessioneAttiva\(\)\?\.invioInCorso/);
  assert.match(apertura, /composerDaRipristinare/);
  assert.match(apertura, /DOM\.modale\.focus\(\{ preventScroll: true \}\)/);
  const chiusura = corpoFunzione("chiudiModale");
  assert.match(chiusura, /stato\?\.precedente\?\.isConnected/);
});

test("share e login cancellabili usano operazioni stabili senza retry automatici", () => {
  const share = corpoFunzione("condividiSessione");
  assert.match(share, /preparaPasso\(["']share["']\)/);
  assert.match(share, /chiediOperazioneIdempotente/);
  assert.match(share, /PREFISSO_RISULTATI_OPERAZIONI/);

  const auth = corpoFunzione("mostraNotificaAutenticazione");
  assert.match(auth, /AUTH_FLOW\.loginCommandIdEvento\(evento\)/);
  assert.match(auth, /annullaLoginProvider/);
  const dialogo = corpoFunzione("mostraProssimoDialogoEstensione");
  assert.match(dialogo, /AUTH_FLOW\.loginCommandIdEvento\(evento\)/);
  assert.match(dialogo, /if \(risposta\.cancelled\) annullaAutenticazione\(\)/);
  const annulla = corpoFunzione("annullaLoginProvider");
  assert.match(annulla, /\/api\/annulla-login-provider/);
  assert.match(annulla, /loginProviderAnnullati\.has/,
    "chiusura, pulsante e timeout devono produrre una sola cancellazione");
  assert.doesNotMatch(annulla, /setTimeout|while\s*\(/,
    "la cancellazione auth non deve avere retry automatici");
});

test("il nuovo tema continua a stilizzare i nodi creati dinamicamente da app.js", () => {
  for (const classe of [
    "scheda-gruppo",
    "scheda",
    "msg",
    "msg-chi",
    "msg-corpo",
    "utente",
    "agente",
    "strumento",
    "voce",
  ]) {
    assert.match(stile, new RegExp(`\\.${classe}(?:[^\\w-]|$)`),
      `stile.css non copre piu la classe dinamica .${classe}`);
  }
});
