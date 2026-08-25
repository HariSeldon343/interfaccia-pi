(function pubblicaVista(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiViewCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaVistaCore() {
  "use strict";

  const RIGA_METODO = /^\s*(?:`|\*\*|__)?(?:ottimizzazione|orchestrazione)\s*:\s*ok[.!]?(?:(?:`|\*\*|__)\s*)?(?:\s*[—–-]\s*(.*?))?(?:(?:`|\*\*|__))?\s*$/i;
  const SUFFISSO_METODO_TECNICO = /^stack e goal confermati[.!]?$/i;

  function analizzaRigaMetodo(valore) {
    const corrispondenza = RIGA_METODO.exec(String(valore || ""));
    if (!corrispondenza) return null;
    const suffisso = String(corrispondenza[1] || "").trim();
    return {
      testoVisibile: suffisso && !SUFFISSO_METODO_TECNICO.test(suffisso)
        ? suffisso
        : "",
    };
  }

  function pulisciRispostaAgente(valore) {
    const originale = String(valore || "");
    const righe = originale.replace(/\r\n/g, "\n").split("\n");
    let indice = 0;
    while (indice < righe.length && !righe[indice].trim()) indice += 1;
    let rimosse = 0;
    while (indice < righe.length) {
      const marker = analizzaRigaMetodo(righe[indice]);
      if (!marker) break;
      rimosse += 1;
      if (marker.testoVisibile) {
        righe[indice] = marker.testoVisibile;
        break;
      }
      indice += 1;
      while (indice < righe.length && !righe[indice].trim()) indice += 1;
    }
    if (!rimosse) return originale;
    return righe.slice(indice).join("\n").trimStart();
  }

  function presentaErroreCompattazione(valore) {
    const originale = String(valore || "");
    const nonNecessaria = /nothing to compact|session too small/i.test(originale);
    return {
      nonNecessaria,
      testo: nonNecessaria
        ? "La conversazione è ancora troppo breve per essere riassunta."
        : originale,
    };
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
      descrizione: "Le tue richieste originali restano visibili. La sintesi del lavoro è chiusa e i rami precedenti restano recuperabili.",
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

  function chiaveModello(modello) {
    const provider = typeof modello?.provider === "string"
      ? modello.provider.trim()
      : "";
    const id = typeof modello?.id === "string"
      ? modello.id.trim()
      : "";
    if (!provider || !id) return null;
    return JSON.stringify([provider, id]);
  }

  function finestraContestoValida(valore) {
    const finestra = valore == null ? NaN : Number(valore);
    return Number.isFinite(finestra) && finestra > 0 ? finestra : null;
  }

  function finestraContestoModelloCorrente({
    modelloCorrente = null,
    modelloStato = null,
    catalogo = [],
    statistiche = null,
    modelloStatistiche = null,
  } = {}) {
    const chiaveCorrente = chiaveModello(modelloCorrente);
    if (!chiaveCorrente) return null;

    if (chiaveModello(modelloStato) === chiaveCorrente) {
      const dalloStato = finestraContestoValida(modelloStato.contextWindow);
      if (dalloStato != null) return dalloStato;
    }

    const dalCatalogo = Array.isArray(catalogo)
      ? catalogo.find((modello) => chiaveModello(modello) === chiaveCorrente)
      : null;
    const finestraCatalogo = finestraContestoValida(dalCatalogo?.contextWindow);
    if (finestraCatalogo != null) return finestraCatalogo;

    if (chiaveModello(modelloStatistiche) !== chiaveCorrente) return null;
    return finestraContestoValida(statistiche?.contextUsage?.contextWindow);
  }

  return Object.freeze({
    chiaveModello,
    etichettaRiepilogo,
    finestraContestoModelloCorrente,
    presentaErroreCompattazione,
    presentaCosto,
    pulisciRispostaAgente,
    statoAttivita,
  });
});
