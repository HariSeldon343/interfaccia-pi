// Controlli del consiglio: valutazione delle caselle EVAL, rilevamento del piano
// dei test dal manifesto del progetto ed esecuzione del piano congelato.
//
// Il rilevamento legge soltanto il manifesto e non esegue niente. L'esecuzione
// ricalcola l'impronta del piano prima dello spawn, non passa mai da una shell,
// tronca il log e registra le impronte dei soli file dichiarati dallo scrittore.
// L'applicazione gira con i permessi dell'account e non è una sandbox: il runner
// riduce la superficie, non promette isolamento.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { CODICI_EVAL } from "./consiglio-scrittore.mjs";

export const TIMEOUT_TEST_PREDEFINITO_MS = 10 * 60 * 1000;
export const LIMITE_LOG_PREDEFINITO = 64 * 1024;

const TASKKILL_PREDEFINITO = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");

const VARIABILI_AMBIENTE_CONSENTITE = Object.freeze([
  "SystemRoot",
  "windir",
  "ComSpec",
  "SystemDrive",
  "PATH",
  "PATHEXT",
  "TEMP",
  "TMP",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "LANG",
  "LC_ALL",
  "TZ",
  "SHELL",
  "USER",
  "LOGNAME",
  "XDG_CACHE_HOME",
]);

const METACARATTERI_SHELL = /[&|;<>\n\r`]|\$\(/;

function sha256(dati) {
  return createHash("sha256").update(dati).digest("hex");
}

function senzaCodaSeparatore(percorso) {
  const testo = String(percorso ?? "");
  if (testo.length <= 3) return testo;
  return testo.replace(/[\\/]+$/, "");
}

function canonico(percorso) {
  return senzaCodaSeparatore(resolve(percorso));
}

function confrontabile(percorso) {
  const normalizzato = senzaCodaSeparatore(percorso).split("/").join(sep);
  return process.platform === "win32" ? normalizzato.toLowerCase() : normalizzato;
}

function dentro(base, candidato) {
  const radice = confrontabile(base);
  const figlio = confrontabile(candidato);
  if (!radice || !figlio) return false;
  if (radice === figlio) return true;
  return figlio.startsWith(radice.endsWith(sep) ? radice : radice + sep);
}

/**
 * Valuta le quattro caselle EVAL compilate dallo scrittore.
 * PASS soltanto con quattro caselle segnate, nell'ordine da E1 a E4, ciascuna
 * con evidenza non vuota.
 * @param {Array<{codice: string, segnata: boolean, evidenza: string}>} caselle
 * @returns {{esito: "pass"|"fail", motivi: string[]}}
 */
export function valutaEval(caselle) {
  const motivi = [];
  if (!Array.isArray(caselle)) {
    return {
      esito: "fail",
      motivi: ["La sezione EVAL non è stata analizzata: manca l'elenco delle caselle."],
    };
  }
  if (caselle.length !== CODICI_EVAL.length) {
    motivi.push(`Le caselle EVAL devono essere quattro, da E1 a E4: ne risultano ${caselle.length}.`);
  }
  CODICI_EVAL.forEach((codice, indice) => {
    const casella = caselle[indice];
    if (!casella || casella.codice !== codice) {
      motivi.push(`La casella ${codice} manca oppure è fuori ordine.`);
      return;
    }
    if (casella.segnata !== true) motivi.push(`La casella ${codice} non è segnata.`);
    if (!String(casella.evidenza ?? "").trim()) motivi.push(`La casella ${codice} non porta alcuna evidenza.`);
  });
  return { esito: motivi.length === 0 ? "pass" : "fail", motivi };
}

async function risolviNpmCliPredefinito() {
  const candidato = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  try {
    const informazioni = await stat(candidato);
    return informazioni.isFile() ? candidato : null;
  } catch {
    return null;
  }
}

/**
 * Normalizza un piano indicato a mano dall'utente.
 * Eseguibile e argomenti devono essere separati: una riga di comando da
 * interpretare con la shell viene rifiutata.
 */
export function normalizzaPianoManuale(pianoManuale, workspace) {
  const cartella = canonico(workspace);
  if (typeof pianoManuale === "string") {
    return {
      piano: null,
      motivo:
        "Il piano indicato a mano è una riga di comando da interpretare con la shell: servono eseguibile e argomenti separati.",
    };
  }
  if (!pianoManuale || typeof pianoManuale !== "object") {
    return { piano: null, motivo: "Il piano indicato a mano non è leggibile." };
  }
  if (typeof pianoManuale.comando === "string") {
    return {
      piano: null,
      motivo:
        "Il piano indicato a mano usa il campo comando come riga di shell: servono eseguibile e argomenti separati.",
    };
  }
  const eseguibile = String(pianoManuale.eseguibile ?? "").trim();
  if (!eseguibile) {
    return { piano: null, motivo: "Il piano indicato a mano non dichiara l'eseguibile." };
  }
  if (METACARATTERI_SHELL.test(eseguibile)) {
    return {
      piano: null,
      motivo: `L'eseguibile "${eseguibile}" contiene caratteri da shell: servono eseguibile e argomenti separati.`,
    };
  }
  if (/\.(cmd|bat)$/i.test(eseguibile)) {
    return {
      piano: null,
      motivo:
        "Un piano indicato a mano non può puntare a un file .cmd o .bat, perché richiederebbe il processore comandi di sistema.",
    };
  }
  const argomentiGrezzi = pianoManuale.argomenti;
  if (argomentiGrezzi !== undefined && !Array.isArray(argomentiGrezzi)) {
    return {
      piano: null,
      motivo: "Gli argomenti del piano indicato a mano devono essere una lista, non una sola stringa.",
    };
  }
  const argomenti = Array.isArray(argomentiGrezzi) ? argomentiGrezzi.map((voce) => String(voce)) : [];
  if (Array.isArray(argomentiGrezzi) && argomentiGrezzi.some((voce) => typeof voce !== "string")) {
    return { piano: null, motivo: "Gli argomenti del piano indicato a mano devono essere tutti stringhe." };
  }
  return {
    piano: {
      origine: "manuale",
      eseguibile,
      argomenti,
      cwd: cartella,
      filePiano: null,
      pianoHash: null,
    },
  };
}

