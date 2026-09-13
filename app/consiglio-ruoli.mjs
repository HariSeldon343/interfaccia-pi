// Ruoli del consiglio: regola di default sul catalogo, validazione della
// configurazione salvata e risoluzione delle coppie provider più modello.
// Nessun identificativo di modello è scritto qui: il catalogo arriva sempre
// dalla risposta di pi.

export const SCHEMA_CONSIGLIO = 1;
export const MAX_CONSIGLIERI = 4;
export const MIN_CONSIGLIERI = 1;
export const ROLE_ID_SCRITTORE = "scrittore";

const ROLE_ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,39}$/u;

function erroreConsiglio(messaggio, stato = 400) {
  const errore = new Error(messaggio);
  errore.statusHttp = stato;
  return errore;
}

function oggetto(valore) {
  return Boolean(valore) && typeof valore === "object" && !Array.isArray(valore);
}

export function chiaveModello(modello) {
  if (!modello) return null;
  const provider = String(modello.provider ?? "").trim();
  const id = String(modello.modelId ?? modello.id ?? "").trim();
  return provider && id ? provider + "/" + id : null;
}

// Il catalogo arriva da get_available_models: teniamo soltanto i campi che
// servono ai ruoli e conserviamo l'ordine di pi, che è stabile.
export function normalizzaCatalogo(modelli) {
  if (!Array.isArray(modelli)) return [];
  const visti = new Set();
  const catalogo = [];
  for (const voce of modelli) {
    if (!oggetto(voce)) continue;
    const provider = String(voce.provider ?? "").trim();
    const modelId = String(voce.id ?? voce.modelId ?? "").trim();
    if (!provider || !modelId) continue;
    const chiave = provider + "/" + modelId;
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    catalogo.push({
      provider,
      modelId,
      nome: typeof voce.name === "string" && voce.name.trim() ? voce.name.trim() : modelId,
    });
  }
  return catalogo;
}

export function configurazioneConsiglioPredefinita() {
  return {
    schemaVersion: SCHEMA_CONSIGLIO,
    version: 0,
    consiglieri: [{ roleId: "consigliere-1", model: null, thinking: null }],
    scrittore: { roleId: ROLE_ID_SCRITTORE, model: null, thinking: null },
  };
}

function validaModelloAssegnato(valore, dove) {
  if (valore === null || valore === undefined) return null;
  if (!oggetto(valore)) {
    throw erroreConsiglio(`Il modello di ${dove} deve essere nullo oppure una coppia provider e modello.`);
  }
  const chiavi = Object.keys(valore).sort();
  if (chiavi.length !== 2 || chiavi[0] !== "modelId" || chiavi[1] !== "provider") {
    throw erroreConsiglio(`Il modello di ${dove} accetta soltanto i campi provider e modelId.`);
  }
  const provider = String(valore.provider ?? "").trim();
  const modelId = String(valore.modelId ?? "").trim();
  if (!provider || provider.length > 200 || !modelId || modelId.length > 200) {
    throw erroreConsiglio(`Il modello di ${dove} non ha una coppia provider e modelId valida.`);
  }
  return { provider, modelId };
}

function validaRuolo(valore, dove, roleIdAtteso = null) {
  if (!oggetto(valore)) throw erroreConsiglio(`La configurazione di ${dove} non è un oggetto.`);
  for (const chiave of Object.keys(valore)) {
    if (!["roleId", "model", "thinking"].includes(chiave)) {
      throw erroreConsiglio(`La configurazione di ${dove} contiene il campo non previsto "${chiave}".`);
    }
  }
  const roleId = String(valore.roleId ?? "").trim();
  if (!ROLE_ID_VALIDO.test(roleId)) {
    throw erroreConsiglio(`L'identificativo del ruolo "${roleId}" non è valido: usa lettere minuscole, cifre e trattini.`);
  }
  if (roleIdAtteso && roleId !== roleIdAtteso) {
    throw erroreConsiglio(`Lo scrittore deve avere l'identificativo "${roleIdAtteso}".`);
  }
  const thinking = valore.thinking === null || valore.thinking === undefined
    ? null
    : String(valore.thinking).trim();
  if (thinking !== null && (!thinking || thinking.length > 40)) {
    throw erroreConsiglio(`Il livello di ragionamento di ${dove} non è valido.`);
  }
  return { roleId, model: validaModelloAssegnato(valore.model, dove), thinking };
}

