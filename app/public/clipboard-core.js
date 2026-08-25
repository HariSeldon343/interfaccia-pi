(function pubblicaClipboard(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiClipboardCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaClipboard() {
  "use strict";

  const TIPI_IMMAGINE_SUPPORTATI = Object.freeze([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);
  const ESTENSIONI = new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ]);

  function normalizzaMime(valore) {
    return String(valore || "").trim().toLowerCase();
  }

  function tipoImmagineSupportato(valore) {
    return TIPI_IMMAGINE_SUPPORTATI.includes(normalizzaMime(valore));
  }

  function supportoImmaginiModello(modello) {
    const input = modello?.input;
    if (!Array.isArray(input)) return null;
    return input.includes("image");
  }

  function nomeScreenshotClipboard(mimeType, indice = 0, adesso = Date.now()) {
    const mime = normalizzaMime(mimeType);
    const data = new Date(adesso);
    const istante = Number.isNaN(data.valueOf())
      ? "data-sconosciuta"
      : data.toISOString().replace(/[:.]/g, "-");
    const suffisso = indice ? `-${indice + 1}` : "";
    return `screenshot-${istante}${suffisso}.${ESTENSIONI.get(mime) || "png"}`;
  }

  function rinominaImmagineClipboard(file, indice, { FileCtor = globalThis.File, adesso = Date.now() } = {}) {
    const nome = String(file?.name || "").trim();
    if (nome && !/^image\.(?:png|jpe?g|webp|gif)$/i.test(nome)) return file;
    if (typeof FileCtor !== "function") return file;
    const mimeType = normalizzaMime(file?.type);
    try {
      return new FileCtor([file], nomeScreenshotClipboard(mimeType, indice, adesso), {
        type: mimeType,
        lastModified: Number(adesso),
      });
    } catch {
      return file;
    }
  }

  function immaginiDaClipboard(clipboardData, opzioni = {}) {
    if (!clipboardData) return [];
    const dagliElementi = Array.from(clipboardData.items || [])
      .filter((elemento) => elemento?.kind === "file" && tipoImmagineSupportato(elemento.type))
      .map((elemento) => elemento.getAsFile?.())
      .filter(Boolean);
    const daiFile = Array.from(clipboardData.files || [])
      .filter((file) => tipoImmagineSupportato(file?.type));
    // WebView2 e browser non popolano sempre items/files nello stesso modo.
    // Scegliere la sorgente piu completa evita sia immagini perse sia duplicati.
    const candidati = daiFile.length > dagliElementi.length ? daiFile : dagliElementi;
    return candidati.map((file, indice) => rinominaImmagineClipboard(file, indice, opzioni));
  }

  return {
    TIPI_IMMAGINE_SUPPORTATI,
    immaginiDaClipboard,
    nomeScreenshotClipboard,
    supportoImmaginiModello,
    tipoImmagineSupportato,
  };
});
