const MODE_LOCAL = "local";
const MODE_ONLINE = "online";
const PLAYER = "player";
const COMPUTER = "computer";
const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const USERNAME_STORAGE_KEY = "inoiizy-tictactoe-username";
const PLAYER_ID_STORAGE_KEY = "inoiizy-tictactoe-player-id";
const CURRENT_ROOM_STORAGE_KEY = "inoiizy-tictactoe-current-room";
const USERNAME_MAX_LENGTH = 18;
const WIN_PATTERNS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];
const CELL_POSITIONS = [
  "oben links",
  "oben mittig",
  "oben rechts",
  "Mitte links",
  "Mitte",
  "Mitte rechts",
  "unten links",
  "unten mittig",
  "unten rechts"
];

const appScript = document.querySelector('script[src$="app.js"]');
const BASE_PATH = new URL(".", appScript.src).pathname.replace(/\/$/, "");

const cells = [...document.querySelectorAll(".cell")];
const boardElement = document.querySelector("#board");
const statusElement = document.querySelector("#status");
const leftScoreElement = document.querySelector("#left-score");
const rightScoreElement = document.querySelector("#right-score");
const leftScoreSide = document.querySelector("#left-score-side");
const rightScoreSide = document.querySelector("#right-score-side");
const leftScoreLabel = document.querySelector("#left-score-label");
const rightScoreLabel = document.querySelector("#right-score-label");
const newRoundButton = document.querySelector("#new-round");
const localModeButton = document.querySelector("#local-mode");
const onlineModeButton = document.querySelector("#online-mode");
const onlinePanel = document.querySelector("#online-panel");
const onlineLobby = document.querySelector("#online-lobby");
const roomPanel = document.querySelector("#room-panel");
const createRoomButton = document.querySelector("#create-room");
const joinForm = document.querySelector("#join-form");
const joinRoomButton = document.querySelector("#join-room");
const roomInput = document.querySelector("#room-input");
const usernameInput = document.querySelector("#username-input");
const usernameField = document.querySelector("#username-field");
const roomCodeElement = document.querySelector("#room-code");
const playerRoleElement = document.querySelector("#player-role");
const connectionStateElement = document.querySelector("#connection-state");
const copyCodeButton = document.querySelector("#copy-code");
const copyLinkButton = document.querySelector("#copy-link");
const leaveRoomButton = document.querySelector("#leave-room");
const onlineErrorElement = document.querySelector("#online-error");
const duelHistoryElement = document.querySelector("#duel-history");
const duelXWinsElement = document.querySelector("#duel-x-wins");
const duelOWinsElement = document.querySelector("#duel-o-wins");
const duelHistoryNamesElement = document.querySelector("#duel-history-names");
const duelHistoryMetaElement = document.querySelector("#duel-history-meta");

let mode = MODE_LOCAL;
let localBoard = Array(9).fill(null);
let localTurn = PLAYER;
let localRoundFinished = false;
let computerTimer;
let localScores = loadLocalScores();
const copyFeedbackTimers = new WeakMap();

let inMemoryPlayerId = null;

const online = {
  roomId: null,
  token: null,
  role: null,
  name: null,
  playerId: null,
  socket: null,
  state: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  intentionallyClosed: false
};

function normalizePlayerId(value) {
  const playerId = String(value ?? "").trim().toLowerCase();
  const isValid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(playerId);
  if (isValid) return playerId;
  return null;
}

function loadOrCreatePlayerId() {
  try {
    const existing = normalizePlayerId(localStorage.getItem(PLAYER_ID_STORAGE_KEY));
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_STORAGE_KEY, created);
    return created;
  } catch {
    inMemoryPlayerId ||= crypto.randomUUID();
    return inMemoryPlayerId;
  }
}

function normalizeUsername(value) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const username = Array.from(cleaned).slice(0, USERNAME_MAX_LENGTH).join("");
  return username.length >= 2 ? username : null;
}

