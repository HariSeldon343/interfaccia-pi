# Changelog

## 2.5.1 — 2026-08-25

- i riepiloghi di compattazione e di ramo non vengono più riversati come
  lunghi messaggi di sistema: restano chiusi, vengono renderizzati soltanto su
  richiesta e portano direttamente a **Cronologia e rami**;
- la cronologia compatta segue il leaf realmente attivo anche dopo un ritorno a
  un nodo precedente senza nuovi append; l'albero rimane visibile durante il
  lavoro e spiega quando la navigazione è temporaneamente indisponibile;
- i fallimenti intermedi dei tool sono mostrati in ambra come tentativi non
  riusciti, mentre il rosso resta riservato agli errori terminali; lo stderr
  diagnostico non lascia più una scheda permanentemente in errore;
- le righe tecniche ripetute `ottimizzazione: OK` e `orchestrazione: OK` sono
  rimosse dalla risposta visibile e dalla copia, conservando intatto il JSONL;
- **Stato reale** descrive tempo trascorso, operazioni, ragionamenti, tool
  corrente, tentativi falliti e coda senza interrompere Pi né inventare una
  percentuale;
- il costo viene etichettato come equivalente tariffario stimato; se il
  provider attuale è `openai-codex` la barra indica OAuth e avverte che una
  sessione mista può includere anche costi di altri provider o API;
- **falla dopo** è la modalità predefinita mentre Pi lavora; **intervieni
  adesso** avvisa che può deviare o concludere il turno e si disattiva dopo un
  solo invio;
- il prompt della GUI vieta promesse di lavoro in background, percentuali non
  misurate e dichiarazioni di completamento mentre un controllo deterministico
  è ancora fallito;
- testata, schede, stato e barra laterale adottano un layout più neutro e
  stabile, verificato senza overflow a 1136, 1024 e 820 pixel;
- aggiunti test regressivi per presentazione, compattazione lazy, warning,
  modalità della coda e leaf autorevole dopo `navigate_tree`.

## 2.5.0 — 2026-08-25

- **Nuova scheda** apre una sessione Pi indipendente nello stesso contesto di
  lavoro; più processi possono quindi lavorare nella medesima cartella senza
  condividere il file JSONL, mentre resta vietata la doppia apertura della
  stessa conversazione salvata;
- nuova estensione integrata e verificata `/sistema`, utilizzabile interamente
  dalla GUI per creare e riprendere progetti di sistemi di gestione
  multi-cliente;
- questionario persistente in blocchi di massimo quattro domande, piano
  documentale con dipendenze, registro append-only delle operazioni e stato di
  avanzamento verificabile;
- evidenze collegate per riferimento, con natura dell'informazione, metadati e
  SHA-256: nessun file del cliente viene copiato nell'app o nell'installer;
- librerie di template selezionate dall'utente e confinate alla radice reale,
  con supporto per DOCX/DOTX, XLSX/XLTX, ODT/ODS e Markdown;
- compilazione sicura dei placeholder `{{CHIAVE}}` e `[[CHIAVE]]`, anche quando
  Word o Excel li dividono internamente, e modalità dossier Word che conserva
  copertine, sezioni iniziali, stili, intestazioni e piè di pagina;
- ogni generazione crea una nuova revisione locale; placeholder o informazioni
  mancanti impediscono l'approvazione, e una modifica successiva viene rilevata
  confrontando l'impronta del file;
- esportazione consentita soltanto dopo conferma umana, in un nuovo pacchetto
  consegnabile con manifesto, provenienza e hash dei documenti;
- collaudo RPC con Pi 0.84.2, test su pacchetti Office ostili e prova visuale
  su un template Word reale senza modificare l'originale.

## 2.4.1 — 2026-08-25

- uno screenshot copiato negli appunti puo essere incollato direttamente nel
  composer con `Ctrl+V`, senza passare dal selettore file;
- l'immagine incollata usa la stessa anteprima rimovibile, persistenza della
  bozza e gli stessi limiti degli allegati scelti dal pulsante **+**;
- il normale incolla di testo resta nativo e la GUI non richiede permessi di
  lettura permanente della clipboard;
- se il modello corrente e solo testo, la GUI impedisce l'invio dell'immagine e
  spiega che Pi la trasformerebbe in `image omitted`; l'allegato gia presente
  resta nella bozza durante un cambio modello a caldo;
- test comportamentali dedicati coprono clipboard Windows/WebView2, MIME
  supportati, fallback file, clipboard mista, piu screenshot e compatibilita
  visiva del modello.

## 2.4.0 — 2026-08-24

- conversazioni utilizzabili anche senza selezionare una cartella;
- flusso `/login` allineato a Pi, con scelta account/OAuth oppure chiave API;
- apertura OAuth delegata in sicurezza al browser di sistema e callback manuale
  disponibile soltanto come fallback;
- ragionamento chiuso per impostazione predefinita;
- strumenti e ragionamenti consecutivi raccolti in un blocco **Attivita tecniche**
  chiuso, con conteggi e stato visibili;
- deduplicazione delle copie di sicurezza degli invii e testi della coda chiariti;
- stato esplicito durante compattazione e cambio modello;
- cronologia non piu presentata come vuota dopo un reload mentre Pi lavora;
- conversazioni gia aperte riconosciute nell'elenco delle salvate;
- pannello Skills aggiornabile senza riavviare o perdere la conversazione: il
  vero reload di Pi riscopre anche le skill installate dopo l'avvio;
- pulsante **Ricarica estensioni** nella barra Strumenti e menu rapido **+** per
  allegare immagini, richiamare skill o procedure e usare i comandi delle
  estensioni secondo la disponibilita GUI/terminale dichiarata da Pi;
- Pi riceve in ogni sessione il contesto dell'interfaccia grafica e propone
  collegamenti Markdown adatti al clic, senza istruzioni da terminale o
  scorciatoie Desktop non richieste;
- link web, percorsi assoluti e target Markdown locali o relativi realmente
  apribili dalla chat, con canonicalizzazione, confine della cartella di lavoro
  e blocco di rete, namespace, stream NTFS e file attivi;
- accesso diretto dalla barra Strumenti all'albero della conversazione, per
  tornare a un passaggio precedente senza cancellare il ramo successivo;
- preparazione del runtime e workflow Windows resi riproducibili e fail-fast
  anche sui runner GitHub ospitati;
- percorsi Windows confrontati nella forma canonica e rilevamento dei dischi
  locali tollerante anche ai cold-start molto lenti di PowerShell, restando
  fail-closed;
- suite di regressione estesa e smoke test con il runtime Pi incluso.

## 2.3.1 — 2026-08-23

- base sorgente completa e installer autocontenuto per Windows.
