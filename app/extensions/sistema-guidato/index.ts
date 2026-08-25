import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  approvaDocumento,
  caricaDatiProgetto,
  collegaLibreriaTemplate,
  creaProgetto,
  elencaProgetti,
  esportaDocumentiApprovati,
  generaBozzaDocumento,
  mappaTemplateDocumento,
  normalizzaSchemi,
  promptProssimoPasso,
  prossimeDomande,
  QUESTIONARIO_BASE,
  registraEvidenza,
  riepilogoProgetto,
  salvaRisposte,
  verificaCompletezza,
} from "./core.mjs";

type Progetto = Awaited<ReturnType<typeof elencaProgetti>>[number];
type DatiProgetto = Awaited<ReturnType<typeof caricaDatiProgetto>>;

function etichettaProgetto(progetto: Progetto) {
  return `${progetto.cliente?.nome || "Cliente"} — ${progetto.titolo || progetto.id}`;
}

function etichettaDocumento(documento: DatiProgetto["documenti"]["documenti"][number]) {
  const stato = documento.approvazione?.stato === "approvato" ? "approvato" : documento.stato;
  return `${documento.id} — ${documento.titolo} [${stato}]`;
}

async function scegliProgetto(ctx: ExtensionContext, progetti: Progetto[]) {
  if (progetti.length === 0) {
    ctx.ui.notify("Nessun sistema guidato presente in questa cartella.", "warning");
    return null;
  }
  if (progetti.length === 1) return progetti[0];
  const opzioni = progetti.map(etichettaProgetto);
  const scelta = await ctx.ui.select("Scegli il sistema di gestione", opzioni);
  if (!scelta) return null;
  return progetti[opzioni.indexOf(scelta)] || null;
}

async function scegliDocumento(
  ctx: ExtensionContext,
  dati: DatiProgetto,
  titolo: string,
  filtro: (documento: DatiProgetto["documenti"]["documenti"][number]) => boolean = () => true,
) {
  const candidati = (dati.documenti.documenti || []).filter(filtro);
  if (candidati.length === 0) {
    ctx.ui.notify("Nessun documento disponibile per questa operazione.", "warning");
    return null;
  }
  const opzioni = candidati.map(etichettaDocumento);
  const scelta = await ctx.ui.select(titolo, opzioni);
  if (!scelta) return null;
  return candidati[opzioni.indexOf(scelta)] || null;
}

function attivaProgetto(ctx: ExtensionContext, progetto: Progetto) {
  ctx.ui.setStatus("sistema-guidato", `Sistema: ${progetto.cliente.nome} · ${progetto.fase}`);
  ctx.ui.setEditorText(promptProssimoPasso(progetto));
}

async function progettoCorrente(ctx: ExtensionContext) {
  return scegliProgetto(ctx, await elencaProgetti(ctx.cwd));
}

async function nuovoSistema(pi: ExtensionAPI, ctx: ExtensionContext) {
  const cliente = (await ctx.ui.input("Nuovo sistema — cliente", "Nome dell'organizzazione"))?.trim();
  if (!cliente) return;
  const titolo = (await ctx.ui.input("Nome del progetto", `Sistema di gestione integrato - ${cliente}`))?.trim();
  if (!titolo) return;
  const testoSchemi = await ctx.ui.editor("Schemi, norme e riferimenti applicabili — uno per riga", "");
  const schemi = normalizzaSchemi(testoSchemi || "");
  if (schemi.length === 0) {
    ctx.ui.notify("Il progetto richiede almeno uno schema o riferimento.", "warning");
    return;
  }
  const consulente = (await ctx.ui.input("Consulente responsabile", "Nome o ruolo"))?.trim() || "";
  const contesto = await ctx.ui.editor("Contesto iniziale — puoi lasciarlo vuoto e completarlo dopo", "");
  const conferma = await ctx.ui.confirm(
    "Crea il sistema guidato?",
    `Cliente: ${cliente}\nProgetto: ${titolo}\nSchemi: ${schemi.map((voce) => voce.titolo).join(", ")}\n\nI dati saranno salvati localmente nella cartella di lavoro.`,
  );
  if (!conferma) return;
  const { progetto, directory } = await creaProgetto(ctx.cwd, { cliente, titolo, schemi, consulente, contesto: contesto || "" });
  pi.appendEntry("sistema-guidato", { azione: "progetto-creato", projectId: progetto.id, cliente: progetto.cliente.nome, directory });
  attivaProgetto(ctx, progetto);
  ctx.ui.notify("Sistema creato. Usa /sistema domande per iniziare la raccolta guidata.", "info");
}