function loadUsername() {
  try {
    return normalizeUsername(localStorage.getItem(USERNAME_STORAGE_KEY)) ?? "";
  } catch {
    return "";
  }
}

function saveUsername(username) {
  try {
    localStorage.setItem(USERNAME_STORAGE_KEY, username);
  } catch {}
}

function loadCurrentRoom() {
  try {
    return normalizeRoomCode(sessionStorage.getItem(CURRENT_ROOM_STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveCurrentRoom(roomId) {
  try {
    sessionStorage.setItem(CURRENT_ROOM_STORAGE_KEY, roomId);
  } catch {}
}

function clearCurrentRoom() {
  try {
    sessionStorage.removeItem(CURRENT_ROOM_STORAGE_KEY);
  } catch {}
}

function getUsername() {
  const username = normalizeUsername(usernameInput.value);
  if (!username) {
    showOnlineError("Name: mindestens 2 Zeichen.");
    usernameInput.focus();
    return null;
  }
  usernameInput.value = username;
  saveUsername(username);
  return username;
}

function loadLocalScores() {
  try {
    const saved = JSON.parse(localStorage.getItem("inoiizy-tictactoe-score"));
    const oldValues = Object.values(saved ?? {});
    const player = Number.isFinite(saved?.player) ? saved.player : oldValues[0];
    const computer = Number.isFinite(saved?.computer) ? saved.computer : oldValues[1];
    return {
      player: Number.isFinite(player) ? player : 0,
      computer: Number.isFinite(computer) ? computer : 0
    };
  } catch {
    return { player: 0, computer: 0 };
  }
}

function saveLocalScores() {
  try {
    localStorage.setItem("inoiizy-tictactoe-score", JSON.stringify(localScores));
  } catch {}
}

function roomStorageKey(roomId) {
  return `inoiizy-tictactoe-room-${roomId}`;
}

function loadRoomToken(roomId) {
  try {
    return sessionStorage.getItem(roomStorageKey(roomId));
  } catch {
    return null;
  }
}

function saveRoomToken(roomId, token) {
  try {
    sessionStorage.setItem(roomStorageKey(roomId), token);
  } catch {}
}

function setStatus(message) {
  statusElement.textContent = message;
}

function setScoreboard(left, right, leftLabel, rightLabel) {
  leftScoreElement.textContent = left;
  rightScoreElement.textContent = right;
  leftScoreLabel.textContent = leftLabel;
  rightScoreLabel.textContent = rightLabel;
  leftScoreElement.setAttribute("aria-label", `Punkte ${leftLabel}: ${left}`);
  rightScoreElement.setAttribute("aria-label", `Punkte ${rightLabel}: ${right}`);
}

function renderDuelHistory(state) {
  const stats = state?.duelStats;
  const visible = mode === MODE_ONLINE && stats && state.status !== "waiting";
  duelHistoryElement.hidden = !visible;
  if (!visible) return;

  const xName = playerName(state, "X");
  const oName = playerName(state, "O");
  const roundWord = stats.rounds === 1 ? "Runde" : "Runden";

  duelXWinsElement.textContent = stats.X;
  duelOWinsElement.textContent = stats.O;
  duelHistoryNamesElement.textContent = `${xName} gegen ${oName}`;
  duelHistoryMetaElement.textContent = `${stats.draws} Unentschieden · ${stats.rounds} ${roundWord}`;
  duelHistoryElement.setAttribute(
    "aria-label",
    `Gesamt: ${xName} ${stats.X} zu ${stats.O} gegen ${oName}, ${stats.draws} Unentschieden`
  );
}

function setTurnHighlight(activeSide) {
  const leftActive = activeSide === "left";
  const rightActive = activeSide === "right";
  leftScoreSide.classList.toggle("is-turn", leftActive);
  rightScoreSide.classList.toggle("is-turn", rightActive);
  leftScoreSide.setAttribute("aria-current", leftActive ? "true" : "false");
  rightScoreSide.setAttribute("aria-current", rightActive ? "true" : "false");
}

function tokenOwner(value) {
  if (value === PLAYER || value === "X") return PLAYER;
  if (value === COMPUTER || value === "O") return COMPUTER;
  return null;
}

function tokenDescription(value) {
  if (mode === MODE_ONLINE) {
    return `von ${playerName(online.state ?? {}, value)}`;
  }
  if (value === PLAYER) return "von dir";
  return "vom Computer";
}

function createToken(value) {
  const owner = tokenOwner(value);
  const image = document.createElement("img");

  if (owner === PLAYER) {
    image.src = "./assets/player.webp";
  } else {
    image.src = "./assets/computer.webp";
  }

  if (mode === MODE_LOCAL) {
    image.alt = owner === PLAYER ? "Dein Bild" : "Bild des Computers";
  } else if (value === online.role) {
    image.alt = `Dein Spielstein ${value}`;
  } else {
    image.alt = `Spielstein ${value}`;
  }

  image.draggable = false;
  return image;
}

function renderBoard(values, winningPattern = [], canSelect = () => false) {
  cells.forEach((cell, index) => {
    const value = values[index];
    cell.replaceChildren();
    cell.classList.toggle("is-win", winningPattern.includes(index));
    cell.removeAttribute("data-owner");
    cell.setAttribute("aria-label", `Feld ${CELL_POSITIONS[index]}`);

    if (value) {
      cell.dataset.owner = tokenOwner(value);
      cell.append(createToken(value));
      cell.setAttribute("aria-label", `Feld ${CELL_POSITIONS[index]}, ${tokenDescription(value)} belegt`);
    }

    cell.disabled = Boolean(value) || !canSelect(index);
  });
}

function findWinner(state) {
  for (const pattern of WIN_PATTERNS) {
    const [a, b, c] = pattern;
    if (state[a] && state[a] === state[b] && state[a] === state[c]) {
      return { owner: state[a], pattern };
    }
  }
  return null;
}

function renderLocalGame() {
  setScoreboard(localScores.player, localScores.computer, "Du", "Computer");

  let activeSide = null;
  if (!localRoundFinished) {
    activeSide = localTurn === PLAYER ? "left" : "right";
  }
  setTurnHighlight(activeSide);

  const winner = findWinner(localBoard);
  const canSelect = (index) => !localRoundFinished && localTurn === PLAYER && !localBoard[index];
  renderBoard(localBoard, winner?.pattern ?? [], canSelect);
}

function finishLocalRound(winner) {
  localRoundFinished = true;

  if (winner) {
    localScores[winner.owner] += 1;
    saveLocalScores();
    setStatus(winner.owner === PLAYER ? "Du gewinnst!" : "Computer gewinnt");
  } else {
    setStatus("Unentschieden");
  }

  renderLocalGame();
}

function evaluateLocalRound() {
  const winner = findWinner(localBoard);
  if (winner) {
    finishLocalRound(winner);
    return true;
  }

  if (localBoard.every(Boolean)) {
    finishLocalRound(null);
    return true;
  }

  return false;
}

function ratePosition(state, computerTurn, depth = 0) {
  const winner = findWinner(state);
  if (winner?.owner === COMPUTER) return 10 - depth;
  if (winner?.owner === PLAYER) return depth - 10;
  if (state.every(Boolean)) return 0;

  const scores = [];
  for (let index = 0; index < state.length; index += 1) {
    if (state[index]) continue;
    state[index] = computerTurn ? COMPUTER : PLAYER;
    scores.push(ratePosition(state, !computerTurn, depth + 1));
    state[index] = null;
  }

  if (computerTurn) return Math.max(...scores);
  return Math.min(...scores);
}

function chooseComputerMove() {
  const moves = [];
  let bestScore = -Infinity;

  for (let index = 0; index < localBoard.length; index += 1) {
    if (localBoard[index]) continue;
    localBoard[index] = COMPUTER;
    const score = ratePosition(localBoard, false);
    localBoard[index] = null;
    moves.push({ index, score });
    if (score > bestScore) bestScore = score;
  }

  const bestMoves = moves.filter((move) => move.score === bestScore);
  const otherMoves = moves.filter((move) => move.score < bestScore);
  const makeMistake = otherMoves.length > 0 && Math.random() < 0.15;
  const choices = makeMistake ? otherMoves : bestMoves;
  const randomIndex = Math.floor(Math.random() * choices.length);
  return choices[randomIndex].index;
}

function runComputerTurn() {
  setStatus("Computer denkt …");
  renderLocalGame();

  const computerDelay = 650 + Math.floor(Math.random() * 301);
  computerTimer = window.setTimeout(() => {
    if (mode !== MODE_LOCAL || localRoundFinished) return;
    localBoard[chooseComputerMove()] = COMPUTER;
    if (evaluateLocalRound()) return;

    localTurn = PLAYER;
    setStatus("Du bist dran");
    renderLocalGame();
  }, computerDelay);
}

function startLocalRound(focusBoard = true) {
  window.clearTimeout(computerTimer);
  localBoard = Array(9).fill(null);
  localTurn = PLAYER;
  localRoundFinished = false;
  newRoundButton.hidden = false;
  newRoundButton.disabled = false;
  newRoundButton.textContent = "Neue Runde";
  setStatus("Du bist dran");
  renderLocalGame();
  if (focusBoard) cells[0].focus({ preventScroll: true });
}

function showOnlineError(message) {
  onlineErrorElement.textContent = message;
  onlineErrorElement.hidden = !message;
}

function setLobbyBusy(isBusy) {
  createRoomButton.disabled = isBusy;
  joinRoomButton.disabled = isBusy;
  roomInput.disabled = isBusy;
  usernameInput.disabled = isBusy;
}

function updateModeControls() {
  const localActive = mode === MODE_LOCAL;
  localModeButton.classList.toggle("is-active", localActive);
  onlineModeButton.classList.toggle("is-active", !localActive);
  localModeButton.setAttribute("aria-pressed", String(localActive));
  onlineModeButton.setAttribute("aria-pressed", String(!localActive));
  onlinePanel.hidden = localActive;
}

function removeRoomFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  history.replaceState(null, "", url);
}

function stopOnlineConnection() {
  online.intentionallyClosed = true;
  window.clearTimeout(online.reconnectTimer);
  online.reconnectTimer = null;

  const socket = online.socket;
  online.socket = null;
  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close(1000, "Raum verlassen");
  }
}

function clearOnlineSession({ removeUrl = true } = {}) {
  stopOnlineConnection();
  online.roomId = null;
  online.token = null;
  online.role = null;
  online.name = null;
  online.playerId = null;
  online.state = null;
  online.reconnectAttempt = 0;
  roomPanel.hidden = true;
  usernameField.hidden = false;
  onlineLobby.hidden = false;
  newRoundButton.hidden = true;
  duelHistoryElement.hidden = true;
  setLobbyBusy(false);
  showOnlineError("");
  clearCurrentRoom();
  if (removeUrl) removeRoomFromUrl();
}

function activateLocalMode() {
  if (mode === MODE_ONLINE) clearOnlineSession();
  mode = MODE_LOCAL;
  duelHistoryElement.hidden = true;
  updateModeControls();
  startLocalRound(false);
}

function activateOnlineMode() {
  window.clearTimeout(computerTimer);
  mode = MODE_ONLINE;
  updateModeControls();

  if (!online.roomId) {
    usernameField.hidden = false;
    onlineLobby.hidden = false;
    roomPanel.hidden = true;
    newRoundButton.hidden = true;
    setScoreboard(0, 0, normalizeUsername(usernameInput.value) || "Du", "Gegner");
    setTurnHighlight(null);
    duelHistoryElement.hidden = true;
    renderBoard(Array(9).fill(null));
    setStatus("Raum erstellen oder beitreten");
  } else {
    renderOnlineGame();
  }
}

function normalizeRoomCode(value) {
  const roomId = String(value ?? "").trim().toUpperCase();
  return ROOM_PATTERN.test(roomId) ? roomId : null;
}

function shareRoomUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", online.roomId);
  return url.toString();
}

function playerName(state, role) {
  return state.players?.[role]?.name || `Spieler ${role}`;
}

function onlineStatusMessage(state, socketOpen) {
  if (!socketOpen) return "Verbindung weg. Neuer Versuch …";
  if (state.status === "waiting") return "Warte auf Gegner";

  if (state.status === "finished") {
    if (state.rematchVotes.includes(online.role)) return "Rematch angefragt";
    if (state.winner === "draw") return "Unentschieden. Rematch?";
    if (state.winner === online.role) return "Du gewinnst!";
    return `${playerName(state, state.winner)} gewinnt`;
  }

  let message = "Du bist dran";
  if (state.turn !== online.role) {
    message = `${playerName(state, state.turn)} ist dran`;
  }

  const opponent = online.role === "X" ? "O" : "X";
  if (!state.connected?.[opponent]) {
    message += " · Gegner offline";
  }
  return message;
}

function renderOnlineGame() {
  if (!online.roomId) return;

  usernameField.hidden = true;
  onlineLobby.hidden = true;
  roomPanel.hidden = false;
  roomCodeElement.value = online.roomId;
  roomCodeElement.setAttribute("aria-label", "Verdeckter sechsstelliger Raumcode");
  let ownName = online.name;
  if (online.state && online.role) {
    ownName = playerName(online.state, online.role);
  }
  playerRoleElement.textContent = "–";
  if (online.role) {
    playerRoleElement.textContent = `${ownName || "Du"} (${online.role})`;
  }

  const socketOpen = online.socket?.readyState === WebSocket.OPEN;
  connectionStateElement.textContent = socketOpen ? "Verbunden" : "Nicht verbunden";
  connectionStateElement.classList.toggle("is-online", socketOpen);

  const state = online.state;
  if (!state) {
    duelHistoryElement.hidden = true;
    setScoreboard(0, 0, "Spieler X", "Spieler O");
    setTurnHighlight(null);
    renderBoard(Array(9).fill(null));
    newRoundButton.hidden = true;
    setStatus(socketOpen ? "Raum lädt …" : "Verbinde …");
    return;
  }

  const xName = playerName(state, "X");
  const oName = playerName(state, "O");
  const leftLabel = online.role === "X" ? `${xName} (du)` : xName;
  const rightLabel = online.role === "O" ? `${oName} (du)` : oName;
  setScoreboard(state.scores.X, state.scores.O, leftLabel, rightLabel);

  let activeSide = null;
  if (state.status === "playing") {
    activeSide = state.turn === "X" ? "left" : "right";
  }
  setTurnHighlight(activeSide);
  renderDuelHistory(state);

  const canSelect = (index) => (
    socketOpen
    && state.status === "playing"
    && state.turn === online.role
    && !state.board[index]
  );
  renderBoard(state.board, state.winningPattern, canSelect);
  setStatus(onlineStatusMessage(state, socketOpen));

  const roundFinished = state.status === "finished";
  newRoundButton.hidden = !roundFinished;
  newRoundButton.textContent = state.rematchVotes.includes(online.role)
    ? "Rematch angefragt"
    : "Rematch anfragen";
  newRoundButton.disabled = !socketOpen || state.rematchVotes.includes(online.role);
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${BASE_PATH}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers
    }
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Serverantwort ungültig.");
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.message || "Anfrage fehlgeschlagen.");
  }
  return data;
}

