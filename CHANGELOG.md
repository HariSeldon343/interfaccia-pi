# Changelog

## 2.6.0 RC — 2026-08-25

- **Sistema Guidato** e ora un pannello interno autonomo, apribile dal pulsante
  nella testata o dal comando virtuale `/sistema` anche quando non e stata
  selezionata una cartella di lavoro;
- il backend viene avviato pigramente una sola volta per processo GUI, condiviso
  fra le chat, arrestato insieme al bridge e riavviato in modo controllato dopo
  un crash;
- dashboard e API sono esposte sotto `/sistema/` sulla stessa origine della GUI:
  il browser non riceve token, cookie backend o segreti in URL, HTML,
  JavaScript, localStorage, sessionStorage, header di risposta o log;
- il proxy crea e conserva soltanto in memoria host la sessione attendibile del
  backend, la associa a `prepare`/`commit` di ruoli e finding e la rinnova senza
  riusare una mutazione: dopo un rinnovo un ticket precedente deve essere
  preparato di nuovo;
- runtime Pi, dashboard e template del modulo provengono dal monorepo
  `sistema-guidato`; l'host verifica versione, patch RPC, lettori e writer di
  schema, manifesti, dimensioni e SHA-256 di ogni file prima di avviare il
  servizio;
- il writer storico schema 1 non viene piu caricato o registrato in Pi. I dati
  esistenti restano disponibili soltanto come sorgente read-only di una
  migrazione esplicita, con anteprima e conferma; nessun dato viene eliminato o
  sovrascritto automaticamente;
- aggiunti test di pannello senza cartella, comando unico `/sistema`, proxy
  same-origin, session binding, singleton, crash recovery, shutdown, bundle e
  compatibilita, conservando le funzioni e la copertura della 2.5.3;
- predisposto l'updater Tauri 2 con flusso interamente manuale, capability
  confinata, shutdown ordinato e pipeline production fail-closed. La build
  pilota resta updater-disabled; G11 e ACC-16 restano aperti fino al drill reale
  N-1, recovery e rollback.

## 2.5.3 — 2026-08-25

- dopo una compattazione la chat conserva, integralmente e nello stesso ordine,
  il testo di tutti i prompt originali dell'utente appartenenti al ramo attivo;
  le immagini storiche restano nel JSONL ma vengono mostrate come segnaposto,
  senza ricaricare ogni volta i relativi base64; il riepilogo
  rimane un elemento aggiuntivo chiuso e non ripristina risposte o output
  tecnici gia sintetizzati; le cronologie molto lunghe vengono ricostruite a
  blocchi, mantenendo il campo testo utilizzabile senza perdere ordine o prompt;
- il pulsante **+** permette di allegare file generici oltre alle immagini;
  file e immagini possono anche essere trascinati nel composer, persistono con
  la bozza e sono mostrati come allegati senza esporre il marcatore tecnico
  inviato a Pi; i file generici usano un token locale non forgiabile e passano
  atomicamente da pending a permanenti quando il prompt entra nel canale RPC;
  la rimozione dalla bozza cancella soltanto i pending e un cleanup prudente
  elimina esclusivamente pending orfani senza contatto da almeno 30 giorni;
  ogni sessione puo conservare al massimo 40 pending per complessivi 200 MiB,
  contando o raccogliendo anche gli orfani scaduti lasciati da finestre chiuse;
  al riavvio del bridge una bozza adotta i propri file con token ruotati e una
  seconda finestra ne riceve copie pending distinte, cosi la rimozione in una
  pagina non interrompe il lavoro dell'altra; la pulizia parte anche all'avvio
  e prosegue periodicamente senza richiedere un nuovo upload, mentre le bozze
  ancora aperte rinnovano il proprio lease; un marker preparato che non ha
  completato la rinomina finale viene ritentato in modo conservativo e mai
  cancellato;
  se una chiusura riesce ma un file temporaneo e momentaneamente bloccato, la
  sessione si chiude comunque, mostra un avviso e lascia il retry al cleanup;
  la bozza confermata viene rimossa anche in presenza di copie storiche nella
  sezione Invii da verificare, che restano conservate separatamente;
- il contatore del contesto segue provider e modello effettivamente selezionati:
  una risposta statistica tardiva del modello precedente non puo piu lasciare
  una finestra da 272k dopo il cambio;
- nel selettore dei modelli GPT-5.6 e disponibile una scelta esplicita fra il
  profilo Pi da 272.000 token e la finestra ufficiale da 1.050.000 token, con
  conferma e spiegazione distinta della tariffazione API long-context e
  dell'accesso OAuth;
- il gruppo **Attivita tecniche** attivo mostra un punto pulsante e una sottile
  luce in movimento; i gruppi conclusi restano statici e le preferenze di
  riduzione del movimento vengono rispettate;
- lo stato “ricalcolo dopo il riassunto” si spegne appena riprendono risposta o
  strumenti e non resta bloccato se la lettura accessoria delle statistiche
  fallisce;
- durante la compattazione il composer resta scrivibile e salva la bozza;
  soltanto l'invio e le azioni incompatibili attendono la fine del riassunto;
  la stessa barriera e applicata dal bridge anche nella race precedente a
  `agent_start`, inclusi nuova sessione, cambio modello e profilo di contesto
  GPT; una prenotazione manuale resta fail-closed anche se PI tarda a emettere
  l'evento di avvio e viene liberata soltanto da un esito autorevole o dallo
  stop della sessione;
- l'aggiornamento globale del contesto GPT usa un commit CAS non distruttivo di
  `models.json`, conserva modifiche esterne concorrenti e propaga un latch
  verificabile anche alle nuove schede e dopo il riavvio del bridge; in OAuth
  viene verificato esattamente il provider corrente senza rendere obbligatori
  provider non configurati.

## 2.5.2 — 2026-08-25

- **Cronologia e rami** mostra soltanto passaggi leggibili dall'utente:
  messaggi, immagini, compattazioni e sintesi dei rami; pensieri, risultati dei
  tool e cambi tecnici restano nel JSONL ma non invadono l'interfaccia;
- i nodi visibili vengono ricuciti al primo antenato visibile, così la struttura
  dei rami e il punto corrente restano corretti anche quando tra due messaggi
  esistono molti eventi tecnici;
- una conversazione troppo breve per la compattazione produce un solo avviso
  neutro, senza banner rosso, testo inglese o notifiche duplicate;
- il filtro dei marker iniziali `ottimizzazione: OK` e `orchestrazione: OK`
  riconosce anche righe interamente racchiuse da backtick o grassetto Markdown,
  senza cancellare riferimenti analoghi nel corpo della risposta;
- la normale conferma di un invio live non viene piu presentata come recupero
  di una richiesta precedente; l'avviso resta disponibile dopo reload o esito
  di trasporto incerto, quando serve davvero;
- i brevi conflitti di lettura tra fine risposta e salvataggio del JSONL vengono
  riletti automaticamente, senza mostrare un falso errore di cronologia;
- le anteprime assistente in **Cronologia e rami** applicano lo stesso filtro
  della chat ai marker iniziali di ottimizzazione e orchestrazione;
- aggiunti test regressivi per riservatezza del ragionamento, ricucitura dei
  rami, leaf visibile e presentazione degli esiti di compattazione.

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
