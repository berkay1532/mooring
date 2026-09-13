import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCard,
  getAddedCards,
  getSelected,
  getViewMode,
  removeCard,
  setSelected,
  setViewMode,
} from "../../lib/prefs";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const OTHER_OWNER = "GCWVS52A6XGOKUUSO4X7A5KBI3FWBILM4DS7JYQT3Z4K5YB7V574YEQZ";
const CARD_A = "CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP";
const CARD_B = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";

describe("prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips the added-cards list", () => {
    expect(getAddedCards(OWNER)).toEqual([]);
    addCard(OWNER, CARD_A);
    addCard(OWNER, CARD_B);
    expect(getAddedCards(OWNER)).toEqual([CARD_A, CARD_B]);
  });

  it("adding the same card twice is idempotent", () => {
    addCard(OWNER, CARD_A);
    addCard(OWNER, CARD_A);
    expect(getAddedCards(OWNER)).toEqual([CARD_A]);
  });

  it("removes a card", () => {
    addCard(OWNER, CARD_A);
    addCard(OWNER, CARD_B);
    removeCard(OWNER, CARD_A);
    expect(getAddedCards(OWNER)).toEqual([CARD_B]);
  });

  it("removing an absent card is a no-op", () => {
    addCard(OWNER, CARD_A);
    removeCard(OWNER, CARD_B);
    expect(getAddedCards(OWNER)).toEqual([CARD_A]);
  });

  it("keys the added-cards list by owner", () => {
    addCard(OWNER, CARD_A);
    addCard(OTHER_OWNER, CARD_B);
    expect(getAddedCards(OWNER)).toEqual([CARD_A]);
    expect(getAddedCards(OTHER_OWNER)).toEqual([CARD_B]);
  });

  it("round-trips the selected card, keyed by owner", () => {
    expect(getSelected(OWNER)).toBeUndefined();
    setSelected(OWNER, CARD_A);
    setSelected(OTHER_OWNER, CARD_B);
    expect(getSelected(OWNER)).toBe(CARD_A);
    expect(getSelected(OTHER_OWNER)).toBe(CARD_B);
  });

  it("clears the selected card when it is set to null", () => {
    setSelected(OWNER, CARD_A);
    setSelected(OWNER, null);
    expect(getSelected(OWNER)).toBeUndefined();
  });

  it("round-trips the view mode, defaulting to grid, keyed by owner", () => {
    expect(getViewMode(OWNER)).toBe("grid");
    setViewMode(OWNER, "list");
    expect(getViewMode(OWNER)).toBe("list");
    // Another owner in the same browser keeps their own view.
    expect(getViewMode(OTHER_OWNER)).toBe("grid");
  });

  it("uses the caller's fallback view mode only when nothing is stored", () => {
    expect(getViewMode(OWNER, "list")).toBe("list");
    setViewMode(OWNER, "grid");
    expect(getViewMode(OWNER, "list")).toBe("grid");
  });

  it("falls back to defaults on invalid JSON in the added-cards list", () => {
    localStorage.setItem(`mooring:${OWNER}:added`, "{not valid json");
    expect(getAddedCards(OWNER)).toEqual([]);
  });

  it("falls back to defaults on a non-array value in the added-cards list", () => {
    localStorage.setItem(`mooring:${OWNER}:added`, JSON.stringify({ not: "an array" }));
    expect(getAddedCards(OWNER)).toEqual([]);
  });

  it("survives a throwing storage, returning defaults on read and no-oping on write", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(getAddedCards(OWNER)).toEqual([]);
    expect(getSelected(OWNER)).toBeUndefined();
    expect(getViewMode(OWNER)).toBe("grid");
    expect(() => addCard(OWNER, CARD_A)).not.toThrow();
    expect(() => setSelected(OWNER, CARD_A)).not.toThrow();
    expect(() => setSelected(OWNER, null)).not.toThrow();
    expect(() => setViewMode(OWNER, "list")).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
});
