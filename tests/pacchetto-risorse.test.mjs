import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("il pacchetto Tauri contiene tutti i moduli locali raggiunti dal ponte", async () => {
  const radice = fileURLToPath(new URL("../", import.meta.url));
  const configurazione = JSON.parse(await readFile(resolve(radice, "src-tauri/tauri.conf.json"), "utf8"));
  const risorse = configurazione.bundle.resources;
  const visitati = new Set();
  const mancanti = [];
  async function visita(file) {
    if (visitati.has(file)) return;
    visitati.add(file);
    const relativo = relative(radice, file).replaceAll("\\", "/");
    if (risorse[`../${relativo}`] !== relativo) mancanti.push(relativo);
    const sorgente = await readFile(file, "utf8");
    for (const voce of sorgente.matchAll(/\bimport\s+[^;]*?\s+from\s+["'](\.\/[^"']+\.mjs)["']/g)) {
      await visita(resolve(dirname(file), voce[1]));
    }
  }
  await visita(resolve(radice, "app/server.mjs"));
  assert.ok(visitati.size > 1, "il test deve attraversare gli import del ponte");
  assert.deepEqual(mancanti, [], `Moduli assenti dalle risorse: ${mancanti.join(", ")}`);
});
