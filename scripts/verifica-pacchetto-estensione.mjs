import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { extname, resolve } from "node:path";
import { leggiFileRegolare, verificaPacchettoEstensione } from "../app/estensioni-manifest.mjs";

// Elenco curato, indipendente dall'inventario che il pacchetto dichiara.
export const FILE_SECOND_BRAIN = Object.freeze([
  "package.json",
  "skills/raccogliere-appunti/SKILL.md",
  "skills/organizzare-note/SKILL.md",
  "skills/preparare-diario/SKILL.md",
  "skills/riesaminare-settimana/SKILL.md",
  "prompts/giornaliero.md",
  "prompts/settimanale.md",
  "LEGGIMI.md",
]);
const FORMATI = new Set([".md", ".json"]);
const PERCORSI_VIETATI = /(?:^|\/)(?:\.pi|\.obsidian|\.git|attachments?|allegati|logs?|databases?|clienti)(?:\/|$)|\.(?:jsonl|log|db|sqlite\d?|pdf|docx?|xlsx?|png|jpe?g|zip)$/iu;
const CONTAMINAZIONI = [
  ["percorso personale", /(?:[a-z]:[\\/](?:users|utenti)[\\/]|\/(?:home|Users)\/|~[\\/]|%(?:USERPROFILE|APPDATA|LOCALAPPDATA)%|\$\{?HOME\}?)/iu],
  ["indirizzo di posta", /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+\b/iu],
  ["numero di telefono", /(?:\+\d[\d ().-]{7,}\d|\b(?:tel(?:efono)?|cell(?:ulare)?|phone|mobile)\s*[:=]\s*[+()\d][\d ().-]{5,}\d|\b(?:0\d{1,3}|3\d{2})[ .-]\d{3}[ .-]\d{3,4}\b|\b(?:3\d{8,9}|0\d{8,10})\b)/iu],
  ["credenziale", /(?:-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\b(?:api[_ -]?key|access[_ -]?token|password|passwd|secret|credenzial[ei])\s*["']?\s*[:=]\s*["']?[^\s"'<>\[\]]{3,}|\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu],
  ["nome di cliente", /\b(?:cliente|client|ragione sociale)\s*[:=]\s*[\p{L}\p{N}][\p{L}\p{N} .&'-]{2,}/iu],
];

function rifiuta(motivo, percorso) {
  return Object.assign(new Error(`Pacchetto Second Brain rifiutato: ${motivo}${percorso ? ` in ${percorso}` : ""}`), { code: "PACCHETTO_CONTAMINATO" });
}

export function verificaTestoCurato(testo, { percorso = "", nomiClienti = [] } = {}) {
  for (const [motivo, espressione] of CONTAMINAZIONI) {
    if (espressione.test(testo)) throw rifiuta(motivo, percorso);
  }
  // Il rilascio può fornire l'elenco da escludere; non si pubblica quell'elenco.
  for (const nome of nomiClienti) {
    if (typeof nome !== "string" || nome.trim().length < 3) throw rifiuta("elenco di nomi da escludere non valido");
    if (testo.toLocaleLowerCase("it").includes(nome.trim().toLocaleLowerCase("it"))) throw rifiuta("nome di cliente", percorso);
  }
}

export async function verificaPacchettoSecondBrain(radice, { nomiClienti = [], ...opzioni } = {}) {
  const pacchetto = await verificaPacchettoEstensione(radice, opzioni);
  if (pacchetto.manifesto.id !== "second-brain" || pacchetto.manifesto.categoria !== "risorse") throw rifiuta("identità o categoria non consentita");
  const elenco = new Set(FILE_SECOND_BRAIN);
  for (const voce of pacchetto.files) {
    if (PERCORSI_VIETATI.test(voce.percorso) || !FORMATI.has(extname(voce.percorso).toLowerCase()) || !elenco.delete(voce.percorso)) {
      throw rifiuta("file fuori dall'elenco chiuso o formato non consentito", voce.percorso);
    }
    const buffer = await leggiFileRegolare(resolve(pacchetto.radice, voce.percorso), voce.byte);
    if (createHash("sha256").update(buffer).digest("hex") !== voce.sha256) throw rifiuta("digest divergente", voce.percorso);
    let testo;
    try { testo = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch { throw rifiuta("contenuto non testuale UTF-8", voce.percorso); }
    if (testo.includes("\u0000")) throw rifiuta("contenuto binario", voce.percorso);
    verificaTestoCurato(testo, { percorso: voce.percorso, nomiClienti });
    if (voce.percorso === "package.json") {
      let payload;
      try { payload = JSON.parse(testo); } catch { throw rifiuta("package.json non leggibile"); }
      if (!payload || Array.isArray(payload) || Object.keys(payload).some((campo) => !["name", "version", "description", "private", "pi"].includes(campo))
        || payload.name !== "second-brain" || payload.version !== pacchetto.manifesto.versione
        || !payload.pi || Array.isArray(payload.pi) || Object.keys(payload.pi).some((campo) => !["skills", "prompts", "extensions", "themes"].includes(campo))
        || ["skills", "prompts", "extensions", "themes"].some((campo) => JSON.stringify(payload.pi[campo]) !== JSON.stringify(pacchetto.manifesto.pi[campo]))) {
        throw rifiuta("package.json contiene campi o risorse non consentiti");
      }
    }
  }
  if (elenco.size) throw rifiuta("file obbligatorio mancante", [...elenco][0]);
  verificaTestoCurato(JSON.stringify(pacchetto.manifesto), { percorso: "manifesto-estensione.json", nomiClienti });
  return { ...pacchetto, revisioneUmanaRichiesta: true,
    messaggio: "Controllo meccanico superato. Prima della firma di rilascio è necessaria la lettura umana dell'intero contenuto." };
}

export const verificaPacchettoCurato = verificaPacchettoSecondBrain;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argomenti = process.argv.slice(2);
  if (argomenti.length !== 1 || argomenti[0].startsWith("-")) {
    console.error("Uso: node scripts/verifica-pacchetto-estensione.mjs <cartella firmata Second Brain>");
    process.exitCode = 1;
  } else {
    try {
      const esito = await verificaPacchettoSecondBrain(argomenti[0]);
      console.log(esito.messaggio);
    } catch (errore) {
      console.error(errore.message);
      process.exitCode = 1;
    }
  }
}