async function riprendiSistema(pi: ExtensionAPI, ctx: ExtensionContext) {
  const progetto = await progettoCorrente(ctx);
  if (!progetto) return;
  pi.appendEntry("sistema-guidato", { azione: "progetto-ripreso", projectId: progetto.id, cliente: progetto.cliente.nome });
  attivaProgetto(ctx, progetto);
  ctx.ui.notify("Progetto caricato; controlla e invia il testo predisposto.", "info");
}

async function raccogliRisposte(pi: ExtensionAPI, ctx: ExtensionContext) {
  const progetto = await progettoCorrente(ctx);
  if (!progetto) return;
  const dati = await caricaDatiProgetto(ctx.cwd, progetto.id);
  const domande = prossimeDomande(dati.risposte, 4);
  if (domande.length === 0) {
    ctx.ui.notify("Il questionario di base e completo. Collega le evidenze e passa ai documenti.", "info");
    return;
  }
  const risposte = [];
  for (const domanda of domande) {
    const risposta = await ctx.ui.editor(`${domanda.sezione} · ${domanda.id}\n${domanda.domanda}`, "");
    if (risposta == null) break;
    if (risposta.trim()) risposte.push({ questionId: domanda.id, risposta: risposta.trim() });
  }
  if (risposte.length === 0) return;
  const conferma = await ctx.ui.confirm(
    "Salvare questo blocco di risposte?",
    `${risposte.length} risposte saranno registrate come dichiarazioni dell'utente, ancora da verificare con evidenze.`,
  );
  if (!conferma) return;
  const esito = await salvaRisposte(ctx.cwd, progetto.id, risposte);
  pi.appendEntry("sistema-guidato", { azione: "risposte-salvate", projectId: progetto.id, conteggio: esito.salvate });
  ctx.ui.setStatus("sistema-guidato", `Sistema: ${progetto.cliente.nome} · raccolta ${esito.risposte.risposte.length}/${QUESTIONARIO_BASE.length}`);
  ctx.ui.notify(`Salvate ${esito.salvate} risposte. Prossimo blocco: ${esito.prossime.length} domande.`, "info");
}

async function collegaEvidenza(pi: ExtensionAPI, ctx: ExtensionContext) {
  const progetto = await progettoCorrente(ctx);
  if (!progetto) return;
  const dati = await caricaDatiProgetto(ctx.cwd, progetto.id);
  const percorso = (await ctx.ui.input("Collega un'evidenza", "Percorso assoluto del file"))?.trim();
  if (!percorso) return;
  const descrizione = await ctx.ui.editor("Descrizione sintetica dell'evidenza", "");
  if (descrizione == null) return;
  const etichetteNatura = ["Fatto verificato", "Dichiarazione dell'utente", "Fonte normativa o contrattuale", "Evidenza collegata da verificare"];
  const naturaScelta = await ctx.ui.select("Natura dell'informazione", etichetteNatura);
  if (!naturaScelta) return;
  const natura = ["fatto-verificato", "dichiarazione-utente", "fonte-normativa", "evidenza-collegata"][etichetteNatura.indexOf(naturaScelta)];
  const opzioniDomanda = ["Nessuna domanda specifica", ...QUESTIONARIO_BASE.map((voce) => `${voce.id} — ${voce.domanda}`)];
  const domandaScelta = await ctx.ui.select("Collega l'evidenza a una domanda", opzioniDomanda);
  if (!domandaScelta) return;
  const questionId = domandaScelta === opzioniDomanda[0] ? null : QUESTIONARIO_BASE[opzioniDomanda.indexOf(domandaScelta) - 1]?.id || null;
  const opzioniDocumento = ["Nessun documento specifico", ...(dati.documenti.documenti || []).map(etichettaDocumento)];
  const documentoScelto = await ctx.ui.select("Collega anche a un documento", opzioniDocumento);
  if (!documentoScelto) return;
  const documento = documentoScelto === opzioniDocumento[0] ? null : dati.documenti.documenti[opzioniDocumento.indexOf(documentoScelto) - 1]?.id || null;
  const conferma = await ctx.ui.confirm(
    "Collegare l'evidenza?",
    "Il file non verra copiato. Saranno salvati percorso, metadati e SHA-256 per rilevare modifiche successive.",
  );
  if (!conferma) return;
  const esito = await registraEvidenza(ctx.cwd, progetto.id, { percorso, descrizione, natura, questionId, documenti: documento ? [documento] : [] });
  pi.appendEntry("sistema-guidato", { azione: "evidenza-collegata", projectId: progetto.id, evidenceId: esito.evidenza.id, sha256: esito.evidenza.sha256 });
  ctx.ui.notify("Evidenza collegata e impronta SHA-256 registrata. Nessuna copia eseguita.", "info");
}

