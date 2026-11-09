import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });

  it("сохраняет скидку; строковый discountPercent тоже принимается", async () => {
    const o = apiOrder({ amount: 2609, discountPercent: "7", amountPaid: 2426.37 });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "created" });
    const { rows } = await ctx.db.query(`SELECT discount_percent, amount_paid_kop FROM orders WHERE id = $1`, [o.id]);
    expect(Number(rows[0].discount_percent)).toBe(7);
    expect(Number(rows[0].amount_paid_kop)).toBe(242637);
  });

  it("новая версия со сменой скидки обновляет скидку", async () => {
    const o = apiOrder({ amount: 1000, discountPercent: 0, amountPaid: 1000 });
    await postWebhook(ctx.app, o);
    await postWebhook(ctx.app, { ...o, discountPercent: 33, amountPaid: 670, updatedAt: "2026-02-10T13:00:00Z" });
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [o.id]);
    expect(Number(rows[0].amount_paid_kop)).toBe(67000);
  });

  it("некорректная скидка — 400", async () => {
    expect((await postWebhook(ctx.app, apiOrder({ discountPercent: 150 }))).statusCode).toBe(400);
    expect((await postWebhook(ctx.app, apiOrder({ discountPercent: "abc" }))).statusCode).toBe(400);
    expect((await postWebhook(ctx.app, apiOrder({ amount: 100, amountPaid: 101 }))).statusCode).toBe(400);
    expect((await postWebhook(ctx.app, apiOrder({ amountPaid: "" }))).statusCode).toBe(400);
  });

  it("параллельные вебхуки одного заказа не откатывают его на устаревшую версию", async () => {
    const o = apiOrder({ status: "pending" });
    const versions = Array.from({ length: 30 }, (_, i) => ({
      ...o,
      status: i === 29 ? "refunded" : "paid",
      updatedAt: new Date(Date.parse("2026-02-10T12:00:00Z") + i * 60_000).toISOString(),
    }));
    // Самую свежую версию отправляем первой, остальные — одновременно с ней
    const results = await Promise.all([versions[29], ...versions.slice(0, 29).reverse()].map((v) => postWebhook(ctx.app, v)));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const { rows } = await ctx.db.query(`SELECT status, updated_at FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
    expect(rows[0].updated_at.toISOString()).toBe(versions[29].updatedAt);
  });
});
