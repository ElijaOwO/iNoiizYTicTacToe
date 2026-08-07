import { DurableObject } from "cloudflare:workers";

const BASE_PATH = "/iNoiizY/TicTacToe";
const LEGACY_PATH = "/iNoiizy/TicTacToe";
const API_PREFIX = `${BASE_PATH}/api/rooms`;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 4096;
const USERNAME_MAX_LENGTH = 18;
const GAME_STORAGE_KEY = "game";
const DUEL_STORAGE_KEY = "stats";
const RECENT_RESULT_LIMIT = 32;
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

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function errorResponse(status, code, message) {
  return jsonResponse({ ok: false, error: code, message }, { status });
}

function normalizeRoomCode(value) {
  const roomId = String(value ?? "").trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(roomId) ? roomId : null;
}

function createRoomCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
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

function normalizePlayerId(value) {
  const playerId = String(value ?? "").trim();
  return PLAYER_ID_PATTERN.test(playerId) ? playerId.toLowerCase() : null;
}

function roleForToken(game, token) {
  if (!token) return null;
  if (game.players.X.token === token) return "X";
  if (game.players.O.token === token) return "O";
  return null;
}

function findWinner(board) {
  for (const pattern of WIN_PATTERNS) {
    const [a, b, c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { role: board[a], pattern };
    }
  }
  return null;
}

function emptyDuelStats() {
  return { X: 0, O: 0, draws: 0, rounds: 0 };
}

function normalizeDuelStats(value) {
  if (!value || typeof value !== "object") return null;
  return {
    X: Math.max(0, Number(value.X) || 0),
    O: Math.max(0, Number(value.O) || 0),
    draws: Math.max(0, Number(value.draws) || 0),
    rounds: Math.max(0, Number(value.rounds) || 0)
  };
}

function upgradeGame(rawGame) {
  if (!rawGame || typeof rawGame !== "object") return null;
  const game = rawGame;
  game.version = 3;
  game.players ??= {};
  game.players.X ??= { token: null, name: "Spieler X", playerId: null };
  game.players.O ??= { token: null, name: null, playerId: null };
  game.players.X.playerId = normalizePlayerId(game.players.X.playerId);
  game.players.O.playerId = normalizePlayerId(game.players.O.playerId);
  game.duelStats = normalizeDuelStats(game.duelStats);
  game.rematchVotes = [];
  return game;
}

function initialGame(ownerToken, ownerName, ownerPlayerId) {
  const now = Date.now();
  return {
    version: 3,
    board: Array(9).fill(null),
    turn: "X",
    status: "waiting",
    winner: null,
    winningPattern: [],
    scores: { X: 0, O: 0 },
    players: {
      X: { token: ownerToken, name: ownerName, playerId: ownerPlayerId },
      O: { token: null, name: null, playerId: null }
    },
    duelStats: null,
    rematchVotes: [],
    round: 1,
    createdAt: now,
    updatedAt: now
  };
}

async function duelObjectName(playerA, playerB) {
  const canonicalPair = [playerA, playerB].sort().join(":");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPair)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readSmallJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MESSAGE_LENGTH) {
    throw new Error("request_too_large");
  }

  const text = await request.text();
  if (text.length > MAX_MESSAGE_LENGTH) throw new Error("request_too_large");
  if (!text) return {};
  return JSON.parse(text);
}

function securityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function mapStoredDuelStats(stored, playerXId, playerOId) {
  if (!stored) return emptyDuelStats();
  const xIsA = stored.playerA === playerXId;
  return {
    X: xIsA ? stored.winsA : stored.winsB,
    O: xIsA ? stored.winsB : stored.winsA,
    draws: stored.draws,
    rounds: stored.rounds
  };
}

export class DuelStats extends DurableObject {
  async getStats(rawPlayerXId, rawPlayerOId) {
    const playerXId = normalizePlayerId(rawPlayerXId);
    const playerOId = normalizePlayerId(rawPlayerOId);
    if (!playerXId || !playerOId || playerXId === playerOId) return emptyDuelStats();

    const stored = await this.ctx.storage.get(DUEL_STORAGE_KEY);
    return mapStoredDuelStats(stored, playerXId, playerOId);
  }

