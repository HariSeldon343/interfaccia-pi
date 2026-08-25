# Distribuzione e aggiornamenti

## Stato della versione 2.4.1

Il repository pubblico autorevole e
`https://github.com/HariSeldon343/interfaccia-pi`. I workflow inclusi sono
deliberatamente separati:

- `verifica-windows.yml` controlla sintassi, test JavaScript, smoke test del
  runtime incorporato e test Rust;
- `compila-windows.yml` parte soltanto manualmente e produce gli installer NSIS
  (`.exe`) e MSI con i rispettivi hash SHA-256;
- le release verificate vengono promosse manualmente su GitHub con EXE, MSI e
  `SHA256SUMS.txt`; nessun aggiornamento viene installato automaticamente nella
  2.4.1.

Il repository non deve contenere `vendor/pi-runtime`: sono circa 204 MiB e oltre
15.000 file. La CI lo ricostruisce da fonti e digest bloccati nello script
`scripts/vendor-pi-runtime.mjs`. Il pacchetto sorgente completo destinato
all'archivio, invece, include il runtime per consentire controlli e build
riproducibili senza dipendere dall'albero Git.

Per creare il pacchetto sorgente completo:

```powershell
pwsh -File scripts/crea-pacchetto-sorgente.ps1
```

## Repository e promozione release

Il repository e pubblico dal 24/08/2026, dopo scansione del sorgente e della
cronologia, build completa su GitHub Actions e verifica degli installer. La
promozione resta intenzionalmente manuale.

La sequenza consigliata e:

1. creare il repository senza inizializzarlo con file automatici;
2. aggiungere il sorgente, escluso il runtime generato e ogni segreto;
3. proteggere il ramo principale e richiedere il workflow di verifica;
4. eseguire manualmente **Compila installer Windows**;
5. scaricare gli artefatti e confrontare `SHA256SUMS.txt`;
6. installare prima su una macchina di collaudo, poi promuovere la release.

## Aggiornamenti continui: due firme diverse

Gli aggiornamenti automatici Tauri richiedono una firma dedicata che non puo
essere disattivata. Questa firma prova che il pacchetto proviene dal canale di
aggiornamento corretto, ma non sostituisce la firma Windows Authenticode.

Per una distribuzione affidabile servono quindi due livelli distinti:

1. **firma updater Tauri**: coppia di chiavi; la pubblica va nella configurazione
   dell'app, la privata e la sua password restano esclusivamente nei GitHub
   Actions Secrets;
2. **firma codice Windows**: certificato o servizio di firma per EXE e MSI, utile
   a identita dell'editore e reputazione SmartScreen.

Non generare la chiave updater come passaggio effimero della CI: se viene persa,
le installazioni esistenti non possono verificare gli aggiornamenti futuri.

## Attivazione futura del canale rolling

Prima di aggiungere il plugin updater va risolto anche il lifecycle specifico
di questa applicazione. Il bridge locale puo essere condiviso da piu finestre e
puo avere sessioni Pi ancora attive; inoltre oggi il launcher riconosce la
compatibilita del ponte tramite la sola versione del protocollo. Una release
nuova non deve quindi riusare per errore un bridge appartenente a una build
precedente.

Il controllo aggiornamenti andra implementato nel launcher Rust, o dietro una
capability strettamente confinata: la pagina viene servita da `localhost` e non
deve ricevere genericamente i privilegi nativi dell'updater. L'installazione
deve essere consentita soltanto quando nessun agente sta generando, non esistono
altre finestre con bozze o sessioni attive, la cronologia e sincronizzata e il
bridge e stato terminato ordinatamente. `/api/salute` dovra inoltre esporre un
identificativo della build applicativa, distinto dalla versione del protocollo.

Dopo aver scelto nome e proprietario definitivi del repository:

1. generare e custodire offline la chiave privata updater;
2. configurare `TAURI_SIGNING_PRIVATE_KEY` e
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` come secrets;
3. aggiungere `tauri-plugin-updater`, la sua capability e la chiave pubblica;
4. impostare l'endpoint HTTPS definitivo, per esempio il `latest.json` di una
   GitHub Release;
5. creare release inizialmente in bozza e promuoverle solo dopo smoke test;
6. separare eventualmente i canali `stable` e `beta` invece di distribuire ogni
   commit agli utenti.

Un updater che legge direttamente `latest.json` da GitHub richiede asset
scaricabili senza autenticazione. Il repository pubblico soddisfa questo
prerequisito, ma non sostituisce firma, lifecycle e rollback descritti sopra.

La 2.4.1 resta volutamente a aggiornamento manuale: attivare l'updater prima di
avere repository definitivo, chiavi durevoli e strategia di firma creerebbe un
canale fragile e difficile da migrare.
