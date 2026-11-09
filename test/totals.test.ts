import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

/** День без скидок: gross = net = total. */
const noDiscount = (date: string, total: number) => ({ date, total, gross: total, discount: 0, net: total });

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      noDiscount("2026-02-09", 0),
      noDiscount("2026-02-10", 1000),
      noDiscount("2026-02-11", 349),
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 500)]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 800)]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /customers/:id/daily-totals: скидки", () => {
  it("gross, discount, net по дням; total = gross", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 0, amountPaid: 1000 }));
    await postWebhook(ctx.app, apiOrder({ amount: "1500.00", discountPercent: "27.5", amountPaid: 1087.5 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 2500, gross: 2500, discount: 412.5, net: 2087.5 }]);
  });

  it("заказы без полей скидки (старые) считаются оплаченными полностью", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 700 }));
    await postWebhook(ctx.app, apiOrder({ amount: 300, discountPercent: 10, amountPaid: 270 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 1000, gross: 1000, discount: 30, net: 970 }]);
  });

  it("если пришёл только discountPercent — оплата считается из него", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 697, discountPercent: 33 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 697, gross: 697, discount: 230.01, net: 466.99 }]);
  });

  it("суммы с копейками не теряют копейку и не накапливают ошибку float", async () => {
    // 4723.9 * 100 = 472389.99999999994 в double — раньше превращалось в 472389 копеек
    await postWebhook(ctx.app, apiOrder({ amount: 5249, discountPercent: 10, amountPaid: 4723.9 }));
    await postWebhook(ctx.app, apiOrder({ amount: 1, discountPercent: 90, amountPaid: 0.1 }));
    await postWebhook(ctx.app, apiOrder({ amount: 1, discountPercent: 80, amountPaid: 0.2 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 5251, gross: 5251, discount: 526.8, net: 4724.2 }]);
  });

  it("в отдельный день с нулями — все поля", async () => {
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-01", "2026-02-01");
    expect(res.json()).toEqual([noDiscount("2026-02-01", 0)]);
  });
});

describe("GET /customers/:id/daily-totals: переход на летнее/зимнее время", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Europe/Berlin: 29.03.2026 01:00Z — переход CET (+1) → CEST (+2), 25.10.2026 01:00Z — обратно.
  const berlinOrders = () => [
    apiOrder({ customerId: "c_7", amount: 100, createdAt: "2026-03-28T22:30:00Z" }), // 28.03 23:30 CET
    apiOrder({ customerId: "c_7", amount: 200, createdAt: "2026-03-29T22:30:00Z" }), // 30.03 00:30 CEST
    apiOrder({ customerId: "c_7", amount: 400, createdAt: "2026-03-29T21:30:00Z" }), // 29.03 23:30 CEST
    apiOrder({ customerId: "c_7", amount: 800, createdAt: "2026-10-24T22:30:00Z" }), // 25.10 00:30 CEST
    apiOrder({ customerId: "c_7", amount: 1600, createdAt: "2026-10-25T22:30:00Z" }), // 25.10 23:30 CET
  ];

  const expected = [
    noDiscount("2026-03-28", 100),
    noDiscount("2026-03-29", 400),
    noDiscount("2026-03-30", 200),
  ];

  it("день заказа считается по смещению на момент заказа, а не на момент запроса", async () => {
    ctx.api.customers.set("c_7", "Europe/Berlin");
    for (const o of berlinOrders()) await postWebhook(ctx.app, o);

    // Результат не должен зависеть от того, зимой или летом сделан запрос
    for (const now of ["2026-01-15T12:00:00Z", "2026-07-15T12:00:00Z", "2026-11-06T12:00:00Z"]) {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(now) });
      expect((await dailyTotals(ctx.app, "c_7", "2026-03-28", "2026-03-30")).json(), now).toEqual(expected);
      expect((await dailyTotals(ctx.app, "c_7", "2026-10-24", "2026-10-26")).json(), now).toEqual([
        noDiscount("2026-10-24", 0),
        noDiscount("2026-10-25", 2400),
        noDiscount("2026-10-26", 0),
      ]);
      vi.useRealTimers();
    }
  });

  it("America/New_York: переход 08.03.2026", async () => {
    ctx.api.customers.set("c_15", "America/New_York");
    // 07.03 04:30Z = 06.03 23:30 EST (-5); 09.03 04:30Z = 09.03 00:30 EDT (-4)
    await postWebhook(ctx.app, apiOrder({ customerId: "c_15", amount: 10, createdAt: "2026-03-07T04:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ customerId: "c_15", amount: 20, createdAt: "2026-03-09T04:30:00Z" }));
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-15T12:00:00Z") });
    const res = await dailyTotals(ctx.app, "c_15", "2026-03-06", "2026-03-09");
    expect(res.json()).toEqual([
      noDiscount("2026-03-06", 10),
      noDiscount("2026-03-07", 0),
      noDiscount("2026-03-08", 0),
      noDiscount("2026-03-09", 20),
    ]);
  });
});
