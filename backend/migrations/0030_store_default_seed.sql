-- +goose Up
-- 商城默认分类/商品种子。原先由 ensureDefaultStore 在每次请求时 INSERT ON CONFLICT DO NOTHING，
-- 导致管理员删除默认商品后被静默种回；改为仅在此迁移中一次性种入。
INSERT INTO store_categories (id, name, color, sort_order, enabled, created_at, updated_at)
VALUES
  ('lottery', '抽奖次数', '#06b6d4', 1, true, now(), now()),
  ('card', '卡牌抽卡', '#3b82f6', 2, true, now(), now()),
  ('makeup', '补签道具', '#22c55e', 3, true, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO store_items
  (id, name, description, type, category_id, points_cost, value, daily_limit, sort_order, enabled, created_at, updated_at)
VALUES
  ('lottery-spin-1', '抽奖机会 x1', '兑换一次抽奖机会', 'lottery_spin', 'lottery', 13000, 1, 1, 1, true, now(), now()),
  ('lottery-spin-2', '抽奖机会 x2', '兑换两次抽奖机会', 'lottery_spin', 'lottery', 24000, 2, 1, 2, true, now(), now()),
  ('card-draw-1', '动物卡抽卡次数 x1', '兑换一次动物卡抽卡机会', 'card_draw', 'card', 900, 1, NULL, 5, true, now(), now()),
  ('makeup-card-1', '补签卡 x1', '用于补回本周漏签的日子，补签后视同已签到。', 'makeup_card', 'makeup', 30, 1, NULL, 8, true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- +goose Down
DELETE FROM store_items WHERE id IN ('lottery-spin-1', 'lottery-spin-2', 'card-draw-1', 'makeup-card-1');
DELETE FROM store_categories WHERE id IN ('lottery', 'card', 'makeup');
