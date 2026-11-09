import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository, UpsertResult } from "../repositories/orders.js";
import { parsePercent, parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

const Num = z.union([z.number(), z.string()]);

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: Num,
  // Появились в API недавно: у старых заказов их нет
  discountPercent: Num.nullish(),
  amountPaid: Num.nullish(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = UpsertResult;

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      const discountPercent = o.discountPercent == null ? null : parsePercent(o.discountPercent);
      // Источник истины для net — amountPaid («сколько фактически заплатили»).
      // Если пришёл только процент — считаем оплату из него, с округлением до копейки.
      let amountPaidKop: number | null = null;
      if (o.amountPaid != null) amountPaidKop = toKop(parseRub(o.amountPaid));
      else if (discountPercent !== null) amountPaidKop = Math.round((amountKop * (100 - discountPercent)) / 100);
      if (amountPaidKop !== null && amountPaidKop > amountKop) {
        throw new Error(`amountPaid ${o.amountPaid} is greater than amount ${o.amount}`);
      }
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        discountPercent,
        amountPaidKop,
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами, не по порядку и параллельно, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt); проверка атомарна — в самом upsert.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    return this.orders.upsertIfNewer(this.normalize(raw));
  }
}
