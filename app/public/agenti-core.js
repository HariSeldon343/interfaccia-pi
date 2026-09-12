(function pubblicaAgenti(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiAgentiCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const copia = (valore) => JSON.parse(JSON.stringify(valore));
  const elenco = (valore) => Array.isArray(valore) ? valore : [];
  const chiaveModello = (voce) => voce ? voce.provider + "/" + voce.modelId : null;
  const MANCANZA_CATALOGO = "I modelli effettivi non sono leggibili adesso: apri una conversazione con Pi attivo. Gestisci resta disponibile.";

  function configurazioneDaPreimpostazione(voce) {
    const ruolo = (roleId) => ({ roleId, model: voce.assegnazioni[roleId], thinking: voce.livello[roleId] });
    return { consiglieri: voce.ordine.filter((id) => id !== "scrittore").map(ruolo), scrittore: ruolo("scrittore") };
  }

  function motivoPiano(dati, voce, workspace = null) {
    if (voce?.tipo === "codice" && !workspace) return "Questa preimpostazione modifica i file: scegli una conversazione con una cartella di lavoro prima di avviare gli agenti.";
    if (!elenco(dati?.catalogo).length) return MANCANZA_CATALOGO;
    if (!voce) return "Scegli o crea una preimpostazione da Gestisci.";
    const risoluzione = elenco(dati.risoluzioni).find((riga) => riga.id === voce.id && riga.versione === voce.versione);
    const mancanti = voce.ordine.filter((id) => {
      const scelta = voce.assegnazioni[id];
      return scelta && !dati.catalogo.some((modello) => chiaveModello(modello) === chiaveModello(scelta));
    });
    if (mancanti.length || !risoluzione || risoluzione.avvioPossibile === false
      || elenco(risoluzione.problemi).length
      || [...elenco(risoluzione.effettive?.consiglieri), risoluzione.effettive?.scrittore].some((riga) => riga?.nonDisponibile)) {
      return "Un modello manca o il catalogo è incompleto. Scegli esplicitamente le assegnazioni in Gestisci e salva prima di avviare.";
    }
    return null;
  }

  function improntaPiano(dati, voce) {
    const piano = elenco(dati?.risoluzioni).find((riga) => riga.id === voce?.id && riga.versione === voce?.versione);
    return JSON.stringify({ preimpostazione: voce, effettive: piano?.effettive });
  }

  async function attendiImportazioni(sessione) {
    for (const [campo, nome] of [
      ["codaIngressiLibreria", "della libreria"],
      ["codaImportazioneImmagini", "delle immagini"],
      ["codaImportazioneFile", "dei file"],
      ["codaAllegatiBozza", "degli allegati della bozza"],
    ]) {
      try { await sessione[campo]; }
      catch (errore) {
        throw new Error("L'importazione " + nome + " è fallita. Nessun lavoro è stato avviato; bozza e chip restano conservati."
          + (errore?.message ? " " + errore.message : ""));
      }
    }
  }

  // Contratto P3: il modulo crea btn-agenti dopo btn-allega; il contenitore
  // contiene due button reali. Il chiamante passa funzioni, non un secondo UI.
  function montaAgenti(composer, ponte) {
    const documento = composer.ownerDocument;
    const esistente = composer.querySelector("#btn-agenti");
    if (esistente?.agenti) return esistente.agenti;
    const core = ponte.consiglio;
    const input = ponte.input;
    const crea = (tag, classe, testo) => {
      const nodo = documento.createElement(tag);
      if (classe) nodo.className = classe;
      if (testo != null) nodo.textContent = testo;
      return nodo;
    };
    const bottone = (testo, azione, classe = "bottone") => {
      const nodo = crea("button", classe, testo);
      nodo.type = "button";
      nodo.onclick = azione;
      return nodo;
    };
    const contenitore = crea("span", "campo-riga");
    contenitore.id = "btn-agenti";
    const primario = bottone("Agenti", () => avvia(predefinita()), "bottone primario");
    const freccia = bottone("▾", () => menu.hidden ? apriElenco() : chiudiElenco());
    freccia.setAttribute("aria-label", "Scegli la preimpostazione");
    freccia.setAttribute("aria-haspopup", "menu");
    freccia.setAttribute("aria-expanded", "false");
    freccia.setAttribute("aria-controls", "elenco-preimpostazioni-agenti");
    contenitore.append(primario, freccia);
    composer.querySelector("#btn-allega").after(contenitore);
    const menu = crea("div", "menu-azioni-composer");
    menu.id = "elenco-preimpostazioni-agenti";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Preimpostazioni degli agenti");
    const stato = crea("p", "nota", "Leggo le preimpostazioni degli agenti…");
    stato.id = "stato-agenti";
    stato.setAttribute("role", "status");
    stato.setAttribute("aria-live", "polite");
    primario.setAttribute("aria-describedby", stato.id);
    composer.append(menu, stato);
    let dati = null;
    let generazione = 0;
    let firmaSessione = null;
    let avvioInCorso = false;
    let aggiornamentoInCorso = false;
    let avvisoCorrente = "";
    let dialogo = null;
    let distrutto = false;
    const sessioneAttiva = () => ponte.sessioneAttiva();
    const predefinita = () => elenco(dati?.archivio?.preimpostazioni).find((voce) => voce.id === dati.archivio.predefinita);
    const via = (sessione) => "/api/consiglio/preimpostazioni?sessionId=" + encodeURIComponent(sessione?.id || "");
    const avvisa = (testo) => { avvisoCorrente = testo; stato.textContent = testo; ponte.toast?.(testo, "avviso"); };
    const firmaAttiva = () => {
      const s = sessioneAttiva();
      const modelli = elenco(s?.modelli);
      return JSON.stringify([s?.id, s?.attiva, s?.avvioCompletato, s?.sincronizzazione,
        modelli.length, modelli.map((modello) => chiaveModello({ provider: modello.provider, modelId: modello.modelId ?? modello.id })), ponte.online?.()]);
    };
    function aggiornaControlli() {
      const s = sessioneAttiva();
      const scelta = predefinita();
      primario.textContent = "Agenti" + (scelta ? " · " + scelta.nome : "");
      const senzaSessione = !s || s.attiva === false || s.schedaRisultato || s.consiglio || ponte.online?.() === false;
      primario.disabled = avvioInCorso || Boolean(s?.invioInCorso) || senzaSessione || !scelta || !elenco(dati?.catalogo).length
        || (scelta.tipo === "codice" && !s.cartella);
      const motivo = senzaSessione ? "Apri una conversazione tua con Pi attivo per avviare gli agenti. Gestisci resta disponibile."
        : impedimento(s) || (aggiornamentoInCorso && !dati ? null : motivoPiano(dati, scelta, s.cartella));
      contenitore.setAttribute("aria-busy", String(aggiornamentoInCorso));
      if (!avvioInCorso) stato.textContent = avvisoCorrente || motivo || (aggiornamentoInCorso
        ? "Preimpostazioni degli agenti in aggiornamento."
        : "La scelta nell'elenco avvia subito. Ctrl + Maiusc + Invio avvia la preimpostazione predefinita.");
    }
    async function aggiorna() {
      const turno = ++generazione;
      const s = sessioneAttiva();
      firmaSessione = firmaAttiva();
      aggiornamentoInCorso = true;
      aggiornaControlli();
      let risposta;
      try { risposta = await ponte.chiama(via(s)); }
      catch { risposta = { ok: false, messaggio: "Non riesco a leggere le preimpostazioni. Verifica che il ponte sia disponibile." }; }
      if (distrutto || turno !== generazione || s !== sessioneAttiva()) return false;
      aggiornamentoInCorso = false;
      if (!risposta.ok) {
        dati = null;
        aggiornaControlli();
        stato.textContent = risposta.messaggio || "Non riesco a leggere le preimpostazioni.";
        return false;
      }
      dati = copia(risposta.dati);
      aggiornaControlli();
      return true;
    }
    function controllaSessione() {
      if (firmaAttiva() !== firmaSessione) void aggiorna();
      else aggiornaControlli();
    }
    function chiudiElenco(restituisci = true) {
      menu.hidden = true;
      freccia.setAttribute("aria-expanded", "false");
      if (restituisci) freccia.focus();
    }
    function apriElenco() {
      menu.replaceChildren();
      for (const voce of elenco(dati?.archivio?.preimpostazioni)) {
        const riga = bottone(voce.nome, () => { chiudiElenco(); return avvia(voce); }, "menu-azione-composer");
        riga.setAttribute("role", "menuitemradio");
        riga.setAttribute("aria-checked", String(voce.id === dati.archivio.predefinita));
        riga.tabIndex = -1;
        if (!elenco(dati.catalogo).length) riga.setAttribute("aria-disabled", "true");
        menu.appendChild(riga);
      }
      const gestisci = bottone("Gestisci", () => { chiudiElenco(); return apriGestisci(null, freccia); }, "menu-azione-composer");
      gestisci.setAttribute("role", "menuitem");
      gestisci.tabIndex = -1;
      menu.appendChild(gestisci);
      menu.hidden = false;
      freccia.setAttribute("aria-expanded", "true");
      const primo = menu.children[0];
      primo.tabIndex = 0;
      primo.focus();
    }
    function tastiElenco(evento) {
      if (menu.hidden || !menu.contains(evento.target)) return false;
      const voci = [...menu.children];
      let indice = Math.max(0, voci.indexOf(documento.activeElement));
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(evento.key)) {
        indice = evento.key === "Home" ? 0 : evento.key === "End" ? voci.length - 1
          : (indice + (evento.key === "ArrowDown" ? 1 : -1) + voci.length) % voci.length;
        voci.forEach((voce, i) => { voce.tabIndex = i === indice ? 0 : -1; });
        voci[indice].focus();
      } else if (evento.key === "Escape") chiudiElenco();
      else if (evento.key === "Enter" || evento.key === " ") voci[indice].click();
      else if (evento.key === "Tab") { chiudiElenco(false); return false; }
      else return false;
      evento.preventDefault();
      evento.stopImmediatePropagation();
      return true;
    }

    function impedimento(s) {
      if (!s || s.attiva === false || s.schedaRisultato || s.consiglio || ponte.online?.() === false) return "Apri prima una conversazione tua con Pi attivo.";
      if (s.handoffInCorso || s.chiusuraInCorso || s.compattazioneInCorso || s.compattazionePreventivaInCorso
        || s.renderCronologiaInCorso || s.sincronizzazione || s.erroreCronologia || s.erroreAllegatiBozza
        || s.contestoGptDaRicaricare || s.avvioCompletato === false) return "La conversazione è ancora in preparazione. Bozza e allegati restano conservati: attendi prima di avviare gli agenti.";
      return null;
    }
    async function avvia(voce) {
      const s = sessioneAttiva();
      if (avvioInCorso || s?.invioInCorso) return false;
      avvisoCorrente = "";
      const blocco = impedimento(s);
      if (blocco) { avvisa(blocco); return false; }
      if (!String(input.value || s.bozza || "").trim()) { input.focus(); return false; }
      if (!voce || !elenco(dati?.catalogo).length) { avvisa(MANCANZA_CATALOGO); return false; }
      const scelta = copia(voce);
      const piano = improntaPiano(dati, scelta);
      const chiaveBozza = s.chiaveBozza;
      // Il medesimo latch dell'invio ordinario viene preso prima di ogni await.
      s.invioInCorso = true;
      avvioInCorso = true;
      ponte.aggiornaInterfaccia?.();
      aggiornaControlli();
      try {
        await attendiImportazioni(s);
        if (s !== sessioneAttiva() || s.chiaveBozza !== chiaveBozza) {
          avvisa("La conversazione è cambiata durante l'attesa. Nessun lavoro è stato avviato; bozza e allegati restano conservati.");
          return false;
        }
        const attesa = impedimento(s);
        if (attesa) { avvisa(attesa); return false; }
        const motivo = motivoPiano(dati, scelta, s.cartella);
        if (motivo) {
          avvisa(motivo);
          if (scelta.tipo !== "codice" || s.cartella) await apriGestisci(scelta.id, freccia, motivo);
          return false;
        }
        const prompt = String(input.value || s.bozza || "").trim();
        if (!prompt) { input.focus(); return false; }
        const esito = await core.avviaConsiglio({
          sourceSessionId: s.id, prompt, tipo: scelta.tipo, istruzioni: scelta.istruzioni,
          preimpostazione: { id: scelta.id, versione: scelta.versione },
          allegati: copia(s.allegati || []), allegatiLibreria: copia(s.allegatiLibreria || []), workspace: s.cartella,
          operationId: (ponte.operationId || (() => globalThis.crypto.randomUUID()))(),
          chiediConsenso: ponte.chiediConsenso,
          chiama: async (percorso, corpo) => {
            if (s !== sessioneAttiva() || s.chiaveBozza !== chiaveBozza || impedimento(s)) {
              return { ok: false, codice: "sessione-cambiata", messaggio: "La conversazione è cambiata. Nessun lavoro è stato avviato." };
            }
            const attuale = await ponte.chiama(via(s));
            if (!attuale.ok) return attuale;
            if (s !== sessioneAttiva() || s.chiaveBozza !== chiaveBozza || impedimento(s)) {
              return { ok: false, codice: "sessione-cambiata", messaggio: "La conversazione è cambiata. Nessun lavoro è stato avviato." };
            }
            const corrente = elenco(attuale.dati?.archivio?.preimpostazioni).find((riga) => riga.id === scelta.id);
            if (motivoPiano(attuale.dati, corrente, s.cartella) || improntaPiano(attuale.dati, corrente) !== piano) {
              return { ok: false, codice: "preimpostazione-cambiata", messaggio: "La preimpostazione o i modelli effettivi sono cambiati. Controlla la scelta e avvia di nuovo." };
            }
            return ponte.chiama(percorso, corpo);
          },
        });
        if (!esito.avviato) {
          if (esito.codice !== "consenso-rifiutato") avvisa(esito.messaggio);
          return false;
        }
        await ponte.aggiornaDalPonte?.({ sostituisci: true });
        const scheda = core.PREFISSO_SCHEDA_RISULTATO + esito.dati.lavoroId;
        if (ponte.sessioni?.has(scheda)) ponte.attivaSessione?.(scheda);
        return true;
      } catch (errore) {
        avvisa(errore?.message || "Non riesco ad avviare gli agenti. Bozza e allegati restano conservati.");
        return false;
      } finally {
        s.invioInCorso = false;
        avvioInCorso = false;
        ponte.aggiornaInterfaccia?.();
        void aggiorna();
      }
    }

    async function apriGestisci(id, precedente = freccia, motivo = "") {
      if (dialogo) return;
      const velo = crea("div", "velo");
      const finestra = crea("section", "modale larga");
      finestra.setAttribute("role", "dialog");
      finestra.setAttribute("aria-modal", "true");
      finestra.setAttribute("aria-labelledby", "titolo-gestisci-agenti");
      finestra.tabIndex = -1;
      const testa = crea("header", "modale-testa");
      const titolo = crea("h3", null, "Gestisci le preimpostazioni");
      titolo.id = "titolo-gestisci-agenti";
      const corpo = crea("div", "modale-corpo");
      const piede = crea("footer", "modale-piede");
      const chiudi = bottone("Chiudi", () => chiudiGestisci(), "chiudi");
      testa.append(titolo, chiudi);
      finestra.append(testa, corpo, piede);
      velo.appendChild(finestra);
      const sfondo = [...documento.body.children].map((elemento) => ({ elemento, inert: elemento.inert, aria: elemento.getAttribute("aria-hidden") }));
      for (const riga of sfondo) { riga.elemento.inert = true; riga.elemento.setAttribute("aria-hidden", "true"); }
      documento.body.appendChild(velo);
      dialogo = { velo, finestra, sfondo, precedente, chiudi };
      const messaggio = crea("p", "nota", motivo || "Leggo le preimpostazioni…");
      messaggio.setAttribute("role", "status");
      corpo.appendChild(messaggio);
      chiudi.focus();
      await aggiorna();
      if (!dialogo || dialogo.velo !== velo) return;
      if (!dati?.archivio) { messaggio.textContent = stato.textContent; return; }
      let archivio = copia(dati.archivio);
      let selezionata = null;
      let ruoli = null;
      let operazioneInCorso = false;
      const selettore = crea("select", "campo");
      selettore.setAttribute("aria-label", "Preimpostazione da gestire");
      const campi = crea("div");
      const nome = crea("input", "campo");
      nome.setAttribute("aria-label", "Nome della preimpostazione");
      const tipo = crea("select", "campo");
      tipo.setAttribute("aria-label", "Tipo di lavoro");
      for (const [valore, testo] of [["testo", "Solo testo"], ["codice", "Codice, modifica i file"]]) {
        const opzione = crea("option", null, testo); opzione.value = valore; tipo.appendChild(opzione);
      }
      const istruzioni = crea("textarea", "area-testo");
      istruzioni.setAttribute("aria-label", "Istruzioni della preimpostazione");
      const numero = crea("select", "campo");
      numero.setAttribute("aria-label", "Numero di consiglieri");
      for (let n = 0; n <= 4; n += 1) {
        const opzione = crea("option", null, n ? n + (n === 1 ? " consigliere" : " consiglieri") : "Solo scrittore");
        opzione.value = String(n); numero.appendChild(opzione);
      }
      const elencoRuoli = crea("div", "consiglio-ruoli-elenco");
      for (const [etichetta, campo] of [["Nome", nome], ["Tipo di lavoro", tipo], ["Istruzioni", istruzioni], ["Composizione", numero]]) {
        const riga = crea("label", "campo-etichetta", etichetta); riga.appendChild(campo); campi.appendChild(riga);
      }
      corpo.append(selettore, campi, elencoRuoli);
      const avvisoModelli = () => !dati.catalogo.length ? MANCANZA_CATALOGO
        : "Le assegnazioni Automatico sono risolte dal ponte; più consiglieri possono usare lo stesso modello.";
      const aggiornaElenco = (nuovoId) => {
        selettore.replaceChildren();
        for (const voce of archivio.preimpostazioni) {
          const opzione = crea("option", null, voce.nome + (voce.id === archivio.predefinita ? " · Predefinita" : ""));
          opzione.value = voce.id; selettore.appendChild(opzione);
        }
        const nuova = crea("option", null, "Nuova preimpostazione"); nuova.value = ""; selettore.appendChild(nuova);
        selettore.value = nuovoId || "";
      };
      const disegnaRuoli = () => {
        numero.value = String(ruoli.bozza.consiglieri.length);
        ponte.disegnaRuoli(elencoRuoli, ruoli, {
          segnaModificato: () => {},
          aggiungi: () => {
            if (ruoli.bozza.consiglieri.length >= 4) return;
            ruoli.bozza.consiglieri.push({ roleId: core.roleIdConsigliereLibero(ruoli.bozza), model: null, thinking: null });
            disegnaRuoli();
          },
          togli: (indice) => { ruoli.bozza.consiglieri.splice(indice, 1); disegnaRuoli(); },
          muovi: (indice, passo) => {
            const voci = ruoli.bozza.consiglieri;
            if (!voci[indice + passo]) return;
            [voci[indice], voci[indice + passo]] = [voci[indice + passo], voci[indice]];
            disegnaRuoli();
          },
        });
      };
      const carica = () => {
        selezionata = archivio.preimpostazioni.find((voce) => voce.id === selettore.value) || null;
        const voce = selezionata || {
          nome: "", tipo: "testo", istruzioni: "", ordine: ["consigliere-1", "scrittore"],
          livello: { "consigliere-1": null, scrittore: null }, assegnazioni: { "consigliere-1": null, scrittore: null },
        };
        nome.value = voce.nome; tipo.value = voce.tipo; istruzioni.value = voce.istruzioni || "";
        const risolta = elenco(dati.risoluzioni).find((riga) => riga.id === voce.id) || {};
        const catalogo = copia(dati.catalogo);
        // I selettori esistenti hanno sempre un'opzione per la scelta salvata,
        // anche a Pi spento: salvarne il nome non può trasformarla in Automatico.
        for (const scelta of Object.values(voce.assegnazioni).filter(Boolean)) {
          if (!catalogo.some((modello) => chiaveModello(modello) === chiaveModello(scelta))) {
            catalogo.push({ ...scelta, nome: chiaveModello(scelta) + " · salvato, non disponibile" });
          }
        }
        const vista = core.vistaPannelloRuoli({ ...risolta, catalogo, configurazione: configurazioneDaPreimpostazione(voce), cartellaLavori: dati.cartellaLavori });
        vista.avvisi = vista.avvisi.filter((avviso) => !avviso.includes("il ruolo usa il modello predefinito"));
        const livelli = sessioneAttiva()?.livelli?.length ? sessioneAttiva().livelli : ["off", "low", "medium", "high"];
        ruoli = { vista, bozza: core.bozzaRuoli(vista), livelli: [...new Set([...livelli, ...Object.values(voce.livello).filter(Boolean)])] };
        disegnaRuoli();
        for (const pulsante of [duplica, elimina, predefinitaBtn, rinomina]) pulsante.disabled = !selezionata;
        messaggio.textContent = (motivo ? motivo + " " : "") + avvisoModelli();
      };
      const contenuto = () => {
        const configurazione = core.corpoConfigurazioneRuoli(ruoli.vista, ruoli.bozza);
        const righe = [...configurazione.consiglieri, configurazione.scrittore];
        return {
          nome: nome.value.trim(), tipo: tipo.value, istruzioni: istruzioni.value.trim(),
          ordine: righe.map((voce) => voce.roleId),
          livello: Object.fromEntries(righe.map((voce) => [voce.roleId, voce.thinking])),
          assegnazioni: Object.fromEntries(righe.map((voce) => [voce.roleId, voce.model])),
        };
      };
      async function salva(azione) {
        if (operazioneInCorso) return;
        operazioneInCorso = true;
        const richiesta = {
          azione, versioneArchivioAttesa: archivio.versioneArchivio,
          ...(selezionata ? { id: selezionata.id, versioneAttesa: selezionata.versione } : {}),
          ...(["crea", "modifica"].includes(azione) ? { preimpostazione: contenuto() } : {}),
          ...(azione === "duplica" ? { preimpostazione: { nome: nome.value.trim() + " (copia)" } } : {}),
        };
        try {
          const risposta = await ponte.chiama(via(sessioneAttiva()), richiesta);
          if (!dialogo || dialogo.velo !== velo) return;
          if (!risposta.ok) {
            messaggio.textContent = risposta.messaggio || "La modifica non è stata salvata. Riapri Gestisci per leggere la versione aggiornata.";
            return;
          }
          dati = copia(risposta.dati);
          const precedenti = new Set(archivio.preimpostazioni.map((voce) => voce.id));
          archivio = copia(dati.archivio);
          const nuova = archivio.preimpostazioni.find((voce) => !precedenti.has(voce.id));
          aggiornaElenco(nuova?.id || (azione === "elimina" ? archivio.predefinita : selezionata?.id));
          carica();
          messaggio.textContent = "Preimpostazioni salvate. " + avvisoModelli();
          aggiornaControlli();
        } catch (errore) { messaggio.textContent = errore?.message || "Non riesco a salvare la preimpostazione."; }
        finally { operazioneInCorso = false; }
      }
      const salvaBtn = bottone("Salva", () => salva(selezionata ? "modifica" : "crea"), "bottone primario");
      const duplica = bottone("Duplica", () => salva("duplica"));
      const rinomina = bottone("Rinomina", () => nome.focus());
      const elimina = bottone("Elimina", () => salva("elimina"), "bottone pericolo");
      const predefinitaBtn = bottone("Usa come predefinita", () => salva("predefinita"));
      piede.append(rinomina, duplica, elimina, predefinitaBtn, salvaBtn);
      selettore.onchange = carica;
      numero.onchange = () => {
        const n = Number(numero.value);
        ruoli.bozza.consiglieri.splice(n);
        while (ruoli.bozza.consiglieri.length < n) {
          ruoli.bozza.consiglieri.push({ roleId: core.roleIdConsigliereLibero(ruoli.bozza), model: null, thinking: null });
        }
        disegnaRuoli();
      };
      aggiornaElenco(id || archivio.predefinita);
      carica();
      selettore.focus();
    }
    function chiudiGestisci() {
      if (!dialogo) return;
      const precedente = dialogo.precedente;
      for (const riga of dialogo.sfondo) {
        riga.elemento.inert = riga.inert;
        if (riga.aria == null) riga.elemento.removeAttribute("aria-hidden");
        else riga.elemento.setAttribute("aria-hidden", riga.aria);
      }
      dialogo.velo.remove();
      dialogo = null;
      precedente?.focus();
    }
    function tasti(evento) {
      if (evento.isComposing || ponte.composizioneInCorso?.()) return;
      if (dialogo) {
        if (evento.key === "Escape") { evento.preventDefault(); chiudiGestisci(); }
        else if (evento.key === "Tab") {
          const voci = [...dialogo.finestra.querySelectorAll("button, input, select, textarea, [tabindex]")]
            .filter((voce) => !voce.disabled && !voce.hidden && voce.tabIndex !== -1);
          const attivo = documento.activeElement;
          if (evento.shiftKey && (attivo === voci[0] || !dialogo.finestra.contains(attivo))) {
            evento.preventDefault(); voci.at(-1)?.focus();
          } else if (!evento.shiftKey && (attivo === voci.at(-1) || !dialogo.finestra.contains(attivo))) {
            evento.preventDefault(); voci[0]?.focus();
          }
        }
        evento.stopPropagation();
        if (evento.key === "Escape") evento.stopImmediatePropagation();
        return;
      }
      if (tastiElenco(evento)) return;
      if (!composer.contains(evento.target)) return;
      if (evento.key === "Enter" && evento.ctrlKey && evento.shiftKey && !evento.altKey && !evento.metaKey
        && !ponte.finestraAperta?.() && !ponte.paletteAperta?.()) {
        evento.preventDefault(); evento.stopImmediatePropagation();
        void avvia(predefinita());
      }
    }
    function puntatore(evento) {
      if (!menu.hidden && !menu.contains(evento.target) && !contenitore.contains(evento.target)) chiudiElenco(false);
    }
    function fuoco(evento) {
      if (dialogo && !dialogo.finestra.contains(evento.target)) dialogo.chiudi.focus();
      else if (!dialogo) controllaSessione();
    }
    const scollegaAllegati = core.collegaContestoAllegatiConsiglio?.(ponte.chiama, async (id) => {
      const s = ponte.sessioni?.get(id);
      if (!s || s.chiusuraInCorso) throw new Error("La conversazione sorgente non è più disponibile: gli allegati non possono essere verificati.");
      await attendiImportazioni(s);
      if (ponte.sessioni.get(id) !== s || s.chiusuraInCorso || s.erroreAllegatiBozza) {
        throw new Error("Gli allegati della conversazione sorgente non sono verificabili. Bozza e chip restano conservati.");
      }
      return { workspace: s.cartella, allegati: copia(s.allegati || []), allegatiLibreria: copia(s.allegatiLibreria || []) };
    });
    documento.addEventListener("keydown", tasti, true);
    documento.addEventListener("pointerdown", puntatore);
    documento.addEventListener("focusin", fuoco);
    input.addEventListener("input", controllaSessione);
    const Osservatore = documento.defaultView?.MutationObserver;
    const osservatore = Osservatore ? new Osservatore(controllaSessione) : null;
    osservatore?.observe(input, { attributes: true, attributeFilter: ["disabled"] });
    if (ponte.osservaStato) osservatore?.observe(ponte.osservaStato, { attributes: true, attributeFilter: ["aria-busy"] });
    const api = {
      aggiorna, avvia, apriGestisci, chiudiGestisci,
      distruggi() {
        distrutto = true;
        chiudiGestisci();
        osservatore?.disconnect();
        scollegaAllegati?.();
        documento.removeEventListener("keydown", tasti, true);
        documento.removeEventListener("pointerdown", puntatore);
        documento.removeEventListener("focusin", fuoco);
        input.removeEventListener("input", controllaSessione);
        contenitore.remove(); menu.remove(); stato.remove();
      },
    };
    contenitore.agenti = api;
    aggiornaControlli();
    api.pronto = aggiorna();
    return api;
  }

  return { montaAgenti, motivoPiano, configurazioneDaPreimpostazione };
});
