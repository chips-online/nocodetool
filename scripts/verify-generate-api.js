/**
 * /generate の動作確認（ローカル）。OPENAI 未設定時は 503 まで。
 * 使い方: PORT=3850 node server.js を別ターミナルで起動してから
 *        node scripts/verify-generate-api.js
 */
"use strict";

const http = require("http");

const PORT = parseInt(process.env.TEST_PORT || "3850", 10);
/** CORS は Origin の値のみ照合（ポートは接続先と一致しなくてよい） */
const ORIGIN = process.env.TEST_ORIGIN || "http://localhost:3847";

function request(method, path, headers, body) {
  return new Promise(function (resolve, reject) {
    const opts = {
      hostname: "127.0.0.1",
      port: PORT,
      path: path,
      method: method,
      headers: headers || {},
    };
    const req = http.request(opts, function (res) {
      var chunks = [];
      res.on("data", function (c) {
        chunks.push(c);
      });
      res.on("end", function () {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function assert(name, cond, detail) {
  if (!cond) {
    console.error("FAIL:", name, detail || "");
    process.exitCode = 1;
  } else {
    console.log("OK:", name);
  }
}

async function main() {
  console.log("Testing http://127.0.0.1:" + PORT + "/generate\n");

  var r1 = await request("POST", "/generate", { "Content-Type": "application/json" }, "{}");
  assert("no Origin -> 403", r1.status === 403, r1.body);

  var r2 = await request(
    "POST",
    "/generate",
    {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    '{"prompt":"only"}'
  );
  assert("missing userId -> 400", r2.status === 400, r2.body);
  var j2 = JSON.parse(r2.body);
  assert("missing userId code", j2.code === "user_id_required");

  var r3 = await request(
    "POST",
    "/generate",
    {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    "{not json"
  );
  assert("bad JSON -> 400", r3.status === 400, r3.body);
  var j3 = JSON.parse(r3.body);
  assert("bad JSON code", j3.code === "invalid_json");

  var r4 = await request(
    "POST",
    "/generate",
    {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    JSON.stringify({ userId: "verify-user-1", prompt: "hello" })
  );
  if (r4.status === 200) {
    assert("with API key -> 200 plain text", true, r4.body.slice(0, 80));
  } else {
    assert("no API key -> 503", r4.status === 503, r4.body);
    var j4 = JSON.parse(r4.body);
    assert("no API key code", j4.code === "openai_unconfigured");
  }

  console.log("\nDone. exitCode=" + (process.exitCode || 0));
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
