# G11 — stato updater Tauri 2

Data fotografia: 2026-08-25. Stato: **aperto**.

## Implementato e verificabile nel sorgente

- dipendenza `tauri-plugin-updater` e registrazione condizionale;
- configurazione base/pilot esplicitamente updater-disabled;
- overlay production generato e fail-closed su private key, public key e
  endpoint HTTPS;
- capability remota ristretta ai quattro comandi applicativi;
- flusso manuale separato `check` → `download/verifica` → `install/conferma`;
- stato, progresso ed errori leggibili nella GUI;
- token launcher effimero, non esposto alla WebView, per la richiesta di
  shutdown;
- rifiuto di installazione con conversazioni, terminali, finestre o allegati in
  preparazione;
- arresto ordinato dei backend prima di chiamare l'installer;
- contract test JavaScript, test del bridge e unit test Rust dello stato
  iniziale;
- workflow production manuale che genera solo artefatti candidati;
- PAT del bundle e chiavi updater confinati agli step che li consumano: il
  passaggio `npm ci`, i test JavaScript, lo smoke test e i test Rust non
  ricevono secret;
- suite JavaScript production serializzata per file come quella pilota, senza
  ridurre la copertura.

## Evidenze attese dal collaudo reale

| Evidenza | Stato |
|---|---|
| build pilota senza segreti e senza artefatti updater | test automatizzato |
| build production senza un secret | deve fallire in CI |
| asset N e firma generati con la chiave durevole | non eseguito |
| installazione pulita N-1 | non eseguita |
| aggiornamento N-1 → N tramite GUI | non eseguito |
| conservazione progetti, conversazioni e modulo SG | non eseguita |
| rifiuto pacchetto con firma alterata | non eseguito su canale reale |
| interruzione rete e retry | non eseguito su canale reale |
| recovery dopo installer fallito | non eseguito |
| rollback documentato e provato | non progettato/completato |
| firma Authenticode e comportamento SmartScreen | non configurati |

## Gate di chiusura

G11 non va marcato completato e ACC-16 non va dichiarato soddisfatto finche non
esistono verbale, hash degli artefatti, versioni coinvolte, log e risultato di
un drill reale su Windows pulito. Il confronto predefinito dell'updater non e un
meccanismo di downgrade; rollback e compatibilita delle migrazioni richiedono
una decisione di produzione separata.

Riferimenti ufficiali:

- <https://v2.tauri.app/plugin/updater/>
- <https://v2.tauri.app/security/capabilities/>
- <https://v2.tauri.app/distribute/sign/windows/>
- <https://v2.tauri.app/distribute/pipelines/github/>
