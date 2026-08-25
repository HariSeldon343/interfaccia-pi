# Interfaccia pi 2.5.1 — sorgente completo

Questa cartella contiene il pacchetto sorgente completo necessario per modificare
l'interfaccia, il bridge e l'installer desktop di Interfaccia pi 2.5.1.

## Prima di iniziare

Non compilare direttamente dentro kDrive. Copia o estrai il progetto in un
percorso locale corto, per esempio:

```text
C:\src\pi-gui-2.5.1
```

In questo modo si evitano conflitti di sincronizzazione e limiti di lunghezza dei
percorsi di Windows.

## Requisiti consigliati

- Windows 10 o 11 a 64 bit
- Node.js a 64 bit 24.18.0 (minimo supportato: 22.19)
- Rust MSVC 1.98.0 con Cargo
- Visual Studio Build Tools 2022 con:
  - Desktop development with C++
  - toolchain MSVC x64
  - Windows SDK (consigliato 10.0.26100)
- Microsoft Edge WebView2 Runtime
- connessione Internet per il primo ripristino delle dipendenze

Il runtime PI distribuito nell'app è già incluso in `vendor/pi-runtime` e viene
controllato prima della compilazione offline.

## Compilazione e test

Apri PowerShell nella cartella estratta ed esegui:

```powershell
cd C:\src\pi-gui-2.5.1
npm ci
npm run check
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run vendor:pi:check
$env:CARGO_TARGET_DIR = Join-Path $PWD 'src-tauri\target-final-2.5.1'
npm run build:desktop:offline
```

Gli installer prodotti si trovano qui:

```text
src-tauri\target-final-2.5.1\release\bundle\nsis\Interfaccia pi_2.5.1_x64-setup.exe
src-tauri\target-final-2.5.1\release\bundle\msi\Interfaccia pi_2.5.1_x64_en-US.msi
```

## Modificare l'installer

La configurazione principale è in `src-tauri/tauri.conf.json`. Gli script di
preparazione e vendoring sono in `scripts/`; il frontend è in `app/`; il backend
desktop Rust è in `src-tauri/src/`.

Dopo una modifica, aumenta la versione sia in `package.json` sia nei file Tauri
che la riportano, quindi ripeti i test e il comando di build.

## Note

- `build:desktop:offline` indica che PI viene prelevato dal runtime incluso, non
  che l'intera toolchain possa essere installata senza Internet.
- `npm ci`, Cargo e i tool Tauri possono scaricare componenti se non sono già
  presenti nella cache del PC.
- Gli installer creati localmente non sono firmati digitalmente, a meno che non
  venga configurato un certificato di firma del codice.
- Due build corrette possono avere hash differenti per timestamp, identificativi
  generati e versione esatta della toolchain.
- Versioni del runtime incluso: Node 24.18.0, PI 0.84.2, fd 10.4.2, rg 15.2.0.

Verifica sempre l'archivio con l'hash indicato in `SORGENTE-SHA256.txt` prima di
copiarlo o modificarlo su un altro computer.
