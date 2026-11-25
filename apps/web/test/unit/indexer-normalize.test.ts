// @vitest-environment node
import { describe, expect, it } from "vitest";

import { fromRpcEvent, type RpcEventLike } from "../../lib/indexer/normalize/rpc";
import {
  fromExpertRecord,
  ledgerOf,
  txOrderOf,
  txToidOf,
  type ExpertRecord,
} from "../../lib/indexer/normalize/stellarExpert";
import rpcEvents from "../fixtures/indexer/rpc-events.json";
import expertCard from "../fixtures/indexer/stellar-expert-card-events.json";
import expertFactory from "../fixtures/indexer/stellar-expert-factory-events.json";
import expertUsdc from "../fixtures/indexer/stellar-expert-usdc-events.json";

const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const CBI3 = "CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY";
const CAXB = "CAXB2N4XYXXIUJNOCJVRAHVZJD262GSBIEJRHVW6BD3GY5LGPVDVD2D5";
const OWNER = "GBXKAJETATENTZ2TAYVBYGOCNUWRRJHSIKUC2NPWKYN7ZULYHKJHTGIR";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";

const events = (rpcEvents as RpcEventLike[]).map(fromRpcEvent);
const byKind = (kind: string) => events.filter((e) => e?.kind === kind);

describe("indexer/normalize rpc (real testnet events, 2026-11-23..25)", () => {
  it("decodes every fixture row (15 of 15)", () => {
    expect(events.filter(Boolean)).toHaveLength(15);
  });

  it("card_created from the factory → created {owner, card}", () => {
    const created = byKind("created");
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      contract: FACTORY,
      ledger: 5883567,
      txHash: "ca2a7f2d27c256027258cecd46cea644c75da890c6847435365202be04a7ba95",
      payload: { owner: OWNER, card: CBI3 },
    });
    expect(created[1]?.payload.card).toBe(CAXB);
    expect(created[0]?.ts).toMatch(/^2026-11-23T/);
  });

  it("merchant_added / merchant_removed carry the merchant from the topic", () => {
    expect(byKind("merchant_added").map((e) => [e?.contract, e?.payload.merchant])).toEqual([
      [CBI3, "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP"],
      [CAXB, MERCHANT],
    ]);
    expect(byKind("merchant_removed")[0]).toMatchObject({ contract: CAXB, payload: { merchant: MERCHANT } });
  });

  it("label, state, policy, signer, withdrawn payloads", () => {
    expect(byKind("label_changed")[0]?.payload).toEqual({ label: "cli card 2 renamed" });
    expect(byKind("state_changed").map((e) => e?.payload)).toEqual([
      { state: 1, stateName: "frozen" },
      { state: 0, stateName: "active" },
    ]);
    expect(byKind("policy_changed")[0]?.payload).toEqual({
      expiry: "1798033474",
      max_per_tx: "2500000",
      period_amount: "20000000",
      period_duration: "43200",
    });
    expect(byKind("signer_changed")[0]?.payload).toEqual({
      signer: "258023305ab2aaac7aded8374d4a09c41d34cfe7a2bfcf0ff0daf760048e2d25",
    });
    expect(byKind("withdrawn")[0]?.payload).toEqual({ to: OWNER, amount: "500000" });
  });

  it("USDC SAC transfers → transfer {from, to, amount} with string amounts", () => {
    const transfers = byKind("transfer");
    expect(transfers.every((e) => e?.contract === USDC)).toBe(true);
    expect(transfers.map((e) => e?.payload)).toEqual([
      { from: MERCHANT, to: CBI3, amount: "10000000" },
      { from: CBI3, to: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP", amount: "10000" },
      { from: MERCHANT, to: CAXB, amount: "1000000" },
      { from: CAXB, to: OWNER, amount: "500000" },
    ]);
    expect(transfers[1]?.txHash).toBe("e343161a4264c407bf1556d32080b54195fe4eb978c55478f9ca18b5da0f3be0");
  });

  it("returns null for foreign topics, non-contract events and broken XDR — never throws", () => {
    const base = rpcEvents[0] as RpcEventLike;
    expect(fromRpcEvent({ ...base, topic: ["AAAADwAAAAVvdGhlcg=="], value: base.value })).toBeNull(); // "other"
    expect(fromRpcEvent({ ...base, type: "system" })).toBeNull();
    expect(fromRpcEvent({ ...base, topic: ["not base64 xdr!!"] })).toBeNull();
    expect(fromRpcEvent({ ...base, value: "AAAA" })).toBeNull();
  });
});

describe("indexer/normalize stellar.expert", () => {
  const records = (expertCard as { _embedded: { records: ExpertRecord[] } })._embedded.records;

  it("TOID arithmetic: ledger, tx order, enclosing tx toid", () => {
    expect(ledgerOf("025358062441267201-0000")).toBe(5904134);
    expect(txOrderOf("025358062441267201-0000")).toBe(16);
    expect(txToidOf("025358062441267201-0000")).toBe("25358062441267200");
  });

  it("decodes the same card events as the RPC path, keyed se:<id> with no tx hash yet", () => {
    const out = records.map(fromExpertRecord);
    expect(out.map((e) => e?.kind)).toEqual([
      "merchant_added",
      "merchant_removed",
      "label_changed",
      "state_changed",
      "state_changed",
      "policy_changed",
      "signer_changed",
      "withdrawn",
    ]);
    expect(out[0]).toMatchObject({
      eventId: `se:${records[0].id}`,
      contract: CAXB,
      ledger: 5918706,
      txHash: null,
      payload: { merchant: MERCHANT },
    });
    expect(out[7]?.payload).toEqual({ to: OWNER, amount: "500000" });
    expect(out[0]?.ts).toBe(new Date(records[0].ts * 1000).toISOString());
  });

  it("decodes USDC transfers filtered by topic=<card> and factory card_created rows", () => {
    const usdc = (expertUsdc as { _embedded: { records: ExpertRecord[] } })._embedded.records.map(fromExpertRecord);
    expect(usdc.map((e) => [e?.kind, e?.payload.from === CBI3 ? "out" : "in", e?.payload.amount])).toEqual([
      ["transfer", "in", "10000000"],
      ["transfer", "out", "10000"],
    ]);
    const factory = (expertFactory as { _embedded: { records: ExpertRecord[] } })._embedded.records.map(
      fromExpertRecord,
    );
    expect(factory[0]).toMatchObject({ kind: "created", contract: FACTORY, ledger: expect.any(Number) });
    expect(typeof factory[0]?.payload.card).toBe("string");
  });

  it("returns null on malformed rows", () => {
    expect(fromExpertRecord({ ...records[0], bodyXdr: "zz" })).toBeNull();
    expect(fromExpertRecord({ ...records[0], topicsXdr: [] })).toBeNull();
  });
});