  async recordResult(resultId, rawPlayerXId, rawPlayerOId, winner) {
    const playerXId = normalizePlayerId(rawPlayerXId);
    const playerOId = normalizePlayerId(rawPlayerOId);
    if (!playerXId || !playerOId || playerXId === playerOId) return emptyDuelStats();
    if (typeof resultId !== "string" || resultId.length < 3 || resultId.length > 96) {
      throw new Error("invalid_result_id");
    }
    if (!["X", "O", "draw"].includes(winner)) throw new Error("invalid_winner");

    const [playerA, playerB] = [playerXId, playerOId].sort();
    const current = await this.ctx.storage.get(DUEL_STORAGE_KEY);
    const stored = current && current.playerA === playerA && current.playerB === playerB
      ? current
      : {
          version: 1,
          playerA,
          playerB,
          winsA: 0,
          winsB: 0,
          draws: 0,
          rounds: 0,
          recentResultIds: [],
          updatedAt: Date.now()
        };

    if (stored.recentResultIds.includes(resultId)) {
      return mapStoredDuelStats(stored, playerXId, playerOId);
    }

    const winnerId = winner === "X" ? playerXId : winner === "O" ? playerOId : null;
    if (!winnerId) stored.draws += 1;
    else if (winnerId === playerA) stored.winsA += 1;
    else stored.winsB += 1;

    stored.rounds += 1;
    stored.updatedAt = Date.now();
    stored.recentResultIds = [...stored.recentResultIds, resultId].slice(-RECENT_RESULT_LIMIT);
    await this.ctx.storage.put(DUEL_STORAGE_KEY, stored);
    return mapStoredDuelStats(stored, playerXId, playerOId);
  }
}

export class GameRoom extends DurableObject {
  async initializeRoom(ownerToken, ownerName, ownerPlayerId) {
    const existing = await this.ctx.storage.get(GAME_STORAGE_KEY);
    if (existing) return { ok: false, error: "room_exists" };

    const normalizedName = normalizeUsername(ownerName);
    const normalizedPlayerId = normalizePlayerId(ownerPlayerId);
    if (!normalizedName) return { ok: false, error: "invalid_name" };
    if (!normalizedPlayerId) return { ok: false, error: "invalid_player_id" };

    const game = initialGame(ownerToken, normalizedName, normalizedPlayerId);
    await this.ctx.storage.put(GAME_STORAGE_KEY, game);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    return { ok: true };
  }

  async joinRoom(existingToken, requestedName, requestedPlayerId) {
    const game = upgradeGame(await this.ctx.storage.get(GAME_STORAGE_KEY));
    if (!game) return { ok: false, error: "room_not_found" };

    const name = normalizeUsername(requestedName);
    const playerId = normalizePlayerId(requestedPlayerId);
    if (!name) return { ok: false, error: "invalid_name" };
    if (!playerId) return { ok: false, error: "invalid_player_id" };

    const existingRole = roleForToken(game, existingToken);
    if (existingRole) {
      const player = game.players[existingRole];
      const changed = player.name !== name || !player.playerId;
      player.name = name;
      player.playerId ||= playerId;
      if (changed) {
        game.updatedAt = Date.now();
        await this.persist(game);
      }
      if (game.players.X.playerId && game.players.O.playerId) {
        await this.ensureDuelStats(game, { force: changed });
      }
      if (changed) this.broadcast(game);
      return {
        ok: true,
        role: existingRole,
        token: existingToken,
        name,
        playerId: player.playerId
      };
    }

    if (game.players.O.token) return { ok: false, error: "room_full" };

    const token = crypto.randomUUID();
    game.players.O.token = token;
    game.players.O.name = name;
    game.players.O.playerId = playerId;
    game.status = "playing";
    game.duelStats = emptyDuelStats();
    game.updatedAt = Date.now();
    await this.persist(game);
    this.broadcast(game);

    await this.ensureDuelStats(game, { force: true });
    this.broadcast(game);
    return { ok: true, role: "O", token, name, playerId };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return errorResponse(426, "upgrade_required", "WebSocket nötig.");
    }

    const game = upgradeGame(await this.ctx.storage.get(GAME_STORAGE_KEY));
    if (!game) return errorResponse(404, "room_not_found", "Raum nicht gefunden.");

