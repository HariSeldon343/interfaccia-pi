import { createPublicKey } from "node:crypto";

// Nessuna chiave di prova entra nella distribuzione. La chiave pubblica del
// titolare si aggiunge qui dopo la verifica nella catena di rilascio.
export const PORTACHIAVI_ESTENSIONI = Object.freeze([]);

export function chiaveEstensione(chiaveId, portachiavi = PORTACHIAVI_ESTENSIONI, { ora = Date.now() } = {}) {
  const errore = (testo) => Object.assign(new Error(testo), { code: "ESTENSIONE_FIRMA" });
  if (!Array.isArray(portachiavi)) throw errore("Portachiavi delle estensioni non valido");
  const campi = new Set(["chiaveId", "pubblica", "stato", "dal", "primaParte"]);
  const visti = new Set();
  for (const voce of portachiavi) {
    if (!voce || typeof voce !== "object" || Array.isArray(voce)
      || Object.keys(voce).length !== campi.size || Object.keys(voce).some((campo) => !campi.has(campo))
      || typeof voce.chiaveId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(voce.chiaveId)
      || visti.has(voce.chiaveId) || !["attiva", "revocata"].includes(voce.stato)
      || typeof voce.primaParte !== "boolean" || typeof voce.dal !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/u.test(voce.dal)
      || !Number.isFinite(Date.parse(voce.dal))
      || new Date(voce.dal).toISOString().slice(0, 10) !== voce.dal) {
      throw errore("Portachiavi delle estensioni non valido");
    }
    visti.add(voce.chiaveId);
  }
  const voce = portachiavi.find((candidata) => candidata.chiaveId === chiaveId);
  if (!voce) throw errore(`Chiave di firma sconosciuta: ${chiaveId}`);
  if (voce.stato === "revocata") throw errore(`Chiave di firma revocata: ${chiaveId}`);
  if (Date.parse(voce.dal) > Number(ora)) throw errore(`Chiave di firma non ancora attiva: ${chiaveId}`);
  let pubblica;
  try {
    pubblica = voce.pubblica?.type === "public" ? voce.pubblica : createPublicKey(voce.pubblica);
  } catch {
    throw errore(`Chiave pubblica non leggibile: ${chiaveId}`);
  }
  if (pubblica.type !== "public" || pubblica.asymmetricKeyType !== "ed25519") {
    throw errore(`La chiave ${chiaveId} non è Ed25519`);
  }
  return Object.freeze({ ...voce, pubblica });
}
