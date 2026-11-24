/**
 * Genera data/demons-fallback.json a partir de la API de Pointercrate.
 *
 * Úsalo desde una red que NO esté bloqueada por Cloudflare:
 *   node scripts/build-fallback.mjs
 *
 * Descarga el top 150 actual de la demonlist y guarda una versión reducida
 * (id, name, position, publisher, verifier, thumbnail, video) que el servidor
 * usa como respaldo cuando la API en vivo no está disponible.
 */
import { writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "demons-fallback.json");
const BASE = "https://pointercrate.com/api/v2/demons/listed/";

const HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

function slim(d) {
  return {
    id: d.id,
    name: d.name,
    position: d.position,
    publisher: d.publisher?.name ?? null,
    verifier: d.verifier?.name ?? null,
    thumbnail: d.thumbnail ?? null,
    video: d.video ?? null,
  };
}

const all = [];
for (let after = 0; after < 150; after += 50) {
  const res = await fetch(`${BASE}?after=${after}&limit=50`, { headers: HEADERS });
  if (!res.ok) {
    console.error(`Error ${res.status} al descargar (after=${after}).`);
    process.exit(1);
  }
  const batch = await res.json();
  all.push(...batch.map(slim));
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(all, null, 2), "utf-8");
console.log(`Guardados ${all.length} demons en ${OUT}`);
