import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));

async function testo(percorso) {
  return readFile(join(RADICE, percorso), "utf8");
}

function cattura(sorgente, espressione, nome) {
  const valore = sorgente.match(espressione)?.[1];
  if (!valore) throw new Error(`Versione non trovata in ${nome}`);
  return valore;
}

const packageJson = JSON.parse(await testo("package.json"));
const packageLock = JSON.parse(await testo("package-lock.json"));
const cargoToml = await testo("src-tauri/Cargo.toml");
const cargoLock = await testo("src-tauri/Cargo.lock");
const tauriConfig = JSON.parse(await testo("src-tauri/tauri.conf.json"));
const versione = String(packageJson.version || "");

if (!/^\d+\.\d+\.\d+$/.test(versione)) {
  throw new Error(`Versione SemVer non valida: ${versione || "mancante"}`);
}

const bloccoCargo = cargoLock.match(
  /\[\[package\]\]\s*\nname = "interfaccia-pi"\s*\nversion = "([^"]+)"/,
);
const versioni = new Map([
  ["package.json", versione],
  ["package-lock.json", String(packageLock.version || "")],
  ["package-lock.json packages['']", String(packageLock.packages?.[""]?.version || "")],
  ["src-tauri/Cargo.toml", cattura(cargoToml, /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/, "Cargo.toml")],
  ["src-tauri/Cargo.lock", bloccoCargo?.[1] || ""],
  ["src-tauri/tauri.conf.json", String(tauriConfig.version || "")],
]);

const incoerenti = [...versioni].filter(([, valore]) => valore !== versione);
if (incoerenti.length) {
  throw new Error(
    `Versioni non allineate a ${versione}: `
      + incoerenti.map(([file, valore]) => `${file}=${valore || "mancante"}`).join(", "),
  );
}

const ref = String(process.env.GITHUB_REF_NAME || "");
if (ref.startsWith("v") && ref.slice(1) !== versione) {
  throw new Error(`Il tag ${ref} non corrisponde alla versione ${versione}`);
}

console.log(`Versione release coerente: ${versione}`);
