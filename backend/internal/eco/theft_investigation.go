package eco

import (
	"context"
	"errors"
	"math/rand"

	"redemption/backend/internal/achievement"

	"github.com/jackc/pgx/v5"
)

const (
	thiefForcedAchievementMS = int64(10 * 60 * 60 * 1000)
	theftBaseCatchRate       = 0.22
	theftHourlyCatchRateStep = 0.02
	theftRepeatCatchPenalty  = 0.05
)

var ecoTheftInvestigationRollFloat = rand.Float64

type TheftInvestigationResult struct {
	Checked     int64
	Caught      int64
	Escaped     int64
	Rescheduled int64
	Skipped     int64
}

type dueTheftRecord struct {
	ID                       string
	PrizeKey                 string
	OriginalUserID           int64
	ThiefUserID              int64
	PublicEntryID            string
	OriginalLotID            string
	ThiefLotID               string
	StolenAtMs               int64
	NextCheckAtMs            int64
	BlackMarketAvailableAtMs int64
	Message                  string
}

type stolenTheftLot struct {
	ID       string
	PrizeKey string
	Limited  bool
}

func (service *Service) ProcessTheftInvestigations(ctx context.Context, limit int64, nowMs int64) (TheftInvestigationResult, error) {
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	if nowMs <= 0 {
		nowMs = nowMillis()
	}

	result := TheftInvestigationResult{}
	for result.Checked < limit {
		outcome, err := service.processOneTheftInvestigation(ctx, nowMs)
		if err != nil {
			return result, err
		}
		if outcome == "" {
			break
		}
		result.Checked++
		switch outcome {
		case "caught":
			result.Caught++
		case "escaped":
			result.Escaped++
		case "rescheduled":
			result.Rescheduled++
		default:
			result.Skipped++
		}
	}
	return result, nil
}

func (service *Service) processOneTheftInvestigation(ctx context.Context, nowMs int64) (string, error) {
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	record, ok, err := findDueTheftRecordForUpdate(ctx, tx, nowMs)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", tx.Commit(ctx)
	}

	if nowMs >= record.BlackMarketAvailableAtMs {
		if err := markTheftEscapedAndDeletePublicPrize(ctx, tx, record.ID, nowMs); err != nil {
			return "", err
		}
		return "escaped", tx.Commit(ctx)
	}

	caughtProbability, err := theftCaughtProbability(ctx, tx, record, nowMs)
	if err != nil {
		return "", err
	}
	if ecoTheftInvestigationRollFloat() >= caughtProbability {
		if err := rescheduleTheftInvestigation(ctx, tx, record.ID); err != nil {
			return "", err
		}
		return "rescheduled", tx.Commit(ctx)
	}

	outcome, err := service.resolveCaughtTheft(ctx, tx, record, nowMs)
	if err != nil {
		return "", err
	}
	return outcome, tx.Commit(ctx)
}