async function collegaTemplate(pi: ExtensionAPI, ctx: ExtensionContext) {
  const progetto = await progettoCorrente(ctx);
  if (!progetto) return;
  const percorso = (await ctx.ui.input("Cartella dei template", "Percorso assoluto contenente DOCX, XLSX, ODT o Markdown"))?.trim();
  if (!percorso) return;
  const conferma = await ctx.ui.confirm(
    "Collegare questa libreria?",
    "Verranno indicizzati soltanto percorsi e nomi dei file. I documenti non saranno copiati nell'applicazione o nell'installer.",
  );
  if (!conferma) return;
  const { progetto: aggiornato, indice } = await collegaLibreriaTemplate(ctx.cwd, progetto.id, percorso);
  pi.appendEntry("sistema-guidato", { azione: "template-collegati", projectId: progetto.id, conteggio: indice.conteggio });
  attivaProgetto(ctx, aggiornato);
  ctx.ui.notify(`${indice.conteggio} template indicizzati. Nessun file e stato copiato.`, "info");
}

async function mappaTemplate(pi: ExtensionAPI, ctx: ExtensionContext, dati: DatiProgetto) {
  if (!dati.template.radice || !dati.template.file?.length) {
    ctx.ui.notify("Collega prima una cartella di template.", "warning");
    return;
  }
  const documento = await scegliDocumento(ctx, dati, "Documento da associare al template");
  if (!documento) return;
  const ricerca = (await ctx.ui.input("Cerca nella libreria", "Parole presenti nel nome o nel percorso; vuoto = primi risultati"))?.trim().toLocaleLowerCase("it-IT") || "";
  const termini = ricerca.split(/\s+/).filter(Boolean);
  const candidati = dati.template.file.filter((file: string) => termini.every((termine) => file.toLocaleLowerCase("it-IT").includes(termine))).slice(0, 80);
  if (candidati.length === 0) {
    ctx.ui.notify("Nessun template corrisponde alla ricerca.", "warning");
    return;
  }
  const templateId = await ctx.ui.select(`Scegli il template (${candidati.length} risultati, massimo 80)`, candidati);
  if (!templateId) return;
  const conferma = await ctx.ui.confirm("Associare il template?", `${documento.id} — ${documento.titolo}\n\n${templateId}\n\nIl file originale restera invariato.`);
  if (!conferma) return;
  await mappaTemplateDocumento(ctx.cwd, dati.progetto.id, documento.id, templateId);
  pi.appendEntry("sistema-guidato", { azione: "template-mappato", projectId: dati.progetto.id, documentoId: documento.id, templateId });
  ctx.ui.notify("Template associato al documento. L'originale non e stato modificato.", "info");
}

async function generaBozza(pi: ExtensionAPI, ctx: ExtensionContext, dati: DatiProgetto) {
  const documento = await scegliDocumento(ctx, dati, "Documento da generare", (voce) => Boolean(voce.templateId));
  if (!documento) return;
  const opzioni = ["Compila i placeholder {{CHIAVE}} / [[CHIAVE]] del template"];
  if (/\.(?:docx|dotx)$/i.test(documento.templateId || "")) opzioni.push("Crea un dossier fattuale Word usando lo stile del template");
  const scelta = await ctx.ui.select("Modalita di generazione", opzioni);
  if (!scelta) return;
  const modalita = scelta === opzioni[0] ? "placeholder" : "dossier-fattuale";
  const conferma = await ctx.ui.confirm(
    "Generare una nuova bozza revisionata?",
    modalita === "placeholder"
      ? "La GUI compilera soltanto i placeholder riconosciuti. Il template originale restera invariato e i campi mancanti bloccheranno l'approvazione."
      : "La GUI sostituira il contenuto dell'ultima sezione soltanto nella copia di lavoro; eventuali sezioni iniziali, stili, intestazioni, pie di pagina e impostazioni di sezione resteranno preservati. Le informazioni mancanti bloccheranno l'approvazione.",
  );
  if (!conferma) return;
  const esito = await generaBozzaDocumento(ctx.cwd, dati.progetto.id, documento.id, { modalita });
  pi.appendEntry("sistema-guidato", { azione: "bozza-generata", projectId: dati.progetto.id, documentoId: documento.id, file: esito.revisione.file, sha256: esito.revisione.sha256Output });
  if (esito.documento.stato === "bozza-da-completare") {
    const mancanti = [...esito.revisione.tokenResidui, ...esito.revisione.campiMancanti];
    ctx.ui.notify(`Bozza creata, ma non approvabile: ${mancanti.length} informazioni o placeholder mancanti.`, "warning");
  } else {
    ctx.ui.notify(`Bozza generata: ${esito.revisione.file}. Verificala visivamente prima di approvarla.`, "info");
  }
}

