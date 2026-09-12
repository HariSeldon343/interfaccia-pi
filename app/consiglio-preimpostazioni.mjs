import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { creaSerializzatore, scriviFileAtomico } from "./persistenza-atomica.mjs";
import { MAX_CONSIGLIERI, validaConfigurazioneConsiglio } from "./consiglio-ruoli.mjs";

export const SCHEMA_PREIMPOSTAZIONI = 1;
const LIMITE_VERSIONE = 1_000_000_000;
const ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const RUOLO_VALIDO = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const CAMPI_VOCE = ["id", "nome", "tipo", "istruzioni", "ordine", "livello", "assegnazioni", "versione"];
const CAMPI_MODIFICABILI = CAMPI_VOCE.filter((campo) => !["id", "versione"].includes(campo));
const serializzaScritture = creaSerializzatore();

function errore(messaggio, codice = "schema", statusHttp = 400) {
  return Object.assign(new Error(messaggio), { statusHttp, codiceConsiglio: codice });
}

function oggetto(valore) {
  return Boolean(valore) && typeof valore === "object" && !Array.isArray(valore);
}

function campiChiusi(valore, campi, dove) {
  if (!oggetto(valore)) throw errore(`${dove} deve essere un oggetto.`);
  for (const campo of Object.keys(valore)) {
    if (!campi.includes(campo)) throw errore(`${dove} contiene il campo non previsto "${campo}".`);
  }
}

function versioneValida(valore, dove, minimo = 0) {
  if (!Number.isSafeInteger(valore) || valore < minimo || valore > LIMITE_VERSIONE) {
    throw errore(`La versione di ${dove} non è valida.`);
  }
  return valore;
}

function conflitto() {
  return errore("Le preimpostazioni sono cambiate in un'altra finestra. Ricarica l'elenco prima di salvare o avviare.", "preimpostazione-conflitto", 409);
}

function nomeValido(valore) {
  if (typeof valore !== "string" || !valore.trim() || valore.trim().length > 100) {
    throw errore("Il nome della preimpostazione deve contenere da 1 a 100 caratteri.");
  }
  return valore.trim();
}

export function validaPreimpostazione(valore) {
  campiChiusi(valore, CAMPI_VOCE, "La preimpostazione");
  if (typeof valore.id !== "string" || !ID_VALIDO.test(valore.id)) {
    throw errore("L'identificativo della preimpostazione non è valido.");
  }
  const nome = nomeValido(valore.nome);
  if (!["testo", "codice"].includes(valore.tipo)) {
    throw errore("Il tipo della preimpostazione deve essere testo oppure codice.");
  }
  if (typeof valore.istruzioni !== "string" || Buffer.byteLength(valore.istruzioni, "utf8") > 64 * 1024) {
    throw errore("Le istruzioni della preimpostazione non sono valide o sono troppo lunghe.");
  }
  if (!Array.isArray(valore.ordine) || valore.ordine.length < 1 || valore.ordine.length > MAX_CONSIGLIERI + 1
    || valore.ordine.at(-1) !== "scrittore" || new Set(valore.ordine).size !== valore.ordine.length
    || valore.ordine.some((id) => typeof id !== "string" || !RUOLO_VALIDO.test(id))) {
    throw errore(`L'ordine deve contenere da zero a ${MAX_CONSIGLIERI} consiglieri distinti e lo scrittore come ultimo ruolo.`);
  }
  campiChiusi(valore.livello, valore.ordine, "L'elenco dei livelli");
  campiChiusi(valore.assegnazioni, valore.ordine, "L'elenco delle assegnazioni");
  const livello = {};
  const assegnazioni = {};
  for (const id of valore.ordine) {
    if (!Object.hasOwn(valore.livello, id) || !Object.hasOwn(valore.assegnazioni, id)) {
      throw errore(`Il ruolo ${id} deve dichiarare livello e assegnazione, anche se automatici.`);
    }
    const ragionamento = valore.livello[id];
    if (ragionamento !== null && (typeof ragionamento !== "string" || !ragionamento.trim() || ragionamento.trim().length > 40)) {
      throw errore(`Il livello di ragionamento del ruolo ${id} non è valido.`);
    }
    livello[id] = ragionamento === null ? null : ragionamento.trim();
    const modello = valore.assegnazioni[id];
    if (modello === null) {
      assegnazioni[id] = null;
      continue;
    }
    campiChiusi(modello, ["provider", "modelId"], `L'assegnazione del ruolo ${id}`);
    for (const campo of ["provider", "modelId"]) {
      if (typeof modello[campo] !== "string" || !modello[campo].trim() || modello[campo].trim().length > 200) {
        throw errore(`L'assegnazione del ruolo ${id} deve contenere una coppia provider e modello valida.`);
      }
    }
    assegnazioni[id] = { provider: modello.provider.trim(), modelId: modello.modelId.trim() };
  }
  return {
    id: valore.id, nome, tipo: valore.tipo, istruzioni: valore.istruzioni,
    ordine: [...valore.ordine], livello, assegnazioni,
    versione: versioneValida(valore.versione, "preimpostazione", 1),
  };
}

