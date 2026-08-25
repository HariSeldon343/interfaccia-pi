(function pubblicaVista(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiViewCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaVistaCore() {
  "use strict";

  const RIGA_METODO = /^\s*(ottimizzazione|orchestrazione)\s*:\s*ok[.!]?\s*$/i;

  function pulisciRispostaAgente(valore) {
    const originale = String(valore || "");
    const righe = originale.replace(/\r\n/g, "\n").split("\n");
    let indice = 0;
    while (indice < righe.length && !righe[indice].trim()) indice += 1;
    let rimosse = 0;
    while (indice < righe.length) {
      if (!RIGA_METODO.test(righe[indice])) break;
      rimosse += 1;
      indice += 1;
      while (indice < righe.length && !righe[indice].trim()) indice += 1;
    }
    if (!rimosse) return originale;
    return righe.slice(indice).join("\n").trimStart();
  }

  function statoAttivita({
    tentativiFalliti = 0,
    inCorso = false,
    finalizzato = false,
  } = {}) {
    const tentativi = Math.max(0, Number(tentativiFalliti) || 0);
    if (inCorso || !finalizzato) {
      return {
        testo: tentativi
          ? `in corso · ${tentativi} tentativ${tentativi === 1 ? "o" : "i"} non riuscit${tentativi === 1 ? "o" : "i"}`
          : "in corso…",
        livello: tentativi ? "avviso" : "lavoro",
      };
    }
    return {
      testo: tentativi
        ? `completate · ${tentativi} tentativ${tentativi === 1 ? "o" : "i"} non riuscit${tentativi === 1 ? "o" : "i"}`
        : "completate",
      livello: tentativi ? "avviso" : "ok",
    };
  }

  function etichettaRiepilogo(tipo) {
    if (tipo === "branch") {
      return {
        titolo: "Ramo precedente riassunto",
        descrizione: "La sintesi è chiusa. Il ramo originale resta nella cronologia.",
      };
    }
    return {
      titolo: "Conversazione compattata",
      descrizione: "La sintesi è chiusa. Messaggi e rami precedenti restano recuperabili.",
    };
  }

  function presentaCosto(valore, provider = "") {
    const costo = Number(valore);
    if (!Number.isFinite(costo) || costo <= 0) return null;
    const oauthAbbonamento = String(provider || "").toLowerCase() === "openai-codex";
    const importo = costo.toLocaleString("it-IT", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
    return {
      oauthAbbonamento,
      testo: oauthAbbonamento
        ? `≈${importo} $ eq. · OAuth attuale`
        : `≈${importo} $ stimati`,
      spiegazione: oauthAbbonamento
        ? "Equivalente tariffario cumulativo calcolato dai token, non una fattura. Il provider attuale OpenAI Codex usa OAuth; se nella stessa sessione sono stati usati altri provider o API, il totale puo includerne i costi. Eventuali crediti dipendono dal piano."
        : "Stima tariffaria calcolata dai token e dai prezzi del catalogo del modello; non e una fattura del provider.",
    };
  }

  return Object.freeze({
    etichettaRiepilogo,
    presentaCosto,
    pulisciRispostaAgente,
    statoAttivita,
  });
});
