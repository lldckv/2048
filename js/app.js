"use strict";

const SIZE = 4;
const GAME_KEY = "game2048:state:v1";
const BEST_KEY = "game2048:best:v1";
const LEADERBOARD_KEY = "game2048:leaderboard:v1";
const ANIM_DURATION = 130;

function uid() {
  return "tile_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function deepClone(obj) {
  return typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}

const gridBg = document.getElementById("gridBg");
for (let i = 0; i < SIZE * SIZE; i++) {
  const cell = document.createElement("div");
  cell.className = "grid-cell";
  gridBg.appendChild(cell);
}

// state
let tiles = [];          // [{id, r, c, value}]
let score = 0;
let best = Number(localStorage.getItem(BEST_KEY)) || 0;
let gameOver = false;
let submitted = false;
let history = null;      // { tiles, score } — один шаг назад
let isAnimating = false;
let leaderboardOpen = false;
const bestValueEl = document.getElementById("bestValue");
bestValueEl.textContent = best;

function saveState() {
  const payload = {
    tiles: tiles.map((t) => ({ id: t.id, r: t.r, c: t.c, value: t.value })),
    score,
    gameOver,
    submitted,
    history: history
      ? { tiles: history.tiles.map((t) => ({ id: t.id, r: t.r, c: t.c, value: t.value })), score: history.score }
      : null,
  };
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error("Не удалось сохранить состояние игры", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.tiles)) return null;
    return parsed;
  } catch (e) {
    console.error("Не удалось прочитать состояние игры", e);
    return null;
  }
}

function saveBest() {
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch (e) {
    console.error(e);
  }
}

function loadLeaderboard() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(e);
    return [];
  }
}
function saveLeaderboard(list) {
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
  } catch (e) {
    console.error(e);
  }
}
function addToLeaderboard(name, points) {
  const list = loadLeaderboard();
  list.push({ name: name || "Игрок", score: points, date: new Date().toLocaleString("ru-RU") });
  list.sort((a, b) => b.score - a.score);
  saveLeaderboard(list.slice(0, 10));
}


function getEmptyCells(currentTiles) {
  const occupied = new Set(currentTiles.map((t) => `${t.r},${t.c}`));
  const empty = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!occupied.has(`${r},${c}`)) empty.push({ r, c });
    }
  }
  return empty;
}

function spawnTiles(currentTiles, count) {
  const empty = getEmptyCells(currentTiles);
  const n = Math.min(count, empty.length);
  for (let i = 0; i < n; i++) {
    const idx = randomInt(0, empty.length - 1);
    const { r, c } = empty.splice(idx, 1)[0];
    const value = Math.random() < 0.9 ? 2 : 4;
    currentTiles.push({ id: uid(), r, c, value, isNew: true });
  }
}

function newGame() {
  tiles = [];
  score = 0;
  gameOver = false;
  submitted = false;
  history = null;
  spawnTiles(tiles, randomInt(1, 3));
  hideGameOverOverlay();
  resetOverlayInputs();
  renderFull();
  updateFooterState();
  saveState();
}

function getLines(direction) {
  const lines = [];
  if (direction === "left" || direction === "right") {
    for (let r = 0; r < SIZE; r++) {
      const coords = [0, 1, 2, 3].map((c) => ({ r, c }));
      lines.push(direction === "left" ? coords : coords.slice().reverse());
    }
  } else {
    for (let c = 0; c < SIZE; c++) {
      const coords = [0, 1, 2, 3].map((r) => ({ r, c }));
      lines.push(direction === "up" ? coords : coords.slice().reverse());
    }
  }
  return lines;
}

//  * [4,4,4,4] -> [16,0,0,0], +32 = +8, +8, +16).

function mergeLine(lineTiles) {
  const list = lineTiles.slice();
  const removedIds = [];
  const mergedSurvivorIds = new Set();
  let scoreGained = 0;

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].value === list[i + 1].value) {
        list[i].value *= 2;
        scoreGained += list[i].value;
        mergedSurvivorIds.add(list[i].id);
        removedIds.push(list[i + 1].id);
        list.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }

  return { list, scoreGained, removedIds, mergedSurvivorIds };
}

