import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";
import { trovaRuntimeEstrazione } from "./estrazione-runtime.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
export const LIMITE_CARATTERI = 5_000_000;
const ESTENSIONI_TESTUALI = new Set(["md", "txt", "csv", "json", "xml", "yaml", "yml", "html", "htm", "log", "js", "mjs", "cjs", "jsx", "ts", "tsx", "css", "scss", "py", "rs", "c", "h", "cpp", "hpp", "java", "go", "rb", "php", "sql", "sh", "toml", "ini", "cfg", "r", "tex", "svelte", "vue", "kt", "swift"]);
const LIMITE_VOCE_ZIP = 50 * 1024 * 1024;
const LIMITE_ARCHIVIO_ZIP = 200 * 1024 * 1024;

function erroreZip(motivo) {
  throw new Error("Archivio ZIP non valido: " + motivo);
}

function verificaExtraZip(dati) {
  let posizione = 0;
  while (posizione < dati.length) {
    if (posizione + 4 > dati.length) erroreZip("campo aggiuntivo incompleto.");
    if (dati.readUInt16LE(posizione) === 1) erroreZip("ZIP64 non supportato.");
    posizione += 4 + dati.readUInt16LE(posizione + 2);
    if (posizione > dati.length) erroreZip("campo aggiuntivo fuori limite.");
  }
}

function leggiIndiceZip(dati) {
  let fine = -1;
  for (let posizione = dati.length - 22; posizione >= Math.max(0, dati.length - 65557); posizione -= 1) {
    if (dati.readUInt32LE(posizione) === 0x06054b50 && posizione + 22 + dati.readUInt16LE(posizione + 20) === dati.length) { fine = posizione; break; }
  }
  if (fine < 0) erroreZip("directory centrale assente.");
  const numero = dati.readUInt16LE(fine + 10);
  const dimensioneIndice = dati.readUInt32LE(fine + 12);
  const inizioIndice = dati.readUInt32LE(fine + 16);
  if (numero === 0xffff || dimensioneIndice === 0xffffffff || inizioIndice === 0xffffffff) erroreZip("ZIP64 non supportato.");
  if (dati.readUInt16LE(fine + 4) || dati.readUInt16LE(fine + 6) || dati.readUInt16LE(fine + 8) !== numero) erroreZip("archivio multidisco non supportato.");
  if (inizioIndice + dimensioneIndice !== fine) erroreZip("directory centrale fuori limite.");
  const voci = [];
  const nomi = new Set();
  let totale = 0;
  let posizione = inizioIndice;
  for (let indice = 0; indice < numero; indice += 1) {
    if (posizione + 46 > fine || dati.readUInt32LE(posizione) !== 0x02014b50) erroreZip("voce centrale incompleta.");
    const flag = dati.readUInt16LE(posizione + 8);
    const metodo = dati.readUInt16LE(posizione + 10);
    const impronta = dati.readUInt32LE(posizione + 16);
    const compressi = dati.readUInt32LE(posizione + 20);
    const dimensione = dati.readUInt32LE(posizione + 24);
    const lunghezzaNome = dati.readUInt16LE(posizione + 28);
    const lunghezzaExtra = dati.readUInt16LE(posizione + 30);
    const lunghezzaCommento = dati.readUInt16LE(posizione + 32);
    const locale = dati.readUInt32LE(posizione + 42);
    const fineVoce = posizione + 46 + lunghezzaNome + lunghezzaExtra + lunghezzaCommento;
    if (fineVoce > fine) erroreZip("voce centrale fuori limite.");
    if ([compressi, dimensione, locale].includes(0xffffffff)) erroreZip("ZIP64 non supportato.");
    if (dati.readUInt16LE(posizione + 34) || (flag & 0x41)) erroreZip("archivio cifrato o multidisco non supportato.");
    if (metodo !== 0 && metodo !== 8) erroreZip("compressione non supportata.");
    if (dimensione > LIMITE_VOCE_ZIP) erroreZip("oltre 50 MiB decompressi per voce.");
    totale += dimensione;
    if (totale > LIMITE_ARCHIVIO_ZIP) erroreZip("oltre 200 MiB decompressi per archivio.");
    const nomeByte = dati.subarray(posizione + 46, posizione + 46 + lunghezzaNome);
    const nome = nomeByte.toString("utf8");
    if (!nome || /[\\:\u0000-\u001f\u007f]/.test(nome) || nome.startsWith("/") || nome.replace(/\/$/, "").split("/").some((parte) => !parte || parte === "." || parte === "..")) erroreZip("nome della voce non valido.");
    if (nomi.has(nome)) erroreZip("nome della voce duplicato.");
    nomi.add(nome);
    verificaExtraZip(dati.subarray(posizione + 46 + lunghezzaNome, posizione + 46 + lunghezzaNome + lunghezzaExtra));
    voci.push({nome, nomeByte, flag, metodo, impronta, compressi, dimensione, locale});
    posizione = fineVoce;
  }
  if (posizione !== fine) erroreZip("dimensione della directory centrale incoerente.");
  return {voci, inizioIndice};
}

