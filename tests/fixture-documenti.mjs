import { crc32, deflateRawSync } from "node:zlib";

export function zipDocumento(oggetti, {metodo = 8} = {}) {
  const locali = [];
  const centrali = [];
  let posizione = 0;
  for (const [nome, contenuto] of Object.entries(oggetti)) {
    const nomeByte = Buffer.from(nome);
    const dati = Buffer.isBuffer(contenuto) ? contenuto : Buffer.from(contenuto);
    const compressi = metodo === 8 ? deflateRawSync(dati) : dati;
    const impronta = crc32(dati);
    const locale = Buffer.alloc(30);
    locale.writeUInt32LE(0x04034b50, 0);
    locale.writeUInt16LE(20, 4);
    locale.writeUInt16LE(0x800, 6);
    locale.writeUInt16LE(metodo, 8);
    locale.writeUInt32LE(impronta, 14);
    locale.writeUInt32LE(compressi.length, 18);
    locale.writeUInt32LE(dati.length, 22);
    locale.writeUInt16LE(nomeByte.length, 26);
    const centrale = Buffer.alloc(46);
    centrale.writeUInt32LE(0x02014b50, 0);
    centrale.writeUInt16LE(20, 4);
    centrale.writeUInt16LE(20, 6);
    centrale.writeUInt16LE(0x800, 8);
    centrale.writeUInt16LE(metodo, 10);
    centrale.writeUInt32LE(impronta, 16);
    centrale.writeUInt32LE(compressi.length, 20);
    centrale.writeUInt32LE(dati.length, 24);
    centrale.writeUInt16LE(nomeByte.length, 28);
    centrale.writeUInt32LE(posizione, 42);
    locali.push(locale, nomeByte, compressi);
    centrali.push(centrale, nomeByte);
    posizione += locale.length + nomeByte.length + compressi.length;
  }
  const indice = Buffer.concat(centrali);
  const fine = Buffer.alloc(22);
  fine.writeUInt32LE(0x06054b50, 0);
  fine.writeUInt16LE(Object.keys(oggetti).length, 8);
  fine.writeUInt16LE(Object.keys(oggetti).length, 10);
  fine.writeUInt32LE(indice.length, 12);
  fine.writeUInt32LE(posizione, 16);
  return Buffer.concat([...locali, indice, fine]);
}

export function docxMinimo(testo = "Testo DOCX verificato") {
  const xml = testo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return zipDocumento({"word/document.xml": "<w:document xmlns:w=\"urn:word\"><w:body><w:p><w:r><w:t>" + xml + "</w:t></w:r></w:p></w:body></w:document>"});
}

export function pdfMinimo(testo = "Testo PDF verificato") {
  const flusso = testo ? "BT /F1 12 Tf 72 720 Td (" + testo + ") Tj ET" : "";
  const oggetti = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + Buffer.byteLength(flusso) + " >>\nstream\n" + flusso + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const posizioni = [0];
  oggetti.forEach((oggetto, indice) => {
    posizioni.push(Buffer.byteLength(pdf));
    pdf += (indice + 1) + " 0 obj\n" + oggetto + "\nendobj\n";
  });
  const indice = Buffer.byteLength(pdf);
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  pdf += posizioni.slice(1).map((posizione) => String(posizione).padStart(10, "0") + " 00000 n \n").join("");
  pdf += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + indice + "\n%%EOF\n";
  return Buffer.from(pdf);
}
