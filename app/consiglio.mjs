// Coordinatore del consiglio a piu modelli.
// Apre le sessioni di ruolo, invia il prompt congelato, raccoglie i contributi,
// gestisce il limite di richieste del provider con una sola ripetizione, congela
// il piano dei test e conserva il lavoro su disco. La fusione dei contributi e i
// controlli non vivono qui: arrivano dai punti di aggancio iniettabili.

import { dirname, isAbsolute, join, resolve } from "node:path";
import { improntaTesto, troncaLog } from "./consiglio-store.mjs";
import {
  risolviRuoliConsiglio,
  ruoliInOrdine,
  validaConfigurazioneConsiglio,
} from "./consiglio-ruoli.mjs";

export const ATTESA_PREDEFINITA_429_MS = 20_000;
export const TIMEOUT_RUOLO_MS = 20 * 60 * 1000;
export const TIMEOUT_TEST_MS = 10 * 60 * 1000;
export const PREFISSO_SCHEDA_RISULTATO = "consiglio:";
export const NOME_SCHEDA_RISULTATO = "Risultato";
export const VARIABILE_RUOLO = "PI_GUI_CONSIGLIO_RUOLO";
export const VARIABILE_WORKSPACE = "PI_GUI_CONSIGLIO_WORKSPACE";
export const VARIABILE_PIANO = "PI_GUI_CONSIGLIO_PIANO";
export const STATI_IN_CORSO = new Set(["preparazione", "raccolta", "fusione", "verifica"]);
export const LIMITE_PROMPT = 2 * 1024 * 1024;
export const LIMITE_ISTRUZIONI = 64 * 1024;

export function erroreConsiglio(codice, messaggio, stato = 400, recuperabile = false) {
  const errore = new Error(messaggio);
  errore.statusHttp = stato;
  errore.codiceConsiglio = codice;
  errore.recuperabile = recuperabile;
  return errore;
}

function oggetto(valore) {
  return Boolean(valore) && typeof valore === "object" && !Array.isArray(valore);
}

function soloCampi(corpo, ammessi, dove) {
  for (const chiave of Object.keys(corpo)) {
    if (!ammessi.includes(chiave)) {
      throw erroreConsiglio("schema", `La richiesta di ${dove} contiene il campo non previsto "${chiave}".`, 400);
    }
  }
}

// Pi consegna al ponte soltanto una stringa: i secondi di attesa vanno letti da
// li. Le tre forme cercate sono quelle che i provider usano davvero.
export function secondiAttesaDaErrore(testo) {
  const contenuto = String(testo ?? "");
  const forme = [
    /retry[\s-]*after[:\s]*([0-9]+(?:\.[0-9]+)?)/iu,
    /(?:in|after)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:s\b|sec|second)/iu,
    /requested\s+([0-9]+(?:\.[0-9]+)?)\s*s/iu,
  ];
  for (const forma of forme) {
    const trovato = contenuto.match(forma);
    if (!trovato) continue;
    const secondi = Number(trovato[1]);
    if (Number.isFinite(secondi) && secondi >= 0 && secondi <= 3600) return secondi;
  }
  return null;
}

export function sembraLimiteRichieste(testo) {
  const contenuto = String(testo ?? "");
  return /\b429\b/u.test(contenuto)
    || /too many requests/iu.test(contenuto)
    || /rate[\s-]*limit/iu.test(contenuto)
    || /troppe richieste/iu.test(contenuto);
}

export function ambienteRuolo({ ruolo, workspace, filePiano }) {
  return {
    [VARIABILE_RUOLO]: String(ruolo || ""),
    [VARIABILE_WORKSPACE]: workspace ? String(workspace) : "",
    [VARIABILE_PIANO]: filePiano ? String(filePiano) : "",
  };
}

export function promptConsigliere({ prompt, istruzioni }) {
  const righe = [
    "Rispondi per intero alla richiesta che segue, con le tue parole e senza rimandare ad altri.",
    "Dichiara i dubbi e le parti che non puoi verificare, invece di nasconderli.",
    "",
    "### RICHIESTA",
    String(prompt ?? ""),
  ];
  if (istruzioni) righe.push("", "### ISTRUZIONI AGGIUNTIVE", String(istruzioni));
  return righe.join("\n");
}