function leggiZip(dati) {
  dati = Buffer.from(dati);
  const {voci, inizioIndice} = leggiIndiceZip(dati);
  const risultato = new Map();
  let finePrecedente = 0;
  for (const voce of voci.sort((prima, seconda) => prima.locale - seconda.locale)) {
    const posizione = voce.locale;
    if (posizione < finePrecedente || posizione + 30 > inizioIndice || dati.readUInt32LE(posizione) !== 0x04034b50) erroreZip("intestazione locale non valida.");
    const lunghezzaNome = dati.readUInt16LE(posizione + 26);
    const lunghezzaExtra = dati.readUInt16LE(posizione + 28);
    const inizio = posizione + 30 + lunghezzaNome + lunghezzaExtra;
    const fine = inizio + voce.compressi;
    if (fine > inizioIndice || dati.readUInt16LE(posizione + 6) !== voce.flag || dati.readUInt16LE(posizione + 8) !== voce.metodo || !dati.subarray(posizione + 30, posizione + 30 + lunghezzaNome).equals(voce.nomeByte)) erroreZip("intestazione locale incoerente.");
    if (!(voce.flag & 8) && (dati.readUInt32LE(posizione + 14) !== voce.impronta || dati.readUInt32LE(posizione + 18) !== voce.compressi || dati.readUInt32LE(posizione + 22) !== voce.dimensione)) erroreZip("dimensioni o CRC locali incoerenti.");
    verificaExtraZip(dati.subarray(posizione + 30 + lunghezzaNome, inizio));
    // Il limite si applica anche quando la directory centrale mente sulla dimensione.
    let contenuto;
    try {
      contenuto = voce.metodo === 0 ? dati.subarray(inizio, fine) : inflateRawSync(dati.subarray(inizio, fine), {maxOutputLength: Math.max(1, Math.min(voce.dimensione, LIMITE_VOCE_ZIP))});
    } catch {
      erroreZip("contenuto danneggiato o oltre il limite di decompressione.");
    }
    if (contenuto.length !== voce.dimensione || crc32(contenuto) !== voce.impronta) erroreZip("dimensione o CRC del contenuto non valido.");
    risultato.set(voce.nome, contenuto);
    finePrecedente = fine;
  }
  return risultato;
}

function decodificaXml(testo) {
  return testo.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entita) => {
    const simboli = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'"};
    if (Object.hasOwn(simboli, entita)) return simboli[entita];
    if (!entita.startsWith("&#")) return entita;
    const codice = entita[2].toLowerCase() === "x" ? parseInt(entita.slice(3, -1), 16) : Number(entita.slice(2, -1));
    return codice > 0 && codice <= 0x10ffff && !(codice >= 0xd800 && codice <= 0xdfff) ? String.fromCodePoint(codice) : "�";
  });
}

function leggiXml(archivio, nome) {
  const dati = archivio.get(nome);
  if (!dati) throw new Error("Parte Office assente: " + nome);
  const testo = dati.toString("utf8").replace(/^\uFEFF/, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(testo)) throw new Error("Dichiarazioni XML esterne non supportate.");
  return testo;
}

function raccoglitoreTesto() {
  const parti = [];
  let caratteri = 0;
  return {
    get pieno() { return caratteri > LIMITE_CARATTERI; },
    aggiungi(testo) {
      // Un carattere sentinella conserva la nota di troncamento senza espandere tutto il documento.
      const porzione = testo.slice(0, Math.max(0, LIMITE_CARATTERI + 1 - caratteri));
      if (porzione) parti.push(porzione);
      caratteri += porzione.length;
    },
    testo() { return parti.join(""); },
  };
}