function startOnlineSession({ roomId, token, role, name }) {
  stopOnlineConnection();
  online.roomId = roomId;
  online.token = token;
  online.role = role;
  online.name = normalizeUsername(name) || normalizeUsername(usernameInput.value);
  online.playerId = loadOrCreatePlayerId();
  online.state = null;
  online.reconnectAttempt = 0;
  online.intentionallyClosed = false;
  saveRoomToken(roomId, token);
  saveCurrentRoom(roomId);
  removeRoomFromUrl();
  showOnlineError("");
  renderOnlineGame();
  connectWebSocket();
}

function connectWebSocket() {
  if (!online.roomId || !online.token || mode !== MODE_ONLINE) return;
  if (online.socket && online.socket.readyState <= WebSocket.OPEN) return;

  window.clearTimeout(online.reconnectTimer);
  online.reconnectTimer = null;
  online.intentionallyClosed = false;

  const socketUrl = new URL(`${BASE_PATH}/api/rooms/${online.roomId}/ws`, window.location.origin);
  socketUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(socketUrl, ["ttt", `token.${online.token}`]);
  online.socket = socket;
  renderOnlineGame();

  socket.addEventListener("open", () => {
    if (online.socket !== socket) return;
    online.reconnectAttempt = 0;
    renderOnlineGame();
  });

  socket.addEventListener("message", (event) => {
    if (online.socket !== socket) return;

    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      showOnlineError("Servernachricht ungültig.");
      return;
    }

    if (message.type === "state") {
      online.state = message.state;
      showOnlineError("");
      renderOnlineGame();
      return;
    }

    if (message.type === "error") {
      showOnlineError(message.message || "Zug abgelehnt.");
    }
  });

  socket.addEventListener("close", () => {
    if (online.socket !== socket) return;
    online.socket = null;
    renderOnlineGame();

    if (online.intentionallyClosed || !online.roomId || mode !== MODE_ONLINE) return;
    online.reconnectAttempt += 1;
    const delay = Math.min(1000 * 2 ** (online.reconnectAttempt - 1), 10000);
    online.reconnectTimer = window.setTimeout(connectWebSocket, delay);
  });
}