// npm-cli.js viaggia accanto all'eseguibile di Node, sia nel runtime
// vendorizzato sia in una installazione di sistema.
export async function risolviNpmCli(execPath, esisteFile) {
  const base = dirname(String(execPath || ""));
  if (!base) return null;
  const candidati = [
    join(base, "node_modules", "npm", "bin", "npm-cli.js"),
    join(base, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidato of candidati) {
    if (await esisteFile(candidato)) return resolve(candidato);
  }
  return null;
}

// Il piano si congela all'avvio e non si rilegge piu: e l'unica difesa contro
// uno scrittore che riscrive scripts.test dopo il consenso.
export async function rilevaPianoTest({
  workspace,
  tipo,
  execPath,
  esisteFile,
  leggiFile,
  improntaFile,
  percorsoNpmCli = null,
}) {
  if (tipo !== "codice" || !workspace) {
    return { origine: "assente", motivo: "Lavoro di solo testo: non viene eseguito nessun comando." };
  }
  const filePiano = join(workspace, "package.json");
  let pacchetto = null;
  try {
    pacchetto = JSON.parse(await leggiFile(filePiano, "utf8"));
  } catch {
    return {
      origine: "assente",
      motivo: "Nella cartella di lavoro non c'è un package.json leggibile: i test non vengono eseguiti e Approva resta bloccato.",
    };
  }
  const script = pacchetto?.scripts?.test;
  if (typeof script !== "string" || !script.trim()) {
    return {
      origine: "assente",
      motivo: "Il package.json non definisce lo script test: i test non vengono eseguiti e Approva resta bloccato.",
    };
  }
  const npmCli = percorsoNpmCli || await risolviNpmCli(execPath, esisteFile);
  if (!npmCli) {
    return {
      origine: "assente",
      motivo: "Non trovo npm-cli.js accanto a Node: il comando dei test non è determinabile e Approva resta bloccato.",
    };
  }
  return {
    origine: "npm",
    eseguibile: String(execPath),
    argomenti: [npmCli, "run", "test"],
    cwd: workspace,
    filePiano,
    pianoHash: await improntaFile(filePiano),
    script: script.trim(),
    comando: `${execPath} ${npmCli} run test`,
  };
}

export function testoConsenso({ piano, workspace, cartellaConsigli, ripristino }) {
  const righe = [
    `Lo scrittore del consiglio modificherà i file della cartella ${workspace}.`,
  ];
  if (piano?.origine === "npm") {
    righe.push(
      `Al termine il ponte eseguirà questo comando, con i permessi del tuo account e, trattandosi di uno script npm, attraverso il processore comandi di sistema: ${piano.comando}`,
    );
  } else {
    righe.push(
      `Non è stato riconosciuto un comando di test da eseguire (${piano?.motivo || "motivo non disponibile"}): per un lavoro di codice Approva resta bloccato.`,
    );
  }
  righe.push(
    `Richiesta, istruzioni e contributi restano salvati in chiaro in ${cartellaConsigli} fino a trenta giorni.`,
  );
  righe.push(
    ripristino?.disponibile
      ? "Se lo chiedi, con Rifai posso riportare allo stato di adesso i soli file che il consiglio dichiara di aver modificato."
      : `Il ripristino con git non è possibile (${ripristino?.motivo || "git non disponibile"}): i file modificati restano come sono.`,
  );
  return righe.join("\n");
}

export function azioniPerStato(stato) {
  return {
    approva: stato === "bozza_valida",
    rifai: ["bozza_valida", "bozza_bloccata", "approvato", "interrotto"].includes(stato),
    annulla: STATI_IN_CORSO.has(stato) || ["bozza_valida", "bozza_bloccata"].includes(stato),
  };
}

// Quando il comando distingue i due flussi si legge soltanto stdout: un avviso
// di git ("warning: LF will be replaced by CRLF", comune su Windows) arriva su
// stderr e non deve passare per un identificativo. Con un comando che mescola i
// flussi si prende comunque l'ultima riga che ha la forma di un oggetto git.
export function uscitaStandard(esito) {
  return typeof esito?.stdout === "string" ? esito.stdout : String(esito?.uscita ?? "");
}

export function shaDaUscita(esito) {
  const righe = uscitaStandard(esito).split(/\r?\n/u).map((riga) => riga.trim()).filter(Boolean);
  for (let indice = righe.length - 1; indice >= 0; indice -= 1) {
    const primo = righe[indice].split(/\s+/u)[0];
    if (/^[0-9a-f]{7,64}$/u.test(primo)) return primo;
  }
  return "";
}

export function percorsiDaRipristinare({ dichiarati, tracciati }) {
  const insieme = new Set(tracciati.map((percorso) => percorso.replace(/\\/gu, "/")));
  return dichiarati
    .map((percorso) => String(percorso).replace(/\\/gu, "/"))
    .filter((percorso) => insieme.has(percorso));
}

// Punti di aggancio predefiniti: finche i moduli dello scrittore e dei controlli
// non esistono, il consiglio resta in bozza bloccata invece di fingere un esito.
export const fusioneNonDisponibile = {
  componiPrompt() {
    return null;
  },
  analizzaUscita() {
    return {
      ok: false,
      motivi: ["Il modulo dello scrittore non è ancora disponibile in questa versione."],
      risultato: null,
    };
  },
};

export function controlliNonDisponibili({ tipo }) {
  return {
    tipo: tipo === "codice" ? "test" : "eval",
    esito: "assente",
    motivi: ["Il modulo dei controlli non è ancora disponibile: Approva resta bloccato."],
    logTroncato: null,
    impronteFile: [],
  };
}

export function guardiaNonDisponibile() {
  return { consentito: false, motivo: "La guardia degli strumenti del consiglio non è ancora disponibile." };
}

export function creaGestoreConsiglio({
  archivio,
  cartellaConsigli,
  acquisisciMutazione,
  reclamaOperazione,
  trovaOperazioneRegistrata,
  completaOperazione,
  improntaOperazione,
  operationIdValido,
  postiLiberi,
  apriSessioneRuolo,
  chiudiSessioneRuolo,
  leggiUltimaRisposta,
  descriviSessioneSorgente,
  catalogoModelli,
  leggiConfigurazioneRuoli,
  salvaConfigurazioneRuoli,
  emetti,
  fondiRisultato = fusioneNonDisponibile,
  verificaControlli = controlliNonDisponibili,
  guardStrumenti = guardiaNonDisponibile,
  attendi = (ms) => new Promise((risolvi) => setTimeout(risolvi, ms)),
  pausaBreve = (ms) => new Promise((risolvi) => setTimeout(risolvi, ms)),
  eseguiComando,
  esisteFile,
  leggiFile,
  improntaFile,
  execPath = process.execPath,
  percorsoNpmCli = null,
  adesso = () => Date.now(),
  nuovoId,
  attesaPredefinita429Ms = ATTESA_PREDEFINITA_429_MS,
  timeoutRuoloMs = TIMEOUT_RUOLO_MS,
  registraProcessoTest = () => {},
  dimenticaProcessoTest = () => {},
} = {}) {
  const lavori = new Map();
  const attese = new Map();
  let prenotati = 0;

  function ora() {
    return new Date(adesso()).toISOString();
  }

  function trovaLavoro(lavoroId) {
    const lavoro = lavori.get(lavoroId);
    if (!lavoro) throw erroreConsiglio("lavoro-assente", "Il lavoro del consiglio non esiste più in questa sessione del ponte.", 404);
    return lavoro;
  }

  // La sessione viva di un ruolo non deve finire su disco: nel file resta solo
  // il suo identificativo.
  async function conserva(lavoro) {
    lavoro.aggiornatoIl = ora();
    await archivio.salva({
      ...lavoro,
      ruoli: lavoro.ruoli.map(({ sessione, ...resto }) => resto),
    });
  }

  function emettiStato(lavoro, motivo = null) {
    lavoro.seq += 1;
    emetti({
      type: "gui_consiglio_stato",
      lavoroId: lavoro.lavoroId,
      revisione: lavoro.revisione,
      seq: lavoro.seq,
      at: ora(),
      stato: lavoro.stato,
      ...(motivo ? { motivo } : {}),
      azioni: azioniPerStato(lavoro.stato),
    });
  }

  function emettiRuolo(lavoro, ruolo, extra = {}) {
    lavoro.seq += 1;
    emetti({
      type: "gui_consiglio_ruolo",
      lavoroId: lavoro.lavoroId,
      revisione: lavoro.revisione,
      seq: lavoro.seq,
      at: ora(),
      roleId: ruolo.roleId,
      guiSessionId: ruolo.guiSessionId,
      stato: ruolo.stato,
      tentativo: ruolo.tentativo,
      ...(ruolo.attesaFinoA ? { attesaFinoA: ruolo.attesaFinoA } : {}),
      ...(ruolo.errore ? { errore: ruolo.errore } : {}),
      ...extra,
    });
  }

  function emettiControllo(lavoro, controllo) {
    lavoro.seq += 1;
    emetti({
      type: "gui_consiglio_controllo",
      lavoroId: lavoro.lavoroId,
      revisione: lavoro.revisione,
      seq: lavoro.seq,
      at: ora(),
      tipo: controllo.tipo,
      esito: controllo.esito,
      motivi: controllo.motivi || [],
    });
  }

  async function cambiaStato(lavoro, stato, motivo = null) {
    lavoro.stato = stato;
    lavoro.motivo = motivo;
    await conserva(lavoro);
    emettiStato(lavoro, motivo);
  }

  // Un ciclo di revisione puo restare in volo dopo che l'utente ha premuto
  // Annulla o Rifai: l'annullamento alza la generazione e porta lo stato ad
  // "annullato", Rifai apre la generazione successiva. Dopo di che il ciclo
  // vecchio non deve piu scrivere nulla, ne lo stato ne i contributi, e
  // soprattutto non deve arrivare a eseguire i test in una cartella per cui il
  // consenso e stato revocato. Ogni transizione passa da qui.
  function revisioneSuperata(lavoro, generazione) {
    return lavoro.stato === "annullato" || lavoro.generazione !== generazione;
  }

  // Osservatore degli eventi di una sessione di ruolo. Il ponte lo aggancia a
  // SessionePi alla creazione: e l'unico canale con cui il consiglio vede
  // agent_settled, auto_retry_start e gli errori del provider.
  function osservaEvento(guiSessionId, evento) {
    const attesa = attese.get(guiSessionId);
    if (!attesa) return;
    const tipo = String(evento?.type || "");
    if (tipo === "auto_retry_start") {
      attesa.autoRetry += 1;
      attesa.ultimoAutoRetry = {
        attempt: Number(evento.attempt) || attesa.autoRetry,
        maxAttempts: Number(evento.maxAttempts) || null,
        delayMs: Number(evento.delayMs) || null,
        errorMessage: typeof evento.errorMessage === "string" ? evento.errorMessage : null,
      };
      attesa.suAutoRetry?.(attesa.ultimoAutoRetry);
      return;
    }
    if (tipo === "error" || tipo === "agent_error" || tipo === "gui_errore") {
      const messaggio = typeof evento.message === "string" ? evento.message
        : typeof evento.messaggio === "string" ? evento.messaggio
          : typeof evento.error === "string" ? evento.error : null;
      if (messaggio) attesa.errore = messaggio;
      return;
    }
    if (tipo === "message_end" && evento.message?.stopReason === "error") {
      attesa.stopReasonErrore = true;
      if (!attesa.errore && typeof evento.message?.errorMessage === "string") {
        attesa.errore = evento.message.errorMessage;
      }
      return;
    }
    if (tipo === "agent_settled") {
      attesa.concluso = true;
      attesa.risolvi?.();
    }
  }

  function registraAttesa(guiSessionId, suAutoRetry) {
    const attesa = {
      autoRetry: 0,
      errore: null,
      stopReasonErrore: false,
      concluso: false,
      ultimoAutoRetry: null,
      suAutoRetry,
      risolvi: null,
    };
    attesa.fine = new Promise((risolvi) => { attesa.risolvi = risolvi; });
    attese.set(guiSessionId, attesa);
    return attesa;
  }

  async function leggiContributo(sessione) {
    let ultimo = null;
    for (let tentativo = 0; tentativo < 6; tentativo += 1) {
      try {
        return await leggiUltimaRisposta(sessione);
      } catch (errore) {
        ultimo = errore;
        await pausaBreve(25);
      }
    }
    throw ultimo || new Error("Non riesco a leggere la risposta del ruolo");
  }

  // Un turno: invio, attesa di agent_settled, lettura dell'ultima risposta.
  async function turnoDiRuolo(lavoro, ruolo, testo) {
    const sessione = ruolo.sessione;
    if (!sessione) return { ok: false, errore: "La sessione del ruolo è stata chiusa." };
    const attesa = registraAttesa(sessione.id, (autoRetry) => {
      emettiRuolo(lavoro, ruolo, {
        stato: "attesa_provider",
        attesaProvider: { attempt: autoRetry.attempt, maxAttempts: autoRetry.maxAttempts },
      });
    });
    try {
      try {
        sessione.inviaPromptDiRuolo(testo);
      } catch (errore) {
        return { ok: false, errore: String(errore?.message || errore) };
      }
      let scaduto = false;
      const timer = setTimeout(() => {
        scaduto = true;
        attesa.risolvi?.();
      }, timeoutRuoloMs);
      timer.unref?.();
      try {
        await attesa.fine;
      } finally {
        clearTimeout(timer);
      }
      if (scaduto && !attesa.concluso) {
        return { ok: false, errore: "Il ruolo non ha risposto entro il tempo previsto." };
      }
      if (attesa.errore || attesa.stopReasonErrore) {
        return {
          ok: false,
          ...(attesa.stopReasonErrore ? { stopReason: "error" } : {}),
          errore: attesa.errore
            || "La risposta si è chiusa con stopReason error: il contributo non entra nella fusione.",
        };
      }
      const risposta = await leggiContributo(sessione).catch((errore) => ({
        testo: "",
        stopReason: null,
        errore: String(errore?.message || errore),
      }));
      if (risposta.errore) return { ok: false, errore: risposta.errore };
      if (["error", "aborted"].includes(String(risposta.stopReason || ""))) {
        return { ok: false, errore: `La risposta si è chiusa con stopReason ${risposta.stopReason}.`, stopReason: risposta.stopReason };
      }
      if (!String(risposta.testo || "").trim()) {
        return { ok: false, errore: "Il ruolo non ha prodotto testo utilizzabile." };
      }
      return { ok: true, testo: risposta.testo, stopReason: risposta.stopReason || "stop" };
    } finally {
      attese.delete(sessione.id);
    }
  }

  // Una sola ripetizione del ponte. Gli auto_retry_start di pi non contano:
  // sono attese del provider dentro lo stesso turno.
  async function eseguiRuolo(lavoro, ruolo, testo) {
    for (let tentativo = 0; tentativo <= 1; tentativo += 1) {
      if (ruolo.stato === "annullato" || lavoro.stato === "annullato") {
        return { ok: false, errore: "Ruolo annullato." };
      }
      ruolo.tentativo = tentativo;
      ruolo.stato = "in_corso";
      ruolo.attesaFinoA = null;
      emettiRuolo(lavoro, ruolo);
      const esito = await turnoDiRuolo(lavoro, ruolo, testo);
      if (ruolo.stato === "annullato" || lavoro.stato === "annullato") {
        return { ok: false, errore: "Ruolo annullato." };
      }
      if (esito.ok) {
        ruolo.stato = "completato";
        ruolo.errore = null;
        emettiRuolo(lavoro, ruolo);
        return esito;
      }
      const limite = sembraLimiteRichieste(esito.errore);
      if (!limite || tentativo === 1) {
        ruolo.stato = "errore";
        ruolo.errore = esito.errore;
        emettiRuolo(lavoro, ruolo);
        return esito;
      }
      const secondi = secondiAttesaDaErrore(esito.errore);
      const millisecondi = secondi === null ? attesaPredefinita429Ms : Math.round(secondi * 1000);
      ruolo.stato = "attesa_provider";
      ruolo.attesaFinoA = new Date(adesso() + millisecondi).toISOString();
      ruolo.errore = esito.errore;
      lavoro.attese.push({ roleId: ruolo.roleId, millisecondi, secondiDichiarati: secondi });
      emettiRuolo(lavoro, ruolo, { ripetizione: { numero: 1, su: 1 }, attesaMs: millisecondi });
      await conserva(lavoro);
      await attendi(millisecondi);
    }
    return { ok: false, errore: "Ripetizione esaurita." };
  }

  function contributiValidi(lavoro) {
    return lavoro.contributi.filter((contributo) => contributo.incluso);
  }

  async function chiudiRuoli(lavoro) {
    for (const ruolo of lavoro.ruoli) {
      const sessione = ruolo.sessione;
      ruolo.sessione = null;
      if (!sessione) continue;
      attese.delete(sessione.id);
      await chiudiSessioneRuolo(sessione).catch(() => {});
    }
  }

  async function eseguiControllo(lavoro) {
    const piano = lavoro.piano;
    if (lavoro.tipo === "codice" && piano?.origine === "npm") {
      const improntaAttuale = await improntaFile(piano.filePiano).catch(() => null);
      if (improntaAttuale !== piano.pianoHash) {
        return {
          tipo: "test",
          esito: "fail",
          motivi: ["Il piano dei test è cambiato dopo il consenso: nessun comando è stato eseguito."],
          logTroncato: null,
          impronteFile: [],
          at: ora(),
        };
      }
    }
    if (lavoro.tipo === "codice" && piano?.origine !== "npm") {
      return {
        tipo: "test",
        esito: "fail",
        motivi: [piano?.motivo || "Nessun comando di test riconosciuto per questa cartella."],
        logTroncato: null,
        impronteFile: [],
        at: ora(),
      };
    }
    const esito = await verificaControlli({
      tipo: lavoro.tipo,
      piano,
      workspace: lavoro.workspace,
      risultato: lavoro.risultato,
      registraProcesso: registraProcessoTest,
      dimenticaProcesso: dimenticaProcessoTest,
      esegui: eseguiComando,
      tronca: troncaLog,
      timeoutMs: TIMEOUT_TEST_MS,
    });
    return {
      tipo: esito?.tipo || (lavoro.tipo === "codice" ? "test" : "eval"),
      esito: ["pass", "fail", "assente"].includes(esito?.esito) ? esito.esito : "fail",
      motivi: Array.isArray(esito?.motivi) ? esito.motivi : [],
      logTroncato: esito?.logTroncato == null ? null : troncaLog(esito.logTroncato),
      impronteFile: Array.isArray(esito?.impronteFile) ? esito.impronteFile : [],
      at: ora(),
    };
  }

  async function improntePerFile(lavoro, percorsi) {
    const impronte = [];
    for (const percorso of percorsi) {
      const pieno = isAbsolute(percorso) ? percorso : join(lavoro.workspace || "", percorso);
      const impronta = await improntaFile(pieno).catch(() => null);
      impronte.push({ percorso, impronta });
    }
    return impronte;
  }

  // Il ciclo di una revisione: consiglieri in parallelo, fusione, controllo.
  async function eseguiRevisione(lavoro) {
    const generazione = lavoro.generazione;
    // Chiusura di una revisione: i ruoli si chiudono e lo stato cambia soltanto
    // se nel frattempo nessuno ha annullato il lavoro o aperto un Rifai.
    const concludi = async (stato, motivo = null) => {
      if (revisioneSuperata(lavoro, generazione)) return;
      await chiudiRuoli(lavoro);
      if (revisioneSuperata(lavoro, generazione)) return;
      await cambiaStato(lavoro, stato, motivo);
    };
    try {
      if (revisioneSuperata(lavoro, generazione)) return;
      await cambiaStato(lavoro, "raccolta");
      const testoConsiglieri = promptConsigliere({
        prompt: lavoro.revisioneCorrente.prompt,
        istruzioni: lavoro.revisioneCorrente.istruzioni,
      });
      const consiglieri = lavoro.ruoli.filter((ruolo) => ruolo.tipo === "consigliere");
      const esiti = await Promise.all(
        consiglieri.map(async (ruolo) => ({ ruolo, esito: await eseguiRuolo(lavoro, ruolo, testoConsiglieri) })),
      );
      if (revisioneSuperata(lavoro, generazione)) return;
      for (const { ruolo, esito } of esiti) {
        lavoro.contributi.push({
          roleId: ruolo.roleId,
          provider: ruolo.provider,
          modello: ruolo.modello,
          testo: esito.ok ? esito.testo : "",
          stopReason: esito.ok ? esito.stopReason : (esito.stopReason || "error"),
          incluso: Boolean(esito.ok),
          errore: esito.ok ? null : esito.errore,
        });
      }
      const validi = contributiValidi(lavoro);
      if (!validi.length) {
        await concludi("bozza_bloccata", "Nessun consigliere ha prodotto un contributo valido.");
        return;
      }
      if (revisioneSuperata(lavoro, generazione)) return;
      await cambiaStato(lavoro, "fusione");
      const scrittore = lavoro.ruoli.find((ruolo) => ruolo.tipo === "scrittore");
      const promptScrittore = fondiRisultato.componiPrompt({
        prompt: lavoro.revisioneCorrente.prompt,
        istruzioni: lavoro.revisioneCorrente.istruzioni,
        contributi: validi,
        tipo: lavoro.tipo,
        workspace: lavoro.workspace,
      });
      if (typeof promptScrittore !== "string" || !promptScrittore.trim()) {
        await concludi("bozza_bloccata", "Il modulo dello scrittore non ha prodotto il contratto da inviare.");
        return;
      }
      const esitoScrittore = await eseguiRuolo(lavoro, scrittore, promptScrittore);
      if (revisioneSuperata(lavoro, generazione)) return;
      if (!esitoScrittore.ok) {
        await concludi("bozza_bloccata", `Lo scrittore non ha completato: ${esitoScrittore.errore}`);
        return;
      }
      const analisi = fondiRisultato.analizzaUscita(esitoScrittore.testo, validi);
      if (!analisi?.ok || !analisi.risultato) {
        lavoro.testoGrezzoScrittore = esitoScrittore.testo;
        await concludi(
          "bozza_bloccata",
          (analisi?.motivi || ["L'uscita dello scrittore non rispetta il formato previsto."]).join(" "),
        );
        return;
      }
      lavoro.risultato = {
        testo: analisi.risultato.testo,
        provenienza: analisi.risultato.provenienza || [],
        scartati: analisi.risultato.scartati || [],
        fileModificati: analisi.risultato.fileModificati || [],
        eval: analisi.risultato.eval || [],
        risultatoHash: improntaTesto(analisi.risultato.testo),
      };
      if (revisioneSuperata(lavoro, generazione)) return;
      await cambiaStato(lavoro, "verifica");
      const controllo = await eseguiControllo(lavoro);
      if (revisioneSuperata(lavoro, generazione)) return;
      if (!controllo.impronteFile.length && lavoro.risultato.fileModificati.length) {
        controllo.impronteFile = await improntePerFile(lavoro, lavoro.risultato.fileModificati);
      }
      lavoro.controllo = controllo;
      emettiControllo(lavoro, controllo);
      await concludi(
        controllo.esito === "pass" ? "bozza_valida" : "bozza_bloccata",
        controllo.esito === "pass" ? null : (controllo.motivi[0] || "Il controllo automatico non è passato."),
      );
    } catch (errore) {
      if (revisioneSuperata(lavoro, generazione)) return;
      await chiudiRuoli(lavoro).catch(() => {});
      lavoro.stato = "bozza_bloccata";
      lavoro.motivo = String(errore?.message || errore);
      await conserva(lavoro).catch(() => {});
      emettiStato(lavoro, lavoro.motivo);
    }
  }

  async function statoGit(workspace) {
    if (!workspace) return { disponibile: false, motivo: "Nessuna cartella di lavoro." };
    if (!await esisteFile(join(workspace, ".git"))) {
      return { disponibile: false, motivo: "La cartella di lavoro non è un repository git." };
    }
    const versione = await eseguiComando("git", ["--version"], { cwd: workspace, timeoutMs: 5000 })
      .catch((errore) => ({ codice: -1, uscita: String(errore?.message || errore) }));
    if (versione.codice !== 0) {
      return { disponibile: false, motivo: "L'eseguibile git non risponde su questo computer." };
    }
    const sporco = await eseguiComando("git", ["status", "--porcelain"], { cwd: workspace, timeoutMs: 10_000 })
      .catch(() => ({ codice: -1, uscita: "" }));
    if (sporco.codice !== 0) {
      return { disponibile: false, motivo: "Non riesco a leggere lo stato del repository." };
    }
    const alberoSporco = Boolean(uscitaStandard(sporco).trim());
    const testa = () => eseguiComando("git", ["rev-parse", "HEAD"], { cwd: workspace, timeoutMs: 10_000 })
      .catch(() => null);
    let base = alberoSporco
      ? await eseguiComando("git", ["stash", "create"], { cwd: workspace, timeoutMs: 20_000 }).catch(() => null)
      : await testa();
    let sha = base?.codice === 0 ? shaDaUscita(base) : "";
    // git stash create non salva nulla quando lo sporco sono soltanto file non
    // tracciati: esce con codice 0 e non stampa niente. In quel caso i file
    // tracciati stanno tutti a HEAD, quindi la base e HEAD e la promessa di
    // ripristino resta valida invece di sparire dal testo del consenso.
    if (alberoSporco && base?.codice === 0 && !sha) {
      base = await testa();
      sha = base?.codice === 0 ? shaDaUscita(base) : "";
    }
    if (base?.codice !== 0 || !sha) {
      return { disponibile: false, motivo: "Non riesco a registrare uno stato di partenza con git." };
    }
    return { disponibile: true, motivo: null, gitBase: sha, alberoSporco };
  }

  async function ripristinaFile(lavoro, dichiarati) {
    if (!lavoro.git?.disponibile || !lavoro.gitBase) {
      return { possibile: false, motivo: lavoro.git?.motivo || "Il ripristino con git non è possibile.", file: [] };
    }
    if (!dichiarati.length) {
      return { possibile: true, file: [], motivo: "Il consiglio non ha dichiarato file modificati." };
    }
    const elenco = await eseguiComando("git", ["ls-files", "--", ...dichiarati], {
      cwd: lavoro.workspace,
      timeoutMs: 20_000,
    }).catch(() => null);
    if (elenco?.codice !== 0) {
      return { possibile: false, motivo: "Non riesco a leggere l'elenco dei file tracciati.", file: [] };
    }
    const tracciati = String(elenco.uscita || "").split(/\r?\n/u).map((riga) => riga.trim()).filter(Boolean);
    return { possibile: true, file: percorsiDaRipristinare({ dichiarati, tracciati }), motivo: null };
  }

  async function eseguiRipristino(lavoro, file) {
    if (!file.length) return { eseguito: false, file: [] };
    const esito = await eseguiComando("git", ["checkout", lavoro.gitBase, "--", ...file], {
      cwd: lavoro.workspace,
      timeoutMs: 60_000,
    }).catch((errore) => ({ codice: -1, uscita: String(errore?.message || errore) }));
    if (esito.codice !== 0) {
      throw erroreConsiglio("ripristino", `Il ripristino con git non è riuscito: ${troncaLog(esito.uscita, 2000)}`, 409, true);
    }
    return { eseguito: true, file };
  }

  async function apriRuoli(lavoro, effettive) {
    const ordinati = ruoliInOrdine(effettive);
    lavoro.ruoli = ordinati.map((ruolo) => ({
      roleId: ruolo.roleId,
      tipo: ruolo.tipo,
      ordine: ruolo.ordine,
      provider: ruolo.provider,
      modello: ruolo.modello,
      nomeModello: ruolo.nomeModello,
      thinking: ruolo.thinking,
      guiSessionId: null,
      stato: "preparazione",
      tentativo: 0,
      attesaFinoA: null,
      errore: null,
      sessione: null,
    }));
    for (const ruolo of lavoro.ruoli) {
      const sessione = await apriSessioneRuolo({
        lavoroId: lavoro.lavoroId,
        roleId: ruolo.roleId,
        ruolo: ruolo.tipo,
        workspace: lavoro.workspace,
        filePiano: lavoro.piano?.filePiano || null,
        provider: ruolo.provider,
        modello: ruolo.modello,
        ragionamento: ruolo.thinking,
        nome: ruolo.tipo === "scrittore"
          ? `Scrittore, ${ruolo.nomeModello || ruolo.modello}`
          : `Consigliere ${ruolo.ordine}, ${ruolo.nomeModello || ruolo.modello}`,
      });
      ruolo.sessione = sessione;
      ruolo.guiSessionId = sessione.id;
      prenotati = Math.max(0, prenotati - 1);
      emettiRuolo(lavoro, ruolo);
    }
  }

  async function preparaRuoli(lavoro) {
    const catalogo = await catalogoModelli(lavoro.sourceSessionId).catch(() => []);
    const configurazione = await leggiConfigurazioneRuoli();
    const sorgente = descriviSessioneSorgente(lavoro.sourceSessionId);
    const risolti = risolviRuoliConsiglio({
      configurazione,
      catalogo,
      modelloSorgente: sorgente?.provider && sorgente?.modello
        ? { provider: sorgente.provider, modelId: sorgente.modello }
        : null,
    });
    if (!risolti.avvioPossibile) {
      throw erroreConsiglio(
        "ruoli-non-risolvibili",
        risolti.problemi[0]?.messaggio || "Non ci sono modelli utilizzabili per i ruoli del consiglio.",
        409,
      );
    }
    return risolti;
  }

  async function avvia(corpo) {
    if (!oggetto(corpo)) throw erroreConsiglio("schema", "La richiesta di avvio non è un oggetto.", 400);
    soloCampi(corpo, [
      "operationId", "sourceSessionId", "prompt", "allegati", "tipo", "istruzioni", "consenso", "piano",
    ], "avvio");
    const operationId = operationIdValido(corpo.operationId);
    if (!operationId) throw erroreConsiglio("schema", "L'identificativo dell'operazione non è valido.", 400);
    const prompt = typeof corpo.prompt === "string" ? corpo.prompt : "";
    if (!prompt.trim() || Buffer.byteLength(prompt, "utf8") > LIMITE_PROMPT) {
      throw erroreConsiglio("schema", "La richiesta da mandare al consiglio non è valida.", 400);
    }
    const istruzioni = corpo.istruzioni == null ? null : String(corpo.istruzioni);
    if (istruzioni !== null && Buffer.byteLength(istruzioni, "utf8") > LIMITE_ISTRUZIONI) {
      throw erroreConsiglio("schema", "Le istruzioni aggiuntive sono troppo lunghe.", 400);
    }
    const tipo = corpo.tipo === "codice" ? "codice" : corpo.tipo === "testo" ? "testo" : null;
    if (!tipo) throw erroreConsiglio("schema", "Il tipo del lavoro deve essere testo oppure codice.", 400);
    const allegati = Array.isArray(corpo.allegati) ? corpo.allegati : [];
    if (allegati.length > 50) throw erroreConsiglio("schema", "Troppi allegati per un solo consiglio.", 400);
    const sorgente = descriviSessioneSorgente(corpo.sourceSessionId);
    if (!sorgente) throw erroreConsiglio("sessione-assente", "La conversazione sorgente non è aperta.", 404);
    const workspace = sorgente.cartella || null;
    if (tipo === "codice" && !workspace) {
      throw erroreConsiglio("workspace-assente", "Un lavoro di codice richiede una conversazione con cartella di lavoro.", 409);
    }

    const piano = await rilevaPianoTest({
      workspace, tipo, execPath, esisteFile, leggiFile, improntaFile, percorsoNpmCli,
    });
    const git = tipo === "codice" ? await statoGit(workspace) : { disponibile: false, motivo: "Lavoro di solo testo." };
    if (tipo === "codice" && corpo.consenso !== true) {
      throw Object.assign(
        erroreConsiglio("consenso-mancante", "Serve il consenso prima di avviare un consiglio che modifica i file.", 409, true),
        { consenso: testoConsenso({ piano, workspace, cartellaConsigli, ripristino: git }) },
      );
    }

    const impronta = improntaOperazione({
      kind: "consiglio-avvia",
      sourceSessionId: sorgente.id,
      prompt,
      istruzioni,
      tipo,
      allegati: allegati.map((allegato) => String(allegato?.percorso || "")),
    });
    const libera = await acquisisciMutazione();
    let record = null;
    try {
      const esistente = trovaOperazioneRegistrata({
        sessionId: sorgente.id,
        operationId,
        fingerprint: impronta,
      });
      if (esistente) {
        return {
          stato: esistente.status === "pending" ? 202 : (esistente.httpStatus || 200),
          corpo: esistente.ackBody || { ok: true, replay: true },
        };
      }
      const risolti = await preparaRuoli({ sourceSessionId: sorgente.id, workspace });
      const posti = risolti.effettive.consiglieri.length + 1;
      if (postiLiberi() < posti) {
        throw erroreConsiglio(
          "posti-insufficienti",
          `Il consiglio ha bisogno di ${posti} conversazioni libere: chiudine qualcuna e riprova.`,
          409,
          true,
        );
      }
      const claim = reclamaOperazione({
        sessionId: sorgente.id,
        operationId,
        fingerprint: impronta,
        kind: "consiglio-avvia",
      });
      record = claim.record;
      if (!claim.nuovo) {
        return {
          stato: record.status === "pending" ? 202 : (record.httpStatus || 200),
          corpo: record.ackBody || { ok: true, replay: true },
        };
      }
      prenotati += posti;
      const lavoroId = nuovoId();
      const revisione = {
        numero: 1,
        prompt,
        istruzioni,
        allegati,
        ruoli: ruoliInOrdine(risolti.effettive).map((ruolo) => ({
          roleId: ruolo.roleId, tipo: ruolo.tipo, provider: ruolo.provider, modello: ruolo.modello,
        })),
      };
      const lavoro = {
        lavoroId,
        sourceSessionId: sorgente.id,
        workspace,
        tipo,
        stato: "preparazione",
        revisione: 1,
        // Segna il ciclo di revisione in corso: Annulla e Rifai la alzano, e il
        // ciclo vecchio se ne accorge prima di scrivere qualunque cosa.
        generazione: 1,
        seq: 0,
        consenso: tipo === "codice"
          ? { accettato: true, at: ora(), testo: testoConsenso({ piano, workspace, cartellaConsigli, ripristino: git }) }
          : null,
        piano,
        git: { disponibile: git.disponibile, motivo: git.motivo },
        gitBase: git.gitBase || null,
        creatoIl: ora(),
        aggiornatoIl: ora(),
        revisioni: [revisione],
        revisioneCorrente: revisione,
        ruoli: [],
        contributi: [],
        attese: [],
        risultato: null,
        controllo: null,
        approvazione: null,
        problemi: risolti.problemi,
        motivo: null,
      };
      if (tipo === "codice" && piano.origine === "npm") {
        const guardia = await guardStrumenti("write", { path: piano.filePiano }, {
          ruolo: "scrittore", workspace, filePiano: piano.filePiano,
        });
        if (guardia?.consentito !== false) {
          lavoro.problemi = [...lavoro.problemi, {
            roleId: null,
            codice: "piano-non-protetto",
            messaggio: "La guardia degli strumenti non protegge il file che definisce il piano dei test.",
          }];
        }
      }
      lavori.set(lavoroId, lavoro);
      await conserva(lavoro);
      try {
        await apriRuoli(lavoro, risolti.effettive);
      } catch (errore) {
        prenotati = Math.max(0, prenotati - posti);
        await chiudiRuoli(lavoro);
        lavoro.stato = "bozza_bloccata";
        lavoro.motivo = `Non sono riuscito ad aprire le sessioni del consiglio: ${String(errore?.message || errore)}`;
        await conserva(lavoro);
        completaOperazione(record, { success: false, error: lavoro.motivo }, {
          ackBody: { codice: "apertura", messaggio: lavoro.motivo, recuperabile: true },
          httpStatus: 409,
        });
        throw erroreConsiglio("apertura", lavoro.motivo, 409, true);
      }
      const esito = {
        lavoroId,
        revisione: lavoro.revisione,
        stato: lavoro.stato,
        piano: pianoPubblico(lavoro.piano),
        ruoli: lavoro.ruoli.map(ruoloPubblico),
        problemi: lavoro.problemi,
      };
      completaOperazione(record, { success: true, data: esito }, { ackBody: esito, httpStatus: 202 });
      emettiStato(lavoro);
      void eseguiRevisione(lavoro);
      return { stato: 202, corpo: esito };
    } finally {
      libera();
    }
  }

  function pianoPubblico(piano) {
    if (!piano) return null;
    return piano.origine === "npm"
      ? {
        origine: piano.origine,
        comando: piano.comando,
        script: piano.script,
        filePiano: piano.filePiano,
        pianoHash: piano.pianoHash,
      }
      : { origine: "assente", motivo: piano.motivo };
  }

  function ruoloPubblico(ruolo) {
    return {
      roleId: ruolo.roleId,
      tipo: ruolo.tipo,
      ordine: ruolo.ordine,
      provider: ruolo.provider,
      modello: ruolo.modello,
      nomeModello: ruolo.nomeModello,
      guiSessionId: ruolo.guiSessionId,
      stato: ruolo.stato,
      tentativo: ruolo.tentativo,
      attesaFinoA: ruolo.attesaFinoA,
      errore: ruolo.errore,
    };
  }

  function statoPubblico(lavoro) {
    return {
      lavoro: {
        lavoroId: lavoro.lavoroId,
        sourceSessionId: lavoro.sourceSessionId,
        workspace: lavoro.workspace,
        tipo: lavoro.tipo,
        stato: lavoro.stato,
        revisione: lavoro.revisione,
        motivo: lavoro.motivo,
        piano: pianoPubblico(lavoro.piano),
        git: lavoro.git,
        consenso: lavoro.consenso ? { accettato: true, at: lavoro.consenso.at, testo: lavoro.consenso.testo } : null,
        creatoIl: lavoro.creatoIl,
        aggiornatoIl: lavoro.aggiornatoIl,
        problemi: lavoro.problemi,
      },
      ruoli: lavoro.ruoli.map(ruoloPubblico),
      contributi: lavoro.contributi.map((contributo) => ({
        roleId: contributo.roleId,
        provider: contributo.provider,
        modello: contributo.modello,
        testo: contributo.testo,
        stopReason: contributo.stopReason,
        incluso: contributo.incluso,
        errore: contributo.errore,
      })),
      risultato: lavoro.risultato,
      controllo: lavoro.controllo,
      azioni: azioniPerStato(lavoro.stato),
      seq: lavoro.seq,
    };
  }

  function stato(corpo) {
    if (!oggetto(corpo)) throw erroreConsiglio("schema", "La richiesta di stato non è un oggetto.", 400);
    soloCampi(corpo, ["lavoroId"], "stato");
    return { stato: 200, corpo: statoPubblico(trovaLavoro(corpo.lavoroId)) };
  }

  async function approva(corpo) {
    if (!oggetto(corpo)) throw erroreConsiglio("schema", "La richiesta di approvazione non è un oggetto.", 400);
    soloCampi(corpo, ["operationId", "lavoroId", "revisione", "risultatoHash"], "approvazione");
    const operationId = operationIdValido(corpo.operationId);
    if (!operationId) throw erroreConsiglio("schema", "L'identificativo dell'operazione non è valido.", 400);
    const lavoro = trovaLavoro(corpo.lavoroId);
    const impronta = improntaOperazione({
      kind: "consiglio-approva",
      lavoroId: lavoro.lavoroId,
      revisione: corpo.revisione,
      risultatoHash: corpo.risultatoHash,
    });
    const libera = await acquisisciMutazione();
    try {
      const esistente = trovaOperazioneRegistrata({
        sessionId: lavoro.sourceSessionId, operationId, fingerprint: impronta,
      });
      if (esistente) {
        return {
          stato: esistente.status === "pending" ? 202 : (esistente.httpStatus || 200),
          corpo: esistente.ackBody || { ok: true, replay: true },
        };
      }
      if (lavoro.revisione !== corpo.revisione) {
        throw erroreConsiglio("revisione-superata", "La revisione indicata non è più quella corrente.", 409);
      }
      if (lavoro.stato !== "bozza_valida") {
        throw erroreConsiglio("controllo-non-valido", `Approva è bloccato: il lavoro è in stato ${lavoro.stato}.`, 409);
      }
      if (lavoro.controllo?.esito !== "pass") {
        throw erroreConsiglio("controllo-non-valido", "Approva è bloccato perché il controllo automatico non è passato.", 409);
      }
      if (lavoro.risultato?.risultatoHash !== corpo.risultatoHash) {
        throw erroreConsiglio("risultato-cambiato", "Il risultato è cambiato dopo l'ultima lettura: ricarica prima di approvare.", 409);
      }
      if (lavoro.tipo === "codice" && lavoro.piano?.origine === "npm") {
        const improntaPiano = await improntaFile(lavoro.piano.filePiano).catch(() => null);
        if (improntaPiano !== lavoro.piano.pianoHash) {
          throw erroreConsiglio("piano-cambiato", "Il piano dei test è cambiato dopo il consenso: il controllo non vale più.", 409);
        }
      }
      for (const voce of lavoro.controllo?.impronteFile || []) {
        const pieno = isAbsolute(voce.percorso) ? voce.percorso : join(lavoro.workspace || "", voce.percorso);
        const attuale = await improntaFile(pieno).catch(() => null);
        if (attuale !== voce.impronta) {
          throw erroreConsiglio("controllo-obsoleto", `Il file ${voce.percorso} è cambiato dopo il controllo: rifai la verifica.`, 409);
        }
      }
      const claim = reclamaOperazione({
        sessionId: lavoro.sourceSessionId, operationId, fingerprint: impronta, kind: "consiglio-approva",
      });
      if (!claim.nuovo) {
        return {
          stato: claim.record.status === "pending" ? 202 : (claim.record.httpStatus || 200),
          corpo: claim.record.ackBody || { ok: true, replay: true },
        };
      }
      lavoro.approvazione = {
        revisione: lavoro.revisione,
        risultatoHash: lavoro.risultato.risultatoHash,
        approvatoIl: ora(),
        operationId,
      };
      await chiudiRuoli(lavoro);
      await cambiaStato(lavoro, "approvato");
      const esito = {
        stato: "approvato",
        testo: lavoro.risultato.testo,
        approvatoIl: lavoro.approvazione.approvatoIl,
      };
      completaOperazione(claim.record, { success: true, data: esito }, { ackBody: esito, httpStatus: 200 });
      return { stato: 200, corpo: esito };
    } finally {
      libera();
    }
  }

  async function rifai(corpo) {
    if (!oggetto(corpo)) throw erroreConsiglio("schema", "La richiesta di ripetizione non è un oggetto.", 400);
    soloCampi(corpo, ["operationId", "lavoroId", "revisioneAttesa", "istruzioni", "ripristina", "confermaRipristino"], "ripetizione");
    if (corpo.operationId != null && !operationIdValido(corpo.operationId)) {
      throw erroreConsiglio("schema", "L'identificativo dell'operazione non è valido.", 400);
    }
    const lavoro = trovaLavoro(corpo.lavoroId);
    const libera = await acquisisciMutazione();
    try {
      // Revisione e stato si leggono dentro il mutex, non prima: due clic
      // ravvicinati arrivano qui insieme, e il secondo deve vedere la revisione
      // che il primo ha appena aperto. Letti fuori, aprirebbero due revisioni e
      // due gruppi di sessioni sullo stesso lavoro.
      // Prima la revisione: un client rimasto indietro deve sapere che sta
      // guardando una bozza vecchia, non che il consiglio e occupato.
      if (Object.hasOwn(corpo, "revisioneAttesa") && corpo.revisioneAttesa !== lavoro.revisione) {
        throw erroreConsiglio("revisione-superata", "La revisione indicata non è più quella corrente.", 409);
      }
      if (STATI_IN_CORSO.has(lavoro.stato)) {
        throw erroreConsiglio("lavoro-in-corso", "Il consiglio sta ancora lavorando: annulla prima di rifare.", 409);
      }
      const dichiarati = lavoro.risultato?.fileModificati || [];
      let ripristino = { possibile: false, file: [], motivo: "Ripristino non richiesto." };
      if (corpo.ripristina === true) {
        ripristino = await ripristinaFile(lavoro, dichiarati);
        if (ripristino.possibile && ripristino.file.length && corpo.confermaRipristino !== true) {
          return {
            stato: 200,
            corpo: {
              lavoroId: lavoro.lavoroId,
              revisione: lavoro.revisione,
              stato: lavoro.stato,
              ripristino: { ...ripristino, conferma: "richiesta" },
            },
          };
        }
        if (ripristino.possibile && corpo.confermaRipristino === true) {
          ripristino = { ...ripristino, ...await eseguiRipristino(lavoro, ripristino.file) };
        }
      }
      const posti = lavoro.ruoli.length || 2;
      await chiudiRuoli(lavoro);
      if (postiLiberi() < posti) {
        throw erroreConsiglio(
          "posti-insufficienti",
          `La nuova revisione ha bisogno di ${posti} conversazioni libere: chiudine qualcuna e riprova.`,
          409,
          true,
        );
      }
      const risolti = await preparaRuoli(lavoro);
      const revisione = {
        numero: lavoro.revisione + 1,
        prompt: lavoro.revisioni[0].prompt,
        istruzioni: corpo.istruzioni == null ? lavoro.revisioneCorrente.istruzioni : String(corpo.istruzioni),
        allegati: lavoro.revisioni[0].allegati,
        ruoli: ruoliInOrdine(risolti.effettive).map((ruolo) => ({
          roleId: ruolo.roleId, tipo: ruolo.tipo, provider: ruolo.provider, modello: ruolo.modello,
        })),
      };
      lavoro.revisioni.push(revisione);
      lavoro.revisioneCorrente = revisione;
      lavoro.revisione = revisione.numero;
      lavoro.generazione = (lavoro.generazione || 1) + 1;
      lavoro.contributi = [];
      lavoro.risultato = null;
      lavoro.controllo = null;
      lavoro.attese = [];
      lavoro.stato = "preparazione";
      lavoro.motivo = null;
      prenotati += posti;
      await conserva(lavoro);
      try {
        await apriRuoli(lavoro, risolti.effettive);
      } catch (errore) {
        prenotati = Math.max(0, prenotati - posti);
        await chiudiRuoli(lavoro);
        throw erroreConsiglio("apertura", `Non sono riuscito ad aprire le sessioni del consiglio: ${String(errore?.message || errore)}`, 409, true);
      }
      emettiStato(lavoro);
      void eseguiRevisione(lavoro);
      return {
        stato: 202,
        corpo: {
          lavoroId: lavoro.lavoroId,
          revisione: lavoro.revisione,
          stato: lavoro.stato,
          ripristino,
        },
      };
    } finally {
      libera();
    }
  }

  async function annulla(corpo) {
    if (!oggetto(corpo)) throw erroreConsiglio("schema", "La richiesta di annullamento non è un oggetto.", 400);
    soloCampi(corpo, ["lavoroId", "roleId"], "annullamento");
    const lavoro = trovaLavoro(corpo.lavoroId);
    if (corpo.roleId) {
      const ruolo = lavoro.ruoli.find((voce) => voce.roleId === corpo.roleId);
      if (!ruolo) throw erroreConsiglio("ruolo-assente", "Il ruolo indicato non esiste in questo lavoro.", 404);
      const sessione = ruolo.sessione;
      ruolo.sessione = null;
      ruolo.stato = "annullato";
      if (sessione) {
        attese.get(sessione.id)?.risolvi?.();
        attese.delete(sessione.id);
        await chiudiSessioneRuolo(sessione).catch(() => {});
      }
      emettiRuolo(lavoro, ruolo);
      await conserva(lavoro);
      return { stato: 200, corpo: { stato: lavoro.stato, ruoli: lavoro.ruoli.map(ruoloPubblico) } };
    }
    // Prima cosa: il ciclo in volo deve sapere subito che questa revisione non
    // vale piu, altrimenti riprende dall'attesa e riscrive lo stato.
    lavoro.generazione = (lavoro.generazione || 1) + 1;
    for (const ruolo of lavoro.ruoli) {
      if (!["completato", "errore"].includes(ruolo.stato)) ruolo.stato = "annullato";
      const sessione = ruolo.sessione;
      if (sessione) {
        attese.get(sessione.id)?.risolvi?.();
      }
    }
    await chiudiRuoli(lavoro);
    await cambiaStato(lavoro, "annullato", "Annullato dall'utente.");
    return { stato: 200, corpo: { stato: lavoro.stato, ruoli: lavoro.ruoli.map(ruoloPubblico) } };
  }

  async function ruoli(corpo = null, { sourceSessionId = null } = {}) {
    const catalogo = await catalogoModelli(sourceSessionId).catch(() => []);
    const sorgente = sourceSessionId ? descriviSessioneSorgente(sourceSessionId) : null;
    const modelloSorgente = sorgente?.provider && sorgente?.modello
      ? { provider: sorgente.provider, modelId: sorgente.modello }
      : null;
    let configurazione = await leggiConfigurazioneRuoli();
    if (corpo) {
      soloCampi(corpo, ["expectedVersion", "consiglieri", "scrittore", "sourceSessionId"], "configurazione dei ruoli");
      const attesa = corpo.expectedVersion;
      if (!Number.isInteger(attesa) || attesa !== (configurazione.version ?? 0)) {
        throw erroreConsiglio(
          "versione-superata",
          "La configurazione dei ruoli è cambiata da un'altra finestra: ricaricala prima di salvare.",
          409,
        );
      }
      const nuova = validaConfigurazioneConsiglio({
        schemaVersion: 1,
        version: attesa + 1,
        consiglieri: corpo.consiglieri,
        scrittore: corpo.scrittore,
      });
      for (const ruolo of [...nuova.consiglieri, nuova.scrittore]) {
        if (!ruolo.model) continue;
        const presente = catalogo.some(
          (voce) => voce.provider === ruolo.model.provider && (voce.id || voce.modelId) === ruolo.model.modelId,
        );
        if (!presente) {
          throw erroreConsiglio(
            "modello-non-disponibile",
            `Il modello ${ruolo.model.provider}/${ruolo.model.modelId} non è nel catalogo dei modelli collegati.`,
            409,
          );
        }
      }
      configurazione = await salvaConfigurazioneRuoli(nuova);
    }
    const risolti = risolviRuoliConsiglio({ configurazione, catalogo, modelloSorgente });
    return {
      stato: 200,
      corpo: {
        version: risolti.configurazione.version,
        configurazione: risolti.configurazione,
        effettive: risolti.effettive,
        catalogo: risolti.catalogo,
        problemi: risolti.problemi,
        avvioPossibile: risolti.avvioPossibile,
        cartellaLavori: cartellaConsigli,
      },
    };
  }

  // La scheda "Risultato" nasce qui e viaggia nello snapshot del ponte: se
  // vivesse solo nel browser sparirebbe al primo aggiornamento di pagina.
  function schede() {
    const voci = [];
    for (const lavoro of lavori.values()) {
      if (lavoro.stato === "annullato") continue;
      voci.push({
        id: PREFISSO_SCHEDA_RISULTATO + lavoro.lavoroId,
        nomeSessione: NOME_SCHEDA_RISULTATO,
        attiva: false,
        riservata: false,
        avvioCompletato: true,
        cartella: lavoro.workspace,
        nomeCartella: lavoro.workspace ? NOME_SCHEDA_RISULTATO : "Senza cartella",
        senzaCartella: !lavoro.workspace,
        provider: null,
        modello: null,
        nomeModello: null,
        ragionamento: null,
        fileSessione: null,
        inEsecuzione: false,
        creataIl: lavoro.creatoIl,
        consiglio: {
          lavoroId: lavoro.lavoroId,
          stato: lavoro.stato,
          revisione: lavoro.revisione,
          seq: lavoro.seq,
          tipo: lavoro.tipo,
          motivo: lavoro.motivo,
          controllo: lavoro.controllo
            ? { tipo: lavoro.controllo.tipo, esito: lavoro.controllo.esito, motivi: lavoro.controllo.motivi }
            : null,
          azioni: azioniPerStato(lavoro.stato),
        },
      });
    }
    return voci;
  }

  function lavoriInCorso() {
    return [...lavori.values()].filter((lavoro) => STATI_IN_CORSO.has(lavoro.stato)).map((lavoro) => lavoro.lavoroId);
  }

  function sessioneDiRuolo(guiSessionId) {
    for (const lavoro of lavori.values()) {
      const ruolo = lavoro.ruoli.find((voce) => voce.guiSessionId === guiSessionId);
      if (ruolo) return { lavoro, ruolo };
    }
    return null;
  }

  async function applicaRitenzione(opzioni) {
    return archivio.applicaRitenzione(opzioni);
  }

  return {
    lavori,
    avvia,
    stato,
    approva,
    rifai,
    annulla,
    ruoli,
    schede,
    lavoriInCorso,
    sessioneDiRuolo,
    osservaEvento,
    applicaRitenzione,
    postiPrenotati: () => prenotati,
    statoPubblico,
  };
}