function testoParagrafoDocx(xml) {
  const parti = raccoglitoreTesto();
  for (const elemento of xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t\s*>|<w:(tab|br|cr)\b[^>]*\/?\s*>/g)) {
    parti.aggiungi(elemento[1] !== undefined ? decodificaXml(elemento[1]) : elemento[2] === "tab" ? "\t" : "\n");
    if (parti.pieno) break;
  }
  return parti.testo();
}

function estraiDocx(archivio) {
  const xml = leggiXml(archivio, "word/document.xml");
  const righe = raccoglitoreTesto();
  let primaRiga = true;
  function aggiungiRiga(testo) {
    if (!primaRiga) righe.aggiungi("\n");
    righe.aggiungi(testo);
    primaRiga = false;
  }
  for (const blocco of xml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl\s*>|<w:p\b[^>]*>[\s\S]*?<\/w:p\s*>/g)) {
    if (blocco[0].startsWith("<w:tbl")) {
      for (const riga of blocco[0].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr\s*>/g)) {
        const celle = raccoglitoreTesto();
        let primaCella = true;
        for (const cella of riga[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc\s*>/g)) {
          if (!primaCella) celle.aggiungi(" | ");
          primaCella = false;
          let primoParagrafo = true;
          for (const paragrafo of cella[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p\s*>/g)) {
            if (!primoParagrafo) celle.aggiungi(" ");
            celle.aggiungi(testoParagrafoDocx(paragrafo[1]));
            primoParagrafo = false;
            if (celle.pieno) break;
          }
          if (celle.pieno) break;
        }
        aggiungiRiga(celle.testo());
        if (righe.pieno) break;
      }
    } else aggiungiRiga(testoParagrafoDocx(blocco[0]));
    if (righe.pieno) break;
  }
  return righe.testo();
}

function attributiXml(xml) {
  const attributi = new Map();
  for (const attributo of xml.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attributi.set(attributo[1], decodificaXml(attributo[2] ?? attributo[3]));
  return attributi;
}

function leggiRelazioni(archivio, nome) {
  const relazioni = new Map();
  for (const relazione of leggiXml(archivio, nome).matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)\/?\s*>/g)) {
    const attributi = attributiXml(relazione[1]);
    const id = attributi.get("Id");
    if (!id || relazioni.has(id)) throw new Error("Relazione Office senza identificatore o duplicata.");
    relazioni.set(id, attributi);
  }
  return relazioni;
}

function destinazioneRelazione(relazioni, id, origine) {
  const relazione = relazioni.get(id);
  const destinazione = relazione?.get("Target");
  if (!destinazione || relazione.get("TargetMode") === "External") throw new Error("Relazione Office assente o esterna: " + id);
  const percorso = decodeURIComponent(destinazione);
  if (/[\\:\u0000-\u001f\u007f?#]/.test(percorso)) throw new Error("Percorso della relazione Office non valido.");
  const parti = percorso.startsWith("/") ? [] : origine.split("/").slice(0, -1);
  for (const parte of percorso.split("/")) {
    if (!parte || parte === ".") continue;
    if (parte === "..") {
      if (!parti.length) throw new Error("Relazione Office fuori archivio.");
      parti.pop();
    } else parti.push(parte);
  }
  if (!parti.length) throw new Error("Relazione Office senza destinazione.");
  return parti.join("/");
}

function testiXml(xml) {
  const risultato = raccoglitoreTesto();
  for (const testo of xml.matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t\s*>/g)) {
    risultato.aggiungi(decodificaXml(testo[1]));
    if (risultato.pieno) break;
  }
  return risultato.testo();
}

function valoreCella(xml, attributi, condivise) {
  if (attributi.get("t") === "inlineStr") return testiXml(xml);
  const valore = /<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v\s*>/.exec(xml)?.[1] ?? "";
  if (attributi.get("t") !== "s") return decodificaXml(valore);
  const indice = Number(valore);
  if (!/^\d+$/.test(valore) || !Number.isSafeInteger(indice) || indice >= condivise.length) throw new Error("Indice della stringa condivisa XLSX non valido.");
  return condivise[indice];
}

function righeFoglio(xml, condivise) {
  const righe = raccoglitoreTesto();
  let primaRiga = true;
  for (const riga of xml.matchAll(/<(?:[\w.-]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?row\s*>/g)) {
    if (!primaRiga) righe.aggiungi("\n");
    primaRiga = false;
    let ultimaColonna = -1;
    for (const cella of riga[1].matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c\s*>)/g)) {
      const attributi = attributiXml(cella[1]);
      const riferimento = attributi.get("r");
      let colonna = ultimaColonna + 1;
      if (riferimento !== undefined) {
        const lettere = /^([A-Z]{1,3})[1-9]\d*$/.exec(riferimento)?.[1];
        if (!lettere) throw new Error("Riferimento della cella XLSX non valido.");
        colonna = 0;
        for (const lettera of lettere) colonna = colonna * 26 + lettera.charCodeAt(0) - 64;
        colonna -= 1;
        if (colonna >= 16384 || colonna <= ultimaColonna) throw new Error("Ordine o colonna della cella XLSX non valido.");
      }
      righe.aggiungi("\t".repeat(ultimaColonna < 0 ? colonna : colonna - ultimaColonna));
      righe.aggiungi(valoreCella(cella[2] || "", attributi, condivise));
      ultimaColonna = colonna;
      if (righe.pieno) break;
    }
    if (righe.pieno) break;
  }
  return righe.testo();
}