function computeMove(sourceTiles, direction) {
  const working = sourceTiles.map((t) => ({ id: t.id, r: t.r, c: t.c, value: t.value }));
  const removedIds = new Set();
  const mergedIds = new Set(); // выжившие
  let moved = false;
  let scoreGained = 0;

  const lines = getLines(direction);

  for (const line of lines) {
    const lineTiles = [];
    for (const { r, c } of line) {
      const t = working.find((wt) => wt.r === r && wt.c === c && !removedIds.has(wt.id));
      if (t) lineTiles.push(t);
    }

    const { list: resultTiles, scoreGained: gained, removedIds: removed, mergedSurvivorIds } = mergeLine(lineTiles);
    scoreGained += gained;
    removed.forEach((id) => removedIds.add(id));
    mergedSurvivorIds.forEach((id) => mergedIds.add(id));

    resultTiles.forEach((t, i) => {
      const { r, c } = line[i];
      if (t.r !== r || t.c !== c) moved = true;
      t.r = r;
      t.c = c;
    });
  }

  if (removedIds.size > 0) moved = true;

  const newTiles = working.filter((t) => !removedIds.has(t.id));
  return { moved, tiles: newTiles, scoreGained, mergedIds };
}

function canMove(currentTiles) {
  return ["left", "right", "up", "down"].some((dir) => computeMove(currentTiles, dir).moved);
}

function handleMove(direction) {
  if (gameOver || isAnimating || leaderboardOpen) return;

  const result = computeMove(tiles, direction);
  if (!result.moved) return;
  history = { tiles: deepClone(tiles), score };

  tiles = result.tiles;
  score += result.scoreGained;
  if (score > best) {
    best = score;
    saveBest();
  }

  renderMove(result.mergedIds);
  updateFooterState();

  isAnimating = true;
  setTimeout(() => {
    spawnTiles(tiles, Math.random() < 0.85 ? 1 : 2);
    renderFull();
    isAnimating = false;

    if (!canMove(tiles)) {
      gameOver = true;
      showGameOverOverlay();
    }
    updateFooterState();
    saveState();
  }, ANIM_DURATION);
}

function undoMove() {
  if (!history || gameOver || isAnimating) return;
  tiles = history.tiles;
  score = history.score;
  history = null;
  renderFull();
  updateFooterState();
  saveState();
}

function getCellStep() {
  const styles = getComputedStyle(document.documentElement);
  const cell = parseFloat(styles.getPropertyValue("--cell-size"));
  const gap = parseFloat(styles.getPropertyValue("--gap-size"));
  return cell + gap;
}

function positionTileEl(el, r, c) {
  const step = getCellStep();
  el.style.transform = `translate(${c * step}px, ${r * step}px)`;
}

function createTileEl(tile) {
  const el = document.createElement("div");
  el.className = "tile";
  el.dataset.id = tile.id;
  el.dataset.value = tile.value;
  positionTileEl(el, tile.r, tile.c);
  const inner = document.createElement("div");
  inner.className = "tile__inner";
  inner.textContent = tile.value;
  el.appendChild(inner);

  return el;
}

const scoreValueEl = document.getElementById("scoreValue");
const tilesLayer = document.getElementById("tilesLayer");

function renderFull() {
  tilesLayer.innerHTML = "";
  tiles.forEach((tile) => {
    const el = createTileEl(tile);
    if (tile.isNew) {
      const inner = el.querySelector(".tile__inner");
      inner.classList.add("tile--new");
      tile.isNew = false;
      inner.addEventListener("animationend", () => inner.classList.remove("tile--new"), { once: true });
    }
    tilesLayer.appendChild(el);
  });
  scoreValueEl.textContent = score;
  bestValueEl.textContent = best;
}

function renderMove(mergedIds) {
  const existingEls = new Map();
  tilesLayer.querySelectorAll(".tile").forEach((el) => existingEls.set(el.dataset.id, el));

  const keepIds = new Set(tiles.map((t) => t.id));
  existingEls.forEach((el, id) => {
    if (!keepIds.has(id)) el.remove();
  });

  tiles.forEach((tile) => {
    const el = existingEls.get(tile.id);
    if (!el) return;
    el.dataset.value = tile.value;
    const inner = el.querySelector(".tile__inner");
    inner.textContent = tile.value;
    positionTileEl(el, tile.r, tile.c);
    if (mergedIds.has(tile.id)) {
      inner.classList.add("tile--pop");
      inner.addEventListener("animationend", () => inner.classList.remove("tile--pop"), { once: true });
    }
  });

  scoreValueEl.textContent = score;
  bestValueEl.textContent = best;
}

