# Changelog

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
- accesso diretto dalla barra Strumenti all'albero della conversazione, per
  tornare a un passaggio precedente senza cancellare il ramo successivo;
- preparazione del runtime e workflow Windows resi riproducibili e fail-fast
  anche sui runner GitHub ospitati;
- percorsi Windows confrontati nella forma canonica e rilevamento dei dischi
  locali tollerante al primo avvio lento di PowerShell, restando fail-closed;
- suite di regressione estesa e smoke test con il runtime Pi incluso.

## 2.3.1 — 2026-08-23

- base sorgente completa e installer autocontenuto per Windows.