export function validaArchivioPreimpostazioni(valore) {
  campiChiusi(valore, ["schemaVersion", "versioneArchivio", "predefinita", "preimpostazioni"], "L'archivio delle preimpostazioni");
  if (valore.schemaVersion !== SCHEMA_PREIMPOSTAZIONI) throw errore("Lo schema dell'archivio delle preimpostazioni non è riconosciuto.");
  const versioneArchivio = versioneValida(valore.versioneArchivio, "archivio");
  if (!Array.isArray(valore.preimpostazioni) || valore.preimpostazioni.length > 100) {
    throw errore("L'archivio deve contenere un elenco di non più di 100 preimpostazioni.");
  }
  const preimpostazioni = valore.preimpostazioni.map(validaPreimpostazione);
  if (new Set(preimpostazioni.map((voce) => voce.id)).size !== preimpostazioni.length) {
    throw errore("L'archivio contiene identificativi di preimpostazione ripetuti.");
  }
  if (preimpostazioni.length ? !preimpostazioni.some((voce) => voce.id === valore.predefinita) : valore.predefinita !== null) {
    throw errore("La preimpostazione predefinita deve essere presente nell'elenco.");
  }
  return { schemaVersion: SCHEMA_PREIMPOSTAZIONI, versioneArchivio, predefinita: valore.predefinita, preimpostazioni };
}

function iniziale(id, nome, numero) {
  const ordine = [...Array.from({ length: numero }, (_, i) => `consigliere-${i + 1}`), "scrittore"];
  return { id, nome, tipo: "testo", istruzioni: "", ordine,
    livello: Object.fromEntries(ordine.map((ruolo) => [ruolo, null])),
    assegnazioni: Object.fromEntries(ordine.map((ruolo) => [ruolo, null])), versione: 1 };
}

// Soltanto l'assenza del file abilita l'inizializzazione e la migrazione.
// Un archivio già scritto, anche svuotato dall'utente, non reintroduce voci.
export function inizializzaPreimpostazioni(archivio = null, configurazioneRuoli = null) {
  if (archivio !== null) return validaArchivioPreimpostazioni(archivio);
  const preimpostazioni = [iniziale("rapido", "Rapido", 1), iniziale("tre-consiglieri", "Tre consiglieri", 3)];
  if (configurazioneRuoli !== null && configurazioneRuoli !== undefined) {
    const precedente = validaConfigurazioneConsiglio(configurazioneRuoli);
    const ruoli = [...precedente.consiglieri, precedente.scrittore];
    preimpostazioni.unshift({ id: "il-mio-consiglio", nome: "Il mio consiglio", tipo: "testo", istruzioni: "",
      ordine: ruoli.map((ruolo) => ruolo.roleId),
      livello: Object.fromEntries(ruoli.map((ruolo) => [ruolo.roleId, ruolo.thinking])),
      assegnazioni: Object.fromEntries(ruoli.map((ruolo) => [ruolo.roleId, ruolo.model])), versione: 1 });
  }
  return validaArchivioPreimpostazioni({ schemaVersion: SCHEMA_PREIMPOSTAZIONI, versioneArchivio: 1,
    predefinita: preimpostazioni[0].id, preimpostazioni });
}

export function configurazioneDaPreimpostazione(valore) {
  const voce = validaPreimpostazione(valore);
  const ruolo = (roleId) => ({ roleId, model: voce.assegnazioni[roleId], thinking: voce.livello[roleId] });
  return { schemaVersion: 1, version: voce.versione,
    consiglieri: voce.ordine.filter((id) => id !== "scrittore").map(ruolo), scrittore: ruolo("scrittore") };
}