const undoBtn = document.getElementById("undoBtn");
const mobileControls = document.getElementById("mobileControls");

function updateFooterState() {
  undoBtn.disabled = !history || gameOver || isAnimating;
  updateControlsVisibility();
}

function updateControlsVisibility() {
  const shouldHide = gameOver || leaderboardOpen;
  mobileControls.classList.toggle("is-hidden", shouldHide);
}


const gameOverOverlay = document.getElementById("gameOverOverlay");
const gameOverMessage = document.getElementById("gameOverMessage");
const playerNameInput = document.getElementById("playerNameInput");
const saveScoreBtn = document.getElementById("saveScoreBtn");

function showGameOverOverlay() {
  gameOverOverlay.hidden = false;
  updateControlsVisibility();
  if (submitted) {
    playerNameInput.hidden = true;
    saveScoreBtn.hidden = true;
    gameOverMessage.textContent = "Ваш рекорд сохранён!";
  } else {
    resetOverlayInputs();
  }
}
function hideGameOverOverlay() {
  gameOverOverlay.hidden = true;
  updateControlsVisibility();
}
function resetOverlayInputs() {
  gameOverMessage.textContent = "Игра окончена!";
  playerNameInput.hidden = false;
  playerNameInput.value = "";
  saveScoreBtn.hidden = false;
}

saveScoreBtn.addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  addToLeaderboard(name, score);
  submitted = true;
  playerNameInput.hidden = true;
  saveScoreBtn.hidden = true;
  gameOverMessage.textContent = "Ваш рекорд сохранён!";
  saveState();
});

const restartFromOverlayBtn = document.getElementById("restartFromOverlayBtn");
restartFromOverlayBtn.addEventListener("click", newGame);
const restartBtn = document.getElementById("restartBtn");
restartBtn.addEventListener("click", newGame);
undoBtn.addEventListener("click", undoMove);


const leaderboardBody = document.getElementById("leaderboardBody");

function renderLeaderboard() {
  const list = loadLeaderboard();
  leaderboardBody.innerHTML = "";
  document.getElementById("leaderboardEmpty").hidden = list.length > 0;
  list.forEach((entry, i) => {
    const row = document.createElement("tr");
    const cells = [String(i + 1), entry.name, String(entry.score), entry.date];
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      row.appendChild(td);
    });
    leaderboardBody.appendChild(row);
  });
}

const leaderboardModal = document.getElementById("leaderboardModal");

function openLeaderboard() {
  renderLeaderboard();
  leaderboardModal.hidden = false;
  leaderboardOpen = true;
  updateControlsVisibility();
}
function closeLeaderboard() {
  leaderboardModal.hidden = true;
  leaderboardOpen = false;
  updateControlsVisibility();
}
document.getElementById("leaderboardBtn").addEventListener("click", openLeaderboard);
document.getElementById("leaderboardCloseBtn").addEventListener("click", closeLeaderboard);
document.getElementById("leaderboardOverlay").addEventListener("click", closeLeaderboard);

const KEY_TO_DIR = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

document.addEventListener("keydown", (e) => {
  const dir = KEY_TO_DIR[e.key];
  if (!dir) return;
  e.preventDefault();
  handleMove(dir);
});

mobileControls.querySelectorAll(".ctrl").forEach((btn) => {
  btn.addEventListener("click", () => handleMove(btn.dataset.dir));
});

window.addEventListener("resize", () => {
  tiles.forEach((tile) => {
    const el = tilesLayer.querySelector(`[data-id="${tile.id}"]`);
    if (el) positionTileEl(el, tile.r, tile.c);
  });
});

function init() {
  const saved = loadState();
  if (saved && saved.tiles.length > 0) {
    tiles = saved.tiles.map((t) => ({ ...t, isNew: false }));
    score = saved.score || 0;
    gameOver = Boolean(saved.gameOver);
    submitted = Boolean(saved.submitted);
    history = saved.history ? { tiles: saved.history.tiles, score: saved.history.score } : null;
    renderFull();
    updateFooterState();
    if (gameOver) showGameOverOverlay();
  } else {
    newGame();
  }
}

init();
