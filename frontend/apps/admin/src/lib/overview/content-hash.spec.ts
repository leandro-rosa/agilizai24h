import { stableStringify } from "./content-hash";

describe("stableStringify", () => {
  it("is independent of key order", () => {
    expect(stableStringify({ a: 1, b: { d: 1, c: 2 } })).toBe(stableStringify({ b: { c: 2, d: 1 }, a: 1 }));
  });
  it("differs when content differs", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
  it("drops undefined and keeps null", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });
});
