import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const POINTERCRATE = "https://pointercrate.com/api/v2";
const DATA_DIR = join(__dirname, "data");
const DB_FILE = join(DATA_DIR, "players.json");

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

/* ------------------------------------------------------------------ */
/* Almacenamiento local de cuentas / leaderboard (archivo JSON)        */
/* ------------------------------------------------------------------ */

/**
 * Estructura del "jugador" local:
 * {
 *   name: string,          // nombre único (clave)
 *   score: number,         // puntos totales acumulados
 *   demons: [              // demons completados por este jugador
 *     { id, name, position, points }
 *   ]
 * }
 */
async function loadDb() {
  try {
    const raw = await readFile(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveDb(players) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(players, null, 2), "utf-8");
}

/* ------------------------------------------------------------------ */
/* Cálculo de puntos (fórmula oficial de Pointercrate)                 */
/*                                                                     */
/*   record_score(progress = 100, position):                          */
/*     150 * exp((1 - position) * ln(1/30) / (-149))                   */
/*                                                                     */
/* Da 150 pts en la posición 1 y ~2.481 pts en la posición 150.        */
/* Demons fuera del top 150 (legacy) otorgan 0 puntos, igual que en    */
/* el stats viewer real.                                               */
/* ------------------------------------------------------------------ */
export function pointsForPosition(position) {
  if (position == null || position < 1 || position > 150) return 0;
  const pts = 150.0 * Math.exp(((1.0 - position) * Math.log(1.0 / 30.0)) / -149.0);
  return Math.round(pts * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Proxy a la API de Pointercrate (evita CORS y el reto de Cloudflare) */
/* ------------------------------------------------------------------ */
const UPSTREAM_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

async function fetchUpstream(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${POINTERCRATE}${path}`, {
      headers: UPSTREAM_HEADERS,
      signal: controller.signal,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: "Respuesta no-JSON de Pointercrate", status: res.status };
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: { error: String(err) } };
  } finally {
    clearTimeout(timer);
  }
}

/* Dataset de respaldo (top 150 real) para cuando la API en vivo no responde */
let fallbackCache = null;
async function loadFallbackDemons() {
  if (fallbackCache) return fallbackCache;
  try {
    const raw = await readFile(join(DATA_DIR, "demons-fallback.json"), "utf-8");
    fallbackCache = JSON.parse(raw);
  } catch {
    fallbackCache = [];
  }
  return fallbackCache;
}

function enrich(d) {
  return {
    id: d.id,
    name: d.name,
    position: d.position,
    verifier: d.verifier ?? null,
    publisher: d.publisher ?? null,
    thumbnail: d.thumbnail ?? null,
    video: d.video ?? null,
    points: pointsForPosition(d.position),
  };
}

/**
 * Busca demons en TODO el histórico de la lista (no solo el top 150).
 * GET /api/demons?q=texto
 */
app.get("/api/demons", async (req, res) => {
  const q = (req.query.q || "").trim();

  // Busca en TODO el histórico (name_contains); sin query, lista rankeada.
  const path = q
    ? `/demons/?name_contains=${encodeURIComponent(q)}&limit=50`
    : `/demons/listed/?limit=50`;

  const { status, body } = await fetchUpstream(path);

  if (status === 200 && Array.isArray(body)) {
    return res.json({ source: "live", demons: body.map(enrich) });
  }

  // Fallback: usamos el dataset local (top 150) y filtramos por nombre.
  const fallback = await loadFallbackDemons();
  const filtered = q
    ? fallback.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()))
    : fallback;
  res.json({ source: "fallback", demons: filtered.map(enrich) });
});

/* ------------------------------------------------------------------ */
/* Cuentas de jugadores locales + leaderboard                          */
/* ------------------------------------------------------------------ */

// Leaderboard ordenado por puntos
app.get("/api/leaderboard", async (_req, res) => {
  const players = await loadDb();
  const ranked = [...players]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      score: Math.round(p.score * 100) / 100,
      demonCount: p.demons.length,
    }));
  res.json(ranked);
});

// Detalle de una cuenta (demons completados)
app.get("/api/players/:name", async (req, res) => {
  const players = await loadDb();
  const player = players.find(
    (p) => p.name.toLowerCase() === req.params.name.toLowerCase()
  );
  if (!player) return res.status(404).json({ error: "Jugador no encontrado" });
  res.json({
    name: player.name,
    score: Math.round(player.score * 100) / 100,
    demons: player.demons,
  });
});

// Crea una cuenta (o la devuelve si ya existe)
app.post("/api/players", async (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Falta el nombre de la cuenta" });

  const players = await loadDb();
  let player = players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!player) {
    player = { name, score: 0, demons: [] };
    players.push(player);
    await saveDb(players);
  }
  res.status(201).json(player);
});

// Añade un demon completado a la cuenta y suma sus puntos
app.post("/api/players/:name/demons", async (req, res) => {
  const { id, name: demonName, position } = req.body || {};
  if (id == null || !demonName) {
    return res.status(400).json({ error: "Datos del demon incompletos" });
  }

  const players = await loadDb();
  const player = players.find(
    (p) => p.name.toLowerCase() === req.params.name.toLowerCase()
  );
  if (!player) return res.status(404).json({ error: "Jugador no encontrado" });

  if (player.demons.some((d) => d.id === id)) {
    return res.status(409).json({ error: "Ya tienes este demon completado" });
  }

  const points = pointsForPosition(position);
  player.demons.push({ id, name: demonName, position: position ?? null, points });
  player.score += points;
  await saveDb(players);

  res.status(201).json({
    name: player.name,
    score: Math.round(player.score * 100) / 100,
    added: { id, name: demonName, position: position ?? null, points },
  });
});

// Elimina un demon de la cuenta y resta sus puntos
app.delete("/api/players/:name/demons/:id", async (req, res) => {
  const demonId = Number(req.params.id);
  const players = await loadDb();
  const player = players.find(
    (p) => p.name.toLowerCase() === req.params.name.toLowerCase()
  );
  if (!player) return res.status(404).json({ error: "Jugador no encontrado" });

  const idx = player.demons.findIndex((d) => d.id === demonId);
  if (idx === -1) return res.status(404).json({ error: "Demon no encontrado en la cuenta" });

  const [removed] = player.demons.splice(idx, 1);
  player.score = Math.max(0, player.score - removed.points);
  await saveDb(players);

  res.json({
    name: player.name,
    score: Math.round(player.score * 100) / 100,
    removed,
  });
});

app.listen(PORT, () => {
  console.log(`Demonlist tracker escuchando en http://localhost:${PORT}`);
});
