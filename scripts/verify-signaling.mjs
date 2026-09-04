// Verificacao headless de um relay de sinalizacao IMPLANTADO.
// Uso: node scripts/verify-signaling.mjs <signaling-base-url> <web-origin>
//   <signaling-base-url>  ex.: https://fagulha-signaling.up.railway.app
//   <web-origin>          valor EXATO configurado como WEB_ORIGIN no servidor,
//                         enviado como header Origin do handshake WS
// Exit 0 = um quadro `signal` do cliente "host" chegou ao cliente "guest".
// Exit 1 = qualquer outra coisa (upgrade recusado, quadro errado, timeout).

import WebSocket from "ws";

const [, , baseArg, originArg] = process.argv;
if (!baseArg || !originArg) {
  console.error("usage: node scripts/verify-signaling.mjs <signaling-base-url> <web-origin>");
  process.exit(1);
}

const WS_URL = `${baseArg.replace(/^http/, "ws")}/ws`;
const ORIGIN = originArg;
const SDP = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
const TIMEOUT_MS = 15000;

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

const timer = setTimeout(() => fail(`no relayed signal within ${TIMEOUT_MS}ms`), TIMEOUT_MS);

const open = (label) => {
  const ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });
  ws.on("error", (err) =>
    fail(
      `${label} socket error: ${err.message} — server down, or Origin does not match WEB_ORIGIN exactly?`
    )
  );
  ws.on("unexpected-response", (_req, res) =>
    fail(`${label} handshake rejected: HTTP ${res.statusCode} — wrong path or Origin mismatch`)
  );
  ws.on("close", (code) =>
    fail(
      `${label} socket closed unexpectedly (code ${code}) — connection dropped before the relay completed`
    )
  );
  return ws;
};

const parse = (raw) => {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return fail(`received a non-JSON frame: ${raw.toString().slice(0, 120)}`);
  }
};

const host = open("host");
let guest;
let token;

host.on("open", () => host.send(JSON.stringify({ type: "create" })));

host.on("message", (raw) => {
  const msg = parse(raw);
  if (msg.type === "error") return fail(`server error frame on host: ${msg.code}`);

  if (msg.type === "session_state" && msg.session?.status === "waiting" && !token) {
    token = msg.session.token;
    if (!token) return fail("create returned no token");

    guest = open("guest");
    guest.on("open", () => guest.send(JSON.stringify({ type: "join", token, role: "guest" })));
    guest.on("message", (graw) => {
      const gmsg = parse(graw);
      if (gmsg.type === "error") return fail(`server error frame on guest: ${gmsg.code}`);
      if (gmsg.type === "session_state" && gmsg.session?.status === "waiting") {
        guest.send(JSON.stringify({ type: "accept" }));
      }
      if (gmsg.type === "signal") {
        if (gmsg.payload?.kind === "offer" && gmsg.payload?.sdp === SDP) {
          clearTimeout(timer);
          console.log("OK: signal relayed host -> guest end to end");
          host.close();
          guest.close();
          process.exit(0);
        }
        return fail(`guest received an unexpected signal payload: ${JSON.stringify(gmsg.payload)}`);
      }
    });
  }

  if (msg.type === "session_state" && msg.session?.status === "accepted") {
    host.send(JSON.stringify({ type: "signal", payload: { kind: "offer", sdp: SDP } }));
  }
});
