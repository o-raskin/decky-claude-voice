import { describe, expect, it } from "vitest";
import { CSS } from "../../src/theme";

describe("theme", () => {
  it("has balanced braces", () => {
    const open = (CSS.match(/{/g) || []).length;
    const close = (CSS.match(/}/g) || []).length;
    expect(open).toBe(close);
    expect(open).toBeGreaterThan(50);
  });
  it("styles the elements the UI renders", () => {
    for (const cls of [".cv-root", ".cv-full", ".cv-side", ".cv-main", ".cv-composer", ".cv-msgbtn", ".cv-mic", ".cv-tobottom",
      ".cv-ctxchip", ".cv-chatrow", ".cv-appr", ".cv-selbar", ".cv-quote", ".cv-typing"]) {
      expect(CSS, cls).toContain(cls);
    }
  });
  it("never uses the sticky .gpfocuswithin class (it kept elements highlighted)", () => {
    expect(CSS).not.toContain("gpfocuswithin");
  });
  it("uses Claude's accent colour", () => {
    expect(CSS.toLowerCase()).toContain("#d97757");
  });
});
