# Interfaccia pi

Interfaccia desktop Windows, accessibile e multi-sessione, per usare l'agente
Pi con o senza una cartella di lavoro. La versione corrente e la **2.4.0** e
include Pi 0.84.2 in un runtime autocontenuto e verificato.

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
