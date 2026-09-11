// Guardia degli strumenti per le sessioni del consiglio. Stessa forma della
// guardia che esiste già per le sessioni senza cartella (app/no-workspace-guard.mjs),
// severità opposta: qui, nel dubbio, si nega.
//
// Il contesto non può arrivare per argomento, perché Pi aggancia le estensioni
// solo per percorso e il default export riceve un argomento solo: l'unico canale
// è l'ambiente del processo figlio, che il ponte valorizza allo spawn.

import { realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const NOMI_AMBIENTE_CONSIGLIO = Object.freeze({
  ruolo: "PI_GUI_CONSIGLIO_RUOLO",
  workspace: "PI_GUI_CONSIGLIO_WORKSPACE",
  filePiano: "PI_GUI_CONSIGLIO_PIANO",
});

export const RUOLI_CONSIGLIO = Object.freeze(["consigliere", "scrittore"]);

const RUOLI = new Set(RUOLI_CONSIGLIO);
const STRUMENTI_LETTURA = new Set(["read", "ls", "find", "grep"]);
const STRUMENTI_SCRITTURA = new Set(["write", "edit"]);
const STRUMENTI_SHELL = new Set(["bash", "sh", "shell", "cmd", "powershell", "pwsh", "exec", "run_command"]);
const PERCORSO_FACOLTATIVO = new Set(["ls", "find", "grep"]);
const PROFONDITA_MASSIMA_RISOLUZIONE = 64;

function nega(motivo) {
  return { consentito: false, motivo };
}

const CONSENTITO = { consentito: true };

function senzaCodaSeparatore(percorso) {
  const testo = String(percorso ?? "");
  if (testo.length <= 3) return testo;
  return testo.replace(/[\\/]+$/, "");
}

function confrontabile(percorso) {
  const normalizzato = senzaCodaSeparatore(percorso).split("/").join(sep);
  return process.platform === "win32" ? normalizzato.toLowerCase() : normalizzato;
}

function canonico(percorso) {
  return senzaCodaSeparatore(resolve(percorso));
}

// Risolve i collegamenti risalendo fino al primo antenato che esiste davvero:
// un percorso ancora da creare resta valutabile, un collegamento che punta
// fuori dalla cartella di lavoro viene smascherato.
function percorsoReale(percorso) {
  let corrente = canonico(percorso);
  const coda = [];
  for (let passo = 0; passo < PROFONDITA_MASSIMA_RISOLUZIONE; passo += 1) {
    try {
      const reale = realpathSync.native(corrente);
      return coda.length === 0 ? senzaCodaSeparatore(reale) : senzaCodaSeparatore(join(reale, ...coda.reverse()));
    } catch {
      const genitore = dirname(corrente);
      if (!genitore || genitore === corrente) return canonico(percorso);
      coda.push(basename(corrente));
      corrente = genitore;
    }
  }
  return canonico(percorso);
}

function dentro(base, candidato) {
  const radice = confrontabile(base);
  const figlio = confrontabile(candidato);
  if (!radice || !figlio) return false;
  if (radice === figlio) return true;
  return figlio.startsWith(radice.endsWith(sep) ? radice : radice + sep);
}

function stessoFile(uno, due) {
  return confrontabile(uno) === confrontabile(due);
}

function dentroGit(percorso) {
  return confrontabile(percorso)
    .split(sep)
    .some((parte) => parte === ".git");
}

// Il progetto chiede una cartella di lavoro "assoluta esistente": un percorso che
// non c'è non confina niente, e lo strumento write di Pi crea da solo le cartelle
// mancanti, quindi lo scrittore costruirebbe un albero fuori da ogni sorveglianza.
function cartellaEsistente(percorso) {
  try {
    return statSync(percorso).isDirectory();
  } catch {
    return false;
  }
}

function leggiContesto(contesto) {
  const ruoloGrezzo = String(contesto?.ruolo ?? "").trim().toLowerCase();
  const workspaceGrezzo = String(contesto?.workspace ?? "").trim();
  const pianoGrezzo = String(contesto?.filePiano ?? "").trim();
  const workspaceCandidato = workspaceGrezzo && isAbsolute(workspaceGrezzo) ? canonico(workspaceGrezzo) : "";
  // Un piano dichiarato ma non assoluto non è un'assenza: è un contesto sbagliato,
  // e scartarlo in silenzio spegnerebbe la protezione sul file del piano.
  const pianoMalformato = Boolean(pianoGrezzo) && !isAbsolute(pianoGrezzo);
  return {
    ruolo: RUOLI.has(ruoloGrezzo) ? ruoloGrezzo : "",
    workspace: workspaceCandidato && cartellaEsistente(workspaceCandidato) ? workspaceCandidato : "",
    filePiano: pianoGrezzo && !pianoMalformato ? canonico(pianoGrezzo) : "",
    pianoMalformato,
  };
}

function motivoChiusura(strumento) {
  return (
    `Il contesto del consiglio non è valido: lo strumento "${strumento}" resta negato finché il ponte non dichiara `
    + "un ruolo riconosciuto e una cartella di lavoro assoluta ed esistente."
  );
}

function motivoPianoMalformato(strumento) {
  return (
    "Il contesto del consiglio dichiara il file del piano dei test con un percorso non assoluto: lo strumento "
    + `"${strumento}" resta negato finché il ponte non passa un percorso assoluto.`
  );
}

function valutaPercorsoNelWorkspace(strumento, grezzo, workspace) {
  let richiesto = grezzo;
  if (!richiesto) {
    if (!PERCORSO_FACOLTATIVO.has(strumento)) {
      return { esito: nega(`Lo strumento "${strumento}" richiede il percorso del file su cui operare.`) };
    }
    richiesto = workspace;
  }
  const lessicale = canonico(isAbsolute(richiesto) ? richiesto : resolve(workspace, richiesto));
  const effettivo = percorsoReale(lessicale);
  // La cartella di lavoro stessa può essere raggiunta da un collegamento: il
  // confronto va fatto due volte, sul percorso scritto e su quello risolto.
  const workspaceReale = percorsoReale(workspace);
  if (!dentro(workspace, lessicale) || !dentro(workspaceReale, effettivo)) {
    return {
      esito: nega(
        `Il percorso "${richiesto}" esce dalla cartella di lavoro del consiglio: sono consentiti solo i file dentro ${workspace}.`,
      ),
    };
  }
  if (dentroGit(lessicale) || dentroGit(effettivo)) {
    return { esito: nega(`Il percorso "${richiesto}" sta dentro la cartella .git, che resta intoccabile.`) };
  }
  return { lessicale, effettivo };
}

/**
 * Decide se una chiamata a strumento è ammessa in una sessione del consiglio.
 * @param {string} nome nome dello strumento chiamato
 * @param {{path?: string}} input argomenti della chiamata
 * @param {{ruolo?: string, workspace?: string|null, filePiano?: string|null}} contesto ruolo, cartella di lavoro e file del piano dei test
 * @returns {{consentito: boolean, motivo?: string}}
 */
export function validaToolConsiglio(nome, input, contesto) {
  try {
    const strumento = String(nome ?? "").trim().toLowerCase();
    if (!strumento) return nega("La chiamata non dichiara quale strumento vuole usare.");
    if (STRUMENTI_SHELL.has(strumento)) {
      return nega(
        `Lo strumento "${strumento}" è sempre negato nelle sessioni del consiglio: i comandi li esegue il ponte, dopo il consenso dell'utente.`,
      );
    }
    const scrittura = STRUMENTI_SCRITTURA.has(strumento);
    const lettura = STRUMENTI_LETTURA.has(strumento);
    if (!scrittura && !lettura) {
      return nega(`Lo strumento "${strumento}" non è previsto per le sessioni del consiglio.`);
    }

    const { ruolo, workspace, filePiano, pianoMalformato } = leggiContesto(contesto);
    const grezzo = typeof input?.path === "string" ? input.path.trim() : "";

    // Regola di chiusura: senza un contesto valido non si scrive e non si legge.
    // Una lettura libera rimetterebbe in gioco i file di credenziali dell'utente,
    // che è proprio quello che la guardia deve impedire.
    if (!ruolo || !workspace) return nega(motivoChiusura(strumento));

    if (scrittura) {
      if (pianoMalformato) return nega(motivoPianoMalformato(strumento));
      if (ruolo !== "scrittore") {
        return nega(
          `Il consigliere ha solo strumenti di lettura: "${strumento}" è riservato allo scrittore del consiglio.`,
        );
      }
      const valutazione = valutaPercorsoNelWorkspace(strumento, grezzo, workspace);
      if (valutazione.esito) return valutazione.esito;
      if (filePiano) {
        const pianoReale = percorsoReale(filePiano);
        if (
          stessoFile(valutazione.lessicale, filePiano)
          || stessoFile(valutazione.effettivo, pianoReale)
        ) {
          return nega(
            `Il file "${filePiano}" definisce il piano dei test: è congelato dal consenso e non si può modificare.`,
          );
        }
      }
      return CONSENTITO;
    }

    const valutazione = valutaPercorsoNelWorkspace(strumento, grezzo, workspace);
    if (valutazione.esito) return valutazione.esito;
    return CONSENTITO;
  } catch (errore) {
    return nega(
      "La guardia del consiglio non ha potuto valutare la chiamata e quindi la nega: "
        + String(errore?.message || errore),
    );
  }
}

/**
 * Legge il contesto del consiglio dall'ambiente del processo figlio.
 * @param {NodeJS.ProcessEnv} ambiente
 * @returns {{ruolo: string, workspace: string, filePiano: string}}
 */
export function contestoDaAmbiente(ambiente = process.env) {
  const leggi = (chiave) => {
    const valore = ambiente?.[chiave];
    return typeof valore === "string" ? valore.trim() : "";
  };
  return {
    ruolo: leggi(NOMI_AMBIENTE_CONSIGLIO.ruolo),
    workspace: leggi(NOMI_AMBIENTE_CONSIGLIO.workspace),
    filePiano: leggi(NOMI_AMBIENTE_CONSIGLIO.filePiano),
  };
}

export default function proteggiSessioneConsiglio(pi) {
  const contesto = contestoDaAmbiente(process.env);
  pi.on("tool_call", (evento) => {
    const esito = validaToolConsiglio(evento?.toolName, evento?.input, contesto);
    if (esito.consentito) return undefined;
    return { block: true, reason: esito.motivo };
  });
}
