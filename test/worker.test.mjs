import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = path.join(projectRoot, "src", "worker.js");
const temporaryModule = path.join(os.tmpdir(), `tictactoe-worker-${crypto.randomUUID()}.mjs`);

let source = await fs.readFile(sourcePath, "utf8");
source = source
  .replace(
    'import { DurableObject } from "cloudflare:workers";',
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"
  )
  .replace("export class DuelStats", "class DuelStats")
  .replace("export class GameRoom", "class GameRoom")
  .replace("export default {", "const workerDefault = {");
source += "\nexport { DuelStats, GameRoom, workerDefault };\n";
await fs.writeFile(temporaryModule, source);

const { DuelStats, GameRoom, workerDefault } = await import(
  `${pathToFileURL(temporaryModule).href}?${Date.now()}`
);

const PLAYER_X_ID = "11111111-1111-4111-8111-111111111111";
const PLAYER_O_ID = "22222222-2222-4222-8222-222222222222";
const PLAYER_3_ID = "33333333-3333-4333-8333-333333333333";

class MockStorage {
  data = new Map();
  alarm = null;
  putCount = 0;
  alarmWriteCount = 0;

  async get(key) {
    return structuredClone(this.data.get(key));
  }

  async put(key, value) {
    this.putCount += 1;
    this.data.set(key, structuredClone(value));
  }

  async setAlarm(value) {
    this.alarmWriteCount += 1;
    this.alarm = value;
  }

  async deleteAll() {
    this.data.clear();
    this.alarm = null;
  }
}

class MockSocket {
  constructor(role, token, tags = []) {
    this.attachment = role ? { role, token, rematchRound: null } : null;
    this.tags = tags;
    this.messages = [];
    this.closed = false;
  }

  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment() {
    return structuredClone(this.attachment);
  }

  send(value) {
    if (this.closed) throw new Error("Socket geschlossen");
    this.messages.push(JSON.parse(value));
  }

  close(code, reason) {
    this.closed = true;
    this.closeInfo = { code, reason };
  }
}

class MockContext {
  constructor(name = "TEST01") {
    this.storage = new MockStorage();
    this.sockets = [];
    this.id = { name };
  }

  getWebSockets(tag) {
    return this.sockets.filter((socket) => !socket.closed && (!tag || socket.tags.includes(tag)));
  }

  acceptWebSocket(socket, tags = []) {
    socket.tags = tags;
    this.sockets.push(socket);
  }
}

class DuelStatsNamespace {
  constructor() {
    this.objects = new Map();
  }

  getByName(name) {
    if (!this.objects.has(name)) {
      this.objects.set(name, new DuelStats(new MockContext(name), {}));
    }
    return this.objects.get(name);
  }
}

class GameRoomNamespace {
  constructor(duelStats) {
    this.objects = new Map();
    this.duelStats = duelStats;
  }

  getByName(name) {
    if (!this.objects.has(name)) {
      this.objects.set(
        name,
        new GameRoom(new MockContext(name), { DUEL_STATS: this.duelStats })
      );
    }
    return this.objects.get(name);
  }
}