/**
 * Legge il manifesto della cartella di lavoro e congela il piano dei test.
 * Non esegue niente.
 * @param {string} workspace cartella di lavoro canonica
 * @param {{pianoManuale?: object|string|null, risolviNpmCli?: () => Promise<string|null>}} [opzioni]
 * @returns {Promise<{piano: object}|{piano: null, motivo: string}>}
 */
export async function rilevaPianoTest(workspace, opzioni = {}) {
  const { pianoManuale = null, risolviNpmCli = risolviNpmCliPredefinito } = opzioni ?? {};
  const grezzo = String(workspace ?? "").trim();
  if (!grezzo || !isAbsolute(grezzo)) {
    return { piano: null, motivo: "La cartella di lavoro del consiglio non è un percorso assoluto." };
  }
  const cartella = canonico(grezzo);
  if (pianoManuale !== null && pianoManuale !== undefined) {
    return normalizzaPianoManuale(pianoManuale, cartella);
  }

  const fileManifesto = join(cartella, "package.json");
  let contenuto;
  try {
    contenuto = await readFile(fileManifesto);
  } catch {
    return {
      piano: null,
      motivo: "Nella cartella di lavoro non c'è un package.json: il piano dei test non è riconosciuto.",
    };
  }
  let manifesto;
  try {
    manifesto = JSON.parse(contenuto.toString("utf8"));
  } catch {
    return {
      piano: null,
      motivo: "Il package.json della cartella di lavoro non è leggibile come JSON: il piano dei test non è riconosciuto.",
    };
  }
  const script = manifesto?.scripts?.test;
  if (typeof script !== "string" || !script.trim()) {
    return {
      piano: null,
      motivo: "Il package.json non definisce scripts.test: il piano dei test non è riconosciuto.",
    };
  }
  const npmCli = await risolviNpmCli();
  if (typeof npmCli !== "string" || !npmCli) {
    return {
      piano: null,
      motivo: "Non trovo npm-cli.js accanto all'eseguibile di Node: il piano dei test non è riconosciuto.",
    };
  }
  return {
    piano: {
      origine: "npm",
      eseguibile: process.execPath,
      argomenti: [npmCli, "run", "test"],
      cwd: cartella,
      filePiano: fileManifesto,
      pianoHash: sha256(contenuto),
    },
  };
}

