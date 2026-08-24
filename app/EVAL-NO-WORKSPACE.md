# Eval — conversazione senza cartella

Obiettivo: la GUI deve offrire le funzioni conversazionali e i comandi di Pi
anche quando l'utente non ha scelto un workspace. Le operazioni su file restano
consentite soltanto su percorsi assoluti forniti o selezionati esplicitamente.

## Criteri binari

- [x] `POST /api/avvia` con `senzaCartella: true` crea una sessione attiva.
- [x] La risposta pubblica non espone la directory tecnica: `cartella` e' `null`,
      `senzaCartella` e' `true`, il nome visibile e' `Senza cartella`.
- [x] Il processo Pi usa una directory tecnica vuota e dedicata sotto i dati
      locali dell'applicazione, diversa per ogni nuova conversazione.
- [x] La modalita' passa a Pi `--no-context-files`, `--no-approve`, un prompt di
      sistema dedicato e l'estensione di protezione dei percorsi.
- [x] `read`, `write`, `edit`, `ls`, `find` e `grep` rifiutano percorsi mancanti
      o relativi e accettano un percorso assoluto esplicito; `bash` resta disponibile.
- [x] L'avvio tradizionale con cartella continua a funzionare senza i flag della
      modalita' senza workspace.
- [x] La GUI crea automaticamente una prima conversazione senza cartella e offre
      sempre un comando esplicito `Nuova chat`.
- [x] La GUI non mostra mai la directory tecnica come workspace dell'utente.
- [x] Le conversazioni salvate nella directory tecnica vengono riconosciute e
      riaperte come conversazioni senza cartella.
- [x] Test automatici, controlli sintattici e smoke test reale passano tutti.

Esito richiesto per il rilascio: tutti i criteri devono risultare PASS.

## Esito 2026-08-24

PASS. Suite: 6/6; runtime reale: Pi 0.84.2; verifica browser: avvio
automatico, piu chat senza cartella, console senza errori; installazione reale:
ponte v6 con `cartella: null` e `senzaCartella: true`.