function sendOnlineMessage(payload) {
  if (online.socket?.readyState !== WebSocket.OPEN) {
    showOnlineError("Keine Verbindung.");
    return false;
  }

  online.socket.send(JSON.stringify(payload));
  return true;
}

async function createRoom() {
  activateOnlineMode();
  const name = getUsername();
  if (!name) return;
  setLobbyBusy(true);
  showOnlineError("");
  setStatus("Erstelle Raum …");

  try {
    const session = await requestJson("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, playerId: loadOrCreatePlayerId() })
    });
    startOnlineSession(session);
  } catch (error) {
    showOnlineError(error.message);
    setStatus("Raum konnte nicht erstellt werden.");
  } finally {
    setLobbyBusy(false);
  }
}

async function joinRoom(roomId) {
  const normalizedRoomId = normalizeRoomCode(roomId);
  activateOnlineMode();
  const name = getUsername();
  if (!name) return;

  if (!normalizedRoomId) {
    showOnlineError("Raumcode ungültig.");
    roomInput.focus();
    return;
  }

  setLobbyBusy(true);
  showOnlineError("");
  setStatus("Öffne Raum …");

  try {
    const storedToken = loadRoomToken(normalizedRoomId);
    const session = await requestJson(`/api/rooms/${normalizedRoomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: storedToken, name, playerId: loadOrCreatePlayerId() })
    });
    startOnlineSession(session);
  } catch (error) {
    showOnlineError(error.message);
    setStatus("Beitritt fehlgeschlagen.");
  } finally {
    setLobbyBusy(false);
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textArea.remove();
  }
  return copied;
}

function showCopyFeedback(button, message) {
  const defaultLabel = button.dataset.defaultLabel || button.textContent;
  button.dataset.defaultLabel = defaultLabel;
  window.clearTimeout(copyFeedbackTimers.get(button));
  button.textContent = message;
  copyFeedbackTimers.set(button, window.setTimeout(() => {
    button.textContent = defaultLabel;
  }, 1800));
}

async function copyValue(button, value, successMessage) {
  const copied = await copyTextToClipboard(value);
  if (copied) {
    showOnlineError("");
    showCopyFeedback(button, successMessage);
    return;
  }

  if (button === copyCodeButton) {
    roomCodeElement.focus();
    roomCodeElement.select();
    roomCodeElement.setSelectionRange(0, roomCodeElement.value.length);
    showOnlineError("Code markiert. Drücke Strg + C.");
    return;
  }

  showOnlineError("Kopieren blockiert.");
}

async function copyRoomCode() {
  if (!online.roomId) return;
  await copyValue(copyCodeButton, online.roomId, "Code kopiert");
}

async function copyInviteLink() {
  if (!online.roomId) return;
  await copyValue(copyLinkButton, shareRoomUrl(), "Link kopiert");
}

function handleCellClick(event) {
  const index = Number(event.currentTarget.dataset.cell);

  if (mode === MODE_ONLINE) {
    if (sendOnlineMessage({ type: "move", cell: index })) {
      event.currentTarget.disabled = true;
    }
    return;
  }

  if (localRoundFinished || localTurn !== PLAYER || localBoard[index]) return;
  localBoard[index] = PLAYER;
  renderLocalGame();
  if (evaluateLocalRound()) return;
  localTurn = COMPUTER;
  runComputerTurn();
}

cells.forEach((cell) => cell.addEventListener("click", handleCellClick));

newRoundButton.addEventListener("click", () => {
  if (mode === MODE_LOCAL) {
    startLocalRound();
    return;
  }
  sendOnlineMessage({ type: "rematch" });
});

localModeButton.addEventListener("click", activateLocalMode);
onlineModeButton.addEventListener("click", activateOnlineMode);
createRoomButton.addEventListener("click", () => void createRoom());
copyCodeButton.addEventListener("click", () => void copyRoomCode());
copyLinkButton.addEventListener("click", () => void copyInviteLink());
leaveRoomButton.addEventListener("click", () => {
  clearOnlineSession();
  activateOnlineMode();
  roomInput.focus();
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void joinRoom(roomInput.value);
});

roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, "")
    .slice(0, 6);
});

usernameInput.addEventListener("blur", () => {
  const username = normalizeUsername(usernameInput.value);
  if (username) {
    usernameInput.value = username;
    saveUsername(username);
  }
});

boardElement.addEventListener("keydown", (event) => {
  const index = Number(document.activeElement?.dataset.cell);
  if (!Number.isInteger(index)) return;

  const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const next = index + moves[event.key];
  if (next >= 0 && next < cells.length) cells[next].focus();
});

window.addEventListener("online", () => {
  if (mode === MODE_ONLINE && online.roomId && !online.socket) connectWebSocket();
});

function initialize() {
  loadOrCreatePlayerId();
  usernameInput.value = loadUsername();
  updateModeControls();
  startLocalRound(false);

  const roomFromUrl = normalizeRoomCode(new URL(window.location.href).searchParams.get("room"));
  const storedRoom = loadCurrentRoom();
  let roomToOpen = roomFromUrl;
  if (!roomToOpen && storedRoom && loadRoomToken(storedRoom)) {
    roomToOpen = storedRoom;
  }
  if (roomToOpen) {
    roomInput.value = roomToOpen;
    if (normalizeUsername(usernameInput.value)) {
      void joinRoom(roomToOpen);
    } else {
      activateOnlineMode();
      showOnlineError("Name eingeben, dann beitreten.");
      usernameInput.focus();
    }
  }
}

initialize();
