# Pharol CLI and HTTP MCP stress tests

Use Node 24 and run from the repository root. The harness uses fake keys and deterministic fixtures; never point it at a live server or use real keys. Standalone stdio MCP is not shipped and is out of scope.

```sh
npm ci
npm run build
npm run pack:cli
install_dir=$(mktemp -d)
npm install --prefix "$install_dir" ./leviant-labs-pharol-cli-0.1.1.tgz
export PHAROL_MOCK_LOG="$install_dir/mock.jsonl"
export TAVILY_API_KEY=fake-tavily-key-TEST0001
export FIRECRAWL_API_KEY=fake-firecrawl-key-TEST0002
export PHAROL_WEB_TRANSPORT=fetch
export PHAROL_METRICS_PORT=3106
export PHAROL_ORIGIN=http://127.0.0.1:3105
export PHAROL_CREDENTIAL_SECRET=$(node -p "'ab'.repeat(32)")
NODE_OPTIONS="--expose-gc --require $PWD/stress/mock.cjs" \
  ./node_modules/.bin/next start -H 127.0.0.1 -p 3105 &
test_server=$!
```

Wait for `curl -fsS http://127.0.0.1:3105/api/mcp` to succeed, then run the following from the same shell (or reuse the exact same exported settings). Restart the test server before repeating the protocol run so per-key cooldowns do not persist across runs.

```sh
node stress/run-protocol.cjs --cli "$install_dir/node_modules/.bin/pharol"
node stress/run-load.cjs --cli "$install_dir/node_modules/.bin/pharol" --ops 20 --hold-ms 10000
node stress/soak.cjs --warm-ms 120000 --cold-ms 120000 --control-ms 90000
kill "$test_server"
```

Use `--server-pid` with the **actual process serving** `/api/mcp` for Linux RSS sampling. For heap conclusions, first confirm that `/__metrics` reports that same PID and `gcAvailable: true`. The listener can otherwise be owned by the Next launcher. The runners are test-only; generated data stays separate from the archived snapshots.

## Benchmarks from the Android/Ubuntu test environment

- [Original ramp and hold](baselines/results-ramp-v1.json): higher-concurrency distinct search reused already cached inputs; the hold checked transport status and IDs, not payload validity. RSS rose, peaked, then leveled off before the end of the hold. This is not a leak diagnosis.
- [Fresh-input ramp](baselines/results-fresh-v2.json): 480 operations, zero recorded validation failures; all 20 fresh MCP search requests at each level reached the mock provider. A repeated uncached query produced 17 upstream calls at concurrency 20.
- [Paced soak](baselines/soak-results-v2.json): 13,200 requests at nominally 40 requests/s, zero recorded validation failures. Cold-query p95 was 102 ms and every cold search reached the mock. **The metrics listener and request-serving PIDs differed, so this snapshot cannot establish server heap stability or identify the source of RSS growth.**

The protocol runner is a functional smoke test, not a Streamable HTTP conformance suite. It does not verify the `notifications/initialized` acknowledgement or GET with `Accept: text/event-stream`. Live-provider behavior was not tested.
