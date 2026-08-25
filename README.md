# Interfaccia pi

Interfaccia desktop Windows, accessibile e multi-sessione, per usare l'agente
Pi con o senza una cartella di lavoro. La versione corrente e la **2.5.1** e
include Pi 0.84.2 in un runtime autocontenuto e verificato.

La 2.5 aggiunge sessioni parallele nella stessa cartella e il comando grafico
`/sistema`: un percorso multi-cliente per raccogliere informazioni ed evidenze,
collegare template reali senza copiarli, generare bozze revisionate e produrre
soltanto pacchetti approvati con manifesto e impronte SHA-256.

La 2.5.1 rende la conversazione più essenziale: riepiloghi di compattazione
chiusi, tentativi tecnici distinti dagli errori finali, coda non invasiva per
impostazione predefinita, stato locale verificabile e testata più stabile.

La documentazione completa e in [LEGGIMI.md](LEGGIMI.md). Le modifiche della
release sono in [CHANGELOG.md](CHANGELOG.md); compilazione, repository e strategia
di aggiornamento sono descritti in
[DISTRIBUZIONE-E-AGGIORNAMENTI.md](DISTRIBUZIONE-E-AGGIORNAMENTI.md).

## Verifica rapida

```powershell
npm ci
npm run vendor:pi
npm run check
npm test
npm run test:smoke
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

`vendor/pi-runtime` non viene versionato nel repository Git perché e un albero
riproducibile di circa 204 MiB. Lo script di vendoring scarica esclusivamente le
versioni bloccate, ne verifica i digest e genera il manifesto completo.

## Licenza

Il codice dell'interfaccia e distribuito con licenza ISC. Il runtime incorporato
mantiene le licenze dei rispettivi componenti, raccolte nella cartella
[`licenses`](licenses/).
