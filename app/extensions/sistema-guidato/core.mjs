import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { compilaTemplateOffice, generaDossierWord, risolviTemplateNellaRadice } from "./office-package.mjs";

export const VERSIONE_SCHEMA_PROGETTO = 1;
export const VERSIONE_QUESTIONARIO = 1;
export const CARTELLA_SISTEMI = join(".pi", "sistemi-gestione");
export const ESTENSIONI_TEMPLATE = new Set([".docx", ".dotx", ".xlsx", ".xltx", ".odt", ".ods", ".md"]);

const DOCUMENTI_BASE = Object.freeze([
  ["GOV-01", "Profilo del progetto e criteri di governo", []],
  ["CTX-01", "Contesto, parti interessate e requisiti applicabili", ["GOV-01"]],
  ["CTX-02", "Campo di applicazione del sistema integrato", ["CTX-01"]],
  ["LDR-01", "Politica integrata", ["CTX-01", "CTX-02"]],
  ["LDR-02", "Ruoli, responsabilita' e autorita'", ["CTX-02"]],
  ["PLN-01", "Rischi, opportunita' e obblighi di conformita'", ["CTX-01", "CTX-02"]],
  ["SUP-01", "Competenze, consapevolezza e comunicazione", ["LDR-02", "PLN-01"]],
  ["SUP-02", "Controllo delle informazioni documentate", ["GOV-01"]],
  ["OPS-01", "Mappa dei processi e controlli operativi", ["CTX-02", "PLN-01", "SUP-02"]],
  ["EVA-01", "Obiettivi, indicatori e piano di monitoraggio", ["LDR-01", "PLN-01", "OPS-01"]],
  ["EVA-02", "Programma e procedura di audit interno", ["OPS-01", "EVA-01"]],
  ["EVA-03", "Riesame della direzione", ["EVA-01", "EVA-02"]],
  ["MIG-01", "Non conformita' e azioni correttive", ["OPS-01", "EVA-02"]],
  ["MIG-02", "Registro delle opportunita' di miglioramento", ["EVA-03", "MIG-01"]],
]);

export const QUESTIONARIO_BASE = Object.freeze([
  ["ORG-01", "Profilo", "Denominazione legale, forma giuridica e identificativi essenziali dell'organizzazione", "CLIENTE_DENOMINAZIONE", true, ["GOV-01"]],
  ["ORG-02", "Profilo", "Sedi, unita operative e confini geografici da considerare", "CLIENTE_SEDI", true, ["CTX-02"]],
  ["ORG-03", "Profilo", "Prodotti, servizi e principali categorie di clienti", "CLIENTE_PRODOTTI_SERVIZI", true, ["CTX-01", "CTX-02", "OPS-01"]],
  ["CTX-01", "Contesto", "Fattori interni che possono influenzare il sistema di gestione", "CONTESTO_FATTORI_INTERNI", true, ["CTX-01"]],
  ["CTX-02", "Contesto", "Fattori esterni che possono influenzare il sistema di gestione", "CONTESTO_FATTORI_ESTERNI", true, ["CTX-01"]],
  ["CTX-03", "Contesto", "Parti interessate rilevanti, loro esigenze e aspettative", "PARTI_INTERESSATE", true, ["CTX-01"]],
  ["CTX-04", "Contesto", "Campo di applicazione proposto, incluse esclusioni e relative motivazioni", "CAMPO_APPLICAZIONE", true, ["CTX-02"]],
  ["LDR-01", "Leadership", "Impegni che la direzione intende assumere nella politica integrata", "POLITICA_IMPEGNI", true, ["LDR-01"]],
  ["LDR-02", "Leadership", "Ruoli, responsabilita, deleghe e autorita pertinenti", "RUOLI_RESPONSABILITA", true, ["LDR-02"]],
  ["PLN-01", "Pianificazione", "Metodo oggi usato per identificare e valutare rischi e opportunita", "METODO_RISCHI", true, ["PLN-01"]],
  ["PLN-02", "Pianificazione", "Obblighi legali, contrattuali e altri requisiti gia identificati", "OBBLIGHI_CONFORMITA", true, ["CTX-01", "PLN-01"]],
  ["PLN-03", "Pianificazione", "Obiettivi misurabili, responsabili, risorse e scadenze", "OBIETTIVI", true, ["EVA-01"]],
  ["SUP-01", "Supporto", "Competenze necessarie, competenze disponibili e fabbisogni formativi", "COMPETENZE", true, ["SUP-01"]],
  ["SUP-02", "Supporto", "Comunicazioni interne ed esterne rilevanti: cosa, quando, con chi e chi comunica", "COMUNICAZIONI", false, ["SUP-01"]],
  ["SUP-03", "Supporto", "Regole attuali per approvare, distribuire, aggiornare, conservare e ritirare i documenti", "CONTROLLO_DOCUMENTI", true, ["SUP-02"]],
  ["OPS-01", "Operativita", "Processi principali e di supporto, con input, output, responsabili e interazioni", "MAPPA_PROCESSI", true, ["OPS-01"]],
  ["OPS-02", "Operativita", "Attivita affidate all'esterno e criteri con cui sono controllati i fornitori", "PROCESSI_ESTERNI", false, ["OPS-01"]],
  ["OPS-03", "Operativita", "Controlli operativi gia applicati e registrazioni che ne dimostrano l'esecuzione", "CONTROLLI_OPERATIVI", true, ["OPS-01"]],
  ["EVA-01", "Valutazione", "Indicatori disponibili, frequenza di misura, responsabili e criteri di accettazione", "INDICATORI", true, ["EVA-01"]],
  ["EVA-02", "Valutazione", "Programma di audit interno: perimetro, frequenza, competenze e indipendenza", "AUDIT_INTERNO", true, ["EVA-02"]],
  ["EVA-03", "Valutazione", "Modalita e frequenza del riesame della direzione e decisioni attese", "RIESAME_DIREZIONE", true, ["EVA-03"]],
  ["MIG-01", "Miglioramento", "Come vengono registrate, corrette e analizzate le non conformita", "NON_CONFORMITA", true, ["MIG-01"]],
  ["MIG-02", "Miglioramento", "Come vengono selezionate, pianificate e verificate le azioni di miglioramento", "MIGLIORAMENTO", false, ["MIG-02"]],
].map(([id, sezione, domanda, chiaveTemplate, obbligatoria, documenti]) => Object.freeze({
  id,
  sezione,
  domanda,
  chiaveTemplate,
  obbligatoria,
  documenti: Object.freeze([...documenti]),
})));

