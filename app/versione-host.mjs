import { readFileSync } from "node:fs";

// package.json è distribuito anche accanto alla cartella app nel bundle desktop.
// La compatibilità delle estensioni usa la versione del rilascio dell'host.
export const VERSIONE_HOST = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