export function validaOperazionePreimpostazioni(operazione) {
  campiChiusi(operazione, ["azione", "versioneArchivioAttesa", "id", "versioneAttesa", "preimpostazione"], "L'operazione sulle preimpostazioni");
  const { azione } = operazione;
  if (!["crea", "modifica", "duplica", "elimina", "predefinita"].includes(azione)) {
    throw errore("L'operazione richiesta sulle preimpostazioni non è riconosciuta.");
  }
  versioneValida(operazione.versioneArchivioAttesa, "archivio attesa");
  if (azione === "crea") {
    if (Object.hasOwn(operazione, "id") || Object.hasOwn(operazione, "versioneAttesa")) {
      throw errore("La creazione non accetta identificativo o versione di una voce esistente.");
    }
  } else {
    if (typeof operazione.id !== "string" || !ID_VALIDO.test(operazione.id)) throw errore("L'identificativo della preimpostazione non è valido.");
    versioneValida(operazione.versioneAttesa, "preimpostazione attesa", 1);
  }
  if (["crea", "modifica"].includes(azione)) {
    campiChiusi(operazione.preimpostazione, CAMPI_MODIFICABILI, "I dati della preimpostazione");
    // Valida subito tutto il contenuto, prima di qualunque scrittura o conflitto.
    validaPreimpostazione({ ...operazione.preimpostazione, id: "validazione", versione: 1 });
  } else if (azione === "duplica" && Object.hasOwn(operazione, "preimpostazione")) {
    campiChiusi(operazione.preimpostazione, ["nome"], "I dati della copia");
    nomeValido(operazione.preimpostazione.nome);
  } else if (Object.hasOwn(operazione, "preimpostazione")) {
    throw errore("Questa operazione non accetta dati della preimpostazione.");
  }
  return structuredClone(operazione);
}

// La funzione non modifica l'archivio ricevuto. Il ponte deve leggere, applicare
// l'operazione e pubblicare il risultato dentro un unico serializzatore.
export function applicaOperazionePreimpostazioni(archivio, richiesta, { creaId = () => `agenti-${randomUUID()}` } = {}) {
  const operazione = validaOperazionePreimpostazioni(richiesta);
  const prossimo = validaArchivioPreimpostazioni(archivio);
  if (prossimo.versioneArchivio !== operazione.versioneArchivioAttesa) throw conflitto();
  const indice = prossimo.preimpostazioni.findIndex((voce) => voce.id === operazione.id);
  const voce = prossimo.preimpostazioni[indice];
  if (operazione.azione !== "crea" && (!voce || voce.versione !== operazione.versioneAttesa)) throw conflitto();
  switch (operazione.azione) {
    case "crea": {
      const nuova = validaPreimpostazione({ ...operazione.preimpostazione, id: creaId(), versione: 1 });
      prossimo.preimpostazioni.push(nuova);
      if (prossimo.predefinita === null) prossimo.predefinita = nuova.id;
      break;
    }
    case "modifica":
      prossimo.preimpostazioni[indice] = validaPreimpostazione({ ...operazione.preimpostazione, id: voce.id, versione: voce.versione + 1 });
      break;
    case "duplica": {
      const nome = operazione.preimpostazione?.nome ?? `${voce.nome.slice(0, 92)} (copia)`;
      prossimo.preimpostazioni.push(validaPreimpostazione({ ...voce, id: creaId(), nome, versione: 1 }));
      break;
    }
    case "elimina":
      prossimo.preimpostazioni.splice(indice, 1);
      if (prossimo.predefinita === voce.id) prossimo.predefinita = prossimo.preimpostazioni[0]?.id ?? null;
      break;
    case "predefinita":
      prossimo.predefinita = voce.id;
      break;
  }
  prossimo.versioneArchivio += 1;
  return validaArchivioPreimpostazioni(prossimo);
}

export async function leggiArchivioPreimpostazioni(percorso) {
  let contenuto;
  try {
    contenuto = await readFile(percorso, "utf8");
  } catch (causa) {
    if (causa.code === "ENOENT") return null;
    throw causa;
  }
  let archivio;
  try {
    archivio = JSON.parse(contenuto);
  } catch {
    throw errore("Il file delle preimpostazioni non contiene un archivio JSON valido.");
  }
  return validaArchivioPreimpostazioni(archivio);
}

export async function scriviArchivioPreimpostazioni(percorso, archivio, {
  versioneArchivioAttesa, serializza = serializzaScritture, primaPubblicazione = null,
} = {}) {
  const valido = validaArchivioPreimpostazioni(archivio);
  if (versioneArchivioAttesa !== undefined) versioneValida(versioneArchivioAttesa, "archivio attesa");
  return serializza(percorso, async () => {
    if (versioneArchivioAttesa !== undefined) {
      const corrente = await leggiArchivioPreimpostazioni(percorso);
      if ((corrente?.versioneArchivio ?? 0) !== versioneArchivioAttesa) throw conflitto();
    }
    await mkdir(dirname(percorso), { recursive: true });
    await scriviFileAtomico(percorso, JSON.stringify(valido, null, 2) + "\n", { primaPubblicazione });
    return valido;
  });
}
