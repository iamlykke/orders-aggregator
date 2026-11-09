import { describe, expect, it } from "vitest";
import { fromKop, parsePercent, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
    expect(() => parseRub("")).toThrow();
    expect(() => parseRub("  ")).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });

  it("не теряет копейку из-за погрешности double", () => {
    // 4723.9 * 100 = 472389.99999999994, 1217.61 * 100 = 121760.99999999999
    expect(toKop(4723.9)).toBe(472390);
    expect(toKop(1217.61)).toBe(121761);
    expect(toKop(0.29)).toBe(29);
    expect(toKop(1.005)).toBe(100); // 1.005 — это 1.00499999999999989…: доля копейки отбрасывается
    for (let kop = 0; kop < 1_000_000; kop += 7) expect(toKop(kop / 100)).toBe(kop);
  });
});

describe("parsePercent", () => {
  it("число или строка от 0 до 100", () => {
    expect(parsePercent(0)).toBe(0);
    expect(parsePercent("7")).toBe(7);
    expect(parsePercent(27.5)).toBe(27.5);
    expect(parsePercent(100)).toBe(100);
  });

  it("отклоняет мусор и значения вне диапазона", () => {
    expect(() => parsePercent(-1)).toThrow();
    expect(() => parsePercent(101)).toThrow();
    expect(() => parsePercent("abc")).toThrow();
    expect(() => parsePercent("")).toThrow();
    expect(() => parsePercent(null)).toThrow();
  });
});