/** Ricalcola l'impronta del file che definisce il piano. */
export async function improntaPiano(piano) {
  if (!piano?.filePiano) return { hash: null, leggibile: true };
  try {
    const dati = await readFile(piano.filePiano);
    return { hash: sha256(dati), leggibile: true };
  } catch {
    return { hash: null, leggibile: false };
  }
}

// Prima si guarda che cosa è il percorso, poi lo si legge: una cartella dava un
// errore diverso da ENOENT e finiva fra gli "illeggibili", che si confrontano
// uguali fra loro e spegnevano in silenzio il controllo di freschezza.
async function improntaFile(percorso) {
  let informazioni;
  try {
    informazioni = await stat(percorso);
  } catch (errore) {
    if (errore?.code === "ENOENT") return { stato: "assente", dimensione: null, sha256: null };
    return { stato: "illeggibile", dimensione: null, sha256: null };
  }
  if (!informazioni.isFile()) return { stato: "non-file", dimensione: null, sha256: null };
  try {
    const dati = await readFile(percorso);
    return { stato: "presente", dimensione: dati.byteLength, sha256: sha256(dati) };
  } catch (errore) {
    if (errore?.code === "ENOENT") return { stato: "assente", dimensione: null, sha256: null };
    return { stato: "illeggibile", dimensione: null, sha256: null };
  }
}

function motivoImprontaInutilizzabile(nome, stato, coda) {
  if (stato === "non-file") return `Il percorso dichiarato "${nome}" non è un file: ${coda}`;
  return `Il file dichiarato "${nome}" non è leggibile: ${coda}`;
}

function elencoPercorsi(valore) {
  if (!Array.isArray(valore)) return [];
  return valore.map((voce) => String(voce ?? "").trim()).filter((voce) => voce.length > 0);
}

/**
 * Calcola le impronte dei soli file dichiarati dallo scrittore.
 * @returns {Promise<{impronte: object[], motivi: string[]}>}
 */
export async function calcolaImpronteFile(cwd, fileDichiarati = []) {
  const base = canonico(cwd);
  const impronte = [];
  const motivi = [];
  for (const dichiarato of elencoPercorsi(fileDichiarati)) {
    const assoluto = canonico(isAbsolute(dichiarato) ? dichiarato : resolve(base, dichiarato));
    if (!dentro(base, assoluto)) {
      impronte.push({
        dichiarato,
        percorso: assoluto,
        fuoriCartella: true,
        stato: "fuori",
        dimensione: null,
        sha256: null,
      });
      motivi.push(
        `Il file dichiarato "${dichiarato}" sta fuori dalla cartella di lavoro: il controllo non può garantirlo.`,
      );
      continue;
    }
    const impronta = await improntaFile(assoluto);
    impronte.push({ dichiarato, percorso: assoluto, fuoriCartella: false, ...impronta });
    if (impronta.stato === "non-file" || impronta.stato === "illeggibile") {
      motivi.push(
        motivoImprontaInutilizzabile(dichiarato, impronta.stato, "il controllo non può garantirlo."),
      );
    }
  }
  return { impronte, motivi };
}

/**
 * Verifica che il controllo registrato sia ancora attuale: piano invariato e
 * impronte dei file dichiarati invariate.
 * @returns {Promise<{valido: boolean, motivi: string[]}>}
 */
export async function controlloAncoraValido({ piano = null, impronteFile = [] } = {}) {
  const motivi = [];
  if (piano?.filePiano && piano?.pianoHash) {
    const { hash, leggibile } = await improntaPiano(piano);
    if (!leggibile) {
      motivi.push("Il file che definisce il piano dei test non è più leggibile: il controllo è obsoleto.");
    } else if (hash !== piano.pianoHash) {
      motivi.push("Il piano dei test è cambiato dopo il consenso: il controllo è obsoleto.");
    }
  }
  for (const impronta of Array.isArray(impronteFile) ? impronteFile : []) {
    if (!impronta?.percorso) continue;
    const nome = impronta.dichiarato || impronta.percorso;
    if (impronta.fuoriCartella) {
      motivi.push(`Il file dichiarato "${nome}" sta fuori dalla cartella di lavoro: il controllo non è valido.`);
      continue;
    }
    if (impronta.stato === "non-file" || impronta.stato === "illeggibile") {
      motivi.push(motivoImprontaInutilizzabile(nome, impronta.stato, "il controllo non è valido."));
      continue;
    }
    const attuale = await improntaFile(impronta.percorso);
    if (
      attuale.stato !== impronta.stato
      || attuale.dimensione !== impronta.dimensione
      || attuale.sha256 !== impronta.sha256
    ) {
      motivi.push(`Il file "${nome}" è cambiato dopo l'esecuzione dei test: il controllo è obsoleto.`);
    }
  }
  return { valido: motivi.length === 0, motivi };
}

