import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { creaPonte } from "../app/server.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const home = await mkdtemp(join(tmpdir(), "pi-gui-first-launch-"));
const marcatore = join(home, "primo-get-state-fallito.marker");
process.env.PI_GUI_FAKE_FAIL_FIRST_STATE_FILE = marcatore;

class ArchivioFiduciaTest {
  get() { return null; }
  set() {}
}

const ponte = creaPonte({
  home,
  cliPi: join(QUI, "fake-pi.mjs"),
  radiceSenzaCartella: join(home, "sessioni-senza-cartella"),
  timeoutAvvioSessione: 450,
  elencaDiscendenti: async () => [],
  terminaDiscendenti: async () => true,
  bloccaComandiEstensione: false,
  caricaCronologia: async ({ sessione }) => {
    const dati = await sessione.inviaEAttendi({ type: "get_messages" });
    return dati.messages || [];
  },
  caricaSupportoRuntime: async () => ({
    versione: "0.84.2",
    getAgentDir: () => join(home, ".pi", "agent"),
    getShareViewerUrl: () => "https://example.test/share",
    ProjectTrustStore: ArchivioFiduciaTest,
    modelliPredefiniti: { fake: "modello-test" },
  }),
  caricaCatalogoBuiltin: async () => ({
    versione: "0.84.2",
    comandi: [{ name: "help", description: "Mostra la guida" }],
  }),
});

await new Promise((risolvi) => ponte.server.listen(0, "127.0.0.1", risolvi));
const indirizzo = ponte.server.address();
console.log(`FIRST_LAUNCH_URL=http://127.0.0.1:${indirizzo.port}`);

let chiusuraInCorso = false;
async function chiudi() {
  if (chiusuraInCorso) return;
  chiusuraInCorso = true;
  try {
    await ponte.chiudiTutto();
    if (ponte.server.listening) {
      await new Promise((risolvi) => ponte.server.close(risolvi));
    }
  } finally {
    delete process.env.PI_GUI_FAKE_FAIL_FIRST_STATE_FILE;
    await rm(home, { recursive: true, force: true });
  }
}

for (const segnale of ["SIGINT", "SIGTERM"]) {
  process.on(segnale, () => {
    void chiudi().finally(() => process.exit(0));
  });
}
