(function (radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  radice.PiGuiLibraryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LIMITE_FILE = 10 * 1024 * 1024;
  const CARTELLE_ESCLUSE = new Set([".git", "node_modules", ".pi", ".obsidian", "target", "dist", "build", "__pycache__", ".venv", "venv"]);
  const TIPI_ESCLUSI = new Set(["exe", "msi", "bat", "cmd", "ps1", "lnk", "dll", "scr", "vbs", "jar", "com"]);
  const REGOLE_CATEGORIE = [
    ["normativa", ["legge", "decreto", "d.lgs", "dlgs", "regolamento", "direttiva", "iso", "uni", "norma", "en-"]],
    ["audit", ["audit", "verbale", "rapporto", "checklist", "rve", "pdv", "pda", "ddv", "rilievo"]],
    ["client-evidence", ["contratto", "offerta", "fattura", "evidenza", "policy", "procedura", "registro", "modulo"]],
    ["linee-guida", ["linea guida", "linee guida", "guida", "articolo", "paper", "manuale"]],
  ];

  function estensioneFile(nome) {
    return /\.([a-z0-9]+)$/i.exec(nome)?.[1].toLowerCase() || "";
  }

  function categoriaFile(nome) {
    const minuscolo = String(nome).toLowerCase();
    for (const [categoria, parole] of REGOLE_CATEGORIE) if (parole.some((parola) => minuscolo.includes(parola))) return categoria;
    return /\.(html?|url|mhtml)$/i.test(minuscolo) ? "web-clip" : "documenti";
  }

  function nomeLibreria(nome, versione = 1) {
    const base = String(nome).split(/[\\/]/).pop();
    const estensione = estensioneFile(base);
    const senzaEstensione = estensione ? base.slice(0, -estensione.length - 1) : base;
    let slug = senzaEstensione.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "") || "documento";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug)) slug = "file-" + slug;
    return slug + (versione > 1 ? "-v" + versione : "") + (estensione ? "." + estensione : "");
  }

  function normalizzaPercorsoRelativo(percorso) {
    if (typeof percorso !== "string" || !percorso || percorso.length > 4096 || /[\u0000-\u001f\u007f-\u009f:]/.test(percorso)) throw new Error("Percorso relativo non valido.");
    const normalizzato = percorso.replace(/\\/g, "/");
    if (normalizzato.startsWith("/") || normalizzato.split("/").some((parte) => !parte || parte === ".." || parte === ".")) throw new Error("Percorso relativo non valido.");
    return normalizzato;
  }

  function cartellaEsclusa(nome) {
    return nome.startsWith(".") || CARTELLE_ESCLUSE.has(nome.toLowerCase());
  }

  function motivoEsclusione({nome, percorsoRelativo = nome, dimensione = 0, cartella = false}) {
    const percorso = normalizzaPercorsoRelativo(percorsoRelativo);
    const parti = percorso.split("/");
    if (parti.slice(0, cartella ? undefined : -1).some(cartellaEsclusa)) return "cartella";
    if (parti.at(-1).startsWith(".")) return "nascosto";
    if (TIPI_ESCLUSI.has(estensioneFile(nome))) return "tipo";
    if (dimensione > LIMITE_FILE) return "dimensione";
    return "";
  }

  function ripartisciIngressi(ingressi) {
    const risultato = {immagini: [], file: [], esclusi: [], daCartella: false};
    for (const ingresso of ingressi) {
      risultato.daCartella ||= ingresso.daCartella === true;
      if (!ingresso.file) continue;
      const file = ingresso.file;
      let motivo;
      try { motivo = motivoEsclusione({nome: file.name, percorsoRelativo: ingresso.percorsoRelativo || file.name, dimensione: file.size}); }
      catch { motivo = "percorso"; }
      if (motivo) risultato.esclusi.push({ingresso, motivo});
      else if (file.type.startsWith("image/")) risultato.immagini.push(ingresso);
      else risultato.file.push(ingresso);
    }
    return risultato;
  }

  function componiVociBlocco(pending, libreria, percorsoIndice) {
    const voci = [...pending, ...libreria];
    if (voci.length <= 8) return {voci, avviso: ""};
    if (typeof percorsoIndice !== "string" || !percorsoIndice) throw new Error("Manca il percorso dell'indice della libreria.");
    return {voci: [...voci.slice(0, 7), {nome: "indice della libreria", percorso: percorsoIndice, mimeType: "application/json", dimensione: 0}], avviso: "Oltre 8 file: a Pi saranno riferiti i primi 7 e l'indice della libreria."};
  }

  function riepilogoImportazione({indicizzati = 0, duplicati = 0, saltati = 0, tipo = 0, dimensione = 0, cartella = 0}) {
    return "indicizzati " + indicizzati + ", duplicati " + duplicati + ", saltati " + saltati + " (per tipo " + tipo + ", per dimensione " + dimensione + ", per cartella " + cartella + ")";
  }

  return {LIMITE_FILE, categoriaFile, estensioneFile, nomeLibreria, normalizzaPercorsoRelativo, cartellaEsclusa, motivoEsclusione, ripartisciIngressi, componiVociBlocco, riepilogoImportazione};
});
