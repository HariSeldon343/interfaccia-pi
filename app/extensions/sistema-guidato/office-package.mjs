import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const FIRMA_LOCALE = 0x04034b50;
const FIRMA_CENTRALE = 0x02014b50;
const FIRMA_FINE = 0x06054b50;
const MASSIMO_ARCHIVIO = 128 * 1024 * 1024;
const MASSIMO_FILE_ESPANSO = 64 * 1024 * 1024;
const MASSIMO_TOTALE_ESPANSO = 256 * 1024 * 1024;

const TABELLA_CRC = (() => {
  const tabella = new Uint32Array(256);
  for (let indice = 0; indice < 256; indice += 1) {
    let valore = indice;
    for (let bit = 0; bit < 8; bit += 1) valore = (valore >>> 1) ^ (0xedb88320 & -(valore & 1));
    tabella[indice] = valore >>> 0;
  }
  return tabella;
})();

function crc32(buffer) {
  let valore = 0xffffffff;
  for (const byte of buffer) valore = TABELLA_CRC[(valore ^ byte) & 0xff] ^ (valore >>> 8);
  return (valore ^ 0xffffffff) >>> 0;
}

function percorsoArchivioValido(nome) {
  const normalizzato = String(nome || "").replaceAll("\\", "/");
  if (!normalizzato || normalizzato.includes("\0") || normalizzato.startsWith("/") || /^[a-z]:/i.test(normalizzato)) {
    return false;
  }
  return !normalizzato.split("/").some((parte) => parte === "..");
}

function trovaFineArchivio(buffer) {
  const minimo = Math.max(0, buffer.length - 65_557);
  for (let indice = buffer.length - 22; indice >= minimo; indice -= 1) {
    if (buffer.readUInt32LE(indice) === FIRMA_FINE) return indice;
  }
  throw new Error("Il template non e un archivio Office/OpenDocument valido");
}

export function leggiArchivioZip(bufferInput) {
  const buffer = Buffer.from(bufferInput);
  if (buffer.length > MASSIMO_ARCHIVIO) throw new Error("Il template supera il limite di 128 MiB");
  const fine = trovaFineArchivio(buffer);
  const disco = buffer.readUInt16LE(fine + 4);
  const discoCentrale = buffer.readUInt16LE(fine + 6);
  const vociDisco = buffer.readUInt16LE(fine + 8);
  const vociTotali = buffer.readUInt16LE(fine + 10);
  const dimensioneCentrale = buffer.readUInt32LE(fine + 12);
  const offsetCentrale = buffer.readUInt32LE(fine + 16);
  if (disco !== 0 || discoCentrale !== 0 || vociDisco !== vociTotali) {
    throw new Error("Gli archivi ZIP multidisco non sono supportati");
  }
  if (vociTotali === 0xffff || dimensioneCentrale === 0xffffffff || offsetCentrale === 0xffffffff) {
    throw new Error("Il formato ZIP64 non e supportato per i template");
  }
  if (offsetCentrale + dimensioneCentrale > fine || vociTotali > 20_000) {
    throw new Error("La directory ZIP del template non e coerente");
  }
  const visti = new Set();
  const voci = [];
  let offset = offsetCentrale;
  let totaleEspanso = 0;
  for (let indice = 0; indice < vociTotali; indice += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== FIRMA_CENTRALE) {
      throw new Error("Directory ZIP centrale incompleta");
    }
    const flag = buffer.readUInt16LE(offset + 8);
    const metodo = buffer.readUInt16LE(offset + 10);
    const oraDos = buffer.readUInt16LE(offset + 12);
    const dataDos = buffer.readUInt16LE(offset + 14);
    const crcAtteso = buffer.readUInt32LE(offset + 16);
    const compressa = buffer.readUInt32LE(offset + 20);
    const espansa = buffer.readUInt32LE(offset + 24);
    const lunghezzaNome = buffer.readUInt16LE(offset + 28);
    const lunghezzaExtra = buffer.readUInt16LE(offset + 30);
    const lunghezzaCommento = buffer.readUInt16LE(offset + 32);
    const attributiEsterni = buffer.readUInt32LE(offset + 38);
    const offsetLocale = buffer.readUInt32LE(offset + 42);
    const fineVoce = offset + 46 + lunghezzaNome + lunghezzaExtra + lunghezzaCommento;
    if (fineVoce > buffer.length) throw new Error("Voce ZIP centrale troncata");
    const nomeBuffer = buffer.subarray(offset + 46, offset + 46 + lunghezzaNome);
    const nome = nomeBuffer.toString((flag & 0x800) !== 0 ? "utf8" : "latin1");
    if (!percorsoArchivioValido(nome) || visti.has(nome)) throw new Error(`Voce ZIP non sicura o duplicata: ${nome}`);
    visti.add(nome);
    if ((flag & 1) !== 0) throw new Error("I template ZIP cifrati non sono supportati");
    if (![0, 8].includes(metodo)) throw new Error(`Metodo di compressione ZIP non supportato: ${metodo}`);
    if (espansa > MASSIMO_FILE_ESPANSO) throw new Error(`Voce del template troppo grande: ${nome}`);
    totaleEspanso += espansa;
    if (totaleEspanso > MASSIMO_TOTALE_ESPANSO) throw new Error("Il contenuto espanso del template supera 256 MiB");
    if (offsetLocale + 30 > buffer.length || buffer.readUInt32LE(offsetLocale) !== FIRMA_LOCALE) {
      throw new Error(`Header ZIP locale non valido: ${nome}`);
    }
    const nomeLocale = buffer.readUInt16LE(offsetLocale + 26);
    const extraLocale = buffer.readUInt16LE(offsetLocale + 28);
    const inizioDati = offsetLocale + 30 + nomeLocale + extraLocale;
    if (inizioDati + compressa > buffer.length) throw new Error(`Dati ZIP troncati: ${nome}`);
    const datiCompressi = buffer.subarray(inizioDati, inizioDati + compressa);
    const dati = metodo === 0 ? Buffer.from(datiCompressi) : inflateRawSync(datiCompressi, { maxOutputLength: MASSIMO_FILE_ESPANSO });
    if (dati.length !== espansa || crc32(dati) !== crcAtteso) throw new Error(`Integrita ZIP non valida: ${nome}`);
    voci.push({ nome, dati, metodo, oraDos, dataDos, attributiEsterni });
    offset = fineVoce;
  }
  if (offset !== offsetCentrale + dimensioneCentrale) throw new Error("Dimensione della directory ZIP non coerente");
  return voci;
}