func theftCaughtProbability(ctx context.Context, tx pgx.Tx, record dueTheftRecord, nowMs int64) (float64, error) {
	var previousThefts int64
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(*)
		   FROM eco_thefts
		  WHERE public_entry_id = $1
		    AND id <> $2`,
		record.PublicEntryID,
		record.ID,
	).Scan(&previousThefts); err != nil {
		return 0, err
	}

	hours := (nowMs - record.StolenAtMs) / int64(60*60*1000)
	probability := theftBaseCatchRate -
		float64(maxInt64(0, previousThefts))*theftRepeatCatchPenalty +
		float64(maxInt64(0, hours))*theftHourlyCatchRateStep
	if probability < 0 {
		return 0, nil
	}
	if probability > 1 {
		return 1, nil
	}
	return probability, nil
}

func findDueTheftRecordForUpdate(ctx context.Context, tx pgx.Tx, nowMs int64) (dueTheftRecord, bool, error) {
	var record dueTheftRecord
	err := tx.QueryRow(ctx,
		`SELECT id, prize_key, original_user_id, thief_user_id, public_entry_id,
		        original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		        black_market_available_at_ms, message
		   FROM eco_thefts
		  WHERE resolved_at_ms IS NULL
		    AND next_check_at_ms <= $1
		  ORDER BY next_check_at_ms, stolen_at_ms, id
		  LIMIT 1
		  FOR UPDATE SKIP LOCKED`,
		nowMs,
	).Scan(
		&record.ID,
		&record.PrizeKey,
		&record.OriginalUserID,
		&record.ThiefUserID,
		&record.PublicEntryID,
		&record.OriginalLotID,
		&record.ThiefLotID,
		&record.StolenAtMs,
		&record.NextCheckAtMs,
		&record.BlackMarketAvailableAtMs,
		&record.Message,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return dueTheftRecord{}, false, nil
	}
	if err != nil {
		return dueTheftRecord{}, false, err
	}
	return record, true, nil
}

func (service *Service) resolveCaughtTheft(ctx context.Context, tx pgx.Tx, record dueTheftRecord, nowMs int64) (string, error) {
	if err := lockEcoUsers(ctx, tx, record.OriginalUserID, record.ThiefUserID); err != nil {
		return "", err
	}
	if err := ensurePlaceholderUser(ctx, tx, record.OriginalUserID); err != nil {
		return "", err
	}
	if err := ensurePlaceholderUser(ctx, tx, record.ThiefUserID); err != nil {
		return "", err
	}
	if err := ensurePointAccount(ctx, tx, record.OriginalUserID); err != nil {
		return "", err
	}
	if err := ensurePointAccount(ctx, tx, record.ThiefUserID); err != nil {
		return "", err
	}
	if err := ensureEcoState(ctx, tx, record.OriginalUserID, nowMs); err != nil {
		return "", err
	}
	if err := ensureEcoState(ctx, tx, record.ThiefUserID, nowMs); err != nil {
		return "", err
	}

	lot, ok, err := findStolenTheftLotForUpdate(ctx, tx, record.ThiefUserID, record.ThiefLotID)
	if err != nil {
		return "", err
	}
	if !ok || lot.PrizeKey != record.PrizeKey {
		if err := rescheduleTheftInvestigation(ctx, tx, record.ID); err != nil {
			return "", err
		}
		return "rescheduled", nil
	}

	limitedDelta := int64(0)
	if lot.Limited {
		limitedDelta = 1
	}
	merchantAvailableAt := maxInt64(nowMs, nextChinaSixMs(record.StolenAtMs))
	restoredLotID := randomID()

	if err := deletePrizeLots(ctx, tx, []sellablePrizeLot{{ID: lot.ID}}); err != nil {
		return "", err
	}
	if err := decrementPrizeInventory(ctx, tx, record.ThiefUserID, record.PrizeKey, 1, limitedDelta); err != nil {
		return "", err
	}
	if err := upsertRestoredPrizeInventory(ctx, tx, record.OriginalUserID, record.PrizeKey, limitedDelta); err != nil {
		return "", err
	}
	if err := insertRestoredPrizeLot(ctx, tx, restoredLotID, record.OriginalUserID, record.PrizeKey, record.PublicEntryID, nowMs, record.StolenAtMs, merchantAvailableAt, lot.Limited); err != nil {
		return "", err
	}
	if err := restorePublicPrizeAfterCaught(ctx, tx, record.PublicEntryID, restoredLotID, merchantAvailableAt); err != nil {
		return "", err
	}
	if err := markTheftCaught(ctx, tx, record.ID, nowMs); err != nil {
		return "", err
	}
	if err := service.applyCaughtTheftPenalty(ctx, tx, record, nowMs); err != nil {
		return "", err
	}

	forceUntil := nowMs + thiefForcedAchievementMS
	if err := achievement.GrantAndForceEquip(ctx, tx, record.ThiefUserID, achievement.IDThief, nowMs, forceUntil, "环保行动偷盗被警察抓住"); err != nil {
		return "", err
	}
	return "caught", nil
}

func findStolenTheftLotForUpdate(ctx context.Context, tx pgx.Tx, userID int64, lotID string) (stolenTheftLot, bool, error) {
	var lot stolenTheftLot
	err := tx.QueryRow(ctx,
		`SELECT id, prize_key, limited
		   FROM eco_prize_lots
		  WHERE id = $1
		    AND user_id = $2
		    AND source = 'stolen'
		  FOR UPDATE SKIP LOCKED`,
		lotID,
		userID,
	).Scan(&lot.ID, &lot.PrizeKey, &lot.Limited)
	if errors.Is(err, pgx.ErrNoRows) {
		return stolenTheftLot{}, false, nil
	}
	if err != nil {
		return stolenTheftLot{}, false, err
	}
	return lot, true, nil
}

func rescheduleTheftInvestigation(ctx context.Context, tx pgx.Tx, theftID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE eco_thefts
		    SET next_check_at_ms = LEAST(black_market_available_at_ms, next_check_at_ms + $2),
		        updated_at = now()
		  WHERE id = $1
		    AND resolved_at_ms IS NULL`,
		theftID,
		theftCheckIntervalMS,
	)
	return err
}