function estraiXlsx(archivio) {
  const origine = "xl/workbook.xml";
  const relazioni = leggiRelazioni(archivio, "xl/_rels/workbook.xml.rels");
  let condivise = [];
  if (archivio.has("xl/sharedStrings.xml")) condivise = Array.from(leggiXml(archivio, "xl/sharedStrings.xml").matchAll(/<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si\s*>/g), (voce) => testiXml(voce[1]));
  const blocchi = raccoglitoreTesto();
  const fogli = Array.from(leggiXml(archivio, origine).matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*)\/?\s*>/g));
  for (const [indice, foglio] of fogli.entries()) {
    const attributi = attributiXml(foglio[1]);
    const percorso = destinazioneRelazione(relazioni, attributi.get("r:id"), origine);
    if (indice) blocchi.aggiungi("\n\n");
    blocchi.aggiungi("## Foglio " + (attributi.get("name") || "Senza nome") + "\n");
    blocchi.aggiungi(righeFoglio(leggiXml(archivio, percorso), condivise));
    if (blocchi.pieno) break;
  }
  return {testo: blocchi.testo(), pagine: fogli.length};
}

function estraiPptx(archivio) {
  const origine = "ppt/presentation.xml";
  const relazioni = leggiRelazioni(archivio, "ppt/_rels/presentation.xml.rels");
  const blocchi = raccoglitoreTesto();
  const diapositive = Array.from(leggiXml(archivio, origine).matchAll(/<p:sldId\b([^>]*)\/?\s*>/g));
  for (const [indice, slide] of diapositive.entries()) {
    const percorso = destinazioneRelazione(relazioni, attributiXml(slide[1]).get("r:id"), origine);
    const xml = leggiXml(archivio, percorso);
    if (indice) blocchi.aggiungi("\n\n");
    blocchi.aggiungi("## Slide " + (indice + 1) + "\n");
    let primoParagrafo = true;
    for (const paragrafo of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p\s*>/g)) {
      if (!primoParagrafo) blocchi.aggiungi("\n");
      blocchi.aggiungi(testiXml(paragrafo[1]));
      primoParagrafo = false;
      if (blocchi.pieno) break;
    }
    if (primoParagrafo) blocchi.aggiungi(testiXml(xml));
    if (blocchi.pieno) break;
  }
  return {testo: blocchi.testo(), pagine: diapositive.length};
}

export function spezzaRighe(testo) {
  const righe = [];
  for (let riga of testo.replace(/\r\n?/g, "\n").split("\n")) {
    while (riga.length > 1000) {
      let taglio = riga.lastIndexOf(" ", 1000);
      if (taglio <= 0) taglio = 1000;
      if (/[\uD800-\uDBFF]/.test(riga[taglio - 1])) taglio -= 1;
      righe.push(riga.slice(0, taglio));
      riga = riga.slice(taglio).replace(/^ /, "");
    }
    righe.push(riga);
  }
  return righe.join("\n");
}

