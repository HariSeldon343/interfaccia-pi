import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUI, "..");
const CONFIG_BASE = join(RADICE, "src-tauri", "tauri.conf.json");
export const CONFIG_PRODUCTION = join(
  RADICE,
  "src-tauri",
  "tauri.production.generated.json",
);

function obbligatoria(ambiente, nome) {
  const valore = ambiente[nome];
  if (typeof valore !== "string" || !valore.trim()) {
    throw new Error(`${nome} e obbligatoria per una build updater production`);
  }
  return valore.trim();
}

export function normalizzaChiavePubblica(valore) {
  const chiave = String(valore || "").replace(/\r\n/gu, "\n").trim();
  if (/PLACEHOLDER|CONTENT FROM|INCOLLA|EXAMPLE/iu.test(chiave)) {
    throw new Error("PI_GUI_UPDATER_PUBLIC_KEY contiene un placeholder");
  }
  const righe = chiave.split("\n").map((riga) => riga.trim()).filter(Boolean);
  if (
    righe.length !== 2
    || !/^untrusted comment: minisign public key(?:\s|$)/iu.test(righe[0])
    || !/^RW[A-Za-z0-9+/]{40,}={0,2}$/u.test(righe[1])
  ) {
    throw new Error(
      "PI_GUI_UPDATER_PUBLIC_KEY non ha il formato della chiave pubblica Minisign generata da Tauri",
    );
  }
  return `${righe[0]}\n${righe[1]}`;
}

export function validaEndpoints(valore) {
  let endpoints;
  try {
    endpoints = JSON.parse(String(valore || ""));
  } catch {
    throw new Error("PI_GUI_UPDATER_ENDPOINTS_JSON deve essere un array JSON");
  }
  if (!Array.isArray(endpoints) || endpoints.length < 1 || endpoints.length > 3) {
    throw new Error("PI_GUI_UPDATER_ENDPOINTS_JSON deve contenere da uno a tre endpoint");
  }
  const unici = new Set();
  for (const endpoint of endpoints) {
    if (typeof endpoint !== "string" || !endpoint.trim()) {
      throw new Error("Ogni endpoint updater deve essere una stringa non vuota");
    }
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(`Endpoint updater non valido: ${endpoint}`);
    }
    if (
      url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
      || url.hash
    ) {
      throw new Error("Gli endpoint updater devono essere HTTPS e senza credenziali o frammenti");
    }
    if (unici.has(endpoint)) throw new Error("Gli endpoint updater non possono essere duplicati");
    unici.add(endpoint);
  }
  return [...unici];
}

export function creaConfigurazioneProduction(ambiente = process.env) {
  // La chiave privata non entra mai nel file: ne imponiamo soltanto la presenza.
  obbligatoria(ambiente, "TAURI_SIGNING_PRIVATE_KEY");
  const pubkey = normalizzaChiavePubblica(
    obbligatoria(ambiente, "PI_GUI_UPDATER_PUBLIC_KEY"),
  );
  const endpoints = validaEndpoints(
    obbligatoria(ambiente, "PI_GUI_UPDATER_ENDPOINTS_JSON"),
  );
  return {
    $schema: "https://schema.tauri.app/config/2",
    bundle: {
      createUpdaterArtifacts: true,
    },
    plugins: {
      updater: {
        pubkey,
        endpoints,
        windows: {
          installMode: "passive",
        },
      },
    },
  };
}

export async function verificaConfigurazionePilota(percorso = CONFIG_BASE) {
  const base = JSON.parse(await readFile(percorso, "utf8"));
  if (base?.bundle?.createUpdaterArtifacts !== false) {
    throw new Error("La configurazione base deve avere createUpdaterArtifacts=false");
  }
  if (base?.plugins?.updater) {
    throw new Error("La configurazione base/pilota non deve contenere plugins.updater");
  }
  return true;
}

export async function scriviConfigurazioneProduction({
  ambiente = process.env,
  destinazione = CONFIG_PRODUCTION,
} = {}) {
  await verificaConfigurazionePilota();
  const configurazione = creaConfigurazioneProduction(ambiente);
  await writeFile(destinazione, `${JSON.stringify(configurazione, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
  });
  return destinazione;
}

async function main() {
  const argomenti = new Set(process.argv.slice(2));
  if (argomenti.has("--pilot-check")) {
    await verificaConfigurazionePilota();
    console.log("Updater pilota disattivato: configurazione base valida.");
    return;
  }
  const destinazione = await scriviConfigurazioneProduction();
  if (argomenti.has("--check")) {
    const attuale = JSON.parse(await readFile(destinazione, "utf8"));
    const attesa = creaConfigurazioneProduction(process.env);
    if (JSON.stringify(attuale) !== JSON.stringify(attesa)) {
      throw new Error("La configurazione updater production generata non e riproducibile");
    }
  }
  console.log(`Configurazione updater production validata: ${destinazione}`);
}

const diretto = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (diretto) {
  main().catch((errore) => {
    console.error(`Errore updater production: ${errore.message}`);
    process.exitCode = 1;
  });
}
