(function pubblicaPaletteComandi(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiPaletteCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaPaletteCore() {
  "use strict";

  const FONTI_NOTE = new Set(["builtin", "skill", "prompt", "extension"]);
  const DISPONIBILITA_NOTE = new Set(["gui", "terminal", "unavailable"]);
  const ORIGINI_DA_VERIFICARE_MANUALMENTE = new Set([
    "builtin",
    "extension",
    "prompt",
    "shell",
    "skill",
  ]);

  function testoRicerca(valore) {
    return String(valore || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("it");
  }

  function chiaveComando(comando) {
    return `${String(comando?.source || "unknown")}\u0000${String(comando?.name || "")}`;
  }

  function normalizzaCatalogoComandi(comandi) {
    if (!Array.isArray(comandi)) return [];
    const viste = new Set();
    const risultato = [];
    for (const originale of comandi) {
      if (!originale || typeof originale !== "object") continue;
      const name = typeof originale.name === "string" ? originale.name.trim() : "";
      if (!name || name.length > 200 || /\s/.test(name)) continue;
      const source = FONTI_NOTE.has(originale.source) ? originale.source : "unknown";
      const chiave = `${source}\u0000${name}`;
      if (viste.has(chiave)) continue;
      viste.add(chiave);
      const disponibilitaPredefinita = source === "extension" ? "terminal" : "gui";
      const disponibilitaOggetto = originale.availability && typeof originale.availability === "object"
        ? originale.availability
        : null;
      const superficie = String(disponibilitaOggetto?.surface || "").toLowerCase();
      const stato = String(disponibilitaOggetto?.state || "").toLowerCase();
      const availability = DISPONIBILITA_NOTE.has(originale.availability)
        ? originale.availability
        : superficie === "terminal" || stato === "terminal"
          ? "terminal"
          : ["unavailable", "disabled"].includes(stato)
            ? "unavailable"
            : superficie === "gui" || ["available", "enabled"].includes(stato)
              ? "gui"
              : disponibilitaPredefinita;
      const dispatch = originale.dispatch && typeof originale.dispatch === "object"
        ? {
            kind: typeof originale.dispatch.kind === "string" ? originale.dispatch.kind : null,
            action: typeof originale.dispatch.action === "string" ? originale.dispatch.action : null,
            rpcType: typeof originale.dispatch.rpcType === "string" ? originale.dispatch.rpcType : null,
            rpcTypes: Array.isArray(originale.dispatch.rpcTypes)
              ? originale.dispatch.rpcTypes.filter((voce) => typeof voce === "string").slice(0, 20)
              : null,
          }
        : null;
      risultato.push({
        name,
        description: typeof originale.description === "string" ? originale.description.trim() : "",
        argumentHint: typeof originale.argumentHint === "string" ? originale.argumentHint.trim() : "",
        source,
        availability,
        availabilityReason: typeof disponibilitaOggetto?.reason === "string"
          ? disponibilitaOggetto.reason
          : "",
        dispatch,
        sourceInfo: originale.sourceInfo && typeof originale.sourceInfo === "object"
          ? { ...originale.sourceInfo }
          : null,
      });
    }
    return risultato;
  }

  function nomeSenzaPrefisso(comando) {
    return String(comando?.name || "").replace(/^skill:/, "");
  }

  function punteggioComando(comando, query) {
    const filtro = testoRicerca(query).trim();
    if (!filtro) return 10;
    const nome = testoRicerca(comando.name);
    const leggibile = testoRicerca(nomeSenzaPrefisso(comando));
    const descrizione = testoRicerca(comando.description);
    const fonte = testoRicerca(comando.source);
    if (nome === filtro || leggibile === filtro) return 0;
    if (leggibile.startsWith(filtro)) return 1;
    if (nome.startsWith(filtro)) return 2;
    if (nome.split(/[-_:]/).some((parte) => parte.startsWith(filtro))) return 3;
    if (leggibile.includes(filtro) || nome.includes(filtro)) return 4;
    if (descrizione.includes(filtro)) return 5;
    if (fonte.includes(filtro)) return 6;
    return null;
  }

  function filtraCatalogoComandi(comandi, query) {
    return normalizzaCatalogoComandi(comandi)
      .map((comando, indice) => ({ comando, indice, punti: punteggioComando(comando, query) }))
      .filter((voce) => voce.punti != null)
      .sort((a, b) => a.punti - b.punti || a.indice - b.indice)
      .map((voce) => voce.comando);
  }

  function analizzaRichiamoComando(valore, inizioSelezione, fineSelezione = inizioSelezione) {
    const testo = String(valore || "");
    const inizio = Number(inizioSelezione);
    const fine = Number(fineSelezione);
    if (!Number.isInteger(inizio) || !Number.isInteger(fine) || inizio !== fine || inizio < 1 || inizio > testo.length) {
      return null;
    }
    const prima = testo.slice(0, inizio);
    const corrispondenza = prima.match(/^\/([^\s/]*)$/);
    if (!corrispondenza) return null;
    const codaToken = testo.slice(inizio).match(/^[^\s]*/)?.[0] || "";
    return {
      query: corrispondenza[1],
      start: 0,
      end: inizio + codaToken.length,
    };
  }

  function completaRichiamoComando(valore, richiamo, comando) {
    if (!richiamo || !comando?.name) return null;
    const testo = String(valore || "");
    let coda = testo.slice(richiamo.end);
    if (/^[\t ]+/.test(coda)) coda = coda.replace(/^[\t ]+/, "");
    const prefisso = testo.slice(0, richiamo.start);
    const inserimento = `/${comando.name} `;
    return {
      value: prefisso + inserimento + coda,
      caret: prefisso.length + inserimento.length,
    };
  }

  function analizzaComandoDaInviare(valore) {
    const testo = String(valore || "").trim();
    const corrispondenza = testo.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!corrispondenza) return null;
    return {
      name: corrispondenza[1],
      arguments: corrispondenza[2] || "",
    };
  }

  function operationIdDaLineage(lineageId, tipo = "op") {
    const lineage = String(lineageId || "").trim();
    if (!lineage) return null;
    const categoria = String(tipo || "op").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 20) || "op";
    const uuid = lineage.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
    if (uuid) return `gui-${categoria}-${uuid.toLowerCase()}`;
    // Le bozze migrate possono avere lineage legacy. Un hash deterministico
    // mantiene lo stesso operationId fra finestre senza legarlo al solo testo.
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let indice = 0; indice < lineage.length; indice += 1) {
      const codice = lineage.charCodeAt(indice);
      a = Math.imul(a ^ codice, 0x01000193) >>> 0;
      b = Math.imul(b ^ (codice + indice), 0x85ebca6b) >>> 0;
    }
    return `gui-${categoria}-${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
  }

  function creaRegistroComandoBuiltin({
    id,
    testo,
    lineageId,
    nome,
    argomenti = "",
    operationId = null,
    creatoIl = Date.now(),
  } = {}) {
    const identificatore = String(id || "").trim();
    const fotografia = String(testo || "");
    const comando = String(nome || "").trim();
    const lineage = String(lineageId || "").trim();
    if (!identificatore || !fotografia.trim() || !comando || !lineage) return null;
    return {
      id: identificatore,
      testo: fotografia,
      creatoIl: Number(creatoIl),
      lineageId: lineage,
      origine: "builtin",
      operationId: String(operationId || operationIdDaLineage(lineage, "builtin")),
      comandoBuiltin: comando,
      argomentiBuiltin: String(argomenti || ""),
      statoComando: "in_attesa",
      erroreComando: "",
      allegati: [],
    };
  }

  function creaRegistroShell({
    id,
    testo,
    lineageId,
    comando,
    excludeFromContext = false,
    operationId = null,
    creatoIl = Date.now(),
  } = {}) {
    const identificatore = String(id || "").trim();
    const fotografia = String(testo || "");
    const comandoShell = String(comando || "").trim();
    const lineage = String(lineageId || "").trim();
    if (!identificatore || !/^!!?\S?[\s\S]*$/.test(fotografia.trim()) || !comandoShell || !lineage) {
      return null;
    }
    return {
      id: identificatore,
      testo: fotografia,
      creatoIl: Number(creatoIl),
      lineageId: lineage,
      origine: "shell",
      operationId: String(operationId || operationIdDaLineage(lineage, "shell")),
      comandoShell,
      excludeFromContext: Boolean(excludeFromContext),
      statoComando: "in_attesa",
      erroreComando: "",
      allegati: [],
    };
  }

  function invioRichiedeVerificaManuale(invio) {
    return ORIGINI_DA_VERIFICARE_MANUALMENTE.has(String(invio?.origine || ""));
  }

  function inviiVisibiliDaVerificare(invii, nascosti = []) {
    const idsNascosti = nascosti instanceof Set ? nascosti : new Set(nascosti || []);
    return (Array.isArray(invii) ? invii : []).filter((invio) => (
      invio?.id && !idsNascosti.has(invio.id)
    ));
  }

  function trovaInvioPendenteDuplicato(invii, {
    lineageId,
    testo,
    firmeAllegati = [],
  } = {}) {
    const lineage = String(lineageId || "").trim();
    if (!lineage) return null;
    const fotografia = String(testo || "").trim();
    const firme = (Array.isArray(firmeAllegati) ? firmeAllegati : [])
      .map((firma) => String(firma || ""));
    return (Array.isArray(invii) ? invii : []).find((invio) => {
      if (String(invio?.lineageId || "").trim() !== lineage) return false;
      if (String(invio?.testo || "").trim() !== fotografia) return false;
      const firmeInvio = (Array.isArray(invio?.allegati) ? invio.allegati : [])
        .map((allegato) => String(allegato?.firma || ""));
      return firmeInvio.length === firme.length
        && firmeInvio.every((firma, indice) => firma === firme[indice]);
    }) || null;
  }

  function transizioneEsitoOperazione(invio, esito) {
    if (!["builtin", "shell"].includes(invio?.origine)) return null;
    if (esito?.success === true && !esito?.guiObsoleta) {
      return Object.freeze({ azione: "risolvi", modifiche: null });
    }
    const esplicitamenteFallito = esito?.success === false
      && !esito?.esitoIgnoto
      && !esito?.guiObsoleta;
    const statoComando = esplicitamenteFallito ? "errore" : "esito_ignoto";
    const ripiego = esplicitamenteFallito
      ? "Pi ha rifiutato il comando. Verifica prima di ripeterlo."
      : "La conferma di Pi non e ancora verificabile. Non reinviare il comando.";
    return Object.freeze({
      azione: "conserva",
      modifiche: Object.freeze({
        statoComando,
        erroreComando: String(esito?.error || esito?.message || ripiego),
      }),
    });
  }

  const transizioneEsitoComandoBuiltin = transizioneEsitoOperazione;

  function erroreCatalogoComandiObsoleto(errore) {
    if (Number(errore?.statusHttp) !== 409) return false;
    const codice = String(errore?.code || errore?.codice || "").toUpperCase();
    if (["CATALOG_REVISION_STALE", "CATALOG_STALE", "STALE_CATALOG"].includes(codice)) {
      return true;
    }
    return /catalogo(?:\s+dei)?\s+comandi[\s\S]{0,80}(?:cambiat|obsolet|revisione)/i.test(
      String(errore?.message || ""),
    );
  }

  return Object.freeze({
    analizzaComandoDaInviare,
    analizzaRichiamoComando,
    chiaveComando,
    completaRichiamoComando,
    creaRegistroComandoBuiltin,
    creaRegistroShell,
    erroreCatalogoComandiObsoleto,
    filtraCatalogoComandi,
    invioRichiedeVerificaManuale,
    inviiVisibiliDaVerificare,
    normalizzaCatalogoComandi,
    operationIdDaLineage,
    trovaInvioPendenteDuplicato,
    transizioneEsitoComandoBuiltin,
    transizioneEsitoOperazione,
  });
});