function ambienteRidotto() {
  const ambiente = { NO_COLOR: "1", FORCE_COLOR: "0" };
  for (const nome of VARIABILI_AMBIENTE_CONSENTITE) {
    const valore = process.env[nome];
    if (typeof valore === "string" && valore.length > 0) ambiente[nome] = valore;
  }
  return ambiente;
}

function creaRaccoglitoreLog(limite) {
  const meta = Math.max(1, Math.floor((Number.isFinite(limite) && limite > 0 ? limite : LIMITE_LOG_PREDEFINITO) / 2));
  let testa = "";
  let coda = "";
  let totale = 0;
  return {
    aggiungi(pezzo) {
      const testo = String(pezzo ?? "");
      if (!testo) return;
      totale += testo.length;
      if (testa.length < meta) {
        const spazio = meta - testa.length;
        testa += testo.slice(0, spazio);
        if (testo.length > spazio) coda = (coda + testo.slice(spazio)).slice(-meta);
        return;
      }
      coda = (coda + testo).slice(-meta);
    },
    get troncato() {
      return totale > testa.length + coda.length;
    },
    testo() {
      if (totale <= testa.length + coda.length) return testa + coda;
      const omessi = totale - testa.length - coda.length;
      return `${testa}\n[... ${omessi} caratteri omessi dal ponte ...]\n${coda}`;
    },
  };
}

function convalidaPiano(piano) {
  if (!piano || typeof piano !== "object") return "Il piano dei test è assente.";
  if (typeof piano.eseguibile !== "string" || !piano.eseguibile.trim()) {
    return "Il piano dei test non dichiara l'eseguibile.";
  }
  if (METACARATTERI_SHELL.test(piano.eseguibile)) {
    return `L'eseguibile "${piano.eseguibile}" contiene caratteri da shell: il piano non viene eseguito.`;
  }
  if (!Array.isArray(piano.argomenti) || piano.argomenti.some((voce) => typeof voce !== "string")) {
    return "Gli argomenti del piano dei test devono essere una lista di stringhe.";
  }
  if (typeof piano.cwd !== "string" || !isAbsolute(piano.cwd)) {
    return "La cartella di lavoro del piano dei test non è un percorso assoluto.";
  }
  return "";
}

function esitoSenzaEsecuzione(motivi) {
  return { esito: "fail", codice: null, log: "", troncato: false, impronteFile: [], motivi };
}

/**
 * Esegue il piano dei test congelato.
 * Ricalcola l'impronta del piano prima dello spawn e si ferma se è cambiata.
 * @param {{origine: string, eseguibile: string, argomenti: string[], cwd: string, filePiano: string|null, pianoHash: string|null}} piano
 * @param {{timeoutMs?: number, fileDichiarati?: string[], elencaDiscendenti?: Function, terminaDiscendenti?: Function, taskkillWindows?: string, onProcesso?: Function, limiteLog?: number, attesaChiusuraMs?: number}} [opzioni]
 * @returns {Promise<{esito: "pass"|"fail", codice: number|null, log: string, troncato: boolean, impronteFile: object[], motivi: string[]}>}
 */
