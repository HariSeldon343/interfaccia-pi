(function (radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  radice.PiGuiAttachmentCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INIZIO_FILE = "<pi_gui_files_v1>";
  const FINE_FILE = "</pi_gui_files_v1>";
  const MASSIMO_FILE = 8;
  const COSTANTI_SHA256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function ruotaDestra(valore, bit) {
    return (valore >>> bit) | (valore << (32 - bit));
  }

  function codificaUtf8(valore) {
    const testo = String(valore || "");
    if (typeof TextEncoder === "function") return new TextEncoder().encode(testo);
    const byte = [];
    for (let indice = 0; indice < testo.length; indice += 1) {
      let punto = testo.charCodeAt(indice);
      if (punto >= 0xd800 && punto <= 0xdbff && indice + 1 < testo.length) {
        const basso = testo.charCodeAt(indice + 1);
        if (basso >= 0xdc00 && basso <= 0xdfff) {
          punto = 0x10000 + ((punto - 0xd800) << 10) + (basso - 0xdc00);
          indice += 1;
        }
      }
      if (punto <= 0x7f) byte.push(punto);
      else if (punto <= 0x7ff) {
        byte.push(0xc0 | (punto >>> 6), 0x80 | (punto & 0x3f));
      } else if (punto <= 0xffff) {
        byte.push(
          0xe0 | (punto >>> 12),
          0x80 | ((punto >>> 6) & 0x3f),
          0x80 | (punto & 0x3f),
        );
      } else {
        byte.push(
          0xf0 | (punto >>> 18),
          0x80 | ((punto >>> 12) & 0x3f),
          0x80 | ((punto >>> 6) & 0x3f),
          0x80 | (punto & 0x3f),
        );
      }
    }
    return Uint8Array.from(byte);
  }

  function sha256Esadecimale(valore) {
    const sorgente = codificaUtf8(valore);
    const lunghezzaBit = sorgente.length * 8;
    const lunghezzaTotale = Math.ceil((sorgente.length + 9) / 64) * 64;
    const dati = new Uint8Array(lunghezzaTotale);
    dati.set(sorgente);
    dati[sorgente.length] = 0x80;
    const alto = Math.floor(lunghezzaBit / 0x100000000);
    const basso = lunghezzaBit >>> 0;
    dati[lunghezzaTotale - 8] = alto >>> 24;
    dati[lunghezzaTotale - 7] = alto >>> 16;
    dati[lunghezzaTotale - 6] = alto >>> 8;
    dati[lunghezzaTotale - 5] = alto;
    dati[lunghezzaTotale - 4] = basso >>> 24;
    dati[lunghezzaTotale - 3] = basso >>> 16;
    dati[lunghezzaTotale - 2] = basso >>> 8;
    dati[lunghezzaTotale - 1] = basso;

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const parole = new Uint32Array(64);

    for (let blocco = 0; blocco < dati.length; blocco += 64) {
      for (let indice = 0; indice < 16; indice += 1) {
        const posizione = blocco + indice * 4;
        parole[indice] = (
          (dati[posizione] << 24)
          | (dati[posizione + 1] << 16)
          | (dati[posizione + 2] << 8)
          | dati[posizione + 3]
        ) >>> 0;
      }
      for (let indice = 16; indice < 64; indice += 1) {
        const precedente2 = parole[indice - 2];
        const precedente15 = parole[indice - 15];
        const sigma1 = ruotaDestra(precedente2, 17)
          ^ ruotaDestra(precedente2, 19)
          ^ (precedente2 >>> 10);
        const sigma0 = ruotaDestra(precedente15, 7)
          ^ ruotaDestra(precedente15, 18)
          ^ (precedente15 >>> 3);
        parole[indice] = (
          parole[indice - 16] + sigma0 + parole[indice - 7] + sigma1
        ) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let indice = 0; indice < 64; indice += 1) {
        const somma1 = ruotaDestra(e, 6) ^ ruotaDestra(e, 11) ^ ruotaDestra(e, 25);
        const scelta = (e & f) ^ (~e & g);
        const temporaneo1 = (h + somma1 + scelta + COSTANTI_SHA256[indice] + parole[indice]) >>> 0;
        const somma0 = ruotaDestra(a, 2) ^ ruotaDestra(a, 13) ^ ruotaDestra(a, 22);
        const maggioranza = (a & b) ^ (a & c) ^ (b & c);
        const temporaneo2 = (somma0 + maggioranza) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporaneo1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporaneo1 + temporaneo2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((parola) => parola.toString(16).padStart(8, "0"))
      .join("");
  }

  function fileLocaleValido(file) {
    return Boolean(
      file
      && typeof file === "object"
      && typeof file.nome === "string"
      && file.nome.trim()
      && typeof file.percorso === "string"
      && file.percorso.trim(),
    );
  }

  function normalizzaFileLocale(file) {
    if (!fileLocaleValido(file)) return null;
    const dimensione = Number(file.dimensione);
    return {
      tipo: "file",
      id: typeof file.id === "string" && file.id ? file.id : "",
      nome: file.nome.trim().slice(0, 255),
      percorso: file.percorso.trim(),
      mimeType: typeof file.mimeType === "string"
        ? file.mimeType.trim().slice(0, 255)
        : "application/octet-stream",
      dimensione: Number.isFinite(dimensione) && dimensione >= 0 ? dimensione : 0,
    };
  }

  function allegatoFile(allegato) {
    return allegato?.tipo === "file" && fileLocaleValido(allegato);
  }

  function allegatoImmagine(allegato) {
    return allegato?.tipo !== "file"
      && typeof allegato?.data === "string"
      && typeof allegato?.mimeType === "string"
      && allegato.mimeType.startsWith("image/");
  }

  function creaMessaggioConFile(testo, file) {
    const normalizzati = Array.from(file || [])
      .map(normalizzaFileLocale)
      .filter(Boolean)
      .slice(0, MASSIMO_FILE);
    const richiesta = String(testo || "");
    if (!normalizzati.length) return richiesta;
    const metadati = normalizzati.map(({ nome, percorso, mimeType, dimensione }) => ({
      nome,
      percorso,
      mimeType,
      dimensione,
    }));
    return `${INIZIO_FILE}\n${JSON.stringify({ file: metadati })}\n${FINE_FILE}\n${richiesta}`;
  }

  function separaMessaggioConFile(testo) {
    const originale = String(testo || "");
    if (!originale.startsWith(INIZIO_FILE + "\n")) {
      return { testo: originale, file: [] };
    }
    const fine = originale.indexOf("\n" + FINE_FILE, INIZIO_FILE.length + 1);
    if (fine < 0) return { testo: originale, file: [] };
    const json = originale.slice(INIZIO_FILE.length + 1, fine);
    try {
      const dati = JSON.parse(json);
      if (!dati || typeof dati !== "object" || !Array.isArray(dati.file)) {
        return { testo: originale, file: [] };
      }
      const file = dati.file
        .map(normalizzaFileLocale)
        .filter(Boolean)
        .slice(0, MASSIMO_FILE);
      if (!file.length && dati.file.length) return { testo: originale, file: [] };
      const dopo = fine + 1 + FINE_FILE.length;
      return {
        testo: originale.slice(dopo).replace(/^\r?\n/, ""),
        file,
      };
    } catch {
      return { testo: originale, file: [] };
    }
  }

  function firmaAllegato(allegato) {
    if (allegatoFile(allegato)) {
      return [
        "file",
        String(allegato.percorso || ""),
        Number(allegato.dimensione || 0),
      ].join(":");
    }
    const dati = String(allegato?.data || "");
    const mimeType = String(allegato?.mimeType || "");
    return `image-sha256:${sha256Esadecimale(`${mimeType}\0${dati}`)}`;
  }

  return Object.freeze({
    MASSIMO_FILE,
    allegatoFile,
    allegatoImmagine,
    creaMessaggioConFile,
    separaMessaggioConFile,
    firmaAllegato,
  });
});
