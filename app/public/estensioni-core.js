(function pubblicaEstensioni(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiEstensioniCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaEstensioniCore() {
  "use strict";

  const AVVISO_FIRMA = "Installare un pacchetto è un atto di fiducia pari all'installazione di un programma. La firma certifica provenienza e integrità, non confinamento.";
  const AVVISO_PI = "I pacchetti dichiarati dall'utente nelle impostazioni di Pi restano suoi e possono essere risolti e installati da Pi all'avvio, prima dei filtri delle risorse.";
  const AVVISO_PERSONALI = "Disattivare un pacchetto non spegne una copia personale con lo stesso nome. Le cartelle personali di Pi vengono soltanto lette; lo stato attiva nell'app si salva nel registro dell'app.";
  const AVVISO_APPLICAZIONE = "Applica riavvia Pi soltanto nelle conversazioni ferme, conservando bozza e allegati. Durante un turno, un lavoro degli agenti o un test l'applicazione è rinviata. Ricarica risorse aggiorna il contenuto, non l'elenco dei percorsi.";
  const array = (valore) => Array.isArray(valore) ? valore : [];
  const testo = (valore) => typeof valore === "string" ? valore : "";

  function statoEstensione(voce) {
    if (voce.stato === "Manomessa" || voce.stato === "Non compatibile") return voce.stato;
    if (voce.inUso || voce.rimovibile === false) return "In uso, non rimovibile adesso";
    if (voce.statoApplicazione === "Da applicare" || voce.attiva !== voce.attivaApplicata
      || (voce.attiva && voce.versioneInstallata !== voce.versioneApplicata)) return "Da applicare";
    return voce.attivaApplicata ? "Attiva" : "Disattiva";
  }

  function anteprimaRisorsa(risorsa) {
    return { tipo: testo(risorsa.tipo), percorso: testo(risorsa.percorso),
      origine: testo(risorsa.origine || risorsa.radice), testo: testo(risorsa.testo),
      attiva: risorsa.attiva === true, attivaApplicata: risorsa.attivaApplicata === true,
      stato: testo(risorsa.stato), messaggio: testo(risorsa.messaggio), troncata: risorsa.troncata === true,
      statoApplicazione: testo(risorsa.statoApplicazione), attivabile: risorsa.tipo !== "tema" && risorsa.stato !== "Assente" };
  }

  function creaVistaEstensioni(risposta = {}) {
    return {
      versioneArchivio: Number.isSafeInteger(risposta.versioneArchivio) ? risposta.versioneArchivio : 0,
      avvisi: [AVVISO_FIRMA, AVVISO_PI, AVVISO_PERSONALI, AVVISO_APPLICAZIONE, ...array(risposta.avvisiRisorsePersonali).map(testo)],
      migrazione: risposta.migrazione || null,
      messaggio: testo(risposta.messaggio),
      estensioni: array(risposta.estensioni).map((voce) => ({
        ...voce, nome: testo(voce.nome || voce.id), stato: statoEstensione(voce),
        compatibilita: voce.host ? `Da ${voce.host.minInclusa} inclusa a ${voce.host.maxEsclusa} esclusa` : "Compatibilità non verificata",
        risorse: array(voce.risorse).map(anteprimaRisorsa),
        puoAttivare: !["Manomessa", "Non compatibile"].includes(statoEstensione(voce)),
        puoRimuovere: voce.rimovibile === true,
        puoAprire: voce.attivaApplicata === true && array(voce.pannelli).length > 0,
        versioniPrecedenti: array(voce.versioniPresenti).filter((v) => {
          const a = String(v).split(".").map(Number);
          const b = String(voce.versioneInstallata).split(".").map(Number);
          for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
          return false;
        }),
      })),
      risorsePersonali: array(risposta.risorsePersonali).map(anteprimaRisorsa),
    };
  }

  // L'unico accesso al documento passa dal contenitore fornito dal chiamante.
  // Il modulo caricato da solo non monta nulla e non legge il DOM globale.
  function montaEstensioni(contenitore, ponte) {
    if (!contenitore?.ownerDocument || typeof ponte?.elenco !== "function") throw new Error("È necessario fornire il contenitore e le chiamate al ponte delle estensioni.");
    const documento = contenitore.ownerDocument;
    const radice = documento.createElement("section");
    const pulsante = documento.createElement("button");
    pulsante.type = "button";
    pulsante.id = "btn-estensioni";
    pulsante.textContent = "Estensioni";
    pulsante.setAttribute("aria-controls", "pannello-estensioni");
    pulsante.setAttribute("aria-expanded", "false");
    const pannello = documento.createElement("section");
    pannello.id = "pannello-estensioni";
    pannello.setAttribute("aria-label", "Estensioni");
    pannello.hidden = true;
    const stato = documento.createElement("p");
    stato.setAttribute("role", "status");
    const contenuto = documento.createElement("div");
    pannello.append(stato, contenuto);
    radice.append(pulsante, pannello);
    contenitore.append(radice);
    let vista = creaVistaEstensioni();
    let distrutto = false;
    let occupato = false;

    function elemento(tag, valore, padre) {
      const nodo = documento.createElement(tag);
      if (valore != null) nodo.textContent = String(valore);
      padre.append(nodo);
      return nodo;
    }
    async function esegui(nome, dati) {
      if (occupato || distrutto) return;
      occupato = true;
      pannello.setAttribute("aria-busy", "true");
      try {
        if (typeof ponte[nome] !== "function") throw new Error("Questa operazione non è disponibile nel ponte.");
        const risposta = await ponte[nome]({ ...dati, versioneAttesa: vista.versioneArchivio });
        if (risposta?.annullata) { stato.textContent = "Installazione annullata. Nessuna modifica."; return; }
        await aggiorna(risposta?.estensioni ? risposta : undefined);
      } catch (errore) { stato.textContent = errore.message || "L'operazione sulle estensioni non è riuscita."; }
      finally { occupato = false; pannello.removeAttribute("aria-busy"); }
    }
    function bottone(padre, etichetta, funzione, disabilitato = false) {
      const nodo = elemento("button", etichetta, padre);
      nodo.type = "button";
      nodo.disabled = disabilitato;
      nodo.addEventListener("click", funzione);
      return nodo;
    }
    function mostraRisorsa(padre, risorsa, personale) {
      const dettagli = elemento("details", null, padre);
      elemento("summary", `${risorsa.tipo}: ${risorsa.percorso}`, dettagli);
      elemento("p", `Origine: ${risorsa.origine}`, dettagli);
      elemento("p", `Percorso: ${risorsa.percorso}`, dettagli);
      if (risorsa.messaggio) elemento("p", risorsa.messaggio, dettagli);
      if (risorsa.troncata && !risorsa.messaggio) elemento("p", "Anteprima troncata: il testo supera il limite di lettura.", dettagli);
      elemento("pre", risorsa.testo, dettagli);
      if (personale) {
        const etichetta = elemento("label", null, dettagli);
        const interruttore = elemento("input", null, etichetta);
        interruttore.type = "checkbox";
        interruttore.checked = risorsa.attiva;
        interruttore.disabled = !risorsa.attivabile && !risorsa.attiva;
        elemento("span", " Attiva nell'app", etichetta);
        if (risorsa.tipo === "tema") elemento("p", "Tema consultabile; l'attivazione dei temi non è supportata nella 2.9.", dettagli);
        if (risorsa.statoApplicazione === "Da applicare") elemento("p", "Da applicare", dettagli);
        interruttore.addEventListener("change", () => esegui("attiva", { percorso: risorsa.percorso, attiva: interruttore.checked }));
        if (risorsa.stato === "Da rileggere") bottone(dettagli, "Ho riletto, attiva nell'app", () => esegui("attiva", { percorso: risorsa.percorso, attiva: true }));
      }
    }
    async function cartella(nome) {
      try {
        if (typeof ponte.scegliCartella !== "function") { stato.textContent = "La scelta della cartella non è disponibile."; return; }
        const percorso = await ponte.scegliCartella();
        if (!percorso) return;
        let confermaMigrazione = false;
        if (vista.migrazione?.presente && typeof ponte.confermaMigrazione === "function") {
          confermaMigrazione = await ponte.confermaMigrazione(vista.migrazione);
          if (!confermaMigrazione) return;
        }
        await esegui(nome, { cartella: percorso, confermaMigrazione });
      } catch (errore) {
        stato.textContent = errore.message || "La scelta della cartella non è riuscita.";
      }
    }
    function disegna() {
      contenuto.replaceChildren();
      stato.textContent = vista.messaggio;
      elemento("h2", "Estensioni", contenuto);
      for (const avviso of vista.avvisi) elemento("p", avviso, contenuto);
      if (vista.migrazione?.presente) {
        elemento("p", `${vista.migrazione.titolo || "Il Sistema Guidato ora si installa a parte"}. ${vista.migrazione.messaggio || "I documenti restano dove sono; prima dell'installazione viene creata una copia di sicurezza."}`, contenuto);
      }
      bottone(contenuto, "Installa da cartella", () => cartella("installa"));
      bottone(contenuto, "Applica", () => esegui("applica", {}));
      if (!vista.estensioni.length) elemento("p", "Nessuna estensione installata.", contenuto);
      for (const voce of vista.estensioni) {
        const dettagli = elemento("details", null, contenuto);
        elemento("summary", `${voce.nome} · ${voce.versioneInstallata} · ${voce.stato}`, dettagli);
        elemento("p", `Editore: ${voce.editore || "Non verificato"}`, dettagli);
        elemento("p", voce.descrizione || "", dettagli);
        elemento("p", voce.compatibilita, dettagli);
        elemento("p", `Cartella di origine: ${voce.origine}`, dettagli);
        if (voce.messaggio) elemento("p", voce.messaggio, dettagli);
        for (const risorsa of voce.risorse) mostraRisorsa(dettagli, risorsa, false);
        // Attiva compare dentro l'anteprima, dopo il contenuto completo.
        bottone(dettagli, voce.attiva ? "Disattiva" : "Attiva", () => esegui("attiva", { id: voce.id, attiva: !voce.attiva }), !voce.attiva && !voce.puoAttivare);
        if (voce.puoAprire) bottone(dettagli, "Apri", () => ponte.apri?.({ id: voce.id }));
        bottone(dettagli, "Aggiorna da cartella", () => cartella("aggiorna"));
        bottone(dettagli, "Rimuovi", () => esegui("rimuovi", { id: voce.id }), !voce.puoRimuovere);
        elemento("p", "Rimuovi cancella soltanto il programma e conserva i dati.", dettagli);
        if (voce.versioniPrecedenti.length) {
          const selettore = elemento("select", null, dettagli);
          selettore.setAttribute("aria-label", `Versione precedente di ${voce.nome}`);
          for (const versione of voce.versioniPrecedenti) { const opzione = elemento("option", versione, selettore); opzione.value = versione; }
          const conferma = elemento("input", null, dettagli);
          conferma.type = "text";
          conferma.setAttribute("aria-label", "Conferma scritta del ritorno alla versione precedente");
          elemento("p", "Scrivi Torna a seguito dal numero di versione, per esempio Torna a 1.0.0.", dettagli);
          bottone(dettagli, "Torna alla versione precedente", () => esegui("tornaVersione", { id: voce.id, versione: selettore.value, conferma: conferma.value }));
        }
      }
      elemento("h2", "Risorse personali di Pi", contenuto);
      if (!vista.risorsePersonali.length) elemento("p", "Nessuna risorsa personale trovata.", contenuto);
      for (const risorsa of vista.risorsePersonali) mostraRisorsa(contenuto, risorsa, true);
    }
    async function aggiorna(risposta) {
      const dati = risposta || await ponte.elenco();
      if (distrutto) return;
      vista = creaVistaEstensioni(dati);
      disegna();
      return vista;
    }
    async function apertura() {
      pannello.hidden = !pannello.hidden;
      pulsante.setAttribute("aria-expanded", String(!pannello.hidden));
      if (!pannello.hidden) { try { await aggiorna(); } catch (errore) { stato.textContent = errore.message; } }
    }
    pulsante.addEventListener("click", apertura);
    pannello.addEventListener("keydown", (evento) => {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      pannello.hidden = true;
      pulsante.setAttribute("aria-expanded", "false");
      pulsante.focus();
    });
    return { aggiorna, apri: async () => { if (pannello.hidden) await apertura(); }, distruggi: () => { distrutto = true; radice.remove(); } };
  }

  return { AVVISO_FIRMA, AVVISO_PI, AVVISO_PERSONALI, AVVISO_APPLICAZIONE, statoEstensione, anteprimaRisorsa, creaVistaEstensioni, montaEstensioni };
});
