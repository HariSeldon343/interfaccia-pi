import { isAbsolute } from "node:path";

const TOOL_FILE = new Set(["read", "write", "edit", "ls", "find", "grep"]);

export function validaToolSenzaWorkspace(nome, input) {
  if (!TOOL_FILE.has(nome)) return { consentito: true };
  const percorso = typeof input?.path === "string" ? input.path.trim() : "";
  if (!percorso) {
    return {
      consentito: false,
      motivo: `Il tool ${nome} richiede un percorso assoluto esplicito perche non e selezionata alcuna cartella.`,
    };
  }
  if (!isAbsolute(percorso)) {
    return {
      consentito: false,
      motivo: `Il percorso "${percorso}" e relativo. Senza una cartella selezionata serve un percorso assoluto.`,
    };
  }
  return { consentito: true };
}

export default function proteggiSessioneSenzaWorkspace(pi) {
  pi.on("tool_call", (evento) => {
    const esito = validaToolSenzaWorkspace(evento.toolName, evento.input);
    if (esito.consentito) return undefined;
    return { block: true, reason: esito.motivo };
  });
}