function risultatoEstrazione(nome, parser, testo, pagine, motivo = "") {
  const troncato = testo.length > LIMITE_CARATTERI;
  const taglio = troncato && /[\uD800-\uDBFF]/.test(testo[LIMITE_CARATTERI - 1]) ? LIMITE_CARATTERI - 1 : LIMITE_CARATTERI;
  testo = testo.slice(0, taglio);
  const caratteri = testo.length;
  if (troncato) motivo = "Testo troncato al limite di 5 milioni di caratteri.";
  const stato = testo.trim() ? "ok" : "vuoto";
  if (stato === "vuoto" && parser.startsWith("pdfjs")) motivo = "nessun testo estraibile, probabile scansione: serve OCR";
  const intestazione = ["# Testo estratto da " + nome.replace(/[\r\n]/g, " "), "Fonte: " + nome.replace(/[\r\n]/g, " "), "Pagine: " + pagine, "Caratteri: " + caratteri, "Estratto il: " + new Date().toISOString(), "Parser: " + parser, "Documento lungo: leggere con offset e limit", ""];
  return {stato, pagine, caratteri, motivo, parser, testo: spezzaRighe(testo), contenuto: spezzaRighe([...intestazione, testo, motivo].join("\n"))};
}

class CanvasEstrazione {
  create() { throw new Error("Il rendering canvas non è previsto nell'estrazione testuale."); }
  reset() { throw new Error("Il rendering canvas non è previsto nell'estrazione testuale."); }
  destroy() {}
}

async function estraiPdf(nome, dati, guiDirectory) {
  let bundle;
  let pdf;
  try {
    bundle = await trovaRuntimeEstrazione(guiDirectory);
    pdf = await import(pathToFileURL(bundle.pdf).href);
  } catch (errore) {
    return {stato: "non-supportato", pagine: 0, caratteri: 0, motivo: "PDF non supportato dal runtime verificato: " + errore.message, parser: "pdfjs-dist 6.3.289", testo: "", contenuto: null};
  }
  pdf.GlobalWorkerOptions.workerSrc = pathToFileURL(bundle.worker).href;
  // La factory impedisce al parser di risolvere pacchetti canvas esterni al bundle verificato.
  const caricamento = pdf.getDocument({data: new Uint8Array(dati), CanvasFactory: CanvasEstrazione, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, verbosity: 0});
  try {
    const documento = await caricamento.promise;
    const blocchi = [];
    let caratteri = 0;
    let haTesto = false;
    for (let numero = 1; numero <= documento.numPages; numero += 1) {
      const pagina = await documento.getPage(numero);
      const contenuto = await pagina.getTextContent();
      const testo = contenuto.items.map((voce) => typeof voce.str === "string" ? voce.str + (voce.hasEOL ? "\n" : " ") : "").join("").trim();
      haTesto ||= Boolean(testo);
      blocchi.push("## Pagina " + numero + "\n" + testo);
      caratteri += testo.length + 25;
      pagina.cleanup();
      if (caratteri > LIMITE_CARATTERI) break;
    }
    return risultatoEstrazione(nome, "pdfjs-dist 6.3.289", haTesto ? blocchi.join("\n\n") : "", documento.numPages);
  } finally {
    await caricamento.destroy();
  }
}

export function documentoTestuale(nome) {
  return typeof nome === "string" && ESTENSIONI_TESTUALI.has(/\.([a-z0-9]+)$/i.exec(nome)?.[1].toLowerCase() || "");
}

export async function estraiDocumento({nome, dati, guiDirectory = QUI}) {
  const estensione = /\.([a-z0-9]+)$/i.exec(nome)?.[1].toLowerCase() || "";
  if (documentoTestuale(nome)) {
    const testo = Buffer.from(dati).toString("utf8");
    return {stato: testo.trim() ? "ok" : "vuoto", pagine: 0, caratteri: testo.length, motivo: "", parser: "testo-originale", testo: testo.slice(0, LIMITE_CARATTERI), contenuto: null};
  }
  try {
    if (estensione === "pdf") return await estraiPdf(nome, dati, guiDirectory);
    if (estensione === "docx") return risultatoEstrazione(nome, "office-xml DOCX", estraiDocx(leggiZip(dati)), 0);
    if (estensione === "xlsx") {
      const risultato = estraiXlsx(leggiZip(dati));
      return risultatoEstrazione(nome, "office-xml XLSX", risultato.testo, risultato.pagine);
    }
    if (estensione === "pptx") {
      const risultato = estraiPptx(leggiZip(dati));
      return risultatoEstrazione(nome, "office-xml PPTX", risultato.testo, risultato.pagine);
    }
    return {stato: "non-supportato", pagine: 0, caratteri: 0, motivo: "Formato senza estrattore disponibile.", parser: "nessuno", testo: "", contenuto: null};
  } catch (errore) {
    return {stato: "errore", pagine: 0, caratteri: 0, motivo: "Estrazione non riuscita: " + errore.message, parser: estensione, testo: "", contenuto: null};
  }
}