async function approvaBozza(pi: ExtensionAPI, ctx: ExtensionContext, dati: DatiProgetto) {
  const documento = await scegliDocumento(ctx, dati, "Bozza da approvare", (voce) => Boolean(voce.fileOutput));
  if (!documento) return;
  const revisione = documento.revisioni?.at(-1);
  const mancanti = [...(revisione?.tokenResidui || []), ...(revisione?.campiMancanti || [])];
  if (mancanti.length) {
    ctx.ui.notify(`La bozza non e approvabile: restano ${mancanti.length} elementi da completare.`, "warning");
    return;
  }
  const responsabile = (await ctx.ui.input("Responsabile dell'approvazione", dati.progetto.consulente || "Nome e cognome"))?.trim() || dati.progetto.consulente || "";
  if (!responsabile) return;
  const nota = await ctx.ui.editor("Nota di verifica — facoltativa", "");
  if (nota == null) return;
  const conferma = await ctx.ui.confirm(
    "Confermi l'approvazione umana?",
    `${documento.id} — ${documento.titolo}\nFile: ${documento.fileOutput}\nSHA-256: ${revisione?.sha256Output}\n\nConferma soltanto dopo avere aperto e verificato il documento.`,
  );
  if (!conferma) return;
  const esito = await approvaDocumento(ctx.cwd, dati.progetto.id, documento.id, responsabile, nota);
  pi.appendEntry("sistema-guidato", { azione: "documento-approvato", projectId: dati.progetto.id, documentoId: documento.id, approvatoDa: responsabile, sha256: esito.documento.approvazione.sha256 });
  ctx.ui.notify("Documento approvato. Qualsiasi modifica successiva ne invalidera l'integrita.", "info");
}

async function esportaApprovati(pi: ExtensionAPI, ctx: ExtensionContext, dati: DatiProgetto) {
  const approvati = (dati.documenti.documenti || []).filter((voce) => voce.approvazione?.stato === "approvato");
  if (!approvati.length) {
    ctx.ui.notify("Non ci sono documenti approvati da esportare.", "warning");
    return;
  }
  const conferma = await ctx.ui.confirm(
    "Creare il pacchetto consegnabile?",
    `${approvati.length} documenti approvati saranno copiati in una nuova cartella locale con manifesto e SHA-256. Nessun file verra caricato online.`,
  );
  if (!conferma) return;
  const esito = await esportaDocumentiApprovati(ctx.cwd, dati.progetto.id);
  pi.appendEntry("sistema-guidato", { azione: "pacchetto-esportato", projectId: dati.progetto.id, cartella: esito.cartella, documenti: esito.manifesto.file.map((voce) => voce.documentoId) });
  ctx.ui.notify(`Pacchetto creato: ${esito.cartella}`, "info");
}

async function gestisciDocumenti(pi: ExtensionAPI, ctx: ExtensionContext) {
  const progetto = await progettoCorrente(ctx);
  if (!progetto) return;
  const dati = await caricaDatiProgetto(ctx.cwd, progetto.id);
  const scelta = await ctx.ui.select("Documenti e output", [
    "Associa un template a un documento",
    "Genera una nuova bozza",
    "Approva una bozza verificata",
    "Esporta i documenti approvati",
    "Annulla",
  ]);
  if (scelta === "Associa un template a un documento") return mappaTemplate(pi, ctx, dati);
  if (scelta === "Genera una nuova bozza") return generaBozza(pi, ctx, dati);
  if (scelta === "Approva una bozza verificata") return approvaBozza(pi, ctx, dati);
  if (scelta === "Esporta i documenti approvati") return esportaApprovati(pi, ctx, dati);
}

