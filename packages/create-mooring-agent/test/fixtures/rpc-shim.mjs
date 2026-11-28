// Preloaded (NODE_OPTIONS=--import) into the scaffolded agent by the e2e test.
//
// The client only talks to an https Soroban RPC on testnet-shaped URLs
// (`AssembledTransaction` builds its `rpc.Server` without `allowHttp`), so the
// agent is pointed at MOORING_RPC_URL=https://rpc.mooring.test and this shim
// forwards those requests to the test's plain-http JSON-RPC responder at
// MOORING_TEST_RPC_TARGET. Every other request is left alone.
const HOST = "https://rpc.mooring.test";
const target = process.env.MOORING_TEST_RPC_TARGET;
const original = globalThis.fetch;

if (target) {
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(HOST)) return original(input, init);
    const rewritten = target + url.slice(HOST.length);
    if (typeof input === "string" || input instanceof URL) return original(rewritten, init);
    return original(new Request(rewritten, input), init);
  };
}
