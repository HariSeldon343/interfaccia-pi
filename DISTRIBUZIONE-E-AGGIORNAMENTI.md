# Distribuzione e aggiornamenti

## Stato della versione 2.6.0 Pilot non-production

Il repository pubblico autorevole e
`https://github.com/HariSeldon343/interfaccia-pi`. I workflow inclusi sono
deliberatamente separati:

- `verifica-windows.yml` controlla sintassi, test JavaScript, smoke test del
  runtime incorporato e test Rust;
- `compila-windows.yml` parte soltanto manualmente e produce gli installer NSIS
  (`.exe`) e MSI con i rispettivi hash SHA-256;
- le release verificate vengono promosse manualmente su GitHub con EXE, MSI e
  `SHA256SUMS.txt`; nessun aggiornamento viene installato automaticamente nella
  2.6.0 Pilot.

Il repository non deve contenere `vendor/pi-runtime`: sono circa 204 MiB e oltre
15.000 file. La CI lo ricostruisce da fonti e digest bloccati nello script
`scripts/vendor-pi-runtime.mjs`. Il pacchetto sorgente completo destinato
all'archivio, invece, include il runtime per consentire controlli e build
riproducibili senza dipendere dall'albero Git.

Il runtime di Sistema Guidato non si mantiene a mano nel repository GUI. Lo
script `scripts/vendor-sistema-guidato.mjs` lo importa dal monorepo autorevole,
verifica manifesti, versione Pi, patch RPC, lettori/writer di schema e SHA-256,
poi genera `vendor/sistema-guidato/integration-manifest.json`. La build e la CI
falliscono se il bundle manca, e stato alterato o dichiara una compatibilita
diversa. Nessun progetto, documento cliente, chiave API o segreto del bridge
entra nel bundle.

### Checkout pubblico pulito: provenienza esatta del bundle

Il repository pubblico non contiene il monorepo privato e non presume che
esista una cartella `C:\src\sistema-guidato`. La catena prevista e questa:

1. nel repository privato `sistema-guidato` si eseguono build e test;
2. `scripts/create-interfaccia-pi-bundle.ps1` crea l'asset
   `sistema-guidato-host-bundle-v<VERSIONE>.zip` contenente esclusivamente
   `runtime/`, `release-manifest.json` e `pi-package-compatibility.json`, oltre
   al file `.sha256` esterno;
3. l'asset viene allegato a una release privata immutabile. Un asset gia
   pubblicato non viene sostituito: una modifica richiede una nuova versione;
4. nel repository pubblico si configurano le variabili Actions
   `SISTEMA_GUIDATO_BUNDLE_REPOSITORY`, `SISTEMA_GUIDATO_BUNDLE_TAG`,
   `SISTEMA_GUIDATO_BUNDLE_ASSET` e `SISTEMA_GUIDATO_BUNDLE_SHA256`, piu il
   secret `SISTEMA_GUIDATO_BUNDLE_TOKEN`, un fine-grained PAT con il solo
   permesso **Contents: read** sul repository privato;
5. entrambi i workflow Windows invocano
   `scripts/prepare-sistema-guidato.ps1`: lo script legge la release tramite API
   GitHub, seleziona un solo asset per nome, scarica con il token solo in header,
   confronta il digest bloccato, estrae in una directory temporanea confinata e
   passa l'albero a `vendor-sistema-guidato.mjs`;
6. il vendoring ricontrolla inventario e SHA-256 di ogni file contro il release
   manifest, verifica Pi 0.84.2, patch RPC e schemi dati, genera il manifesto
   dell'host 2.6.0 e infine `vendor:sistema:check` ricontrolla tutto prima di
   test o build Tauri.

Se manca anche un solo secret/valore, il digest non coincide, l'asset contiene
file inattesi o i manifesti divergono, il workflow fallisce. Il PAT non viene
passato a Node, Tauri o al bundle e non compare in argomenti o log.

Per preparare localmente il modulo, senza usare GitHub:

```powershell
pwsh -NoProfile -File scripts/prepare-sistema-guidato.ps1 `
  -SourcePath C:\src\sistema-guidato
