/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Процент скидки из внешнего API: число или строка с числом ("7"), от 0 до 100. */
export function parsePercent(raw: unknown): number {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`invalid discountPercent: ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем.
 *
 * `rub * 100` в двоичной арифметике неточно: 4723.9 * 100 = 472389.99999999994,
 * и голый Math.floor терял бы копейку. Поэтому сначала округляем до 15 значащих цифр
 * (точность double), отбрасывая только погрешность представления, а потом — доли копейки.
 */
export function toKop(rub: number): number {
  return Math.floor(Number((rub * 100).toPrecision(15)));
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