export function scriviArchivioZip(vociInput) {
  if (!Array.isArray(vociInput) || vociInput.length === 0 || vociInput.length > 65_535) {
    throw new Error("Numero di voci ZIP non supportato");
  }
  const locali = [];
  const centrali = [];
  const visti = new Set();
  let posizione = 0;
  for (const voce of vociInput) {
    const nome = String(voce?.nome || "").replaceAll("\\", "/");
    if (!percorsoArchivioValido(nome) || visti.has(nome)) throw new Error(`Voce ZIP non sicura o duplicata: ${nome}`);
    visti.add(nome);
    const nomeBuffer = Buffer.from(nome, "utf8");
    const dati = Buffer.from(voce.dati || "");
    if (dati.length > MASSIMO_FILE_ESPANSO) throw new Error(`Voce del template troppo grande: ${nome}`);
    const metodo = voce.metodo === 0 || nome.endsWith("/") ? 0 : 8;
    const compressi = metodo === 0 ? dati : deflateRawSync(dati, { level: 9 });
    if ([dati.length, compressi.length, posizione].some((numero) => numero > 0xffffffff)) {
      throw new Error("Il template richiederebbe ZIP64, non supportato");
    }
    const checksum = crc32(dati);
    const oraDos = Number(voce.oraDos || 0);
    const dataDos = Number(voce.dataDos || 0);
    const locale = Buffer.alloc(30);
    locale.writeUInt32LE(FIRMA_LOCALE, 0);
    locale.writeUInt16LE(20, 4);
    locale.writeUInt16LE(0x800, 6);
    locale.writeUInt16LE(metodo, 8);
    locale.writeUInt16LE(oraDos, 10);
    locale.writeUInt16LE(dataDos, 12);
    locale.writeUInt32LE(checksum, 14);
    locale.writeUInt32LE(compressi.length, 18);
    locale.writeUInt32LE(dati.length, 22);
    locale.writeUInt16LE(nomeBuffer.length, 26);
    locali.push(locale, nomeBuffer, compressi);

    const centrale = Buffer.alloc(46);
    centrale.writeUInt32LE(FIRMA_CENTRALE, 0);
    centrale.writeUInt16LE(20, 4);
    centrale.writeUInt16LE(20, 6);
    centrale.writeUInt16LE(0x800, 8);
    centrale.writeUInt16LE(metodo, 10);
    centrale.writeUInt16LE(oraDos, 12);
    centrale.writeUInt16LE(dataDos, 14);
    centrale.writeUInt32LE(checksum, 16);
    centrale.writeUInt32LE(compressi.length, 20);
    centrale.writeUInt32LE(dati.length, 24);
    centrale.writeUInt16LE(nomeBuffer.length, 28);
    centrale.writeUInt32LE(Number(voce.attributiEsterni || 0), 38);
    centrale.writeUInt32LE(posizione, 42);
    centrali.push(centrale, nomeBuffer);
    posizione += locale.length + nomeBuffer.length + compressi.length;
  }
  const corpo = Buffer.concat(locali);
  const directory = Buffer.concat(centrali);
  const fine = Buffer.alloc(22);
  fine.writeUInt32LE(FIRMA_FINE, 0);
  fine.writeUInt16LE(vociInput.length, 8);
  fine.writeUInt16LE(vociInput.length, 10);
  fine.writeUInt32LE(directory.length, 12);
  fine.writeUInt32LE(corpo.length, 16);
  return Buffer.concat([corpo, directory, fine]);
}