function oraIso(ora = new Date()) {
  return ora instanceof Date ? ora.toISOString() : new Date(ora).toISOString();
}

function dentroRadice(percorso, radice) {
  const scarto = relative(resolve(radice), resolve(percorso));
  return scarto === "" || (scarto !== ".." && !scarto.startsWith(".." + sep) && !isAbsolute(scarto));
}

export function etichettaNaturaInformazione(natura) {
  const etichette = {
    "dichiarazione-utente": "Dichiarazione dell'utente",
    "fatto-verificato": "Fatto verificato",
    "fonte-normativa": "Fonte normativa o contrattuale",
    "evidenza-collegata": "Evidenza collegata da verificare",
  };
  const chiave = String(natura || "").trim();
  if (etichette[chiave]) return etichette[chiave];
  const leggibile = chiave.replaceAll("-", " ").replace(/\s+/g, " ").trim();
  return leggibile ? leggibile[0].toLocaleUpperCase("it-IT") + leggibile.slice(1) : "Natura non specificata";
}

export function slugSicuro(valore, fallback = "progetto") {
  const pulito = String(valore || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return pulito || fallback;
}

export function normalizzaSchemi(testo) {
  const visti = new Set();
  const risultati = [];
  for (const riga of String(testo || "").split(/[\r\n;,]+/)) {
    const titolo = riga.trim().replace(/\s+/g, " ");
    if (!titolo) continue;
    const chiave = titolo.toLocaleLowerCase("it-IT");
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    risultati.push({
      id: slugSicuro(titolo, `schema-${risultati.length + 1}`),
      titolo,
      fonte: "dichiarazione-utente",
      fileFonte: null,
      statoFonte: "da-collegare",
    });
  }
  return risultati;
}

export function pianoDocumentaleBase() {
  return DOCUMENTI_BASE.map(([id, titolo, dipendenze]) => ({
    id,
    titolo,
    dipendenze: [...dipendenze],
    stato: "da-progettare",
    templateId: null,
    fileOutput: null,
    approvazione: {
      stato: "non-richiesta",
      approvatoDa: null,
      approvatoIl: null,
    },
  }));
}

export function creaProgettoIniziale({
  id = randomUUID(),
  cliente,
  titolo,
  consulente,
  schemi,
  contesto,
  workspace,
  ora = new Date(),
} = {}) {
  const nomeCliente = String(cliente || "").trim();
  if (!nomeCliente) throw new Error("Il nome del cliente e obbligatorio");
  const riferimenti = Array.isArray(schemi) ? schemi : normalizzaSchemi(schemi);
  if (riferimenti.length === 0) throw new Error("Indica almeno uno schema o riferimento applicabile");
  const timestamp = oraIso(ora);
  return {
    schemaVersion: VERSIONE_SCHEMA_PROGETTO,
    id,
    revisione: 1,
    cliente: {
      nome: nomeCliente,
      slug: slugSicuro(nomeCliente, "cliente"),
    },
    titolo: String(titolo || `Sistema di gestione integrato - ${nomeCliente}`).trim(),
    consulente: String(consulente || "").trim() || null,
    workspace: resolve(workspace || process.cwd()),
    contesto: String(contesto || "").trim(),
    schemi: riferimenti,
    fase: "ricognizione",
    stato: "bozza",
    gateApprovazione: "richiesto-prima-esportazione",
    templateLibrary: null,
    creatoIl: timestamp,
    aggiornatoIl: timestamp,
    prossimeAzioni: [
      "Collegare le copie licenziate o pubbliche delle fonti applicabili",
      "Collegare la libreria dei template del consulente",
      "Raccogliere contesto, processi, parti interessate ed evidenze disponibili",
      "Confermare il campo di applicazione prima di generare documenti",
    ],
  };
}

export function radiceSistemi(workspace) {
  return join(resolve(workspace), CARTELLA_SISTEMI);
}

export function directoryProgetto(workspace, id) {
  const radice = join(radiceSistemi(workspace), "progetti");
  const destinazione = join(radice, slugSicuro(id, "progetto"));
  if (!dentroRadice(destinazione, radice)) throw new Error("Identificativo progetto non valido");
  return destinazione;
}

async function scriviJsonAtomico(percorso, valore) {
  const temporaneo = `${percorso}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaneo, JSON.stringify(valore, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporaneo, percorso);
  } catch (errore) {
    if (!["EEXIST", "EPERM"].includes(errore?.code)) throw errore;
    const backup = `${percorso}.${process.pid}.${randomUUID()}.bak`;
    await rename(percorso, backup);
    try {
      await rename(temporaneo, percorso);
      await rm(backup, { force: true });
    } catch (erroreSostituzione) {
      await rename(backup, percorso).catch(() => {});
      throw erroreSostituzione;
    }
  } finally {
    await rm(temporaneo, { force: true }).catch(() => {});
  }
}

async function appendiAudit(directory, evento) {
  const percorso = join(directory, "audit.jsonl");
  const record = JSON.stringify({ id: randomUUID(), timestamp: oraIso(), ...evento }) + "\n";
  await writeFile(percorso, record, { encoding: "utf8", flag: "a" });
}

export async function creaProgetto(workspace, dati) {
  const progetto = creaProgettoIniziale({ ...dati, workspace });
  const directory = directoryProgetto(workspace, progetto.id);
  await mkdir(join(directory, "output"), { recursive: true });
  await Promise.all([
    scriviJsonAtomico(join(directory, "project.json"), progetto),
    scriviJsonAtomico(join(directory, "documents.json"), {
      schemaVersion: 1,
      projectId: progetto.id,
      documenti: pianoDocumentaleBase(),
    }),
    scriviJsonAtomico(join(directory, "answers.json"), {
      schemaVersion: 1,
      questionarioVersion: VERSIONE_QUESTIONARIO,
      projectId: progetto.id,
      risposte: [],
    }),
    scriviJsonAtomico(join(directory, "templates.json"), {
      schemaVersion: 1,
      projectId: progetto.id,
      radice: null,
      file: [],
      indicizzatoIl: null,
    }),
    writeFile(join(directory, "evidence.jsonl"), "", { encoding: "utf8", flag: "wx" }),
  ]);
  await appendiAudit(directory, { azione: "progetto-creato", revisione: progetto.revisione });
  return { progetto, directory };
}

export async function caricaProgetto(workspace, id) {
  const directory = directoryProgetto(workspace, id);
  const progetto = JSON.parse(await readFile(join(directory, "project.json"), "utf8"));
  if (progetto?.schemaVersion !== VERSIONE_SCHEMA_PROGETTO || progetto?.id !== id) {
    throw new Error("Il progetto non rispetta lo schema supportato");
  }
  return { progetto, directory };
}

export async function elencaProgetti(workspace) {
  const radice = join(radiceSistemi(workspace), "progetti");
  let elementi;
  try {
    elementi = await readdir(radice, { withFileTypes: true });
  } catch (errore) {
    if (errore?.code === "ENOENT") return [];
    throw errore;
  }
  const progetti = [];
  for (const elemento of elementi) {
    if (!elemento.isDirectory()) continue;
    try {
      const progetto = JSON.parse(await readFile(join(radice, elemento.name, "project.json"), "utf8"));
      if (progetto?.schemaVersion === VERSIONE_SCHEMA_PROGETTO && progetto?.id) progetti.push(progetto);
    } catch {
      // Un progetto incompleto non rende inutilizzabili quelli validi.
    }
  }
  return progetti.sort((a, b) => String(b.aggiornatoIl).localeCompare(String(a.aggiornatoIl)));
}

async function acquisisciLock(directory, { timeoutMs = 3000, staleMs = 300_000 } = {}) {
  const lock = `${directory}.lock`;
  const scadenza = Date.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(lock);
      return async () => rm(lock, { recursive: true, force: true });
    } catch (errore) {
      if (errore?.code !== "EEXIST") throw errore;
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > staleMs) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch (erroreStat) {
        if (erroreStat?.code === "ENOENT") continue;
        throw erroreStat;
      }
      if (Date.now() >= scadenza) throw new Error("Il progetto e in aggiornamento da un'altra sessione");
      await new Promise((risolvi) => setTimeout(risolvi, 40));
    }
  }
}

export async function aggiornaProgetto(workspace, id, modifica, eventoAudit) {
  const directory = directoryProgetto(workspace, id);
  const rilascia = await acquisisciLock(directory);
  try {
    const { progetto } = await caricaProgetto(workspace, id);
    const aggiornato = await modifica(structuredClone(progetto));
    aggiornato.id = progetto.id;
    aggiornato.schemaVersion = VERSIONE_SCHEMA_PROGETTO;
    aggiornato.revisione = Number(progetto.revisione || 0) + 1;
    aggiornato.aggiornatoIl = oraIso();
    await scriviJsonAtomico(join(directory, "project.json"), aggiornato);
    await appendiAudit(directory, {
      azione: eventoAudit || "progetto-aggiornato",
      revisione: aggiornato.revisione,
    });
    return aggiornato;
  } finally {
    await rilascia();
  }
}

export async function indicizzaTemplate(radiceInput, { massimo = 2000, profonditaMassima = 12 } = {}) {
  if (!isAbsolute(String(radiceInput || ""))) throw new Error("La cartella dei template deve essere un percorso assoluto");
  const radice = await realpath(resolve(radiceInput));
  const info = await stat(radice);
  if (!info.isDirectory()) throw new Error("Il percorso dei template non e una cartella");
  const file = [];
  const visita = async (directory, profondita) => {
    if (profondita > profonditaMassima) return;
    const elementi = await readdir(directory, { withFileTypes: true });
    for (const elemento of elementi) {
      if (file.length >= massimo) throw new Error(`La libreria supera il limite di ${massimo} template`);
      if (elemento.isSymbolicLink()) continue;
      const assoluto = join(directory, elemento.name);
      if (elemento.isDirectory()) {
        if (![".git", ".pi", "node_modules"].includes(elemento.name)) await visita(assoluto, profondita + 1);
      } else if (elemento.isFile() && ESTENSIONI_TEMPLATE.has(extname(elemento.name).toLowerCase())) {
        file.push(relative(radice, assoluto).split(sep).join("/"));
      }
    }
  };
  await visita(radice, 0);
  file.sort((a, b) => a.localeCompare(b, "it"));
  return { radice, file, conteggio: file.length, indicizzatoIl: oraIso() };
}

export async function collegaLibreriaTemplate(workspace, id, radiceTemplate, opzioni = {}) {
  const indice = await indicizzaTemplate(radiceTemplate, opzioni);
  const directory = directoryProgetto(workspace, id);
  const rilascia = await acquisisciLock(directory);
  try {
    await access(join(directory, "project.json"));
    await scriviJsonAtomico(join(directory, "templates.json"), {
      schemaVersion: 1,
      projectId: id,
      ...indice,
    });
    const { progetto } = await caricaProgetto(workspace, id);
    progetto.templateLibrary = {
      radice: indice.radice,
      conteggio: indice.conteggio,
      indicizzatoIl: indice.indicizzatoIl,
    };
    progetto.revisione = Number(progetto.revisione || 0) + 1;
    progetto.aggiornatoIl = oraIso();
    await scriviJsonAtomico(join(directory, "project.json"), progetto);
    await appendiAudit(directory, {
      azione: "libreria-template-collegata",
      revisione: progetto.revisione,
      conteggio: indice.conteggio,
    });
    return { progetto, indice };
  } finally {
    await rilascia();
  }
}

async function leggiJson(percorso) {
  return JSON.parse(await readFile(percorso, "utf8"));
}

async function sha256File(percorso) {
  const hash = createHash("sha256");
  for await (const frammento of createReadStream(percorso)) hash.update(frammento);
  return hash.digest("hex");
}

export async function caricaDatiProgetto(workspace, id) {
  const { progetto, directory } = await caricaProgetto(workspace, id);
  const [documenti, risposte, template] = await Promise.all([
    leggiJson(join(directory, "documents.json")),
    leggiJson(join(directory, "answers.json")),
    leggiJson(join(directory, "templates.json")),
  ]);
  if (documenti?.projectId !== id || risposte?.projectId !== id || template?.projectId !== id) {
    throw new Error("I dati collegati al progetto non sono coerenti");
  }
  return { progetto, directory, documenti, risposte, template };
}

export function prossimeDomande(risposteInput, massimo = 4) {
  const risposte = Array.isArray(risposteInput?.risposte) ? risposteInput.risposte : [];
  const compilate = new Set(risposte.filter((voce) => String(voce?.risposta || "").trim()).map((voce) => voce.questionId));
  const limite = Math.max(1, Math.min(4, Number(massimo) || 4));
  const mancanti = QUESTIONARIO_BASE.filter((domanda) => !compilate.has(domanda.id));
  return [
    ...mancanti.filter((domanda) => domanda.obbligatoria),
    ...mancanti.filter((domanda) => !domanda.obbligatoria),
  ].slice(0, limite);
}

export async function salvaRisposte(workspace, id, nuoveRisposte) {
  if (!Array.isArray(nuoveRisposte) || nuoveRisposte.length === 0) throw new Error("Nessuna risposta da salvare");
  const catalogo = new Map(QUESTIONARIO_BASE.map((domanda) => [domanda.id, domanda]));
  const directory = directoryProgetto(workspace, id);
  const rilascia = await acquisisciLock(directory);
  try {
    const { progetto } = await caricaProgetto(workspace, id);
    const risposte = await leggiJson(join(directory, "answers.json"));
    const perId = new Map((risposte.risposte || []).map((voce) => [voce.questionId, voce]));
    const timestamp = oraIso();
    let salvate = 0;
    for (const voce of nuoveRisposte) {
      const domanda = catalogo.get(voce?.questionId);
      const risposta = String(voce?.risposta || "").trim();
      if (!domanda || !risposta) continue;
      const precedente = perId.get(domanda.id);
      perId.set(domanda.id, {
        questionId: domanda.id,
        sezione: domanda.sezione,
        domanda: domanda.domanda,
        chiaveTemplate: domanda.chiaveTemplate,
        risposta,
        natura: "dichiarazione-utente",
        statoVerifica: precedente?.statoVerifica === "verificata" ? "da-riverificare" : "da-verificare",
        evidenze: Array.isArray(precedente?.evidenze) ? precedente.evidenze : [],
        aggiornatoIl: timestamp,
      });
      salvate += 1;
    }
    if (salvate === 0) throw new Error("Le risposte ricevute sono vuote o non riconosciute");
    risposte.schemaVersion = 1;
    risposte.questionarioVersion = VERSIONE_QUESTIONARIO;
    risposte.projectId = id;
    risposte.risposte = QUESTIONARIO_BASE.map((domanda) => perId.get(domanda.id)).filter(Boolean);
    progetto.fase = "raccolta-informazioni";
    progetto.revisione = Number(progetto.revisione || 0) + 1;
    progetto.aggiornatoIl = timestamp;
    await scriviJsonAtomico(join(directory, "answers.json"), risposte);
    await scriviJsonAtomico(join(directory, "project.json"), progetto);
    await appendiAudit(directory, { azione: "risposte-salvate", revisione: progetto.revisione, conteggio: salvate });
    return { progetto, risposte, salvate, prossime: prossimeDomande(risposte) };
  } finally {
    await rilascia();
  }
}

export async function registraEvidenza(workspace, id, {
  percorso,
  descrizione,
  natura = "evidenza-collegata",
  questionId = null,
  documenti = [],
} = {}) {
  if (!isAbsolute(String(percorso || ""))) throw new Error("Il percorso dell'evidenza deve essere assoluto");
  const reale = await realpath(resolve(percorso));
  const info = await stat(reale);
  if (!info.isFile()) throw new Error("L'evidenza collegata deve essere un file");
  const natureAmmesse = new Set(["fatto-verificato", "dichiarazione-utente", "fonte-normativa", "evidenza-collegata"]);
  if (!natureAmmesse.has(natura)) throw new Error("Natura dell'evidenza non valida");
  if (questionId && !QUESTIONARIO_BASE.some((domanda) => domanda.id === questionId)) throw new Error("Domanda collegata non riconosciuta");
  const directory = directoryProgetto(workspace, id);
  const rilascia = await acquisisciLock(directory);
  try {
    const { progetto } = await caricaProgetto(workspace, id);
    const record = {
      id: randomUUID(),
      timestamp: oraIso(),
      percorso: reale,
      nome: basename(reale),
      dimensione: info.size,
      modificatoIl: info.mtime.toISOString(),
      sha256: await sha256File(reale),
      descrizione: String(descrizione || "").trim() || null,
      natura,
      questionId,
      documenti: [...new Set((documenti || []).map(String))],
      copiaNelProgetto: false,
    };
    await writeFile(join(directory, "evidence.jsonl"), JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });
    if (questionId) {
      const risposte = await leggiJson(join(directory, "answers.json"));
      const risposta = (risposte.risposte || []).find((voce) => voce.questionId === questionId);
      if (risposta) {
        risposta.evidenze = [...new Set([...(risposta.evidenze || []), record.id])];
        risposta.statoVerifica = "evidenza-collegata";
        risposta.aggiornatoIl = record.timestamp;
        await scriviJsonAtomico(join(directory, "answers.json"), risposte);
      }
    }
    progetto.revisione = Number(progetto.revisione || 0) + 1;
    progetto.aggiornatoIl = record.timestamp;
    await scriviJsonAtomico(join(directory, "project.json"), progetto);
    await appendiAudit(directory, { azione: "evidenza-collegata", revisione: progetto.revisione, evidenceId: record.id, sha256: record.sha256 });
    return { progetto, evidenza: record };
  } finally {
    await rilascia();
  }
}

export function valoriTemplateProgetto(progetto, risposteInput, ora = new Date()) {
  const valori = {
    CLIENTE_NOME: progetto.cliente?.nome || "",
    CLIENTE_DENOMINAZIONE: progetto.cliente?.nome || "",
    CLIENTE_SLUG: progetto.cliente?.slug || "",
    PROGETTO_TITOLO: progetto.titolo || "",
    CONSULENTE: progetto.consulente || "",
    SCHEMI: (progetto.schemi || []).map((voce) => voce.titolo).join(", "),
    CONTESTO_INIZIALE: progetto.contesto || "",
    DATA_COMPILAZIONE: new Intl.DateTimeFormat("it-IT", { dateStyle: "long" }).format(ora),
    REVISIONE_PROGETTO: String(progetto.revisione || 1),
  };
  for (const risposta of risposteInput?.risposte || []) {
    if (risposta?.chiaveTemplate && String(risposta.risposta || "").trim()) valori[risposta.chiaveTemplate] = risposta.risposta;
  }
  return valori;
}

export async function mappaTemplateDocumento(workspace, id, documentoId, templateId) {
  const directory = directoryProgetto(workspace, id);
  const rilascia = await acquisisciLock(directory);
  try {
    const { progetto } = await caricaProgetto(workspace, id);
    const [documenti, template] = await Promise.all([
      leggiJson(join(directory, "documents.json")),
      leggiJson(join(directory, "templates.json")),
    ]);
    const documento = (documenti.documenti || []).find((voce) => voce.id === documentoId);
    if (!documento) throw new Error("Documento del piano non riconosciuto");
    if (!template.radice || !(template.file || []).includes(templateId)) throw new Error("Template non presente nella libreria indicizzata");
    documento.templateId = templateId;
    documento.stato = documento.fileOutput ? "bozza-da-rigenerare" : "template-collegato";
    documento.approvazione = { stato: "non-richiesta", approvatoDa: null, approvatoIl: null };
    await scriviJsonAtomico(join(directory, "documents.json"), documenti);
    progetto.fase = "progettazione-documentale";
    progetto.revisione = Number(progetto.revisione || 0) + 1;
    progetto.aggiornatoIl = oraIso();
    await scriviJsonAtomico(join(directory, "project.json"), progetto);
    await appendiAudit(directory, { azione: "template-mappato", revisione: progetto.revisione, documentoId, templateId });
    return { progetto, documento };
  } finally {
    await rilascia();
  }
}

function estensioneOutputTemplate(templateId) {
  const estensione = extname(templateId).toLowerCase();
  if (estensione === ".dotx") return ".docx";
  if (estensione === ".xltx") return ".xlsx";
  return estensione;
}

async function leggiJsonl(percorso) {
  try {
    return (await readFile(percorso, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((riga) => JSON.parse(riga));
  } catch (errore) {
    if (errore?.code === "ENOENT") return [];
    throw errore;
  }
}

export async function generaBozzaDocumento(workspace, id, documentoId, { modalita = "placeholder" } = {}) {
  const directory = directoryProgetto(workspace, id);
  const rilascia = await acquisisciLock(directory, { timeoutMs: 10_000, staleMs: 600_000 });
  let output = null;
  try {
    const { progetto } = await caricaProgetto(workspace, id);
    const [documenti, risposte, template] = await Promise.all([
      leggiJson(join(directory, "documents.json")),
      leggiJson(join(directory, "answers.json")),
      leggiJson(join(directory, "templates.json")),
    ]);
    const documento = (documenti.documenti || []).find((voce) => voce.id === documentoId);
    if (!documento) throw new Error("Documento del piano non riconosciuto");
    if (!documento.templateId || !template.radice) throw new Error("Collega prima un template al documento");
    if (!(template.file || []).includes(documento.templateId)) throw new Error("Il template mappato non appartiene piu all'indice corrente");
    const radiceReale = await realpath(template.radice);
    const sorgenteAttesa = risolviTemplateNellaRadice(radiceReale, documento.templateId);
    const sorgente = await realpath(sorgenteAttesa);
    if (!dentroRadice(sorgente, radiceReale)) throw new Error("Il template risolto esce dalla libreria collegata");
    const revisioni = Array.isArray(documento.revisioni) ? documento.revisioni : [];
    const numero = revisioni.length + 1;
    const cartellaBozze = join(directory, "output", "bozze");
    await mkdir(cartellaBozze, { recursive: true });
    output = join(cartellaBozze, `${documento.id}-r${String(numero).padStart(2, "0")}${estensioneOutputTemplate(documento.templateId)}`);
    let esito;
    if (modalita === "dossier-fattuale") {
      const rispostePerId = new Map((risposte.risposte || []).map((voce) => [voce.questionId, voce]));
      const domandeDocumento = QUESTIONARIO_BASE.filter((domanda) => domanda.documenti.includes(documentoId));
      const evidenze = await leggiJsonl(join(directory, "evidence.jsonl"));
      const sezioni = domandeDocumento
        .filter((domanda) => String(rispostePerId.get(domanda.id)?.risposta || "").trim())
        .map((domanda) => {
          const risposta = rispostePerId.get(domanda.id);
          return {
            titolo: domanda.domanda,
            testo: risposta.risposta,
            natura: etichettaNaturaInformazione(risposta.natura || "dichiarazione-utente"),
            evidenze: evidenze
              .filter((voce) => voce.questionId === domanda.id)
              .map((voce) => `${voce.descrizione || voce.nome} [SHA-256 ${String(voce.sha256).slice(0, 12)}…]`),
          };
        });
      const mancanti = domandeDocumento.filter((domanda) => !String(rispostePerId.get(domanda.id)?.risposta || "").trim()).map((domanda) => `${domanda.id} — ${domanda.domanda}`);
      esito = await generaDossierWord(sorgente, output, {
        titolo: documento.titolo,
        metadati: [
          { etichetta: "Cliente", valore: progetto.cliente?.nome },
          { etichetta: "Progetto", valore: progetto.titolo },
          { etichetta: "Schemi dichiarati", valore: (progetto.schemi || []).map((voce) => voce.titolo).join(", ") },
          { etichetta: "Consulente", valore: progetto.consulente },
        ],
        sezioni,
        mancanti,
      });
    } else if (modalita === "placeholder") {
      esito = await compilaTemplateOffice(sorgente, output, valoriTemplateProgetto(progetto, risposte));
      if (esito.sostituzioni === 0) {
        throw new Error("Il template non contiene placeholder {{CHIAVE}} o [[CHIAVE]] riconosciuti; nessuna bozza ingannevole e stata conservata");
      }
    } else {
      throw new Error("Modalita di generazione non riconosciuta");
    }
    const relativoOutput = relative(directory, output).split(sep).join("/");
    const revisione = {
      numero,
      creatoIl: oraIso(),
      file: relativoOutput,
      templateId: documento.templateId,
      sha256Template: esito.sha256Sorgente,
      sha256Output: esito.sha256Output,
      modalita,
      sostituzioni: esito.sostituzioni || 0,
      perChiave: esito.perChiave || {},
      tokenResidui: esito.tokenResidui || [],
      campiMancanti: esito.campiMancanti || [],
    };
    documento.revisioni = [...revisioni, revisione];
    documento.fileOutput = relativoOutput;
    documento.stato = revisione.tokenResidui.length || revisione.campiMancanti.length ? "bozza-da-completare" : "bozza-generata";
    documento.approvazione = { stato: "da-approvare", approvatoDa: null, approvatoIl: null };
    await scriviJsonAtomico(join(directory, "documents.json"), documenti);
    progetto.fase = "verifica-documentale";
    progetto.revisione = Number(progetto.revisione || 0) + 1;
    progetto.aggiornatoIl = revisione.creatoIl;
    await scriviJsonAtomico(join(directory, "project.json"), progetto);
    await appendiAudit(directory, { azione: "bozza-generata", revisione: progetto.revisione, documentoId, numero, ...esito });
    return { progetto, documento, revisione, output };
  } catch (errore) {
    if (output) await rm(output, { force: true }).catch(() => {});
    throw errore;
  } finally {
    await rilascia();
  }
}

export async function approvaDocumento(workspace, id, documentoId, approvatoDa, nota = "") {
  const responsabile = String(approvatoDa || "").trim();
  if (!responsabile) throw new Error("Indica chi approva il documento");
  const directory = directoryProgetto(workspace, id);
  const rilascia = await acquisisciLock(directory);
  try {
    const { progetto } = await caricaProgetto(workspace, id);
    const documenti = await leggiJson(join(directory, "documents.json"));
    const documento = (documenti.documenti || []).find((voce) => voce.id === documentoId);
    const revisione = documento?.revisioni?.at(-1);
    if (!documento?.fileOutput || !revisione) throw new Error("Non esiste una bozza da approvare");
    if (documento.stato === "bozza-da-completare" || revisione.tokenResidui?.length || revisione.campiMancanti?.length) {
      throw new Error("La bozza contiene placeholder o informazioni mancanti e non puo essere approvata");
    }
    const file = resolve(directory, ...documento.fileOutput.split("/"));
    if (!dentroRadice(file, directory) || await sha256File(file) !== revisione.sha256Output) {
      throw new Error("La bozza e stata modificata dopo la generazione: rigenerala o sottoponila a una nuova revisione");
    }
    const timestamp = oraIso();
    documento.stato = "approvato";
    documento.approvazione = { stato: "approvato", approvatoDa: responsabile, approvatoIl: timestamp, nota: String(nota || "").trim() || null, sha256: revisione.sha256Output };
    await scriviJsonAtomico(join(directory, "documents.json"), documenti);
    progetto.revisione = Number(progetto.revisione || 0) + 1;
    progetto.aggiornatoIl = timestamp;
    await scriviJsonAtomico(join(directory, "project.json"), progetto);
    await appendiAudit(directory, { azione: "documento-approvato", revisione: progetto.revisione, documentoId, approvatoDa: responsabile, sha256: revisione.sha256Output });
    return { progetto, documento };
  } finally {
    await rilascia();
  }
}

export async function esportaDocumentiApprovati(workspace, id, documentiRichiesti = []) {
  const directory = directoryProgetto(workspace, id);
  const rilascia = await acquisisciLock(directory, { timeoutMs: 10_000 });
  try {
    const { progetto } = await caricaProgetto(workspace, id);
    const documenti = await leggiJson(join(directory, "documents.json"));
    const richiesti = new Set((documentiRichiesti || []).map(String));
    const candidati = (documenti.documenti || []).filter((voce) => richiesti.size === 0 ? voce.approvazione?.stato === "approvato" : richiesti.has(voce.id));
    if (candidati.length === 0) throw new Error("Nessun documento approvato da esportare");
    const nonApprovati = candidati.filter((voce) => voce.approvazione?.stato !== "approvato");
    if (nonApprovati.length) throw new Error(`Documenti senza approvazione umana: ${nonApprovati.map((voce) => voce.id).join(", ")}`);
    const progressivo = (Array.isArray(progetto.pacchetti) ? progetto.pacchetti.length : 0) + 1;
    const radiceConsegne = join(directory, "output", "consegnabili");
    const cartella = join(radiceConsegne, `pacchetto-r${String(progressivo).padStart(2, "0")}`);
    await mkdir(radiceConsegne, { recursive: true });
    await mkdir(cartella, { recursive: false });
    const fileManifesto = [];
    try {
      for (const documento of candidati) {
        const sorgente = resolve(directory, ...documento.fileOutput.split("/"));
        if (!dentroRadice(sorgente, directory)) throw new Error(`Output non confinato per ${documento.id}`);
        const revisione = documento.revisioni?.at(-1);
        const hash = await sha256File(sorgente);
        if (!revisione || hash !== revisione.sha256Output || hash !== documento.approvazione.sha256) {
          throw new Error(`Integrita della bozza approvata non valida: ${documento.id}`);
        }
        const nome = `${documento.id}-${basename(sorgente)}`;
        await copyFile(sorgente, join(cartella, nome));
        fileManifesto.push({ documentoId: documento.id, titolo: documento.titolo, file: nome, sha256: hash, approvazione: documento.approvazione, templateId: documento.templateId });
      }
      const manifesto = {
        schemaVersion: 1,
        projectId: id,
        cliente: progetto.cliente,
        titolo: progetto.titolo,
        creatoIl: oraIso(),
        revisioneProgetto: progetto.revisione,
        file: fileManifesto,
      };
      await writeFile(join(cartella, "manifest.json"), JSON.stringify(manifesto, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
      progetto.pacchetti = [...(progetto.pacchetti || []), { numero: progressivo, cartella: relative(directory, cartella).split(sep).join("/"), creatoIl: manifesto.creatoIl, documenti: fileManifesto.map((voce) => voce.documentoId) }];
      progetto.stato = "pacchetto-pronto";
      progetto.revisione = Number(progetto.revisione || 0) + 1;
      progetto.aggiornatoIl = manifesto.creatoIl;
      await scriviJsonAtomico(join(directory, "project.json"), progetto);
      await appendiAudit(directory, { azione: "pacchetto-esportato", revisione: progetto.revisione, progressivo, documenti: manifesto.file.map((voce) => voce.documentoId) });
      return { progetto, cartella, manifesto };
    } catch (errore) {
      await rm(cartella, { recursive: true, force: true }).catch(() => {});
      throw errore;
    }
  } finally {
    await rilascia();
  }
}

export function verificaCompletezza({ progetto, documenti, risposte, template }) {
  const compilate = new Set((risposte?.risposte || []).filter((voce) => String(voce?.risposta || "").trim()).map((voce) => voce.questionId));
  const obbligatorieMancanti = QUESTIONARIO_BASE.filter((domanda) => domanda.obbligatoria && !compilate.has(domanda.id));
  const elencoDocumenti = documenti?.documenti || [];
  const esito = {
    progettoValido: Boolean(progetto?.id && progetto?.cliente?.nome && progetto?.schemi?.length),
    risposte: compilate.size,
    domandeTotali: QUESTIONARIO_BASE.length,
    obbligatorieMancanti: obbligatorieMancanti.map((domanda) => domanda.id),
    templateIndicizzati: Number(template?.file?.length || 0),
    documentiTotali: elencoDocumenti.length,
    templateMappati: elencoDocumenti.filter((voce) => voce.templateId).length,
    bozzeGenerate: elencoDocumenti.filter((voce) => voce.fileOutput).length,
    documentiApprovati: elencoDocumenti.filter((voce) => voce.approvazione?.stato === "approvato").length,
    placeholderResidui: elencoDocumenti.flatMap((voce) => voce.revisioni?.at(-1)?.tokenResidui || []),
    informazioniDocumentoMancanti: elencoDocumenti.flatMap((voce) => voce.revisioni?.at(-1)?.campiMancanti || []),
  };
  esito.prontoPerEsportazione = esito.progettoValido
    && esito.obbligatorieMancanti.length === 0
    && esito.documentiApprovati > 0
    && esito.placeholderResidui.length === 0
    && esito.informazioniDocumentoMancanti.length === 0;
  return esito;
}

export function riepilogoProgetto(progetto) {
  const schemi = (progetto.schemi || []).map((voce) => voce.titolo).join(", ") || "non indicati";
  const template = progetto.templateLibrary
    ? `${progetto.templateLibrary.conteggio} file indicizzati`
    : "non collegati";
  return [
    `Cliente: ${progetto.cliente?.nome || "—"}`,
    `Progetto: ${progetto.titolo || "—"}`,
    `Schemi: ${schemi}`,
    `Fase: ${progetto.fase || "—"}`,
    `Stato: ${progetto.stato || "—"}`,
    `Template: ${template}`,
    `Revisione: ${progetto.revisione || 1}`,
  ].join("\n");
}

export function promptProssimoPasso(progetto) {
  const relativo = `${CARTELLA_SISTEMI.split(sep).join("/")}/progetti/${slugSicuro(progetto.id, "progetto")}`;
  return [
    `Prosegui il progetto guidato ${progetto.id} per ${progetto.cliente.nome}.`,
    `Leggi ${relativo}/project.json e ${relativo}/documents.json.`,
    "Non inventare requisiti normativi: chiedimi di collegare le fonti pubbliche o le copie licenziate mancanti.",
    "Distingui sempre fatti verificati, dichiarazioni dell'utente, inferenze ed evidenze mancanti.",
    "Presentami il prossimo blocco di massimo quattro domande e attendi le mie risposte prima di modificare documenti.",
  ].join(" ");
}