    const requestedProtocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
      .split(",")
      .map((protocol) => protocol.trim());
    if (!requestedProtocols.includes("ttt")) {
      return errorResponse(400, "invalid_protocol", "WebSocket-Protokoll ungültig.");
    }
    const tokenProtocol = requestedProtocols.find((protocol) => protocol.startsWith("token."));
    const token = tokenProtocol?.slice("token.".length) ?? null;
    const role = roleForToken(game, token);
    if (!role) return errorResponse(403, "invalid_token", "Sitzung ungültig.");

    if (game.players.X.playerId && game.players.O.playerId) {
      await this.ensureDuelStats(game);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    for (const previousSocket of this.ctx.getWebSockets(`role:${role}`)) {
      try {
        previousSocket.close(4001, "Neue Verbindung für diesen Spieler geöffnet.");
      } catch {
      }
    }

    this.ctx.acceptWebSocket(server, [`role:${role}`]);
    server.serializeAttachment({
      role,
      token,
      rematchRound: null,
      duelStats: this.currentDuelStats(game)
    });
    this.broadcast(game);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "ttt" }
    });
  }

  async webSocketMessage(socket, message) {
    if (typeof message !== "string" || message.length > MAX_MESSAGE_LENGTH) {
      this.sendError(socket, "invalid_message", "Ungültige Nachricht.");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      this.sendError(socket, "invalid_json", "Nachricht ungültig.");
      return;
    }

    const attachment = socket.deserializeAttachment();
    if (!attachment?.role || !attachment?.token) {
      socket.close(1008, "Ungültige Sitzung.");
      return;
    }

    const game = upgradeGame(await this.ctx.storage.get(GAME_STORAGE_KEY));
    if (!game || roleForToken(game, attachment.token) !== attachment.role) {
      socket.close(1008, "Sitzung abgelaufen.");
      return;
    }

    if (payload.type === "move") {
      await this.handleMove(socket, game, attachment.role, payload.cell);
      return;
    }

    if (payload.type === "rematch") {
      await this.handleRematch(socket, game, attachment.role);
      return;
    }

    this.sendError(socket, "unknown_message", "Unbekannter Nachrichtentyp.");
  }

  async webSocketClose() {
    const game = upgradeGame(await this.ctx.storage.get(GAME_STORAGE_KEY));
    if (game) this.broadcast(game);
  }

  async webSocketError() {
    const game = upgradeGame(await this.ctx.storage.get(GAME_STORAGE_KEY));
    if (game) this.broadcast(game);
  }

  async alarm() {
    const game = upgradeGame(await this.ctx.storage.get(GAME_STORAGE_KEY));
    if (!game) {
      await this.ctx.storage.deleteAll();
      return;
    }

    const remaining = game.updatedAt + ROOM_TTL_MS - Date.now();
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + remaining);
      return;
    }

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(4000, "Raum wegen Inaktivität geschlossen.");
      } catch {
      }
    }
    await this.ctx.storage.deleteAll();
  }

  async handleMove(socket, game, role, rawCell) {
    const cell = Number(rawCell);

    if (game.status !== "playing") {
      this.sendError(socket, "round_not_active", "Die Runde läuft gerade nicht.");
      return;
    }
    if (game.turn !== role) {
      this.sendError(socket, "not_your_turn", "Du bist nicht dran.");
      return;
    }
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || game.board[cell]) {
      this.sendError(socket, "invalid_move", "Feld nicht frei.");
      return;
    }

    game.board[cell] = role;
    const winner = findWinner(game.board);
    let completedResult = null;

    if (winner) {
      game.status = "finished";
      game.winner = winner.role;
      game.winningPattern = winner.pattern;
      game.scores[winner.role] += 1;
      completedResult = winner.role;
    } else if (game.board.every(Boolean)) {
      game.status = "finished";
      game.winner = "draw";
      game.winningPattern = [];
      completedResult = "draw";
    } else {
      game.turn = role === "X" ? "O" : "X";
    }

    if (completedResult) {
      game.duelStats = this.currentDuelStats(game);
      game.duelStats.rounds += 1;
      if (completedResult === "draw") game.duelStats.draws += 1;
      else game.duelStats[completedResult] += 1;
      this.setDuelStatsCache(game.duelStats);
    }

    game.updatedAt = Date.now();
    await this.persist(game);
    this.broadcast(game);

    if (completedResult) {
      try {
        await this.recordDuelResult(game, completedResult);
      } catch (error) {
        console.error(JSON.stringify({
          event: "duel_result_write_failed",
          room: this.ctx.id?.name ?? "unknown",
          round: game.round,
          message: error instanceof Error ? error.message : String(error)
        }));
      }
    }
  }

  async handleRematch(socket, game, role) {
    if (game.status !== "finished") {
      this.sendError(socket, "round_not_finished", "Rematch erst nach der Runde.");
      return;
    }

    const attachment = socket.deserializeAttachment() ?? {};
    attachment.rematchRound = game.round;
    socket.serializeAttachment(attachment);

    const votes = this.rematchVotes(game);
    if (votes.includes("X") && votes.includes("O")) {
      game.round += 1;
      game.board = Array(9).fill(null);
      game.turn = game.round % 2 === 1 ? "X" : "O";
      game.status = "playing";
      game.winner = null;
      game.winningPattern = [];
      game.rematchVotes = [];
      game.updatedAt = Date.now();
      this.clearRematchVotes();
      await this.persist(game);
    }

    this.broadcast(game);
  }

  rematchVotes(game) {
    const votes = new Set();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (
        (attachment?.role === "X" || attachment?.role === "O")
        && attachment.rematchRound === game.round
      ) {
        votes.add(attachment.role);
      }
    }
    return [...votes];
  }

  clearRematchVotes() {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (!attachment) continue;
      attachment.rematchRound = null;
      socket.serializeAttachment(attachment);
    }
  }

  attachedDuelStats() {
    for (const socket of this.ctx.getWebSockets()) {
      const stats = normalizeDuelStats(socket.deserializeAttachment()?.duelStats);
      if (stats) return stats;
    }
    return null;
  }

  currentDuelStats(game) {
    return structuredClone(
      normalizeDuelStats(this.duelStatsCache)
      ?? this.attachedDuelStats()
      ?? normalizeDuelStats(game.duelStats)
      ?? emptyDuelStats()
    );
  }

  setDuelStatsCache(stats) {
    const normalized = normalizeDuelStats(stats) ?? emptyDuelStats();
    this.duelStatsCache = normalized;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() ?? {};
      attachment.duelStats = normalized;
      socket.serializeAttachment(attachment);
    }
  }

  async ensureDuelStats(game, { force = false } = {}) {
    if (!force) {
      const current = normalizeDuelStats(this.duelStatsCache) ?? this.attachedDuelStats();
      if (current) {
        this.duelStatsCache = current;
        return current;
      }
    }

    const stats = await this.loadDuelStats(game);
    this.setDuelStatsCache(stats);
    return stats;
  }

  async loadDuelStats(game) {
    const playerXId = normalizePlayerId(game.players.X.playerId);
    const playerOId = normalizePlayerId(game.players.O.playerId);
    if (!playerXId || !playerOId || playerXId === playerOId || !this.env?.DUEL_STATS) {
      return emptyDuelStats();
    }

    const objectName = await duelObjectName(playerXId, playerOId);
    return this.env.DUEL_STATS.getByName(objectName).getStats(playerXId, playerOId);
  }

  async recordDuelResult(game, winner) {
    const playerXId = normalizePlayerId(game.players.X.playerId);
    const playerOId = normalizePlayerId(game.players.O.playerId);
    if (!playerXId || !playerOId || playerXId === playerOId || !this.env?.DUEL_STATS) return;

    const objectName = await duelObjectName(playerXId, playerOId);
    const resultId = `${this.ctx.id?.name ?? "room"}:${game.round}`;
    await this.env.DUEL_STATS
      .getByName(objectName)
      .recordResult(resultId, playerXId, playerOId, winner);
  }

  publicState(game) {
    const connected = { X: false, O: false };
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.role === "X" || attachment?.role === "O") {
        connected[attachment.role] = true;
      }
    }

    return {
      board: game.board,
      turn: game.turn,
      status: game.status,
      winner: game.winner,
      winningPattern: game.winningPattern,
      scores: game.scores,
      duelStats: this.currentDuelStats(game),
      players: {
        X: { name: normalizeUsername(game.players.X.name) || "Spieler X" },
        O: { name: normalizeUsername(game.players.O.name) || "Spieler O" }
      },
      connected,
      rematchVotes: this.rematchVotes(game),
      round: game.round
    };
  }

  broadcast(game) {
    const message = JSON.stringify({ type: "state", state: this.publicState(game) });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
      }
    }
  }

  sendError(socket, code, message) {
    try {
      socket.send(JSON.stringify({ type: "error", error: code, message }));
    } catch {
    }
  }

  async persist(game) {
    await this.ctx.storage.put(GAME_STORAGE_KEY, game);
  }
}