try {
  const duelStatsNamespace = new DuelStatsNamespace();
  const ctx = new MockContext("ROOM01");
  const room = new GameRoom(ctx, { DUEL_STATS: duelStatsNamespace });

  assert.deepEqual(
    await room.initializeRoom("owner-token", "Elija", PLAYER_X_ID),
    { ok: true }
  );
  assert.deepEqual(
    await room.initializeRoom("other-token", "Andere", PLAYER_3_ID),
    { ok: false, error: "room_exists" }
  );
  assert.equal(ctx.storage.putCount, 1, "Raumerstellung schreibt genau einmal");
  assert.equal(ctx.storage.alarmWriteCount, 1, "Ablaufalarm wird nur bei Erstellung gesetzt");

  assert.equal(
    (await room.joinRoom("owner-token", "Elija", PLAYER_X_ID)).role,
    "X"
  );
  assert.equal(ctx.storage.putCount, 1, "Unveränderte Wiederverbindung schreibt nicht erneut");

  const guest = await room.joinRoom(null, "Ronny", PLAYER_O_ID);
  assert.equal(guest.ok, true);
  assert.equal(guest.role, "O");
  assert.equal(ctx.storage.putCount, 2, "Beitritt benötigt genau einen weiteren Raum-Write");
  assert.equal((await room.joinRoom(null, "Dritter", PLAYER_3_ID)).error, "room_full");

  const playerX = new MockSocket("X", "owner-token", ["role:X"]);
  const playerO = new MockSocket("O", guest.token, ["role:O"]);
  ctx.sockets.push(playerX, playerO);

  await room.webSocketMessage(playerO, JSON.stringify({ type: "move", cell: 0 }));
  assert.equal(playerO.messages.at(-1).error, "not_your_turn");

  for (const [socket, cell] of [
    [playerX, 0],
    [playerO, 3],
    [playerX, 1],
    [playerO, 4],
    [playerX, 2]
  ]) {
    await room.webSocketMessage(socket, JSON.stringify({ type: "move", cell }));
  }

  let game = await ctx.storage.get("game");
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "X");
  assert.deepEqual(game.winningPattern, [0, 1, 2]);
  assert.equal(game.scores.X, 1);
  assert.deepEqual(game.duelStats, { X: 1, O: 0, draws: 0, rounds: 1 });
  assert.equal(ctx.storage.putCount, 7, "Jeder gültige Zug schreibt genau einen Raumzustand");
  assert.equal(ctx.storage.alarmWriteCount, 1, "Züge schreiben keinen neuen Ablaufalarm");

  const publicState = playerX.messages.at(-1).state;
  assert.deepEqual(publicState.connected, { X: true, O: true });
  assert.deepEqual(publicState.players, {
    X: { name: "Elija" },
    O: { name: "Ronny" }
  });
  assert.equal("token" in publicState.players.X, false);
  assert.equal("playerId" in publicState.players.X, false);

  const duelObject = [...duelStatsNamespace.objects.values()][0];
  assert.equal(duelObject.ctx.storage.putCount, 1, "Nur ein History-Write pro beendeter Runde");
  assert.deepEqual(
    await duelObject.getStats(PLAYER_X_ID, PLAYER_O_ID),
    { X: 1, O: 0, draws: 0, rounds: 1 }
  );
  await duelObject.recordResult("ROOM01:1", PLAYER_X_ID, PLAYER_O_ID, "X");
  assert.equal(duelObject.ctx.storage.putCount, 1, "Doppelte Resultate werden nicht erneut geschrieben");

  const writesBeforeRematch = ctx.storage.putCount;
  await room.webSocketMessage(playerX, JSON.stringify({ type: "rematch" }));
  game = await ctx.storage.get("game");
  assert.equal(game.status, "finished");
  assert.equal(ctx.storage.putCount, writesBeforeRematch, "Erste Rematch-Stimme verursacht keinen Storage-Write");
  assert.deepEqual(playerX.messages.at(-1).state.rematchVotes, ["X"]);

  await room.webSocketMessage(playerO, JSON.stringify({ type: "rematch" }));
  game = await ctx.storage.get("game");
  assert.equal(game.status, "playing");
  assert.equal(game.round, 2);
  assert.equal(game.turn, "O");
  assert.deepEqual(game.board, Array(9).fill(null));
  assert.equal(ctx.storage.putCount, writesBeforeRematch + 1, "Rematch startet mit nur einem Write");

  const secondRoomCtx = new MockContext("ROOM02");
  const secondRoom = new GameRoom(secondRoomCtx, { DUEL_STATS: duelStatsNamespace });
  await secondRoom.initializeRoom("owner-2", "Elija", PLAYER_X_ID);
  const secondGuest = await secondRoom.joinRoom(null, "Ronny", PLAYER_O_ID);
  assert.equal(secondGuest.ok, true);
  const secondGame = await secondRoomCtx.storage.get("game");
  assert.deepEqual(
    secondRoom.publicState(secondGame).duelStats,
    { X: 1, O: 0, draws: 0, rounds: 1 },
    "Neue Begegnung lädt den bisherigen Gesamtstand"
  );

  const apiDuelStats = new DuelStatsNamespace();
  const rooms = new GameRoomNamespace(apiDuelStats);
  const env = {
    GAME_ROOMS: rooms,
    DUEL_STATS: apiDuelStats,
    ASSETS: {
      fetch: async () => new Response("asset", { headers: { "Content-Type": "text/plain" } })
    }
  };

  const createResponse = await workerDefault.fetch(
    new Request("https://elija.me/iNoiizY/TicTacToe/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Elija", playerId: PLAYER_X_ID })
    }),
    env
  );
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.roomId, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(created.role, "X");

  const joinResponse = await workerDefault.fetch(
    new Request(`https://elija.me/iNoiizY/TicTacToe/api/rooms/${created.roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: null, name: "Ronny", playerId: PLAYER_O_ID })
    }),
    env
  );
  assert.equal(joinResponse.status, 200);
  const joined = await joinResponse.json();
  assert.equal(joined.role, "O");
  assert.equal(joined.name, "Ronny");

  const invalidIdentityResponse = await workerDefault.fetch(
    new Request("https://elija.me/iNoiizY/TicTacToe/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Elija", playerId: "nicht-gueltig" })
    }),
    env
  );
  assert.equal(invalidIdentityResponse.status, 400);

  const rejectedOrigin = await workerDefault.fetch(
    new Request("https://elija.me/iNoiizY/TicTacToe/api/rooms", {
      method: "POST",
      headers: { Origin: "https://example.com" }
    }),
    env
  );
  assert.equal(rejectedOrigin.status, 403);

  const assetResponse = await workerDefault.fetch(
    new Request("https://elija.me/iNoiizY/TicTacToe/app.js"),
    env
  );
  assert.equal(assetResponse.headers.get("X-Frame-Options"), "DENY");
  assert.match(assetResponse.headers.get("Content-Security-Policy"), /connect-src/);

  console.log("Tic-Tac-Toe Multiplayer-Tests: OK");
} finally {
  await fs.rm(temporaryModule, { force: true });
}