function testoVerifica(dati: DatiProgetto) {
  const esito = verificaCompletezza(dati);
  return [
    riepilogoProgetto(dati.progetto),
    "",
    `Questionario: ${esito.risposte}/${esito.domandeTotali}`,
    `Risposte obbligatorie mancanti: ${esito.obbligatorieMancanti.length}`,
    `Template indicizzati: ${esito.templateIndicizzati}`,
    `Template associati: ${esito.templateMappati}/${esito.documentiTotali}`,
    `Bozze generate: ${esito.bozzeGenerate}`,
    `Documenti approvati: ${esito.documentiApprovati}`,
    `Placeholder residui: ${esito.placeholderResidui.length}`,
    `Informazioni documento mancanti: ${esito.informazioniDocumentoMancanti.length}`,
    `Gate esportazione: ${esito.prontoPerEsportazione ? "aperto" : "chiuso"}`,
  ].join("\n");
}

async function mostraStato(pi: ExtensionAPI, ctx: ExtensionContext) {
  const progetto = await progettoCorrente(ctx);
  if (!progetto) return;
  const dati = await caricaDatiProgetto(ctx.cwd, progetto.id);
  const scelta = await ctx.ui.select(`Stato e verifica\n\n${testoVerifica(dati)}`, [
    "Continua il questionario",
    "Apri documenti e output",
    "Riprendi la progettazione in chat",
    "Chiudi",
  ]);
  if (scelta === "Continua il questionario") return raccogliRisposte(pi, ctx);
  if (scelta === "Apri documenti e output") return gestisciDocumenti(pi, ctx);
  if (scelta === "Riprendi la progettazione in chat") attivaProgetto(ctx, progetto);
}

export default function sistemaGuidato(pi: ExtensionAPI) {
  pi.on("session_start", async (_evento, ctx) => {
    const [recente] = await elencaProgetti(ctx.cwd).catch(() => []);
    if (recente) ctx.ui.setStatus("sistema-guidato", `Sistema: ${recente.cliente.nome} · ${recente.fase}`);
  });

  pi.registerCommand("sistema", {
    description: "Crea, riprende e controlla un sistema di gestione guidato multi-cliente",
    handler: async (args, ctx) => {
      const azione = args.trim().toLocaleLowerCase("it-IT");
      try {
        if (["nuovo", "crea"].includes(azione)) return await nuovoSistema(pi, ctx);
        if (["riprendi", "continua"].includes(azione)) return await riprendiSistema(pi, ctx);
        if (["domande", "questionario"].includes(azione)) return await raccogliRisposte(pi, ctx);
        if (["evidenza", "evidenze"].includes(azione)) return await collegaEvidenza(pi, ctx);
        if (["documenti", "output"].includes(azione)) return await gestisciDocumenti(pi, ctx);
        if (["stato", "verifica"].includes(azione)) return await mostraStato(pi, ctx);
        if (["template", "modelli"].includes(azione)) return await collegaTemplate(pi, ctx);
        const scelta = await ctx.ui.select("Sistema di gestione guidato", [
          "Crea un nuovo sistema",
          "Riprendi un sistema in chat",
          "Continua le domande guidate",
          "Collega un'evidenza",
          "Documenti e output",
          "Stato e verifica",
          "Collega la cartella dei template",
          "Annulla",
        ]);
        if (scelta === "Crea un nuovo sistema") return await nuovoSistema(pi, ctx);
        if (scelta === "Riprendi un sistema in chat") return await riprendiSistema(pi, ctx);
        if (scelta === "Continua le domande guidate") return await raccogliRisposte(pi, ctx);
        if (scelta === "Collega un'evidenza") return await collegaEvidenza(pi, ctx);
        if (scelta === "Documenti e output") return await gestisciDocumenti(pi, ctx);
        if (scelta === "Stato e verifica") return await mostraStato(pi, ctx);
        if (scelta === "Collega la cartella dei template") return await collegaTemplate(pi, ctx);
      } catch (errore) {
        ctx.ui.notify(`Sistema guidato: ${String((errore as Error)?.message || errore)}`, "error");
      }
    },
  });
}
