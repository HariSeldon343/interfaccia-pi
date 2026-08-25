# Interfaccia pi

Interfaccia desktop Windows, accessibile e multi-sessione, per usare l'agente
Pi con o senza una cartella di lavoro. La versione candidata è la **2.6.0
Pilot**, esplicitamente non-production, e include Pi 0.84.2 in un runtime
autocontenuto e verificato.

La 2.6 integra **Sistema Guidato** come pannello interno, raggiungibile da un
pulsante evidente e dal comando virtuale `/sistema` anche senza selezionare una
cartella. Un solo servizio locale viene avviato su richiesta per l'intero
processo GUI; dashboard e API restano sulla stessa origine e credenziali,
token e cookie interni non entrano in URL, JavaScript o storage del browser.
Il bundle proviene dal monorepo `sistema-guidato` ed e accettato soltanto dopo
la verifica di compatibilita, inventario e SHA-256.

La 2.5.1 rende la conversazione più essenziale: riepiloghi di compattazione
chiusi, tentativi tecnici distinti dagli errori finali, coda non invasiva per
impostazione predefinita, stato locale verificabile e testata più stabile.

La 2.5.2 rende la conversazione e la cronologia più vicine a ciò che vede
l'utente: nasconde pensieri e risultati tecnici nell'albero, mantiene i rami
precedenti dopo la compattazione, evita feedback duplicati quando una chat e
troppo breve da riassumere e filtra anche i marker operativi in Markdown.

La 2.5.3 mantiene sempre visibile il testo dei prompt originali dopo la compattazione,
aggiunge file e drag-and-drop, corregge il contesto mostrato dopo un cambio
modello e rende opzionale la finestra GPT-5.6 da 1,05M token. Il composer resta
scrivibile mentre Pi libera spazio e l'attivita in corso ha un segnale visivo
discreto.

La 2.5.4 corregge il primo avvio dopo l'installazione: il caricamento a freddo
di PI usa un tempo dedicato e, se il primo collegamento fallisce, la GUI si
ricollega e ripristina automaticamente chat e selettore del modello senza
richiedere la chiusura dell'app.

La documentazione completa e in [LEGGIMI.md](LEGGIMI.md). Le modifiche della
release sono in [CHANGELOG.md](CHANGELOG.md); compilazione, repository e strategia
di aggiornamento sono descritti in
[DISTRIBUZIONE-E-AGGIORNAMENTI.md](DISTRIBUZIONE-E-AGGIORNAMENTI.md).

## Verifica rapida

```powershell
npm ci
npm run vendor:pi
pwsh -NoProfile -File scripts/prepare-sistema-guidato.ps1 -SourcePath C:\src\sistema-guidato
npm run check
npm test
npm run test:smoke
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

`vendor/pi-runtime` non viene versionato nel repository Git perché e un albero
riproducibile di circa 204 MiB. Lo script di vendoring scarica esclusivamente le
versioni bloccate, ne verifica i digest e genera il manifesto completo.

Anche `vendor/sistema-guidato` e un output verificato e non viene versionato.
In locale richiede il percorso esplicito del monorepo; in CI viene scaricato da
una release privata e accettato soltanto se il digest SHA-256 bloccato e i
manifesti interni coincidono. La procedura completa e in
[DISTRIBUZIONE-E-AGGIORNAMENTI.md](DISTRIBUZIONE-E-AGGIORNAMENTI.md).

## Licenza

Il codice dell'interfaccia e distribuito con licenza ISC. Il runtime incorporato
mantiene le licenze dei rispettivi componenti, raccolte nella cartella
[`licenses`](licenses/).