npm run vendor:sistema:check
```

L'opzione locale e deliberatamente esplicita: `vendor-sistema-guidato.mjs`
rifiuta di cercare automaticamente cartelle sibling. `build:desktop` usa lo
stesso preparatore e richiede quindi `SISTEMA_GUIDATO_SOURCE` oppure le cinque
impostazioni del canale privato; `build:desktop:offline` accetta soltanto un
bundle gia preparato e nuovamente verificato.

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

## Updater predisposto, ma disattivato nel pilot

Il plugin Tauri 2 e ora integrato dietro quattro comandi applicativi controllati:
lettura stato, controllo, download con verifica della firma e installazione. La
pagina `http://localhost:4666` riceve soltanto questi wrapper attraverso una
capability remota limitata alla finestra `main`; non riceve i permessi grezzi
del plugin. I riferimenti tecnici autoritativi sono la
[documentazione updater Tauri 2](https://v2.tauri.app/plugin/updater/) e la
[documentazione delle capability Tauri 2](https://v2.tauri.app/security/capabilities/).

Questa predisposizione non attiva il canale nella build pilota:

- `src-tauri/tauri.conf.json` dichiara esplicitamente
  `createUpdaterArtifacts: false` e non contiene `plugins.updater`;
- il pannello **Aggiornamenti** mostra quindi “build pilota” e non effettua
  richieste di rete;
- `compila-windows.yml` continua a produrre installer pilota non firmati
  dall'updater e non richiede chiavi;
- nessun controllo, download o installazione parte all'avvio o in background.

## Configurazione production fail-closed

Il workflow manuale `compila-production-updater-windows.yml` produce soltanto un
**candidato**. Prima di compilare genera il file ignorato da Git
`src-tauri/tauri.production.generated.json` e si arresta se manca uno di questi
valori:

| Nome | Dove | Vincolo |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | GitHub Actions secret | chiave privata updater durevole; non viene scritta nella configurazione |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | GitHub Actions secret | password della chiave, quando configurata |
| `PI_GUI_UPDATER_PUBLIC_KEY` | GitHub Actions secret | contenuto completo su due righe della chiave pubblica Minisign |
| `PI_GUI_UPDATER_ENDPOINTS_JSON` | GitHub Actions variable | array JSON da uno a tre endpoint esclusivamente HTTPS |

La chiave pubblica e tecnicamente pubblicabile, ma viene iniettata come secret
per preservarne senza ambiguita le due righe. Lo script rifiuta placeholder,
endpoint HTTP, credenziali incorporate, frammenti, duplicati e piu di tre
endpoint. L'app ripete la validazione all'avvio e registra il plugin soltanto
se la configurazione production e completa. `createUpdaterArtifacts: true`
compare esclusivamente nell'overlay generato; la chiave privata non entra mai
nel file o nei log.

I valori sensibili non sono definiti a livello di job: il PAT del bundle esiste
soltanto nello step di acquisizione e viene rimosso prima di avviare Node; la
chiave privata updater entra soltanto negli step di validazione e firma. Gli
step `npm ci`, test JavaScript, smoke test e test Rust non ricevono alcun
secret. Anche in production i test JavaScript sono eseguiti serialmente per
file, come nella pipeline pilota, senza ridurre la copertura.

Comandi di controllo:

```powershell
npm run updater:pilot:check

# Solo in un ambiente production che abbia gia ricevuto i valori reali:
npm run updater:production:prepare
npm run build:desktop:production
```

Non inserire chiavi reali nel repository, negli script o nella cronologia della
shell. La coppia updater va generata e custodita secondo la procedura ufficiale
Tauri; perderla impedirebbe alle installazioni esistenti di verificare nuovi
pacchetti.

## Flusso visibile e arresto ordinato

L'utente deve compiere tre azioni distinte nel pannello **Aggiornamenti**:

1. **Controlla ora** interroga manualmente il canale firmato;
2. **Scarica e verifica firma** conserva temporaneamente il pacchetto soltanto
   dopo la verifica obbligatoria della firma Tauri;
3. **Installa aggiornamento** richiede una seconda conferma e resta bloccato
   finche esistono conversazioni aperte.

Prima di consegnare il pacchetto all'installer, il launcher Rust usa un token
casuale non esposto alla WebView per chiedere al bridge un arresto dedicato. Il
bridge rifiuta l'operazione se rileva conversazioni, terminali, altre finestre
collegate o preparazioni di allegati; in caso contrario arresta in modo ordinato
Sistema Guidato e gli altri backend, chiude il server e viene atteso dal
launcher. Un timeout o una risposta incompleta impediscono l'installazione: non
viene usato un kill forzato per “far riuscire” l'aggiornamento.

Su Windows il plugin avvia l'installer e termina l'applicazione. Se un errore si
verifica dopo l'arresto del bridge, la GUI mostra l'errore ma per continuare a
lavorare occorre chiudere e riaprire l'app. Il pacchetto scaricato vive in
memoria: non costituisce una cache di rollback durevole.

## Limiti aperti: G11 e ACC-16 non sono chiusi

La presenza del codice e della pipeline non equivale a un canale rolling
accettato. Restano da completare con credenziali e infrastruttura reali:

- endpoint HTTPS definitivo e `latest.json` coerente con gli asset firmati;
- chiave updater durevole custodita e recovery della chiave verificata;
- firma Windows Authenticode separata, secondo la
  [guida ufficiale Tauri per Windows](https://v2.tauri.app/distribute/sign/windows/);
- installazione N-1 su una macchina Windows pulita, aggiornamento manuale a N,
  riavvio e verifica di conversazioni, progetti e Sistema Guidato;
- prova di rete interrotta, firma errata, endpoint indisponibile, installer
  fallito e recupero operativo;
- strategia di rollback approvata e relativo drill.

L'updater Tauri confronta normalmente le versioni e propone una versione piu
nuova: il codice corrente non implementa downgrade, watchdog di salute o
rollback automatico. Prima del drill va quindi scelta e documentata una via di
ritorno, per esempio un installer di riparazione firmato e conservato fuori dal
canale corrente, con criteri chiari su dati compatibili e migrazioni. Solo dopo
un drill reale N-1 → N → recovery/rollback, con evidenze, G11 potra essere
chiuso; fino ad allora **ACC-16 resta non dimostrato**.

Il workflow candidato carica artefatti privati per ispezione ma non crea una
GitHub Release, non pubblica `latest.json`, non applica Authenticode, non
implementa rollback e non modifica alcuna installazione.
Per l'eventuale promozione va seguita anche la
[pipeline GitHub ufficiale Tauri](https://v2.tauri.app/distribute/pipelines/github/)
senza rimuovere il gate umano.
