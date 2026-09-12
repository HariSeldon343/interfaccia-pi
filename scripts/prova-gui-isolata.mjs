import { mkdtemp, mkdir, readdir, access, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";

const qui = dirname(fileURLToPath(import.meta.url));
const radice = dirname(qui);

export async function avviaProvaIsolata(argomenti = process.argv.slice(2)) {
  const opzioni = { port: "4679", scenario: "base" };
  const ricevute = new Set();
  for (let i = 0; i < argomenti.length; i += 2) {
    const nome = argomenti[i]?.slice(2);
    if (!argomenti[i]?.startsWith("--") || !["port", "scenario"].includes(nome)
      || ricevute.has(nome) || !argomenti[i + 1]) throw new Error("Usa --port <porta> e --scenario <nome>, una sola volta ciascuno.");
    ricevute.add(nome);
    opzioni[nome] = argomenti[i + 1];
  }
  const porta = Number(opzioni.port);
  if (!/^\d+$/u.test(opzioni.port) || !Number.isInteger(porta) || porta < 1024 || porta > 65535 || [4666, 4699].includes(porta)) {
    throw new Error("Scegli una porta fra 1024 e 65535 diversa da 4666 e 4699.");
  }
  const registro = new Map((await readdir(join(qui, "prove")))
    .filter((nome) => /^scenario-[a-z][a-z0-9-]*\.mjs$/u.test(nome))
    .map((nome) => [nome.slice(9, -4), join(qui, "prove", nome)]));
  if (!registro.has(opzioni.scenario)) {
    throw new Error(`Lo scenario «${opzioni.scenario}» non è disponibile. Scenari presenti: ${[...registro.keys()].join(", ")}.`);
  }
  const cliPi = join(radice, "tests", "fake-pi.mjs");
  await access(cliPi);
  const temporanea = await mkdtemp(join(tmpdir(), "pi-isolata-"));
  const home = join(temporanea, "profilo");
  const env = {
    USERPROFILE: home, HOME: home,
    APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_DATA_HOME: join(home, ".local", "share"), XDG_CONFIG_HOME: join(home, ".config"),
    PI_GUI_PORT: String(porta),
  };
  for (const directory of [home, env.APPDATA, env.LOCALAPPDATA, env.XDG_DATA_HOME, env.XDG_CONFIG_HOME,
    join(home, ".pi", "agent"), join(home, ".pi", "gui"), join(home, ".agents", "skills")]) {
    await mkdir(directory, { recursive: true });
  }
  Object.assign(process.env, env);
  // Il percorso dell'agente viene separato soltanto nella prova: il ponte di
  // produzione conserva auth.json e models.json nella loro radice personale.
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_OFFLINE;
  delete process.env.PI_GUI_LAUNCHER_TOKEN;
  process.env.PI_GUI_PI_CLI = cliPi;
  const chiavi = Object.fromEntries(["attiva", "sconosciuta", "revocata", "terza-parte"].map((nome) => [nome, generateKeyPairSync("ed25519")]));
  const portachiavi = ["attiva", "revocata", "terza-parte"].map((nome) => ({
    chiaveId: `prova-${nome}`, pubblica: chiavi[nome].publicKey.export({ type: "spki", format: "pem" }),
    stato: nome === "revocata" ? "revocata" : "attiva", dal: "2026-01-01", primaParte: nome !== "terza-parte",
  }));
  const contesto = { temporanea, home, env, chiavi, portachiavi, radice, cliPi };
  let ponte;
  let chiusa = false;
  async function chiudi() {
    if (chiusa) return;
    chiusa = true;
    if (ponte) {
      await ponte.chiudiTutto();
      if (ponte.server.listening) await new Promise((ok) => ponte.server.close(ok));
    }
    // La sola radice temporanea creata qui viene eliminata; nessun profilo Pi
    // esterno è letto o scritto dal generatore delle fixture.
    await rm(temporanea, { recursive: true, force: true });
  }
  try {
    const scenario = await import(pathToFileURL(registro.get(opzioni.scenario)).href);
    if (typeof scenario.prepara !== "function") throw new Error(`Lo scenario «${opzioni.scenario}» non espone la funzione prepara.`);
    const fixture = await scenario.prepara(contesto);
    // L'importazione del ponte avviene rigorosamente dopo l'isolamento.
    const { creaPonte, caricaCatalogoBuiltinPi } = await import("../app/server.mjs");
    ponte = creaPonte({
      home, cliPi, portachiavi, ambienteEstensioni: env,
      radiceSenzaCartella: join(temporanea, "senza-cartella"),
      elencaDiscendenti: async () => [], terminaDiscendenti: async () => true,
      // Come nei test del primo avvio, la cronologia della fixture arriva dal
      // processo fake: tests/fake-pi.mjs non contiene i moduli di un runtime Pi.
      caricaCronologia: async ({ sessione }) => {
        const dati = await sessione.inviaEAttendi({ type: "get_messages" });
        return dati.messages || [];
      },
      // Il catalogo è dato puro del runtime già distribuito, come nei test
      // server; leggerlo non avvia la CLI reale e conserva la verifica versione.
      caricaCatalogoBuiltin: () => caricaCatalogoBuiltinPi(
        join(radice, "vendor", "pi-runtime", "pi", "dist", "cli.js"),
      ),
      caricaSupportoRuntime: async () => ({ versione: "0.84.2", modelliPredefiniti: {},
        getAgentDir: () => join(home, ".pi", "agent"), getShareViewerUrl: () => "https://example.test/share",
        ProjectTrustStore: class { get() { return false; } set() {} },
      }),
    });
    await new Promise((ok, no) => { ponte.server.once("error", no); ponte.server.listen(porta, "127.0.0.1", ok); });
    const base = `http://127.0.0.1:${porta}`;
    async function api(via, corpo) {
      const risposta = await fetch(base + via, { method: corpo === undefined ? "GET" : "POST", headers: {
        "content-type": "application/json", "x-pi-gui-token": ponte.tokenApi,
      }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) });
      return { stato: risposta.status, corpo: await risposta.json() };
    }
    const evidenza = { scenario: opzioni.scenario, temporanea, home, base, fixture };
    await writeFile(join(temporanea, "prova.json"), JSON.stringify(evidenza, null, 2));
    console.log(`Prova isolata: ${temporanea}\nScenario: ${opzioni.scenario}\nApri ${base}\nPi finto: ${cliPi}`);
    if (scenario.verifica) await scenario.verifica({ ...contesto, fixture, ponte, api });
    if (fixture?.istruzioni) console.log(fixture.istruzioni.join("\n"));
    for (const segnale of ["SIGINT", "SIGTERM"]) process.once(segnale, () => {
      void chiudi().catch((errore) => { console.error(`Arresto della prova non riuscito: ${errore.message}`); process.exitCode = 1; });
    });
    return { ponte, chiudi, ...evidenza };
  } catch (errore) { await chiudi(); throw errore; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  avviaProvaIsolata().catch((errore) => {
    console.error(`Prova isolata non avviata: ${errore.message}`);
    process.exitCode = 1;
  });
}