export function validaConfigurazioneConsiglio(valore, { consentiSoloScrittore = false } = {}) {
  if (!oggetto(valore)) throw erroreConsiglio("La configurazione del consiglio non è un oggetto.");
  for (const chiave of Object.keys(valore)) {
    if (!["schemaVersion", "version", "consiglieri", "scrittore"].includes(chiave)) {
      throw erroreConsiglio(`La configurazione del consiglio contiene il campo non previsto "${chiave}".`);
    }
  }
  const schemaVersion = valore.schemaVersion ?? SCHEMA_CONSIGLIO;
  if (schemaVersion !== SCHEMA_CONSIGLIO) {
    throw erroreConsiglio(`La configurazione del consiglio usa uno schema non riconosciuto (${schemaVersion}).`);
  }
  const version = valore.version ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > 1_000_000_000) {
    throw erroreConsiglio("Il numero di versione della configurazione del consiglio non è valido.");
  }
  if (!Array.isArray(valore.consiglieri)
    || valore.consiglieri.length < (consentiSoloScrittore ? 0 : MIN_CONSIGLIERI)
    || valore.consiglieri.length > MAX_CONSIGLIERI) {
    throw erroreConsiglio(`I consiglieri devono essere da ${MIN_CONSIGLIERI} a ${MAX_CONSIGLIERI}.`);
  }
  const consiglieri = valore.consiglieri.map((voce, indice) => validaRuolo(voce, `consigliere ${indice + 1}`));
  const scrittore = validaRuolo(valore.scrittore, "scrittore", ROLE_ID_SCRITTORE);
  const identificativi = new Set();
  for (const ruolo of [...consiglieri, scrittore]) {
    if (identificativi.has(ruolo.roleId)) {
      throw erroreConsiglio(`L'identificativo di ruolo "${ruolo.roleId}" è usato più di una volta.`);
    }
    identificativi.add(ruolo.roleId);
  }
  return { schemaVersion: SCHEMA_CONSIGLIO, version, consiglieri, scrittore };
}

function nelCatalogo(catalogo, modello) {
  const chiave = chiaveModello(modello);
  if (!chiave) return null;
  return catalogo.find((voce) => voce.provider + "/" + voce.modelId === chiave) || null;
}

// Regola di default dichiarata nel progetto: nessun modello, avvio disabilitato;
// un modello, lo stesso per i due ruoli in sessioni distinte. Con una sorgente
// nel catalogo, entrambi restano sul suo provider; senza sorgente, il consigliere
// prende il primo modello diverso dallo scrittore.
export function modelliPredefinitiConsiglio({ catalogo = [], modelloSorgente = null } = {}) {
  const elenco = normalizzaCatalogo(catalogo);
  if (!elenco.length) return { scrittore: null, consigliere: null, avvioPossibile: false };
  if (elenco.length === 1) {
    return { scrittore: elenco[0], consigliere: elenco[0], avvioPossibile: true };
  }
  const sorgente = nelCatalogo(elenco, modelloSorgente);
  const scrittore = sorgente || elenco[0];
  const consigliere = elenco.find(
    (voce) => (!sorgente || voce.provider === sorgente.provider)
      && voce.provider + "/" + voce.modelId !== scrittore.provider + "/" + scrittore.modelId,
  ) || scrittore;
  return { scrittore, consigliere, avvioPossibile: true };
}

function ruoloEffettivo({ ruolo, tipo, ordine, catalogo, predefinito, problemi, sostituisciMancanti }) {
  const assegnato = ruolo.model ? nelCatalogo(catalogo, ruolo.model) : null;
  if (ruolo.model && !assegnato) {
    problemi.push({
      roleId: ruolo.roleId,
      codice: "modello-non-disponibile",
      modello: chiaveModello(ruolo.model),
      messaggio: `Il modello ${chiaveModello(ruolo.model)} assegnato a ${ruolo.roleId} non è più disponibile: `
        + (sostituisciMancanti ? "il ruolo torna al modello predefinito." : "scegli esplicitamente un modello o Automatico in Gestisci."),
    });
  }
  const scelto = assegnato || (ruolo.model && !sostituisciMancanti ? null : predefinito);
  return {
    roleId: ruolo.roleId,
    tipo,
    ordine,
    provider: scelto ? scelto.provider : null,
    modello: scelto ? scelto.modelId : null,
    nomeModello: scelto ? scelto.nome : null,
    thinking: ruolo.thinking,
    automatico: !assegnato,
    nonDisponibile: Boolean(ruolo.model && !assegnato) ? chiaveModello(ruolo.model) : null,
  };
}

export function risolviRuoliConsiglio({
  configurazione = configurazioneConsiglioPredefinita(),
  catalogo = [],
  modelloSorgente = null,
  consentiSoloScrittore = false,
  sostituisciMancanti = true,
} = {}) {
  const valida = validaConfigurazioneConsiglio(configurazione, { consentiSoloScrittore });
  const elenco = normalizzaCatalogo(catalogo);
  const predefiniti = modelliPredefinitiConsiglio({ catalogo: elenco, modelloSorgente });
  const problemi = [];
  const consiglieri = valida.consiglieri.map((ruolo, indice) => ruoloEffettivo({
    ruolo,
    tipo: "consigliere",
    ordine: indice + 1,
    catalogo: elenco,
    predefinito: predefiniti.consigliere,
    problemi,
    sostituisciMancanti,
  }));
  const scrittore = ruoloEffettivo({
    ruolo: valida.scrittore,
    tipo: "scrittore",
    ordine: consiglieri.length + 1,
    catalogo: elenco,
    predefinito: predefiniti.scrittore,
    problemi,
    sostituisciMancanti,
  });
  const senzaModello = [...consiglieri, scrittore].filter((ruolo) => !ruolo.modello);
  if (!elenco.length) {
    problemi.push({
      roleId: null,
      codice: "catalogo-vuoto",
      messaggio: "Nessun modello collegato: apri le impostazioni dei provider prima di avviare un consiglio.",
    });
  }
  return {
    configurazione: valida,
    effettive: { consiglieri, scrittore },
    catalogo: elenco,
    problemi,
    avvioPossibile: elenco.length > 0 && senzaModello.length === 0,
  };
}

export function ruoliInOrdine(effettive) {
  return [...effettive.consiglieri, effettive.scrittore];
}
