package eco

import (
	"context"
	"math"
	"math/rand"

	"github.com/jackc/pgx/v5"
)

const (
	maxVisiblePrizes        = int64(12)
	ecoLuckyPrizeMultiplier = float64(5)
)

var ecoPrizeRollFloat = rand.Float64

func (service *Service) advanceStateForUpdate(ctx context.Context, tx pgx.Tx, snapshot StateSnapshot, nowMs int64, allowOnlinePrizes bool) (StateSnapshot, TickResult, error) {
	expiredLimited, err := service.pruneExpiredVisiblePrizes(ctx, tx, &snapshot, nowMs)
	if err != nil {
		return StateSnapshot{}, TickResult{}, err
	}

	var next StateSnapshot
	var tick TickResult
	wanted := defaultPrizeCountMap()
	if allowOnlinePrizes {
		stock, err := loadGlobalPrizeStock(ctx, tx)
		if err != nil {
			return StateSnapshot{}, TickResult{}, err
		}
		rates, err := loadPrizeRateSettingsTx(ctx, tx)
		if err != nil {
			return StateSnapshot{}, TickResult{}, err
		}
		visibleSlots := int64(len(snapshot.VisiblePrizes))
		rollPrize := func() (string, bool) {
			if visibleSlots >= maxVisiblePrizes {
				return "", false
			}
			boosted := snapshot.LuckyGenerationsRemaining > 0
			if boosted {
				snapshot.LuckyGenerationsRemaining = maxInt64(0, snapshot.LuckyGenerationsRemaining-1)
			}
			multiplier := float64(1)
			if boosted {
				multiplier = ecoLuckyPrizeMultiplier
			}
			prizeKey, ok := rollEcoGeneratedPrize(multiplier, rates)
			if !ok {
				return "", false
			}
			if stock[prizeKey] >= ecoPrizeDefinitions[prizeKey].GlobalLimit {
				return "", false
			}
			stock[prizeKey]++
			visibleSlots++
			return prizeKey, true
		}

		next, tick = AdvanceStateWithPrizeRoll(snapshot, nowMs, rollPrize)
		next.LuckyGenerationsRemaining = snapshot.LuckyGenerationsRemaining
		for _, prizeKey := range tick.PrizeKeys {
			wanted[prizeKey]++
		}
	} else {
		next, tick = AdvanceState(snapshot, nowMs)
	}

	// 过期归还与新生成预留在同一循环内按 PrizeKeys 固定顺序结算，
	// 每次只锁单个奖品行：既避免全表 FOR UPDATE 串行化所有请求，
	// 也避免两个事务以不同顺序锁多行导致死锁。
	grantedKeys := make([]string, 0, len(tick.PrizeKeys))
	for _, prizeKey := range PrizeKeys {
		granted, err := settleGlobalPrizeStock(ctx, tx, prizeKey, expiredLimited[prizeKey], wanted[prizeKey])
		if err != nil {
			return StateSnapshot{}, TickResult{}, err
		}
		for index := int64(0); index < granted; index++ {
			grantedKeys = append(grantedKeys, prizeKey)
		}
	}
	for _, prizeKey := range grantedKeys {
		prizeID := randomID()
		if err := insertVisiblePrize(ctx, tx, next.UserID, prizeID, prizeKey, nowMs, true); err != nil {
			return StateSnapshot{}, TickResult{}, err
		}
		next.VisiblePrizes = append(next.VisiblePrizes, VisiblePrize{
			ID:          prizeID,
			PrizeKey:    prizeKey,
			CreatedAtMs: nowMs,
			Limited:     true,
		})
	}
	tick.PrizeKeys = grantedKeys
	return next, tick, nil
}

func (service *Service) pruneExpiredVisiblePrizes(ctx context.Context, tx pgx.Tx, snapshot *StateSnapshot, nowMs int64) (map[string]int64, error) {
	active := make([]VisiblePrize, 0, len(snapshot.VisiblePrizes))
	expiredIDs := []string{}
	expiredLimited := defaultPrizeCountMap()
	for _, prize := range snapshot.VisiblePrizes {
		alive := prize.CreatedAtMs > 0 && prize.CreatedAtMs <= nowMs && nowMs-prize.CreatedAtMs <= ecoPrizeTTLMS
		if alive {
			active = append(active, prize)
			continue
		}
		expiredIDs = append(expiredIDs, prize.ID)
		if prize.Limited && isPrizeKey(prize.PrizeKey) {
			expiredLimited[prize.PrizeKey]++
		}
	}
	if len(expiredIDs) > 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM eco_visible_prizes WHERE user_id = $1 AND id = ANY($2)`, snapshot.UserID, expiredIDs); err != nil {
			return nil, err
		}
	}
	snapshot.VisiblePrizes = active
	return expiredLimited, nil
}

func rollEcoGeneratedPrize(multiplier float64, rates map[string]float64) (string, bool) {
	if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) || multiplier < 0 {
		multiplier = 1
	}
	if rates == nil {
		rates = defaultPrizeRates()
	}
	roll := ecoPrizeRollFloat()
	cursor := float64(0)
	for _, prizeKey := range PrizeKeys {
		cursor += math.Min(1, rates[prizeKey]*multiplier)
		if roll < cursor {
			return prizeKey, true
		}
	}
	return "", false
}

func loadGlobalPrizeStock(ctx context.Context, tx pgx.Tx) (map[string]int64, error) {
	stock := defaultPrizeCountMap()
	rows, err := tx.Query(ctx, `SELECT prize_key, claimed_count FROM eco_global_prize_stock`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var prizeKey string
		var count int64
		if err := rows.Scan(&prizeKey, &count); err != nil {
			return nil, err
		}
		if isPrizeKey(prizeKey) {
			stock[prizeKey] = maxInt64(0, count)
		}
	}
	return stock, rows.Err()
}

// settleGlobalPrizeStock 在单个奖品行的行锁内先归还 refund 个过期配额，
// 再最多预留 wanted 个新配额，返回实际预留数。行不存在时先补插，
// 使无锁读取的快照过期时也不会突破 GlobalLimit。
func settleGlobalPrizeStock(ctx context.Context, tx pgx.Tx, prizeKey string, refund int64, wanted int64) (int64, error) {
	if refund <= 0 && wanted <= 0 {
		return 0, nil
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (prize_key) DO NOTHING`,
		prizeKey,
	); err != nil {
		return 0, err
	}
	var claimed int64
	if err := tx.QueryRow(ctx,
		`SELECT claimed_count FROM eco_global_prize_stock WHERE prize_key = $1 FOR UPDATE`,
		prizeKey,
	).Scan(&claimed); err != nil {
		return 0, err
	}
	next := maxInt64(0, claimed-refund)
	granted := minInt64(wanted, maxInt64(0, ecoPrizeDefinitions[prizeKey].GlobalLimit-next))
	granted = maxInt64(0, granted)
	next += granted
	if next != claimed {
		if _, err := tx.Exec(ctx,
			`UPDATE eco_global_prize_stock SET claimed_count = $2, updated_at = now() WHERE prize_key = $1`,
			prizeKey, next,
		); err != nil {
			return 0, err
		}
	}
	return granted, nil
}

func insertVisiblePrize(ctx context.Context, tx pgx.Tx, userID int64, prizeID string, prizeKey string, createdAtMs int64, limited bool) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_visible_prizes (id, user_id, prize_key, created_at_ms, limited)
		 VALUES ($1, $2, $3, $4, $5)`,
		prizeID,
		userID,
		prizeKey,
		createdAtMs,
		limited,
	)
	return err
}
