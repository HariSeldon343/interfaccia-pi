(function pubblicaConsiglio(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiConsiglioCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaConsiglioCore() {
  "use strict";

  // Stato del consiglio nel client. La fonte resta il ponte: qui si rispecchia
  // quello che arriva dallo snapshot, dagli eventi e dalla lettura di stato,
  // senza inventare nulla. Tutte le funzioni sono pure, così si provano senza
  // browser. Nessun identificativo di modello è scritto qui: provider, modello
  // e nome leggibile arrivano sempre dal ponte.

  const PREFISSO_SCHEDA_RISULTATO = "consiglio:";
  const NOME_SCHEDA_RISULTATO = "Risultato";

  const STATI_LAVORO_IN_CORSO = ["preparazione", "raccolta", "fusione", "verifica"];

  const STATI_RUOLO = {
    preparazione: { testo: "In preparazione", livello: "attesa" },
    in_corso: { testo: "Sta rispondendo", livello: "lavoro" },
    attesa_provider: { testo: "Attesa del provider", livello: "attesa" },
    completato: { testo: "Completato", livello: "ok" },
    errore: { testo: "Errore", livello: "errore" },
    scaduto: { testo: "Tempo scaduto", livello: "errore" },
    annullato: { testo: "Annullato", livello: "errore" },
  };

  const STATI_LAVORO = {
    preparazione: { testo: "In preparazione", livello: "attesa" },
    raccolta: { testo: "Raccolta dei contributi", livello: "lavoro" },
    fusione: { testo: "Bozza in composizione", livello: "lavoro" },
    verifica: { testo: "Controllo automatico in corso", livello: "lavoro" },
    bozza_valida: { testo: "Bozza pronta", livello: "ok" },
    bozza_bloccata: { testo: "Bozza bloccata", livello: "errore" },
    approvato: { testo: "Approvato", livello: "ok" },
    annullato: { testo: "Annullato", livello: "errore" },
    interrotto: { testo: "Interrotto", livello: "errore" },
  };

  const ETICHETTE_AZIONE = {
    approva: "Approva",
    rifai: "Rifai",
    annulla: "Annulla",
  };

  function numero(valore) {
    const convertito = Number(valore);
    return Number.isFinite(convertito) ? convertito : null;
  }

  function testo(valore) {
    return typeof valore === "string" ? valore : "";
  }

  function elenco(valore) {
    return Array.isArray(valore) ? valore : [];
  }

  function senzaAccenti(valore) {
    return String(valore ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  }

  function statoIniziale() {
    return { lavori: {}, ruoliPerSessione: {} };
  }

  // Una voce di snapshot è la scheda "Risultato" quando porta il campo
  // consiglio senza roleId: le sessioni dei ruoli lo portano con il roleId.
  function voceSchedaRisultato(voce) {
    return Boolean(voce?.consiglio?.lavoroId) && !voce.consiglio.roleId;
  }

  function voceSessioneDiRuolo(voce) {
    return Boolean(voce?.consiglio?.lavoroId) && Boolean(voce.consiglio.roleId);
  }

  function lavoroNuovo(lavoroId) {
    return {
      lavoroId,
      schedaId: PREFISSO_SCHEDA_RISULTATO + lavoroId,
      seq: -1,
      revisione: 0,
      stato: "preparazione",
      tipo: null,
      preimpostazione: null,
      motivo: null,
      workspace: null,
      sourceSessionId: null,
      controllo: null,
      azioni: { approva: false, rifai: false, annulla: false },
      ruoli: {},
      contributi: [],
      risultato: null,
      problemi: [],
      storico: [],
      dettaglioDaLeggere: true,
    };
  }

  function conLavoro(stato, lavoroId, cambia) {
    const corrente = stato.lavori[lavoroId] || lavoroNuovo(lavoroId);
    const aggiornato = cambia({ ...corrente, ruoli: { ...corrente.ruoli } });
    return {
      ...stato,
      lavori: { ...stato.lavori, [lavoroId]: aggiornato },
    };
  }

  // Regola unica di ordinamento: una revisione più vecchia non tocca mai la
  // vista, e dentro la stessa revisione conta soltanto un seq più alto di
  // quello già visto. Vale per gli eventi e per lo snapshot.
  function sorpassato(lavoro, revisione, seq) {
    const rev = numero(revisione);
    const numeroSeq = numero(seq);
    if (rev !== null && rev < lavoro.revisione) return true;
    if (numeroSeq !== null && numeroSeq <= lavoro.seq) return true;
    return false;
  }

  function metadatiPreimpostazione(voce) {
    return voce ? { id: voce.id, nome: voce.nome, versione: voce.versione } : null;
  }

  function applicaSnapshotConsiglio(stato, sessioni, { sostituisci = false } = {}) {
    let nuovo = { ...stato, lavori: { ...stato.lavori }, ruoliPerSessione: {} };
    const presenti = new Set();
    for (const voce of elenco(sessioni)) {
      if (voceSessioneDiRuolo(voce)) {
        nuovo.ruoliPerSessione[voce.id] = {
          lavoroId: voce.consiglio.lavoroId,
          roleId: voce.consiglio.roleId,
          ruolo: voce.consiglio.ruolo || null,
        };
        continue;
      }
      if (!voceSchedaRisultato(voce)) continue;
      const dati = voce.consiglio;
      presenti.add(dati.lavoroId);
      nuovo = conLavoro(nuovo, dati.lavoroId, (lavoro) => {
        if (sorpassato(lavoro, dati.revisione, dati.seq)) return lavoro;
        const statoNuovo = testo(dati.stato) || lavoro.stato;
        return {
          ...lavoro,
          seq: numero(dati.seq) ?? lavoro.seq,
          revisione: numero(dati.revisione) ?? lavoro.revisione,
          stato: statoNuovo,
          tipo: dati.tipo ?? lavoro.tipo,
          preimpostazione: dati.preimpostazione === undefined
            ? lavoro.preimpostazione : metadatiPreimpostazione(dati.preimpostazione),
          motivo: dati.motivo ?? null,
          controllo: dati.controllo ?? lavoro.controllo,
          // Proposta di ripristino di un lavoro interrotto: la calcola il ponte
          // alla riapertura, il client la mostra e non la ricalcola.
          ripristino: dati.ripristino ?? lavoro.ripristino ?? null,
          azioni: dati.azioni || lavoro.azioni,
          workspace: voce.cartella ?? lavoro.workspace,
          dettaglioDaLeggere: lavoro.dettaglioDaLeggere || statoNuovo !== lavoro.stato,
        };
      });
    }
    if (sostituisci) {
      for (const lavoroId of Object.keys(nuovo.lavori)) {
        if (!presenti.has(lavoroId)) delete nuovo.lavori[lavoroId];
      }
    }
    return nuovo;
  }

  function applicaEventoRuolo(lavoro, evento) {
    const roleId = testo(evento.roleId);
    if (!roleId) return lavoro;
    const precedente = lavoro.ruoli[roleId] || { roleId };
    const ruolo = {
      ...precedente,
      roleId,
      guiSessionId: evento.guiSessionId ?? precedente.guiSessionId ?? null,
      stato: testo(evento.stato) || precedente.stato || "preparazione",
      tentativo: numero(evento.tentativo) ?? precedente.tentativo ?? 0,
      attesaFinoA: evento.attesaFinoA ?? null,
      errore: evento.errore ?? null,
    };
    // Attesa del provider e ripetizione del consiglio sono due cose diverse:
    // la prima è un ritentativo interno di pi dentro lo stesso turno, la
    // seconda è un secondo prompt inviato dal ponte. Restano separate.
    if (evento.attesaProvider) {
      ruolo.attesaProvider = {
        tentativo: numero(evento.attesaProvider.attempt),
        massimo: numero(evento.attesaProvider.maxAttempts),
      };
    }
    if (evento.ripetizione) {
      ruolo.ripetizione = {
        numero: numero(evento.ripetizione.numero) ?? 1,
        su: numero(evento.ripetizione.su) ?? 1,
      };
    }
    if (ruolo.stato === "completato") ruolo.attesaProvider = null;
    return { ...lavoro, ruoli: { ...lavoro.ruoli, [roleId]: ruolo } };
  }

  function applicaEventoConsiglio(stato, evento) {
    const tipo = testo(evento?.type);
    if (!tipo.startsWith("gui_consiglio_")) return { stato, applicato: false, lavoroId: null };
    const lavoroId = testo(evento.lavoroId);
    if (!lavoroId) return { stato, applicato: false, lavoroId: null };
    const corrente = stato.lavori[lavoroId];
    if (corrente && sorpassato(corrente, evento.revisione, evento.seq)) {
      return { stato, applicato: false, lavoroId };
    }
    const nuovo = conLavoro(stato, lavoroId, (lavoro) => {
      const revisione = numero(evento.revisione) ?? lavoro.revisione;
      const base = {
        ...lavoro,
        seq: numero(evento.seq) ?? lavoro.seq,
        revisione,
      };
      if (tipo === "gui_consiglio_stato") {
        const statoNuovo = testo(evento.stato) || base.stato;
        return {
          ...base,
          stato: statoNuovo,
          motivo: evento.motivo ?? null,
          azioni: evento.azioni || base.azioni,
          dettaglioDaLeggere: true,
        };
      }
      if (tipo === "gui_consiglio_ruolo") return applicaEventoRuolo(base, evento);
      if (tipo === "gui_consiglio_controllo") {
        return {
          ...base,
          controllo: {
            tipo: testo(evento.tipo) || null,
            esito: testo(evento.esito) || null,
            motivi: elenco(evento.motivi),
          },
          dettaglioDaLeggere: true,
        };
      }
      return base;
    });
    return { stato: nuovo, applicato: true, lavoroId };
  }

  function ruoloDaDettaglio(precedente, voce) {
    return {
      ...precedente,
      roleId: voce.roleId,
      tipo: voce.tipo ?? precedente.tipo ?? null,
      ordine: numero(voce.ordine) ?? precedente.ordine ?? null,
      provider: voce.provider ?? precedente.provider ?? null,
      modello: voce.modello ?? precedente.modello ?? null,
      nomeModello: voce.nomeModello ?? precedente.nomeModello ?? null,
      guiSessionId: voce.guiSessionId ?? precedente.guiSessionId ?? null,
    };
  }

  // La lettura di /api/consiglio/stato può arrivare dopo un evento più recente,
  // o addirittura dopo che Rifai ha aperto la revisione seguente. Due regole.
  // Una revisione già superata non tocca niente, nemmeno il testo fuso: Rifai
  // alza la revisione senza alzare seq, quindi il solo confronto su seq
  // lascerebbe rientrare la bozza vecchia con le sue azioni. Dentro la stessa
  // revisione conta seq: la lettura porta anche il testo del risultato, che
  // nessun evento trasporta, quindi a parità di seq va applicata lo stesso.
  function applicaDettaglioConsiglio(stato, risposta) {
    const lavoroId = testo(risposta?.lavoro?.lavoroId);
    if (!lavoroId) return { stato, applicato: false, lavoroId: null };
    const seq = numero(risposta.seq);
    const revisione = numero(risposta.lavoro.revisione);
    let scartato = false;
    const nuovo = conLavoro(stato, lavoroId, (lavoro) => {
      if (revisione !== null && revisione < lavoro.revisione) {
        // Lettura di una revisione superata: si scarta intera e il lavoro
        // resta da leggere, così chi legge riprova invece di fermarsi qui.
        scartato = true;
        return lavoro;
      }
      const ruoli = { ...lavoro.ruoli };
      const aggiornabile = seq === null || seq >= lavoro.seq;
      for (const voce of elenco(risposta.ruoli)) {
        if (!voce?.roleId) continue;
        const base = ruoloDaDettaglio(ruoli[voce.roleId] || { roleId: voce.roleId }, voce);
        ruoli[voce.roleId] = aggiornabile
          ? {
            ...base,
            stato: testo(voce.stato) || base.stato || "preparazione",
            tentativo: numero(voce.tentativo) ?? base.tentativo ?? 0,
            attesaFinoA: voce.attesaFinoA ?? base.attesaFinoA ?? null,
            errore: voce.errore ?? base.errore ?? null,
          }
          : base;
      }
      // Fuori dalla finestra di aggiornamento restano solo i dati anagrafici,
      // che non cambiano dentro una revisione. Contributi, risultato e
      // proposta di ripristino appartengono allo stato e seguono seq.
      const comune = {
        ...lavoro,
        ruoli,
        workspace: risposta.lavoro.workspace ?? lavoro.workspace,
        sourceSessionId: risposta.lavoro.sourceSessionId ?? lavoro.sourceSessionId,
        tipo: risposta.lavoro.tipo ?? lavoro.tipo,
        preimpostazione: risposta.lavoro.preimpostazione === undefined
          ? lavoro.preimpostazione : metadatiPreimpostazione(risposta.lavoro.preimpostazione),
        piano: risposta.lavoro.piano ?? lavoro.piano ?? null,
        git: risposta.lavoro.git ?? lavoro.git ?? null,
        consenso: risposta.lavoro.consenso ?? lavoro.consenso ?? null,
      };
      if (!aggiornabile) return comune;
      return {
        ...comune,
        contributi: elenco(risposta.contributi),
        risultato: risposta.risultato || null,
        ripristino: risposta.lavoro.ripristino ?? lavoro.ripristino ?? null,
        problemi: elenco(risposta.lavoro.problemi),
        dettaglioDaLeggere: false,
        seq: seq ?? lavoro.seq,
        revisione: revisione ?? lavoro.revisione,
        stato: testo(risposta.lavoro.stato) || lavoro.stato,
        motivo: risposta.lavoro.motivo ?? null,
        controllo: risposta.controllo || null,
        azioni: risposta.azioni || lavoro.azioni,
      };
    });
    return { stato: scartato ? stato : nuovo, applicato: !scartato, lavoroId };
  }

  // Rifai apre una revisione nuova: quella precedente non si cancella, resta
  // nello storico con il suo esito, come il ponte fa con le proprie revisioni.
  function registraNuovaRevisione(stato, { lavoroId, revisione } = {}) {
    const corrente = stato.lavori[lavoroId];
    if (!corrente) return stato;
    const successiva = numero(revisione) ?? corrente.revisione + 1;
    if (successiva <= corrente.revisione) return stato;
    return conLavoro(stato, lavoroId, (lavoro) => ({
      ...lavoro,
      storico: [
        ...lavoro.storico,
        {
          revisione: lavoro.revisione,
          stato: lavoro.stato,
          motivo: lavoro.motivo,
          risultato: lavoro.risultato,
          controllo: lavoro.controllo,
        },
      ],
      revisione: successiva,
      stato: "preparazione",
      motivo: null,
      contributi: [],
      risultato: null,
      controllo: null,
      ruoli: {},
      // Le azioni seguono lo stato, non la revisione precedente: una revisione
      // appena aperta non ha ancora una bozza, quindi Approva resta spento
      // finché il ponte non dice il contrario. È lo stesso insieme che il
      // ponte calcola per "preparazione".
      azioni: { approva: false, rifai: false, annulla: true },
      dettaglioDaLeggere: true,
    }));
  }

  function lavoroDiScheda(stato, id) {
    const schedaId = testo(id);
    if (!schedaId.startsWith(PREFISSO_SCHEDA_RISULTATO)) return null;
    return stato.lavori[schedaId.slice(PREFISSO_SCHEDA_RISULTATO.length)] || null;
  }

  function ruoloDiSessione(stato, guiSessionId) {
    const riferimento = stato.ruoliPerSessione[guiSessionId];
    if (!riferimento) return null;
    const lavoro = stato.lavori[riferimento.lavoroId];
    if (!lavoro) return { lavoro: null, ruolo: { roleId: riferimento.roleId, tipo: riferimento.ruolo } };
    return { lavoro, ruolo: lavoro.ruoli[riferimento.roleId] || { roleId: riferimento.roleId, tipo: riferimento.ruolo } };
  }

  // La scheda "Risultato" non ha un processo dietro: non deve diventare la
  // scheda di ripiego finché esiste una conversazione vera.
  function idRipiego(voci) {
    const elencoVoci = elenco(voci);
    const vere = elencoVoci.filter((voce) => !voce?.schedaRisultato);
    const scelta = (candidate) => candidate.slice().reverse().find((voce) => voce.attiva)?.id
      || candidate.at(-1)?.id
      || null;
    return scelta(vere) || scelta(elencoVoci);
  }

  function invioManualeConsentito(sessione) {
    return !sessione?.consiglio && !sessione?.schedaRisultato;
  }

  function testoStatoRuolo(stato) {
    return STATI_RUOLO[stato]?.testo || "Stato non comunicato";
  }

  function livelloStatoRuolo(stato) {
    return STATI_RUOLO[stato]?.livello || "attesa";
  }

  function testoStatoLavoro(stato) {
    return STATI_LAVORO[stato]?.testo || "Stato non comunicato";
  }

  function livelloStatoLavoro(stato) {
    return STATI_LAVORO[stato]?.livello || "attesa";
  }

  function etichettaRuolo(ruolo) {
    const modello = ruolo?.nomeModello || ruolo?.modello || "modello non indicato";
    if (ruolo?.tipo === "scrittore") return "Scrittore, " + modello;
    return "Consigliere " + (ruolo?.ordine || 1) + ", " + modello;
  }

  function righeRuolo(ruolo) {
    const stato = testo(ruolo?.stato) || "preparazione";
    const righe = [{ chiave: "stato", testo: "Stato: " + testoStatoRuolo(stato) }];
    const inAttesa = ["in_corso", "attesa_provider"].includes(stato);
    if (ruolo?.attesaProvider && inAttesa) {
      const attuale = ruolo.attesaProvider.tentativo;
      const massimo = ruolo.attesaProvider.massimo;
      righe.push({
        chiave: "attesa-provider",
        testo: massimo
          ? "Attesa del provider, tentativo " + attuale + " di " + massimo
          : "Attesa del provider, tentativo " + attuale,
      });
    }
    if (ruolo?.ripetizione && (inAttesa || stato === "errore")) {
      righe.push({
        chiave: "ripetizione",
        testo: "Ripetizione del consiglio " + ruolo.ripetizione.numero + " di " + ruolo.ripetizione.su,
      });
    }
    if (ruolo?.errore && stato === "errore") {
      righe.push({ chiave: "errore", testo: "Motivo: " + ruolo.errore });
    }
    return righe;
  }

  function modelloDelRuolo(lavoro, roleId) {
    const ruolo = lavoro?.ruoli?.[roleId];
    if (ruolo?.nomeModello) return ruolo.nomeModello;
    const contributo = elenco(lavoro?.contributi).find((voce) => voce.roleId === roleId);
    return contributo?.modello || ruolo?.modello || "non indicato";
  }

  function motivoAzione(chiave, lavoro) {
    const stato = lavoro?.stato;
    if (chiave === "approva") {
      if (lavoro?.controllo?.esito === "fail") {
        const motivi = elenco(lavoro.controllo.motivi);
        return "Il controllo automatico non è passato"
          + (motivi.length ? ": " + motivi.join(" ") : ".");
      }
      if (lavoro?.controllo?.esito === "assente") {
        const motivi = elenco(lavoro.controllo.motivi);
        return "Il controllo automatico non è stato eseguito"
          + (motivi.length ? ": " + motivi.join(" ") : ".");
      }
      if (stato === "approvato") return "Il risultato è già stato approvato.";
      if (STATI_LAVORO_IN_CORSO.includes(stato)) return "Il consiglio sta ancora lavorando.";
      return "Approva si attiva quando la bozza è pronta e il controllo è passato.";
    }
    if (chiave === "rifai") {
      if (STATI_LAVORO_IN_CORSO.includes(stato)) return "Annulla prima di rifare: il consiglio sta ancora lavorando.";
      return "Rifai si attiva quando il consiglio ha finito.";
    }
    if (STATI_LAVORO_IN_CORSO.includes(stato)) return null;
    return "Non c'è più niente da annullare.";
  }

  function azioniRisultato(lavoro) {
    return ["approva", "rifai", "annulla"].map((chiave) => {
      const attivo = Boolean(lavoro?.azioni?.[chiave]);
      return {
        chiave,
        etichetta: ETICHETTE_AZIONE[chiave],
        attivo,
        motivo: attivo ? null : motivoAzione(chiave, lavoro),
      };
    });
  }

  function vistaControllo(lavoro) {
    const controllo = lavoro?.controllo;
    if (!controllo) {
      return {
        esito: null,
        tipo: null,
        testo: "Controllo automatico non ancora eseguito.",
        motivi: [],
      };
    }
    const tipo = controllo.tipo === "test" ? "test del progetto" : "autovalutazione dello scrittore";
    const esiti = {
      pass: "Controllo passato (" + tipo + ").",
      fail: "Controllo non passato (" + tipo + ").",
      assente: "Controllo non eseguito (" + tipo + ").",
    };
    return {
      esito: controllo.esito || null,
      tipo: controllo.tipo || null,
      testo: esiti[controllo.esito] || "Esito del controllo non comunicato.",
      motivi: elenco(controllo.motivi),
    };
  }

  // La colonna del modello non la scrive lo scrittore: la mette il client con i
  // dati del ponte, così un modello non può riscrivere l'identità di chi ha
  // contribuito.
  function vistaRisultato(lavoro) {
    const risultato = lavoro?.risultato || null;
    const provenienza = elenco(risultato?.provenienza).map((voce) => ({
      parte: testo(voce.parte),
      contributo: testo(voce.contributo),
      modello: modelloDelRuolo(lavoro, testo(voce.contributo)),
      cosaHoPreso: testo(voce.cosaHoPreso),
      perche: testo(voce.perche),
    }));
    const scartati = elenco(risultato?.scartati).map((voce) => ({
      contributo: testo(voce.contributo),
      modello: modelloDelRuolo(lavoro, testo(voce.contributo)),
      cosaHoLasciatoFuori: testo(voce.cosaHoLasciatoFuori),
      perche: testo(voce.perche),
    }));
    const contributiScartati = elenco(lavoro?.contributi)
      .filter((voce) => !voce.incluso)
      .map((voce) => ({
        roleId: voce.roleId,
        modello: modelloDelRuolo(lavoro, voce.roleId),
        motivo: voce.errore || "Contributo non utilizzabile.",
      }));
    return {
      lavoroId: lavoro?.lavoroId || null,
      titolo: "Risultato del consiglio",
      preimpostazione: metadatiPreimpostazione(lavoro?.preimpostazione),
      revisione: lavoro?.revisione ?? null,
      stato: {
        chiave: lavoro?.stato || null,
        testo: testoStatoLavoro(lavoro?.stato),
        livello: livelloStatoLavoro(lavoro?.stato),
      },
      motivo: lavoro?.motivo || null,
      inComposizione: lavoro?.stato === "fusione",
      testo: testo(risultato?.testo),
      provenienza: {
        intestazioni: ["Parte del risultato", "Contributo", "Modello", "Cosa ho preso", "Perché"],
        righe: provenienza,
      },
      scartati: {
        intestazioni: ["Contributo", "Modello", "Cosa ho lasciato fuori", "Perché"],
        righe: scartati,
      },
      contributiScartati,
      fileModificati: elenco(risultato?.fileModificati),
      valutazione: elenco(risultato?.eval),
      controllo: vistaControllo(lavoro),
      ripristino: lavoro?.ripristino || null,
      assegnazioni: vistaAssegnazioni(
        Object.values(lavoro?.ruoli || {}).sort((primo, secondo) => (primo.ordine || 0) - (secondo.ordine || 0)),
      ),
      azioni: azioniRisultato(lavoro),
      storico: elenco(lavoro?.storico).map((voce) => ({
        revisione: voce.revisione,
        stato: testoStatoLavoro(voce.stato),
      })),
    };
  }

  // Il testo del consenso arriva dal ponte: qui si divide in righe e si
  // riconosce che cosa dice ciascuna, senza riscriverne il contenuto.
  function vistaConsenso(valore) {
    const righe = [];
    let comando = null;
    let ripristinoPromesso = false;
    for (const riga of String(valore ?? "").split(/\r?\n/u)) {
      const pulita = riga.trim();
      if (!pulita) continue;
      const piatta = senzaAccenti(pulita);
      let chiave = "altro";
      if (piatta.includes("modifichera i file")) chiave = "file";
      else if (piatta.includes("eseguira questo comando")) {
        chiave = "comando";
        const separatore = pulita.indexOf(": ");
        if (separatore !== -1) comando = pulita.slice(separatore + 2).trim();
      } else if (piatta.includes("non e stato riconosciuto un comando")) chiave = "comando-assente";
      else if (piatta.includes("restano salvati in chiaro")) chiave = "salvataggio";
      else if (piatta.includes("posso riportare allo stato di adesso")) {
        chiave = "ripristino-promesso";
        ripristinoPromesso = true;
      } else if (piatta.includes("ripristino con git non e possibile")) chiave = "ripristino-assente";
      righe.push({ chiave, testo: pulita });
    }
    return { righe, comando, ripristinoPromesso, testo: String(valore ?? "") };
  }

  function chiaveModello(provider, modelId) {
    const p = String(provider ?? "").trim();
    const m = String(modelId ?? "").trim();
    return p && m ? p + "/" + m : null;
  }

  function etichettaRuoloBreve(tipo, ordine) {
    return tipo === "scrittore" ? "Scrittore" : "Consigliere " + (ordine || 1);
  }

  // Il catalogo arriva per intero dalla risposta del ponte: il client non
  // conosce nessun identificativo di modello.
  function vistaPannelloRuoli(risposta) {
    const catalogo = elenco(risposta?.catalogo).map((voce) => ({
      chiave: chiaveModello(voce.provider, voce.modelId),
      provider: voce.provider,
      modelId: voce.modelId,
      etichetta: voce.nome || voce.modelId,
    })).filter((voce) => voce.chiave);
    const configurazione = risposta?.configurazione || { consiglieri: [], scrittore: null };
    const effettive = risposta?.effettive || { consiglieri: [], scrittore: null };
    const coppie = [
      ...elenco(configurazione.consiglieri).map((voce, indice) => ({
        configurato: voce,
        effettivo: elenco(effettive.consiglieri)[indice] || null,
        tipo: "consigliere",
        ordine: indice + 1,
      })),
      ...(configurazione.scrittore
        ? [{ configurato: configurazione.scrittore, effettivo: effettive.scrittore || null, tipo: "scrittore", ordine: elenco(configurazione.consiglieri).length + 1 }]
        : []),
    ];
    const righe = coppie.map(({ configurato, effettivo, tipo, ordine }) => {
      const scelto = configurato?.model
        ? chiaveModello(configurato.model.provider, configurato.model.modelId)
        : null;
      const attivo = effettivo ? chiaveModello(effettivo.provider, effettivo.modello) : null;
      return {
        roleId: configurato?.roleId || null,
        tipo,
        ordine,
        etichetta: etichettaRuoloBreve(tipo, ordine),
        modelloScelto: scelto,
        automatico: !scelto,
        thinking: configurato?.thinking ?? null,
        modelloAttivo: attivo,
        etichettaModelloAttivo: effettivo?.nomeModello || effettivo?.modello || null,
        nonDisponibile: effettivo?.nonDisponibile || null,
      };
    });
    const avvisi = elenco(risposta?.problemi)
      .map((problema) => problema?.messaggio)
      .filter(Boolean);
    for (const riga of righe) {
      if (riga.nonDisponibile) {
        avvisi.push(
          riga.etichetta + ": il modello " + riga.nonDisponibile
          + " non è più disponibile. Non disponibile, il ruolo usa il modello predefinito.",
        );
      }
    }
    const conteggio = new Map();
    for (const riga of righe) {
      if (!riga.modelloAttivo) continue;
      conteggio.set(riga.modelloAttivo, [...(conteggio.get(riga.modelloAttivo) || []), riga.etichetta]);
    }
    for (const [, etichette] of conteggio) {
      if (etichette.length < 2) continue;
      avvisi.push(
        etichette.join(" e ") + " usano lo stesso modello: le risposte tenderanno a somigliarsi.",
      );
    }
    return {
      version: numero(risposta?.version) ?? 0,
      catalogo,
      righe,
      avvisi,
      avvioPossibile: risposta?.avvioPossibile !== false,
      cartellaLavori: risposta?.cartellaLavori || null,
      rigaSalvataggio: risposta?.cartellaLavori
        ? "I lavori del consiglio restano salvati in chiaro in " + risposta.cartellaLavori + " fino a trenta giorni."
        : "Il ponte non ha comunicato dove salva i lavori del consiglio.",
    };
  }

  function vistaAssegnazioni(ruoli) {
    return elenco(ruoli).map((ruolo) => ({
      roleId: ruolo.roleId,
      etichetta: etichettaRuoloBreve(ruolo.tipo, ruolo.ordine),
      modello: ruolo.nomeModello || ruolo.modello || "non indicato",
      provider: ruolo.provider || null,
    }));
  }

  // Copia di lavoro del pannello: il pannello la modifica, il salvataggio la
  // traduce in coppie provider più modello prese dal catalogo del ponte.
  function bozzaRuoli(vista) {
    const daRiga = (riga) => ({
      roleId: riga?.roleId || null,
      model: riga?.modelloScelto || null,
      thinking: riga?.thinking || null,
    });
    return {
      consiglieri: elenco(vista?.righe).filter((riga) => riga.tipo === "consigliere").map(daRiga),
      scrittore: daRiga(elenco(vista?.righe).find((riga) => riga.tipo === "scrittore")),
    };
  }

  function corpoConfigurazioneRuoli(vista, bozza) {
    const catalogo = elenco(vista?.catalogo);
    const componi = (voce) => {
      const trovato = voce?.model ? catalogo.find((modello) => modello.chiave === voce.model) : null;
      return {
        roleId: voce?.roleId || null,
        model: trovato ? { provider: trovato.provider, modelId: trovato.modelId } : null,
        thinking: voce?.thinking || null,
      };
    };
    return {
      expectedVersion: numero(vista?.version) ?? 0,
      consiglieri: elenco(bozza?.consiglieri).map(componi),
      scrittore: componi(bozza?.scrittore),
    };
  }

  function roleIdConsigliereLibero(bozza) {
    const usati = new Set([
      ...elenco(bozza?.consiglieri).map((voce) => voce.roleId),
      bozza?.scrittore?.roleId,
    ].filter(Boolean));
    for (let indice = 1; indice <= 40; indice += 1) {
      const candidato = "consigliere-" + indice;
      if (!usati.has(candidato)) return candidato;
    }
    return null;
  }

  function esitoChiamata(esito) {
    return {
      codice: esito?.codice || "errore",
      messaggio: esito?.messaggio || "Il ponte ha rifiutato la richiesta del consiglio.",
    };
  }

  // Il montaggio collega il contesto anche al vecchio ingresso del consiglio:
  // la chiave è la funzione del ponte, senza sostituirla né leggere il DOM.
  const lettoriAllegati = new WeakMap();

  function collegaContestoAllegatiConsiglio(chiama, leggiContesto) {
    if (typeof chiama !== "function" || typeof leggiContesto !== "function") {
      throw new TypeError("Il collegamento degli allegati del consiglio non è valido.");
    }
    lettoriAllegati.set(chiama, leggiContesto);
    return () => {
      if (lettoriAllegati.get(chiama) === leggiContesto) lettoriAllegati.delete(chiama);
    };
  }

  function percorsoAssolutoConsiglio(valore) {
    if (typeof valore !== "string" || !valore || /[\u0000-\u001f\u007f-\u009f]/u.test(valore)) return null;
    const windows = /^[a-z]:[\\/]/iu.test(valore) || /^[\\/]{2}/u.test(valore);
    const percorso = windows ? valore.replace(/\\/gu, "/") : valore;
    if (!windows && !percorso.startsWith("/")) return null;
    if (windows && (/^\/\/[?.](?:\/|$)/u.test(percorso) || /:/u.test(percorso.slice(/^[a-z]:/iu.test(percorso) ? 2 : 0)))) return null;
    const parti = percorso.split("/").filter(Boolean);
    if (parti.some((parte) => parte === "." || parte === ".." || (windows && /[ .]$/u.test(parte)))) return null;
    if (percorso.startsWith("//") && parti.length < 2) return null;
    const normalizzato = percorso.replace(/\/+$/u, "") || "/";
    return { percorso: normalizzato, confronto: windows ? normalizzato.toLowerCase() : normalizzato, windows };
  }

  function riferimentoDentroCartella(percorso, workspace) {
    const base = percorsoAssolutoConsiglio(workspace);
    const file = percorsoAssolutoConsiglio(percorso);
    return Boolean(base && file && base.windows === file.windows
      && file.confronto.startsWith(base.confronto.replace(/\/$/u, "") + "/"));
  }

  // Le estensioni seguono i documenti testuali riconosciuti da estrazione.mjs.
  // Il contenuto non entra mai qui: anche il testo viaggia solo per percorso.
  const ESTENSIONI_TESTUALI = new Set(["md", "txt", "csv", "json", "xml", "yaml", "yml", "html", "htm", "log", "js", "mjs", "cjs", "jsx", "ts", "tsx", "css", "scss", "py", "rs", "c", "h", "cpp", "hpp", "java", "go", "rb", "php", "sql", "sh", "toml", "ini", "cfg", "r", "tex", "svelte", "vue", "kt", "swift"]);

  function riferimentoTestuale(voce) {
    return /^text\//iu.test(voce.mimeType || "")
      || ESTENSIONI_TESTUALI.has(/\.([a-z0-9]+)$/iu.exec(voce.percorso || "")?.[1].toLowerCase() || "");
  }

  function riferimentoLibreria(voce) {
    const indice = percorsoAssolutoConsiglio(voce.percorsoIndice);
    if (voce.tipo !== "file" || voce.origineLibreria !== true || !indice
      || !indice.confronto.endsWith("/.ingest-index.json")) return false;
    return riferimentoDentroCartella(voce.percorso, indice.percorso.slice(0, -".ingest-index.json".length));
  }

  // Nessun filtro può scartare una voce: se un solo chip non è utilizzabile
  // si ferma tutta la richiesta. I riferimenti della libreria conservano la loro
  // radice; la guardia del ponte continua a confinare le letture al workspace.
  function preparaAllegatiConsiglio({ prompt, allegati = [], allegatiLibreria = [], workspace = null } = {}) {
    const blocca = (nome, motivo) => ({
      ok: false,
      codice: "allegato-non-ammesso",
      messaggio: `Non posso avviare Agenti: ${nome} ${motivo} La bozza e tutti gli allegati sono conservati.`,
    });
    if (!Array.isArray(allegati) || !Array.isArray(allegatiLibreria)) {
      return blocca("l'elenco degli allegati", "non è valido.");
    }
    const riferimenti = [];
    for (const voce of [...allegati, ...allegatiLibreria]) {
      const nome = voce?.nome ? `"${String(voce.nome)}"` : "un allegato";
      if (!voce || typeof voce !== "object") return blocca(nome, "non è riconosciuto.");
      if (voce.tipo === "image" || voce.tipo === "immagine" || /^image\//iu.test(voce.mimeType || "")) {
        return blocca(nome, "è un'immagine. Il consiglio accetta solo riferimenti a file di testo nella cartella di lavoro o nella libreria.");
      }
      if (voce.origineLibreria === true) {
        if (!riferimentoLibreria(voce)) return blocca(nome, "non ha un riferimento valido nella radice della libreria.");
      } else if (typeof voce.percorso !== "string" || !riferimentoDentroCartella(voce.percorso, workspace)) {
        return blocca(nome, "è un caricamento esterno o non ha un riferimento dentro la cartella di lavoro. Usa un file di testo nella cartella oppure una voce della libreria.");
      }
      if (!riferimentoTestuale(voce)) return blocca(nome, "non è un riferimento a un file di testo. Indicizzalo nella libreria per ottenere un riferimento al testo estratto.");
      riferimenti.push({
        percorso: voce.percorso,
        nome: typeof voce.nome === "string" ? voce.nome : null,
        ...(Number.isFinite(voce.dimensione) && voce.dimensione >= 0 ? { dimensione: voce.dimensione } : {}),
        ...(typeof voce.impronta === "string" ? { impronta: voce.impronta } : {}),
      });
    }
    return {
      ok: true,
      prompt,
      allegati: riferimenti,
    };
  }

  // Avvio. Il consenso dei lavori di codice si chiede una volta sola: il ponte
  // risponde 409 con il testo, l'utente accetta, e la stessa richiesta riparte
  // con lo stesso operationId, così non nascono due lavori.
  async function avviaConsiglio({
    sourceSessionId,
    prompt,
    istruzioni = null,
    tipo = "testo",
    operationId,
    preimpostazione,
    allegati,
    allegatiLibreria,
    workspace,
    chiama,
    chiediConsenso,
  } = {}) {
    const scelta = preimpostazione == null ? null : {
      id: preimpostazione.id, versione: preimpostazione.versione,
    };
    let contesto = { allegati, allegatiLibreria, workspace };
    const leggiContesto = lettoriAllegati.get(chiama);
    if (allegati === undefined && allegatiLibreria === undefined && leggiContesto) {
      try {
        contesto = await leggiContesto(sourceSessionId);
        if (!contesto || typeof contesto !== "object") throw new Error("Il contesto degli allegati non è più disponibile.");
      } catch (errore) {
        return { avviato: false, codice: "allegati-non-verificati", messaggio: errore?.message || "Non riesco a verificare gli allegati. La bozza e i chip sono conservati." };
      }
    }
    const preparati = preparaAllegatiConsiglio({ prompt, ...contesto });
    if (!preparati.ok) return { avviato: false, ...preparati };
    const corpo = {
      operationId,
      sourceSessionId,
      prompt: preparati.prompt,
      tipo,
      ...(istruzioni ? { istruzioni } : {}),
      ...(scelta ? { preimpostazione: scelta } : {}),
      ...(preparati.allegati.length ? { allegati: preparati.allegati } : {}),
    };
    let esito = await chiama("/api/consiglio/avvia", corpo);
    if (!esito?.ok && esito?.codice === "consenso-mancante") {
      const consenso = vistaConsenso(esito.consenso || "");
      const accettato = await chiediConsenso(consenso);
      if (!accettato) return { avviato: false, codice: "consenso-rifiutato", consenso };
      esito = await chiama("/api/consiglio/avvia", { ...corpo, consenso: true });
    }
    if (!esito?.ok) return { avviato: false, ...esitoChiamata(esito) };
    return { avviato: true, dati: esito.dati || {} };
  }

  // Approva non invia niente a pi: scrive il testo fuso nella bozza della
  // conversazione sorgente e lascia all'utente la decisione di inviarlo.
  async function approvaConsiglio({ lavoro, operationId, chiama, scriviBozza } = {}) {
    const risultatoHash = lavoro?.risultato?.risultatoHash;
    if (!risultatoHash) {
      return { approvato: false, codice: "risultato-assente", messaggio: "Non c'è un risultato da approvare." };
    }
    const esito = await chiama("/api/consiglio/approva", {
      operationId,
      lavoroId: lavoro.lavoroId,
      revisione: lavoro.revisione,
      risultatoHash,
    });
    if (!esito?.ok) return { approvato: false, ...esitoChiamata(esito) };
    const testoFinale = typeof esito.dati?.testo === "string" ? esito.dati.testo : lavoro.risultato.testo;
    // La consegna può non avvenire: se la conversazione di partenza è stata
    // chiusa mentre il consiglio lavorava non c'è nessuna bozza dove scrivere.
    // scriviBozza dice se ha scritto, e chi chiama deve riferire quello, non
    // promettere un testo che nel composer non c'è.
    const bozzaScritta = await scriviBozza({ sessionId: lavoro.sourceSessionId, testo: testoFinale }) === true;
    return {
      approvato: true,
      bozzaScritta,
      testo: testoFinale,
      sourceSessionId: lavoro.sourceSessionId,
      approvatoIl: esito.dati?.approvatoIl || null,
    };
  }

  // Rifai. Quando il ponte può riportare indietro dei file, li elenca e aspetta
  // una conferma esplicita: senza conferma non si tocca il disco.
  async function rifaiConsiglio({
    lavoro,
    istruzioni = null,
    ripristina = false,
    operationId,
    chiama,
    chiediConferma,
  } = {}) {
    const base = {
      ...(operationId ? { operationId } : {}),
      lavoroId: lavoro.lavoroId,
      revisioneAttesa: lavoro.revisione,
      ...(istruzioni === null ? {} : { istruzioni }),
      ripristina: Boolean(ripristina),
    };
    let esito = await chiama("/api/consiglio/rifai", base);
    if (!esito?.ok) return { rifatto: false, ...esitoChiamata(esito) };
    let ripristinoRichiesto = null;
    if (esito.dati?.ripristino?.conferma === "richiesta") {
      ripristinoRichiesto = elenco(esito.dati.ripristino.file);
      const confermato = await chiediConferma({
        file: ripristinoRichiesto,
        lavoroId: lavoro.lavoroId,
      });
      if (!confermato) {
        return {
          rifatto: false,
          codice: "ripristino-non-confermato",
          messaggio: "Il ripristino dei file non è stato confermato: niente è stato cambiato.",
          file: ripristinoRichiesto,
        };
      }
      esito = await chiama("/api/consiglio/rifai", { ...base, confermaRipristino: true });
      if (!esito?.ok) return { rifatto: false, ...esitoChiamata(esito) };
    }
    return {
      rifatto: true,
      dati: esito.dati || {},
      revisionePrecedente: lavoro.revisione,
      revisione: numero(esito.dati?.revisione) ?? lavoro.revisione + 1,
      ripristino: esito.dati?.ripristino || null,
      fileRipristinati: ripristinoRichiesto,
    };
  }

  async function annullaConsiglio({ lavoro, roleId = null, chiama } = {}) {
    const esito = await chiama("/api/consiglio/annulla", {
      lavoroId: lavoro.lavoroId,
      ...(roleId ? { roleId } : {}),
    });
    if (!esito?.ok) return { annullato: false, ...esitoChiamata(esito) };
    return { annullato: true, dati: esito.dati || {} };
  }

  return Object.freeze({
    PREFISSO_SCHEDA_RISULTATO,
    NOME_SCHEDA_RISULTATO,
    STATI_LAVORO_IN_CORSO,
    annullaConsiglio,
    applicaDettaglioConsiglio,
    applicaEventoConsiglio,
    applicaSnapshotConsiglio,
    approvaConsiglio,
    avviaConsiglio,
    bozzaRuoli,
    collegaContestoAllegatiConsiglio,
    corpoConfigurazioneRuoli,
    roleIdConsigliereLibero,
    etichettaRuolo,
    etichettaRuoloBreve,
    idRipiego,
    invioManualeConsentito,
    lavoroDiScheda,
    livelloStatoLavoro,
    livelloStatoRuolo,
    preparaAllegatiConsiglio,
    registraNuovaRevisione,
    rifaiConsiglio,
    righeRuolo,
    ruoloDiSessione,
    statoIniziale,
    testoStatoLavoro,
    testoStatoRuolo,
    vistaAssegnazioni,
    vistaConsenso,
    vistaPannelloRuoli,
    vistaRisultato,
    voceSchedaRisultato,
    voceSessioneDiRuolo,
  });
});