export async function eseguiPianoTest(piano, opzioni = {}) {
  const {
    timeoutMs = TIMEOUT_TEST_PREDEFINITO_MS,
    fileDichiarati = [],
    elencaDiscendenti = null,
    terminaDiscendenti = null,
    taskkillWindows = TASKKILL_PREDEFINITO,
    onProcesso = null,
    limiteLog = LIMITE_LOG_PREDEFINITO,
    attesaChiusuraMs = 5000,
  } = opzioni ?? {};

  const problema = convalidaPiano(piano);
  if (problema) return esitoSenzaEsecuzione([problema]);

  if (piano.filePiano && piano.pianoHash) {
    const { hash, leggibile } = await improntaPiano(piano);
    if (!leggibile || hash !== piano.pianoHash) {
      return esitoSenzaEsecuzione([
        "Il piano dei test è cambiato dopo il consenso: nessun comando è stato eseguito.",
      ]);
    }
  }

  const motivi = [];
  const raccoglitore = creaRaccoglitoreLog(limiteLog);
  let scaduto = false;
  let processo;
  try {
    processo = spawn(piano.eseguibile, piano.argomenti, {
      cwd: piano.cwd,
      shell: false,
      windowsHide: true,
      env: ambienteRidotto(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (errore) {
    return esitoSenzaEsecuzione([
      `Non sono riuscito ad avviare il comando dei test: ${String(errore?.message || errore)}`,
    ]);
  }

  if (typeof onProcesso === "function") {
    try {
      onProcesso(processo);
    } catch (errore) {
      motivi.push(`La registrazione del processo dei test non è riuscita: ${String(errore?.message || errore)}`);
    }
  }

  processo.stdout?.setEncoding("utf8");
  processo.stderr?.setEncoding("utf8");
  processo.stdout?.on("data", (pezzo) => raccoglitore.aggiungi(pezzo));
  processo.stderr?.on("data", (pezzo) => raccoglitore.aggiungi(pezzo));

  const conclusione = await new Promise((risolvi) => {
    let finito = false;
    let orologio = null;
    let scorta = null;
    const termina = (valore) => {
      if (finito) return;
      finito = true;
      if (orologio) clearTimeout(orologio);
      if (scorta) clearTimeout(scorta);
      risolvi(valore);
    };
    processo.on("error", (errore) => {
      motivi.push(`Il comando dei test ha segnalato un errore: ${String(errore?.message || errore)}`);
      termina({ codice: null, segnale: null });
    });
    processo.on("close", (codice, segnale) => termina({ codice, segnale }));
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      orologio = setTimeout(async () => {
        if (finito) return;
        scaduto = true;
        // L'elenco dei discendenti sta in un try suo: se fallisce, il figlio va
        // terminato lo stesso, altrimenti resta a girare codice del progetto e
        // il motivo restituito direbbe il falso.
        let discendenti = [];
        try {
          discendenti = typeof elencaDiscendenti === "function" ? await elencaDiscendenti(processo.pid) : [];
        } catch (errore) {
          motivi.push(
            `L'elenco dei processi discendenti non è riuscito: ${String(errore?.message || errore)}`,
          );
        }
        try {
          processo.kill();
        } catch {
          // Il processo potrebbe essere già uscito da solo.
        }
        if (typeof terminaDiscendenti === "function") {
          try {
            const alberoTerminato = await terminaDiscendenti(
              Array.isArray(discendenti) ? discendenti : [],
              taskkillWindows,
            );
            if (alberoTerminato === false) {
              motivi.push("Alcuni processi discendenti del comando dei test risultano ancora attivi.");
            }
          } catch (errore) {
            motivi.push(
              `La terminazione dei processi discendenti non è riuscita: ${String(errore?.message || errore)}`,
            );
          }
        }
        if (finito) return;
        scorta = setTimeout(() => {
          if (finito) return;
          motivi.push("Il comando dei test non si è chiuso dopo la richiesta di terminazione.");
          termina({ codice: null, segnale: null });
        }, attesaChiusuraMs);
        if (typeof scorta.unref === "function") scorta.unref();
      }, timeoutMs);
      if (typeof orologio.unref === "function") orologio.unref();
    }
  });

  const codice = typeof conclusione.codice === "number" ? conclusione.codice : null;
  if (scaduto) {
    motivi.push(
      `Il comando dei test ha superato il tempo massimo di ${Math.round(timeoutMs / 1000)} secondi: `
        + "il ponte ne ha chiesto la terminazione insieme ai discendenti.",
    );
  } else if (codice !== 0) {
    const segnale = conclusione.segnale ? ` (segnale ${conclusione.segnale})` : "";
    motivi.push(`Il comando dei test è uscito con codice ${codice === null ? "sconosciuto" : codice}${segnale}.`);
  }

  const { impronte, motivi: motiviFile } = await calcolaImpronteFile(piano.cwd, fileDichiarati);
  motivi.push(...motiviFile);

  return {
    esito: motivi.length === 0 && codice === 0 && !scaduto ? "pass" : "fail",
    codice,
    log: raccoglitore.testo(),
    troncato: raccoglitore.troncato,
    impronteFile: impronte,
    motivi,
  };
}
