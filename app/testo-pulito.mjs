// Una sola regola per le righe di metodo. I marker tra parentesi valgono
// dall'inizio della riga; le attestazioni OK devono occupare la riga intera.
export const RIGA_MARKER = /^\s*(?:`|\*\*|__)?(?:\[(?:Skill stack\]|GOAL\b|GSD\b|Postura QI 190\b|Check finale\])[^\r\n]*|(?:ottimizzazione|orchestrazione)\s*:\s*ok[.!]?(?:`|\*\*|__)?\s*)$/i;

export function testoLeggibile(grezzo) {
  const testo = String(grezzo ?? "");
  // Conta anche i tag annidati omonimi. Un'apertura incompleta conserva
  // la stessa regola: da quel punto alla fine resta soltanto testo tecnico.
  const tag = /<(\/?)([a-z][\w:-]*)(?=\s|\/?>|$)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^'">])*(?:>|$)/gi;
  const aperti = [];
  const parti = [];
  let fine = 0;
  for (const voce of testo.matchAll(tag)) {
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
  return parti.join("")
    .split(/\r?\n/).filter((riga) => !RIGA_MARKER.test(riga)).join("\n")
    .replace(/\s+/g, " ").trim();
}

export function titoloBreve(grezzo, { massimo = 120 } = {}) {
  const testo = testoLeggibile(grezzo);
  if (testo.length <= massimo) return testo;
  const inizio = testo.slice(0, massimo);
  const intero = testo[massimo] === " " ? inizio : inizio.slice(0, Math.max(0, inizio.lastIndexOf(" ")));
  return intero.trimEnd() + "…";
}