func upsertRestoredPrizeInventory(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string, limitedDelta int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_prize_inventory (
		   user_id, prize_key, inventory_count, limited_count, lifetime_claim_count, updated_at
		 ) VALUES (
		   $1, $2, 1, $3, 0, now()
		 )
		 ON CONFLICT (user_id, prize_key) DO UPDATE SET
		   inventory_count = eco_prize_inventory.inventory_count + 1,
		   limited_count = eco_prize_inventory.limited_count + excluded.limited_count,
		   updated_at = now()`,
		userID,
		prizeKey,
		limitedDelta,
	)
	return err
}

func insertRestoredPrizeLot(ctx context.Context, tx pgx.Tx, lotID string, userID int64, prizeKey string, publicEntryID string, acquiredAtMs int64, publiclyListedAtMs int64, merchantAvailableAtMs int64, limited bool) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		   public_entry_id, publicly_listed_at_ms, merchant_available_at_ms
		 ) VALUES (
		   $1, $2, $3, $4, $6, $7, 'restored', $5, $8, $6
		 )`,
		lotID,
		userID,
		prizeKey,
		acquiredAtMs,
		publicEntryID,
		merchantAvailableAtMs,
		limited,
		publiclyListedAtMs,
	)
	return err
}

func restorePublicPrizeAfterCaught(ctx context.Context, tx pgx.Tx, publicEntryID string, ownerLotID string, merchantAvailableAtMs int64) error {
	_, err := tx.Exec(ctx,
		`UPDATE eco_public_prizes
		    SET owner_lot_id = $2,
		        merchant_available_at_ms = $3,
		        status = 'listed',
		        thief_user_id = NULL,
		        thief_name = NULL,
		        theft_message = NULL,
		        stolen_at_ms = NULL,
		        updated_at = now()
		  WHERE id = $1`,
		publicEntryID,
		ownerLotID,
		merchantAvailableAtMs,
	)
	return err
}

func markTheftCaught(ctx context.Context, tx pgx.Tx, theftID string, nowMs int64) error {
	_, err := tx.Exec(ctx,
		`UPDATE eco_thefts
		    SET resolved_at_ms = $2,
		        outcome = 'caught',
		        updated_at = now()
		  WHERE id = $1
		    AND resolved_at_ms IS NULL`,
		theftID,
		nowMs,
	)
	return err
}

func (service *Service) applyCaughtTheftPenalty(ctx context.Context, tx pgx.Tx, record dueTheftRecord, nowMs int64) error {
	stats, err := loadPrizeClaimStatsTx(ctx, tx, previousDateKey(chinaDateKey(nowMs)))
	if err != nil {
		return err
	}
	marketPrice := ecoPrizePrice(record.PrizeKey, chinaDateKey(nowMs), stats)
	penaltyTarget := marketPrice / 10
	if penaltyTarget <= 0 {
		return nil
	}

	thiefBalance, err := getBalanceForUpdate(ctx, tx, record.ThiefUserID)
	if err != nil {
		return err
	}
	penalty := minInt64(thiefBalance, penaltyTarget)
	if penalty <= 0 {
		return nil
	}
	thiefNextBalance := thiefBalance - penalty
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		thiefNextBalance,
		record.ThiefUserID,
	); err != nil {
		return err
	}
	if err := insertPointLog(ctx, tx, record.ThiefUserID, -penalty, SourceGamePlay, "环保行动偷盗处罚·"+ecoPrizeDefinitions[record.PrizeKey].Name, thiefNextBalance); err != nil {
		return err
	}

	compensation := penalty / 2
	if compensation <= 0 {
		return nil
	}
	ownerBalance, err := getBalanceForUpdate(ctx, tx, record.OriginalUserID)
	if err != nil {
		return err
	}
	ownerNextBalance := ownerBalance + compensation
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		ownerNextBalance,
		record.OriginalUserID,
	); err != nil {
		return err
	}
	return insertPointLog(ctx, tx, record.OriginalUserID, compensation, SourceGamePlay, "环保行动偷盗赔偿·"+ecoPrizeDefinitions[record.PrizeKey].Name, ownerNextBalance)
}

func loadPrizeClaimStatsTx(ctx context.Context, tx pgx.Tx, dateKey string) (prizeClaimStats, error) {
	stats := prizeClaimStats{}
	rows, err := tx.Query(ctx,
		`SELECT prize_key, claim_count FROM eco_prize_claim_stats WHERE stat_date = $1::date`,
		dateKey,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var count int64
		if err := rows.Scan(&key, &count); err != nil {
			return nil, err
		}
		stats[key] = maxInt64(0, count)
	}
	if stats["total"] <= 0 {
		total := int64(0)
		for _, key := range PrizeKeys {
			total += stats[key]
		}
		stats["total"] = total
	}
	return stats, rows.Err()
}