async function handleApi(request, env, url) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) {
    return errorResponse(403, "invalid_origin", "Anfrage nicht erlaubt.");
  }

  if (request.method === "POST" && url.pathname === API_PREFIX) {
    let body;
    try {
      body = await readSmallJson(request);
    } catch {
      return errorResponse(400, "invalid_request", "Ungültige Anfrage.");
    }
    const name = normalizeUsername(body.name);
    const playerId = normalizePlayerId(body.playerId);
    if (!name) {
      return errorResponse(400, "invalid_name", "Name muss 2 bis 18 Zeichen haben.");
    }
    if (!playerId) {
      return errorResponse(400, "invalid_player_id", "Spieler-ID ungültig.");
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const roomId = createRoomCode();
      const token = crypto.randomUUID();
      const room = env.GAME_ROOMS.getByName(roomId);
      const result = await room.initializeRoom(token, name, playerId);
      if (result.ok) {
        return jsonResponse({ ok: true, roomId, role: "X", token, name }, { status: 201 });
      }
    }
    return errorResponse(503, "room_creation_failed", "Raum konnte nicht erstellt werden.");
  }

  const routeMatch = url.pathname.match(
    new RegExp(`^${API_PREFIX}/([A-Za-z0-9]{6})/(join|ws)$`)
  );
  if (!routeMatch) return errorResponse(404, "not_found", "Nicht gefunden.");

  const roomId = normalizeRoomCode(routeMatch[1]);
  if (!roomId) return errorResponse(400, "invalid_room", "Ungültiger Raumcode.");

  const action = routeMatch[2];
  const room = env.GAME_ROOMS.getByName(roomId);

  if (action === "join" && request.method === "POST") {
    let body;
    try {
      body = await readSmallJson(request);
    } catch {
      return errorResponse(400, "invalid_request", "Ungültige Anfrage.");
    }

    const name = normalizeUsername(body.name);
    const playerId = normalizePlayerId(body.playerId);
    if (!name) {
      return errorResponse(400, "invalid_name", "Name muss 2 bis 18 Zeichen haben.");
    }
    if (!playerId) {
      return errorResponse(400, "invalid_player_id", "Spieler-ID ungültig.");
    }

    const result = await room.joinRoom(
      typeof body.token === "string" ? body.token : null,
      name,
      playerId
    );
    if (!result.ok) {
      const status = result.error === "room_not_found" ? 404 : 409;
      const message = result.error === "room_full"
        ? "Raum ist voll."
        : "Raum nicht gefunden.";
      return errorResponse(status, result.error, message);
    }

    return jsonResponse({
      ok: true,
      roomId,
      role: result.role,
      token: result.token,
      name: result.name
    });
  }

  if (action === "ws" && request.method === "GET") return room.fetch(request);

  return errorResponse(405, "method_not_allowed", "Methode nicht erlaubt.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === LEGACY_PATH || url.pathname.startsWith(`${LEGACY_PATH}/`)) {
      url.pathname = `${BASE_PATH}/`;
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname === BASE_PATH) {
      url.pathname = `${BASE_PATH}/`;
      return Response.redirect(url.toString(), 308);
    }

    if (!url.pathname.startsWith(`${BASE_PATH}/`)) {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname.startsWith(`${API_PREFIX}/`) || url.pathname === API_PREFIX) {
      return handleApi(request, env, url);
    }

    const response = await env.ASSETS.fetch(request);
    return securityHeaders(response);
  }
};
