# Demonlist Tracker

Página sencilla construida sobre la **API de la Pointercrate Demonlist**. Permite:

- 🔎 **Buscar** cualquier extreme demon del histórico de la lista por nombre.
- ➕ **Seleccionar** un demon y sumar automáticamente los puntos que otorga a tu cuenta.
- 🏆 Aparecer en un **leaderboard de jugadores** ordenado por puntos.

## Cómo funciona

### Puntos (fórmula oficial de Pointercrate)

Al añadir un demon se calculan los puntos con la misma fórmula que usa el
_stats viewer_ de Pointercrate para un récord al 100 %:

```
puntos(posición) = 150 · e^((1 − posición) · ln(1/30) / (−149))
```

- Posición 1 → **150 puntos**
- Posición 7 (Tidal Wave) → **130.8 puntos**
- Posición 150 → **~2.48 puntos**
- Demons fuera del top 150 (_legacy_) → **0 puntos** (igual que en la lista real)

### Cuentas y leaderboard (locales)

La API de Pointercrate **no permite** escribir puntos en cuentas reales (eso
requiere permisos de moderador y no existe un endpoint público para ello). Por
eso las "cuentas" y el leaderboard son **locales**: se guardan en
`data/players.json` en el servidor. Cada jugador acumula los puntos de los
demons que marca como completados (sin duplicados).

### Proxy a Pointercrate (CORS)

La API de Pointercrate no envía cabeceras CORS y está tras Cloudflare, así que
el navegador no puede llamarla directamente. El servidor Express hace de
**proxy** en `/api/demons`. Si la API en vivo no responde (p. ej. Cloudflare
bloquea la petición), se usa automáticamente un **dataset de respaldo** con el
top 150 real (`data/demons-fallback.json`); la UI avisa cuando esto ocurre.

## Arrancar

```bash
npm install
npm start
# abre http://localhost:3000
```

## Actualizar el dataset de respaldo

Desde una red no bloqueada por Cloudflare:

```bash
node scripts/build-fallback.mjs
```

Descarga el top 150 actual y reescribe `data/demons-fallback.json`.

## Estructura

```
server.js                     Servidor Express: proxy + cuentas + leaderboard
public/index.html             UI
public/style.css              Estilos
public/app.js                 Lógica del frontend
data/demons-fallback.json     Top 150 real (respaldo si la API no responde)
scripts/build-fallback.mjs    Regenera el dataset de respaldo
```

## Endpoints del servidor

| Método | Ruta                               | Descripción                               |
| ------ | ---------------------------------- | ----------------------------------------- |
| GET    | `/api/demons?q=texto`              | Busca demons (en vivo, con respaldo)      |
| GET    | `/api/leaderboard`                 | Leaderboard ordenado por puntos           |
| GET    | `/api/players/:name`               | Detalle de una cuenta                     |
| POST   | `/api/players`                     | Crea/recupera una cuenta                  |
| POST   | `/api/players/:name/demons`        | Añade un demon y suma puntos              |
| DELETE | `/api/players/:name/demons/:id`    | Quita un demon y resta puntos             |

Datos de la demonlist: [Pointercrate](https://pointercrate.com) · repositorio [stadust/pointercrate](https://github.com/stadust/pointercrate).
