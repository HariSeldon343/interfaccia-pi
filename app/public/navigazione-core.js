(function pubblicaNavigazione(radice, fabbrica) {
  if (typeof module === "object" && module.exports) {
    module.exports = fabbrica(require("./view-core.js"));
  } else radice.PiGuiNavigazioneCore = fabbrica(radice.PiGuiViewCore);
})(typeof globalThis !== "undefined" ? globalThis : this, function creaNavigazioneCore(VISTA_CORE) {
  "use strict";

  const testo = (valore) => typeof valore === "string" ? valore.trim() : "";
  const elenco = (valore) => valore instanceof Map ? [...valore.values()]
    : Array.isArray(valore) ? valore : [];
  const confronto = (a, b) => a.localeCompare(b, "it", { numeric: true, sensitivity: "base" })
    || (a < b ? -1 : a > b ? 1 : 0);

  // Normalizza solo la forma, senza risolvere cartelle o leggere il disco.
  // Windows ignora il caso; un percorso POSIX conserva invece la distinzione.
  function chiavePercorso(valore) {
    const percorso = testo(valore).replace(/\\/g, "/").replace(/\/+$/u, "");
    if (!percorso) return testo(valore).startsWith("/") ? "/" : "";
    return /^(?:[a-z]:|\/\/)/iu.test(percorso) ? percorso.toLowerCase() : percorso;
  }

  function cartellaConversazione(sessione) {
    if (sessione?.senzaCartella) return null;
    return testo(sessione?.cartella) || testo(sessione?.cwd) || null;
  }

  function riferimentoConsiglio(sessione, consiglio) {
    const riferimento = sessione?.consiglio || consiglio?.ruoliPerSessione?.[sessione?.id];
    const lavoroId = testo(riferimento?.lavoroId);
    if (!lavoroId) return { lavoroId: null, ruoloId: null, lavoro: null, ruolo: null };
    const ruoloId = testo(riferimento.roleId) || null;
    const lavoro = consiglio?.lavori?.[lavoroId] || null;
    const ruoli = lavoro?.ruoli;
    const ruolo = ruoloId ? (Array.isArray(ruoli)
      ? ruoli.find((voce) => voce.roleId === ruoloId)
      : ruoli?.[ruoloId]) || riferimento : null;
    return { lavoroId, ruoloId, lavoro, ruolo };
  }

  function statoConversazione(sessione, { aperta = true, consiglio = null } = {}) {
    const { lavoroId, ruoloId, lavoro, ruolo } = riferimentoConsiglio(sessione, consiglio);
    const statoConsiglio = ruoloId ? ruolo?.stato : lavoro?.stato || sessione?.consiglio?.stato;
    const attesa = aperta && (sessione?.avvioCompletato === false
      || sessione?.sincronizzazione === true || sessione?.invioInCorso === true
      || ["preparazione", "attesa_provider"].includes(statoConsiglio));
    const inCorso = aperta && (Boolean(sessione?.inEsecuzione)
      || Boolean(sessione?.compattazioneInCorso) || Boolean(sessione?.compattazionePreventivaInCorso)
      || ["in_corso", "raccolta", "fusione", "verifica"].includes(statoConsiglio));
    // Le etichette della navigazione riassumono il ciclo della conversazione;
    // lo stato del lavoro e gli avvisi sono sempre quelli del nucleo esistente.
    const attivita = VISTA_CORE.statoAttivita({
      tentativiFalliti: sessione?.tentativiFalliti || 0,
      inCorso: inCorso || attesa,
      finalizzato: !inCorso && !attesa,
    });
    const chiusa = !aperta || (!lavoroId && sessione?.attiva === false);
    return {
      testo: chiusa ? "chiusa" : attesa ? "in attesa" : inCorso ? "al lavoro" : "aperta",
      livello: chiusa ? "chiusa" : sessione?.errore ? "errore" : attesa ? "attesa"
        : inCorso ? attivita.livello : "ok",
      attivita,
    };
  }

  function ordineRuolo(riga) {
    if (!riga.ruoloId) return -1;
    const ruolo = riga.ruolo;
    if (ruolo?.tipo === "scrittore" || ruolo?.ruolo === "scrittore"
      || riga.ruoloId === "scrittore") return Number.MAX_SAFE_INTEGER;
    const ordine = Number(ruolo?.ordine);
    if (Number.isInteger(ordine) && ordine > 0) return ordine;
    const numero = /consigliere[-\s]+(\d+)/iu.exec(riga.ruoloId)
      || /consigliere\s+(\d+)/iu.exec(riga.titolo);
    return numero ? Number(numero[1]) : Number.MAX_SAFE_INTEGER - 1;
  }

  function nomeCartella(cartella) {
    return cartella?.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1) || cartella || "Senza cartella";
  }

  function creaRiga(sessione, aperta, indice, consiglio) {
    const riferimento = riferimentoConsiglio(sessione, consiglio);
    const percorso = testo(sessione.fileSessione) || testo(sessione.percorso);
    const cartella = cartellaConversazione(sessione);
    return {
      tipo: "conversazione",
      id: aperta ? sessione.id : "salvata:" + (chiavePercorso(percorso) || testo(sessione.id)),
      sessione,
      aperta,
      salvata: !aperta,
      percorso,
      cartella,
      titolo: testo(sessione.nomeSessione) || testo(sessione.nome) || testo(sessione.primoMessaggio)
        || (riferimento.lavoroId && !riferimento.ruoloId ? "Risultato" : "Nuova conversazione"),
      stato: statoConversazione(sessione, { aperta, consiglio }),
      ...riferimento,
      indice,
    };
  }

  function corrisponde(riga, ricerca) {
    return [riga.titolo, riga.cartella, riga.sessione.primoMessaggio]
      .some((valore) => testo(valore).toLocaleLowerCase("it").includes(ricerca));
  }

  // Le aperte conservano l'ordine dello snapshot e i riferimenti ai loro dati.
  // Le salvate seguono per data decrescente, con percorso a parità di data.
  // Uno stesso JSONL già aperto non genera una seconda riga di archivio; due
  // processi aperti distinti non vengono mai fusi solo perché leggono quel file.
  function raggruppaConversazioni({ aperte = [], salvate = [], ricerca = "", consiglio = null } = {}) {
    const righe = [];
    const idAperti = new Set();
    const fileAperti = new Set();
    for (const sessione of elenco(aperte)) {
      if (!sessione || !testo(sessione.id) || idAperti.has(sessione.id)) continue;
      idAperti.add(sessione.id);
      const riga = creaRiga(sessione, true, righe.length, consiglio);
      if (riga.percorso) fileAperti.add(chiavePercorso(riga.percorso));
      righe.push(riga);
    }
    const fileSalvati = new Set();
    const ordinate = elenco(salvate).filter(Boolean).slice().sort((a, b) =>
      confronto(testo(b.modificataIl), testo(a.modificataIl))
      || confronto(testo(a.percorso), testo(b.percorso)));
    for (const sessione of ordinate) {
      const file = chiavePercorso(sessione.percorso || sessione.fileSessione);
      const chiave = file || "id:" + testo(sessione.id);
      if ((!file && !testo(sessione.id)) || fileAperti.has(file)
        || idAperti.has(sessione.id) || fileSalvati.has(chiave)) continue;
      fileSalvati.add(chiave);
      righe.push(creaRiga(sessione, false, righe.length, consiglio));
    }

    // Il lavoro è l'unità di raggruppamento: le righe dei ruoli non sono
    // intercalate alle conversazioni né dipendono dall'ordine dello snapshot.
    const lavori = new Map();
    const voci = [];
    for (const riga of righe) {
      if (!riga.lavoroId) { voci.push(riga); continue; }
      let lavoro = lavori.get(riga.lavoroId);
      if (!lavoro) {
        lavoro = {
          tipo: "consiglio", id: "lavoro:" + riga.lavoroId, lavoroId: riga.lavoroId,
          titolo: testo(riga.lavoro?.preimpostazione?.nome)
            || testo(riga.sessione.consiglio?.preimpostazione?.nome) || "Lavoro degli agenti",
          cartella: riga.cartella || testo(riga.lavoro?.workspace) || null,
          indice: riga.indice, righe: [],
        };
        lavori.set(riga.lavoroId, lavoro);
        voci.push(lavoro);
      }
      lavoro.righe.push(riga);
      if (!riga.ruoloId) {
        lavoro.cartella = riga.cartella;
        const preset = testo(riga.sessione.consiglio?.preimpostazione?.nome);
        if (preset) lavoro.titolo = preset;
      }
    }
    for (const lavoro of lavori.values()) {
      lavoro.righe.sort((a, b) => ordineRuolo(a) - ordineRuolo(b)
        || confronto(a.ruoloId || "", b.ruoloId || "") || a.indice - b.indice);
    }

    const filtro = testo(ricerca).toLocaleLowerCase("it");
    const cartelle = new Map();
    for (const voce of voci) {
      if (filtro && !(voce.tipo === "consiglio"
        ? voce.titolo.toLocaleLowerCase("it").includes(filtro) || voce.righe.some((riga) => corrisponde(riga, filtro))
        : corrisponde(voce, filtro))) continue;
      const chiave = chiavePercorso(voce.cartella);
      if (!cartelle.has(chiave)) cartelle.set(chiave, {
        id: chiave ? "cartella:" + chiave : "senza-cartella",
        nome: nomeCartella(voce.cartella), cartella: voce.cartella,
        senzaCartella: !chiave, percorsoVisibile: null, voci: [],
      });
      cartelle.get(chiave).voci.push(voce);
    }
    const gruppi = [...cartelle.values()].sort((a, b) => Number(a.senzaCartella) - Number(b.senzaCartella)
      || confronto(a.nome, b.nome) || confronto(a.cartella || "", b.cartella || ""));
    const nomi = new Map();
    for (const gruppo of gruppi) {
      const nome = gruppo.nome.toLocaleLowerCase("it");
      nomi.set(nome, (nomi.get(nome) || 0) + 1);
    }
    for (const gruppo of gruppi) {
      if (!gruppo.senzaCartella && nomi.get(gruppo.nome.toLocaleLowerCase("it")) > 1) {
        gruppo.percorsoVisibile = gruppo.cartella;
      }
    }
    return gruppi;
  }

  return { chiavePercorso, cartellaConversazione, statoConversazione, raggruppaConversazioni };
});
