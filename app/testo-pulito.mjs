// Una sola regola per le righe di metodo. I marker tra parentesi valgono
// dall'inizio della riga; le attestazioni OK ammettono la coda dopo un trattino,
// con la stessa forma riconosciuta da RIGA_METODO nel nucleo di vista.
export const RIGA_MARKER = /^\s*(?:`|\*\*|__)?(?:\[(?:Skill stack\]|(?:GOAL|GSD)\s+[—–-]|Postura QI 190\b|Check finale\])[^\r\n]*|(?:ottimizzazione|orchestrazione)\s*:\s*ok[.!]?(?:(?:`|\*\*|__)\s*)?(?:\s*[—–-]\s*.*?)?(?:(?:`|\*\*|__))?\s*)$/i;

export const TAG_TECNICI = Object.freeze([
  "skill", "system-reminder", "system_reminder", "antml", "function_results",
  "function_calls", "invoke", "tool_result", "tool_use", "document", "documents",
  "attachment", "attachments", "context", "instructions",
]);
const TAG_TECNICO = new RegExp(`<(\\/?)(${TAG_TECNICI.join("|")})(?=\\s|\\/?>|$)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^'">])*(?:>|$)`, "gi");

export function testoLeggibile(grezzo) {
  const testo = String(grezzo ?? "");
  // Conta anche i tag annidati omonimi. Un'apertura incompleta conserva
  // la stessa regola: da quel punto alla fine resta soltanto testo tecnico.
  const aperti = [];
  const parti = [];
  let fine = 0;
  for (const voce of testo.matchAll(TAG_TECNICO)) {
    if (/\/>$/.test(voce[0])) continue;
    const nome = voce[2].toLowerCase();
    if (!voce[1]) {
      if (!aperti.length) parti.push(testo.slice(fine, voce.index));
      aperti.push(nome);
    } else if (aperti.at(-1) === nome) {
      aperti.pop();
      if (!aperti.length) { parti.push(" "); fine = voce.index + voce[0].length; }
    }
  }
  if (!aperti.length) parti.push(testo.slice(fine));
  const leggibile = parti.join("")
    .split(/\r?\n/).filter((riga) => !RIGA_MARKER.test(riga)).join("\n").trim();
  // Nei messaggi con codice fenced gli a capo e l'indentazione sono contenuto.
  return /^[ \t]*(?:`{3,}|~{3,})/m.test(leggibile)
    ? leggibile : leggibile.replace(/\s+/g, " ");
}

export function titoloBreve(grezzo, { massimo = 120 } = {}) {
  const testo = testoLeggibile(grezzo).replace(/\s+/g, " ");
  if (testo.length <= massimo) return testo;
  const inizio = testo.slice(0, massimo);
  const ultimoSpazio = inizio.lastIndexOf(" ");
  const intero = testo[massimo] === " " || ultimoSpazio < massimo / 2
    ? inizio : inizio.slice(0, ultimoSpazio);
  return intero.trimEnd() + "…";
}