function decodificaXml(testo) {
  return String(testo)
    .replace(/&#x([0-9a-f]+);/gi, (_tutto, valore) => String.fromCodePoint(Number.parseInt(valore, 16)))
    .replace(/&#([0-9]+);/g, (_tutto, valore) => String.fromCodePoint(Number.parseInt(valore, 10)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function codificaXml(testo) {
  return String(testo)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function valoriNormalizzati(valori) {
  const risultato = new Map();
  for (const [chiave, valore] of Object.entries(valori || {})) {
    const nome = String(chiave).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_.-]{0,127}$/.test(nome) || valore == null) continue;
    risultato.set(nome, String(valore).replace(/[\r\n]+/g, " | ").trim());
  }
  return risultato;
}

function trovaToken(testo, valori) {
  const pattern = /\{\{([A-Z0-9][A-Z0-9_.-]{0,127})\}\}|\[\[([A-Z0-9][A-Z0-9_.-]{0,127})\]\]/gi;
  let corrispondenza;
  while ((corrispondenza = pattern.exec(testo))) {
    const chiave = (corrispondenza[1] || corrispondenza[2]).toUpperCase();
    if (valori.has(chiave)) return { indice: corrispondenza.index, lunghezza: corrispondenza[0].length, chiave };
  }
  return null;
}

function sostituisciNeiNodi(frammento, patternNodi, valori) {
  let corrente = frammento;
  let sostituzioni = 0;
  const perChiave = {};
  for (let guardia = 0; guardia < 10_000; guardia += 1) {
    const nodi = [];
    const pattern = new RegExp(patternNodi.source, patternNodi.flags.includes("g") ? patternNodi.flags : `${patternNodi.flags}g`);
    let nodo;
    let lunghezzaLogica = 0;
    while ((nodo = pattern.exec(corrente))) {
      const contenuto = decodificaXml(nodo[2]);
      const inizio = nodo.index + nodo[1].length;
      nodi.push({ inizio, fine: inizio + nodo[2].length, contenuto, base: lunghezzaLogica });
      lunghezzaLogica += contenuto.length;
    }
    if (nodi.length === 0) break;
    const logico = nodi.map((voce) => voce.contenuto).join("");
    const token = trovaToken(logico, valori);
    if (!token) break;
    const fineToken = token.indice + token.lunghezza;
    const primo = nodi.findIndex((voce) => token.indice >= voce.base && token.indice <= voce.base + voce.contenuto.length);
    let ultimo = nodi.findIndex((voce) => fineToken >= voce.base && fineToken <= voce.base + voce.contenuto.length);
    if (ultimo < 0 && fineToken === lunghezzaLogica) ultimo = nodi.length - 1;
    if (primo < 0 || ultimo < primo) break;
    const primaVoce = nodi[primo];
    const ultimaVoce = nodi[ultimo];
    const prefisso = primaVoce.contenuto.slice(0, token.indice - primaVoce.base);
    const suffisso = ultimaVoce.contenuto.slice(fineToken - ultimaVoce.base);
    const nuovi = nodi.map((voce) => voce.contenuto);
    nuovi[primo] = prefisso + valori.get(token.chiave) + (primo === ultimo ? suffisso : "");
    for (let indice = primo + 1; indice < ultimo; indice += 1) nuovi[indice] = "";
    if (ultimo > primo) nuovi[ultimo] = suffisso;
    for (let indice = nodi.length - 1; indice >= 0; indice -= 1) {
      corrente = corrente.slice(0, nodi[indice].inizio) + codificaXml(nuovi[indice]) + corrente.slice(nodi[indice].fine);
    }
    sostituzioni += 1;
    perChiave[token.chiave] = (perChiave[token.chiave] || 0) + 1;
  }
  return { testo: corrente, sostituzioni, perChiave };
}

function applicaPerContenitori(xml, patternContenitore, patternNodi, valori) {
  let sostituzioni = 0;
  const perChiave = {};
  const testo = xml.replace(patternContenitore, (contenitore) => {
    const esito = sostituisciNeiNodi(contenitore, patternNodi, valori);
    sostituzioni += esito.sostituzioni;
    for (const [chiave, conteggio] of Object.entries(esito.perChiave)) perChiave[chiave] = (perChiave[chiave] || 0) + conteggio;
    return esito.testo;
  });
  return { testo, sostituzioni, perChiave };
}

function unisciRisultati(...risultati) {
  const perChiave = {};
  let sostituzioni = 0;
  for (const risultato of risultati) {
    sostituzioni += risultato.sostituzioni;
    for (const [chiave, conteggio] of Object.entries(risultato.perChiave)) perChiave[chiave] = (perChiave[chiave] || 0) + conteggio;
  }
  return { sostituzioni, perChiave };
}

function sostituisciXml(nome, xml, valori) {
  if (nome.startsWith("word/") && nome.endsWith(".xml")) {
    const paragrafi = applicaPerContenitori(xml, /<w:p\b[\s\S]*?<\/w:p>/g, /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g, valori);
    return { testo: paragrafi.testo, ...unisciRisultati(paragrafi) };
  }
  if (nome === "xl/sharedStrings.xml" || /^xl\/(?:worksheets|comments)\/.+\.xml$/.test(nome)) {
    const contenitori = applicaPerContenitori(xml, /<(?:si|is|c)\b[\s\S]*?<\/(?:si|is|c)>/g, /(<t\b[^>]*>)([\s\S]*?)(<\/t>)/g, valori);
    return { testo: contenitori.testo, ...unisciRisultati(contenitori) };
  }
  if (["content.xml", "styles.xml", "meta.xml"].includes(nome)) {
    const paragrafi = applicaPerContenitori(xml, /<text:(?:p|h)\b[\s\S]*?<\/text:(?:p|h)>/g, /(>)([^<]*)(<)/g, valori);
    return { testo: paragrafi.testo, ...unisciRisultati(paragrafi) };
  }
  if (nome.startsWith("docProps/") && nome.endsWith(".xml")) {
    const semplice = sostituisciNeiNodi(xml, /(>)([^<]*)(<)/g, valori);
    return { testo: semplice.testo, ...unisciRisultati(semplice) };
  }
  return { testo: xml, sostituzioni: 0, perChiave: {} };
}

function tokenResidui(testo) {
  const risultati = new Set();
  const pattern = /\{\{([A-Z0-9][A-Z0-9_.-]{0,127})\}\}|\[\[([A-Z0-9][A-Z0-9_.-]{0,127})\]\]/gi;
  let corrispondenza;
  while ((corrispondenza = pattern.exec(testo))) risultati.add((corrispondenza[1] || corrispondenza[2]).toUpperCase());
  return risultati;
}

async function scriviAtomico(percorso, contenuto) {
  const destinazione = resolve(percorso);
  const temporaneo = join(dirname(destinazione), `.${basename(destinazione)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporaneo, contenuto, { flag: "wx" });
  try {
    await rename(temporaneo, destinazione);
  } finally {
    await rm(temporaneo, { force: true }).catch(() => {});
  }
}

export async function compilaTemplateOffice(sorgenteInput, destinazioneInput, valoriInput) {
  const sorgente = resolve(sorgenteInput);
  const destinazione = resolve(destinazioneInput);
  if (!isAbsolute(sorgenteInput) || !isAbsolute(destinazioneInput) || sorgente === destinazione) {
    throw new Error("Sorgente e destinazione del template devono essere percorsi assoluti distinti");
  }
  const estensione = extname(sorgente).toLowerCase();
  const valori = valoriNormalizzati(valoriInput);
  if (valori.size === 0) throw new Error("Nessun valore valido disponibile per compilare il template");
  if (estensione === ".md") {
    const originale = await readFile(sorgente, "utf8");
    let testo = originale;
    const perChiave = {};
    for (const [chiave, valore] of valori) {
      const pattern = new RegExp(`(?:\\{\\{|\\[\\[)${chiave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\}\\}|\\]\\])`, "gi");
      testo = testo.replace(pattern, () => {
        perChiave[chiave] = (perChiave[chiave] || 0) + 1;
        return valore;
      });
    }
    await scriviAtomico(destinazione, testo);
    return {
      formato: "markdown",
      sostituzioni: Object.values(perChiave).reduce((totale, valore) => totale + valore, 0),
      perChiave,
      tokenResidui: [...tokenResidui(testo)].sort(),
      sha256Sorgente: createHash("sha256").update(originale).digest("hex"),
      sha256Output: createHash("sha256").update(testo).digest("hex"),
    };
  }
  if (![".docx", ".dotx", ".xlsx", ".xltx", ".odt", ".ods"].includes(estensione)) {
    throw new Error(`Formato template non supportato: ${estensione || "senza estensione"}`);
  }
  const originale = await readFile(sorgente);
  const voci = leggiArchivioZip(originale);
  const perChiave = {};
  let sostituzioni = 0;
  const residui = new Set();
  for (const voce of voci) {
    if (!voce.nome.endsWith(".xml")) continue;
    const xml = voce.dati.toString("utf8");
    const esito = sostituisciXml(voce.nome, xml, valori);
    if (esito.sostituzioni > 0) voce.dati = Buffer.from(esito.testo, "utf8");
    sostituzioni += esito.sostituzioni;
    for (const [chiave, conteggio] of Object.entries(esito.perChiave)) perChiave[chiave] = (perChiave[chiave] || 0) + conteggio;
    for (const token of tokenResidui(esito.testo)) residui.add(token);
  }
  const compilato = scriviArchivioZip(voci);
  await scriviAtomico(destinazione, compilato);
  return {
    formato: estensione.slice(1),
    sostituzioni,
    perChiave,
    tokenResidui: [...residui].sort(),
    sha256Sorgente: createHash("sha256").update(originale).digest("hex"),
    sha256Output: createHash("sha256").update(compilato).digest("hex"),
  };
}

function paragrafoWord(testo, { livello = 0, etichetta = null } = {}) {
  const contenuto = codificaXml(String(testo || ""));
  const proprieta = livello > 0
    ? `<w:pPr><w:keepNext/><w:spacing w:before="${livello === 1 ? 320 : 220}" w:after="100"/></w:pPr>`
    : '<w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>';
  const stile = livello > 0
    ? `<w:rPr><w:b/><w:sz w:val="${livello === 1 ? 32 : 26}"/><w:szCs w:val="${livello === 1 ? 32 : 26}"/></w:rPr>`
    : "";
  const prefisso = etichetta ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${codificaXml(etichetta)}: </w:t></w:r>` : "";
  return `<w:p>${proprieta}${prefisso}<w:r>${stile}<w:t xml:space="preserve">${contenuto}</w:t></w:r></w:p>`;
}

export async function generaDossierWord(sorgenteInput, destinazioneInput, {
  titolo,
  sottotitolo = "Bozza fattuale soggetta ad approvazione umana",
  metadati = [],
  sezioni = [],
  mancanti = [],
} = {}) {
  const sorgente = resolve(sorgenteInput);
  const destinazione = resolve(destinazioneInput);
  if (!isAbsolute(sorgenteInput) || !isAbsolute(destinazioneInput) || sorgente === destinazione) {
    throw new Error("Sorgente e destinazione del dossier devono essere percorsi assoluti distinti");
  }
  if (![".docx", ".dotx"].includes(extname(sorgente).toLowerCase())) {
    throw new Error("Il dossier fattuale richiede un template Word DOCX o DOTX");
  }
  const originale = await readFile(sorgente);
  const voci = leggiArchivioZip(originale);
  const documento = voci.find((voce) => voce.nome === "word/document.xml");
  if (!documento) throw new Error("Il template Word non contiene word/document.xml");
  const xml = documento.dati.toString("utf8");
  const apertura = xml.match(/<w:body\b[^>]*>/);
  const chiusura = xml.lastIndexOf("</w:body>");
  if (!apertura || chiusura < apertura.index) throw new Error("Il corpo del template Word non e riconoscibile");
  const corpoOriginale = xml.slice(apertura.index + apertura[0].length, chiusura);
  const inizioSezioneFinale = corpoOriginale.lastIndexOf("<w:sectPr");
  const fineTagSezioneFinale = inizioSezioneFinale >= 0 ? corpoOriginale.indexOf("</w:sectPr>", inizioSezioneFinale) : -1;
  const fineSezioneFinale = fineTagSezioneFinale >= 0 ? fineTagSezioneFinale + "</w:sectPr>".length : -1;
  const sezioneFinaleValida = fineSezioneFinale >= 0 && !corpoOriginale.slice(fineSezioneFinale).trim();
  const sezionePagina = sezioneFinaleValida ? corpoOriginale.slice(inizioSezioneFinale, fineSezioneFinale) : "<w:sectPr/>";
  const corpoSenzaSezioneFinale = sezioneFinaleValida ? corpoOriginale.slice(0, inizioSezioneFinale) : corpoOriginale;
  let prefissoConservato = "";
  const paragrafi = /<w:p\b[\s\S]*?<\/w:p>/g;
  let paragrafo;
  while ((paragrafo = paragrafi.exec(corpoSenzaSezioneFinale))) {
    if (paragrafo[0].includes("<w:sectPr")) prefissoConservato = corpoSenzaSezioneFinale.slice(0, paragrafi.lastIndex);
  }
  const blocchi = [
    paragrafoWord(titolo || "Sistema di gestione", { livello: 1 }),
    paragrafoWord(sottotitolo),
    ...metadati.filter((voce) => voce?.valore != null && String(voce.valore).trim()).map((voce) => paragrafoWord(voce.valore, { etichetta: voce.etichetta })),
  ];
  for (const sezione of sezioni) {
    blocchi.push(paragrafoWord(sezione.titolo || "Sezione", { livello: 2 }));
    blocchi.push(paragrafoWord(sezione.testo || "Informazione non disponibile"));
    if (sezione.natura) blocchi.push(paragrafoWord(sezione.natura, { etichetta: "Natura dell'informazione" }));
    if (Array.isArray(sezione.evidenze) && sezione.evidenze.length) {
      blocchi.push(paragrafoWord(sezione.evidenze.join("; "), { etichetta: "Evidenze collegate" }));
    }
  }
  if (mancanti.length) {
    blocchi.push(paragrafoWord("Informazioni mancanti", { livello: 2 }));
    for (const voce of mancanti) blocchi.push(paragrafoWord(voce, { etichetta: "Da completare" }));
  }
  blocchi.push(paragrafoWord("Documento generato come bozza locale. Verificare contenuto, fonti e impaginazione prima dell'approvazione."));
  const nuovoXml = xml.slice(0, apertura.index + apertura[0].length) + prefissoConservato + blocchi.join("") + sezionePagina + xml.slice(chiusura);
  documento.dati = Buffer.from(nuovoXml, "utf8");
  const compilato = scriviArchivioZip(voci);
  await scriviAtomico(destinazione, compilato);
  return {
    formato: "docx",
    modalita: "dossier-fattuale",
    sezioni: sezioni.length,
    prefissoSezioniConservato: Boolean(prefissoConservato),
    campiMancanti: [...mancanti],
    sha256Sorgente: createHash("sha256").update(originale).digest("hex"),
    sha256Output: createHash("sha256").update(compilato).digest("hex"),
  };
}

export function risolviTemplateNellaRadice(radice, relativoInput) {
  const relativo = String(relativoInput || "").replaceAll("/", sep);
  const candidato = resolve(radice, relativo);
  const scarto = relative(resolve(radice), candidato);
  if (!scarto || scarto === ".." || scarto.startsWith(`..${sep}`) || isAbsolute(scarto)) {
    throw new Error("Percorso del template non confinato alla libreria collegata");
  }
  return candidato;
}
