-- Скидки из внешнего API (discountPercent, amountPaid).
-- NULL — внешний API эти поля для версии заказа не прислал (заказы до появления скидок
-- или строки, сохранённые до этой миграции): считаем, что оплачено amount_kop без скидки.
-- Строки, сохранённые до миграции, дозаполняются ближайшим POST /sync (см. OrdersRepository.upsertIfNewer).
ALTER TABLE orders
  ADD COLUMN discount_percent NUMERIC(5, 2) CHECK (discount_percent BETWEEN 0 AND 100),
  ADD COLUMN amount_paid_kop  BIGINT        CHECK (amount_paid_kop >= 0);
