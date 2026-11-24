/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */
let currentPlayer = localStorage.getItem("dl_player") || null;
let myDemonIds = new Set(); // ids de demons ya completados por la cuenta activa

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);

function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add("hidden"), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ------------------------------------------------------------------ */
/* Cuenta                                                              */
/* ------------------------------------------------------------------ */
async function enterAccount(name) {
  const data = await api("/api/players", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  currentPlayer = data.name;
  localStorage.setItem("dl_player", currentPlayer);
  await refreshAll();
  toast(`¡Hola, ${currentPlayer}!`, "ok");
}

function logout() {
  currentPlayer = null;
  myDemonIds = new Set();
  localStorage.removeItem("dl_player");
  renderAccount();
  renderMyDemons([]);
  renderDemonList(lastDemons); // re-render para actualizar botones
}

function renderAccount(score = 0) {
  const status = $("#account-status");
  const row = $(".account-row");
  if (currentPlayer) {
    row.classList.add("hidden");
    status.classList.remove("hidden");
    $("#current-player").textContent = currentPlayer;
    $("#current-score").textContent = score;
  } else {
    row.classList.remove("hidden");
    status.classList.add("hidden");
  }
}

/* ------------------------------------------------------------------ */
/* Lista de demons (búsqueda)                                          */
/* ------------------------------------------------------------------ */
let lastDemons = [];

async function searchDemons(q) {
  const container = $("#demon-list");
  container.innerHTML = `<p class="placeholder">Buscando…</p>`;
  try {
    const result = await api(`/api/demons?q=${encodeURIComponent(q)}`);
    const demons = result.demons || [];
    lastDemons = demons;
    renderDemonList(demons);
    const note = $("#source-note");
    if (result.source === "fallback") {
      note.textContent =
        "⚠️ Usando datos locales de respaldo (top 150). La API en vivo de Pointercrate no respondió.";
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }
  } catch (err) {
    container.innerHTML = `<p class="placeholder">No se pudo cargar: ${err.message}</p>`;
  }
}

function renderDemonList(demons) {
  const container = $("#demon-list");
  if (!demons.length) {
    container.innerHTML = `<p class="placeholder">Sin resultados.</p>`;
    return;
  }
  container.innerHTML = "";
  for (const d of demons) {
    const legacy = d.position == null || d.position > 150;
    const already = myDemonIds.has(d.id);

    const row = document.createElement("div");
    row.className = "demon";
    row.innerHTML = `
      <div class="pos">${d.position != null ? "#" + d.position : "—"}</div>
      <div class="info">
        <div class="name">${escapeHtml(d.name)}${
      legacy ? '<span class="badge-legacy">legacy</span>' : ""
    }</div>
        <div class="meta">por ${escapeHtml(d.publisher || "?")} · verif. ${escapeHtml(
      d.verifier || "?"
    )}</div>
      </div>
      <div class="pts">${d.points} pts</div>
    `;

    const btn = document.createElement("button");
    if (already) {
      btn.textContent = "✓ Hecho";
      btn.disabled = true;
      btn.className = "ghost";
    } else {
      btn.textContent = "+ Añadir";
      btn.addEventListener("click", () => addDemon(d));
    }
    row.appendChild(btn);
    container.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/* Añadir / quitar demons de la cuenta                                 */
/* ------------------------------------------------------------------ */
async function addDemon(demon) {
  if (!currentPlayer) {
    toast("Primero entra con una cuenta.", "err");
    return;
  }
  try {
    const data = await api(
      `/api/players/${encodeURIComponent(currentPlayer)}/demons`,
      {
        method: "POST",
        body: JSON.stringify({
          id: demon.id,
          name: demon.name,
          position: demon.position,
        }),
      }
    );
    myDemonIds.add(demon.id);
    renderAccount(data.score);
    renderDemonList(lastDemons);
    await Promise.all([loadMyDemons(), loadLeaderboard()]);
    toast(`+${data.added.points} pts por ${demon.name}`, "ok");
  } catch (err) {
    toast(err.message, "err");
  }
}

async function removeDemon(demonId, demonName) {
  try {
    const data = await api(
      `/api/players/${encodeURIComponent(currentPlayer)}/demons/${demonId}`,
      { method: "DELETE" }
    );
    myDemonIds.delete(demonId);
    renderAccount(data.score);
    renderDemonList(lastDemons);
    await Promise.all([loadMyDemons(), loadLeaderboard()]);
    toast(`Quitado ${demonName}`, "ok");
  } catch (err) {
    toast(err.message, "err");
  }
}

async function loadMyDemons() {
  if (!currentPlayer) return;
  const data = await api(`/api/players/${encodeURIComponent(currentPlayer)}`);
  myDemonIds = new Set(data.demons.map((d) => d.id));
  renderAccount(data.score);
  renderMyDemons(data.demons);
}

function renderMyDemons(demons) {
  const container = $("#my-demons");
  if (!currentPlayer) {
    container.innerHTML = `<p class="placeholder">Entra con una cuenta para empezar.</p>`;
    return;
  }
  if (!demons.length) {
    container.innerHTML = `<p class="placeholder">Aún no has añadido demons.</p>`;
    return;
  }
  // Ordenamos por posición (los mejores arriba)
  const sorted = [...demons].sort(
    (a, b) => (a.position ?? 9999) - (b.position ?? 9999)
  );
  container.innerHTML = "";
  for (const d of sorted) {
    const row = document.createElement("div");
    row.className = "demon";
    row.innerHTML = `
      <div class="pos">${d.position != null ? "#" + d.position : "—"}</div>
      <div class="info">
        <div class="name">${escapeHtml(d.name)}</div>
      </div>
      <div class="pts">${d.points} pts</div>
    `;
    const btn = document.createElement("button");
    btn.textContent = "Quitar";
    btn.className = "remove";
    btn.addEventListener("click", () => removeDemon(d.id, d.name));
    row.appendChild(btn);
    container.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */
async function loadLeaderboard() {
  const body = $("#leaderboard-body");
  try {
    const rows = await api("/api/leaderboard");
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4" class="placeholder">Sin jugadores todavía.</td></tr>`;
      return;
    }
    body.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      if (currentPlayer && r.name.toLowerCase() === currentPlayer.toLowerCase()) {
        tr.className = "me";
      }
      tr.innerHTML = `
        <td>${r.rank}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.demonCount}</td>
        <td>${r.score}</td>
      `;
      body.appendChild(tr);
    }
  } catch (err) {
    body.innerHTML = `<tr><td colspan="4" class="placeholder">${err.message}</td></tr>`;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

async function refreshAll() {
  renderAccount();
  await Promise.all([loadMyDemons(), loadLeaderboard()]);
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */
$("#account-btn").addEventListener("click", () => {
  const name = $("#account-name").value.trim();
  if (!name) return toast("Escribe un nombre de cuenta.", "err");
  enterAccount(name).catch((e) => toast(e.message, "err"));
});

$("#account-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#account-btn").click();
});

$("#logout-btn").addEventListener("click", logout);

$("#search").addEventListener(
  "input",
  debounce((e) => searchDemons(e.target.value.trim()), 350)
);

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */
(async function init() {
  await searchDemons("");
  await loadLeaderboard();
  if (currentPlayer) await loadMyDemons();
  renderAccount();
})();
