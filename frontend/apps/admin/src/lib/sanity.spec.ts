import { money } from "@/lib/format";

describe("jest setup", () => {
  it("runs TypeScript and resolves @/* imports", () => {
    expect(typeof money).toBe("function");
  });
});
