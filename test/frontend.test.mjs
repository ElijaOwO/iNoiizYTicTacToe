import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const html = await read("public/iNoiizY/TicTacToe/index.html");
const css = await read("public/iNoiizY/TicTacToe/styles.css");
const js = await read("public/iNoiizY/TicTacToe/app.js");
const worker = await read("src/worker.js");
const headers = await read("public/_headers");
const wrangler = await read("wrangler.jsonc");
const readme = await read("README.md");
const packageJson = JSON.parse(await read("package.json"));

assert.match(html, /id="username-input"/);
assert.match(html, /id="room-input"[\s\S]*?type="password"/);
assert.match(html, /id="room-code"[\s\S]*?type="password"/);
assert.match(html, /id="copy-code"/);
assert.match(html, /made by elija/);
assert.match(html, /id="left-score-side"/);
assert.match(html, /id="right-score-side"/);
assert.match(html, /id="duel-history"/);
assert.match(html, /id="duel-x-wins"/);
assert.match(html, />Computer</);
assert.match(html, /2–18 Zeichen\. Der andere Spieler sieht deinen Namen\./);
assert.match(css, /#left-score-side\.is-turn/);
assert.match(css, /#right-score-side\.is-turn/);
assert.match(css, /\.site-credit/);
assert.match(css, /\.room-code-secret/);
assert.match(css, /\.duel-history \{/);
assert.match(css, /position: fixed;/);
assert.match(css, /data-owner="computer"/);
assert.match(js, /async function copyRoomCode\(\)/);
assert.match(js, /function normalizeUsername\(value\)/);
assert.match(js, /function loadOrCreatePlayerId\(\)/);
assert.match(js, /crypto\.randomUUID\(\)/);
assert.match(js, /function renderDuelHistory\(state\)/);
assert.match(js, /function chooseComputerMove\(\)/);
assert.match(js, /function runComputerTurn\(\)/);
assert.match(js, /playerId: loadOrCreatePlayerId\(\)/);
assert.match(js, /removeRoomFromUrl\(\);/);
assert.match(js, /const computerDelay = 650 \+ Math\.floor\(Math\.random\(\) \* 301\)/);
assert.doesNotMatch(js, /window\.prompt/);
assert.doesNotMatch(js, /setStatus\(`Raum \$\{normalizedRoomId\}/);
assert.doesNotMatch(css, /am Zug| · Zug/);
assert.doesNotMatch(css, /score-side\.is-turn \.score-label::after/);
assert.match(headers, /X-Frame-Options: DENY/);
assert.match(headers, /Content-Security-Policy:/);
assert.doesNotMatch(wrangler, /run_worker_first/);
assert.match(wrangler, /"name": "DUEL_STATS"/);
assert.match(wrangler, /"DuelStats":/);
assert.equal(packageJson.version, "1.6.0");

const code = `${html}\n${css}\n${js}\n${worker}`;
const projectText = `${code}\n${readme}`;
assert.doesNotMatch(code, /^\s*\/\//m);
assert.doesNotMatch(code, /\/\*/);
assert.doesNotMatch(html, /<!--/);
assert.doesNotMatch(projectText, /\b(?:AI|KI)\b|Künstliche|ChatGPT|OpenAI/i);

await access(new URL("public/iNoiizY/TicTacToe/assets/computer.webp", root));
await assert.rejects(access(new URL("public/iNoiizY/TicTacToe/assets/ai.webp", root)));

console.log("Frontend-Prüfungen erfolgreich.");
