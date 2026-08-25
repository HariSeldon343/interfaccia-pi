(function pubblicaAvvio(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiStartupCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaAvvioCore() {
  "use strict";

  function sessioniUtilizzabili(sessioni) {
    return [...(sessioni || [])].filter((sessione) =>
      sessione?.attiva && sessione.avvioCompletato !== false);
  }

  async function assicuraSessioneIniziale({
    elencaSessioni,
    aggiornaSnapshot,
    avviaSessione,
  }) {
    if (
      typeof elencaSessioni !== "function"
      || typeof aggiornaSnapshot !== "function"
      || typeof avviaSessione !== "function"
    ) {
      throw new TypeError("Il coordinatore di avvio richiede callback valide");
    }

    let attive = sessioniUtilizzabili(elencaSessioni());
    if (attive.length) return { sessione: attive.at(-1), creata: false };

    // Prima di creare rileggiamo il ponte: una POST precedente potrebbe avere
    // avuto successo pur perdendo la risposta HTTP. In quel caso riusiamo la
    // sessione autorevole e non ne duplichiamo una seconda.
    await aggiornaSnapshot();
    attive = sessioniUtilizzabili(elencaSessioni());
    if (attive.length) return { sessione: attive.at(-1), creata: false };

    const sessione = await avviaSessione();
    if (!sessione?.attiva || sessione.avvioCompletato === false) {
      throw new Error("Il ponte non ha creato una conversazione iniziale utilizzabile");
    }
    return { sessione, creata: true };
  }

  return {
    assicuraSessioneIniziale,
    sessioniUtilizzabili,
  };
});
