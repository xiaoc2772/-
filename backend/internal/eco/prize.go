package eco

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	theftCheckIntervalMS      = int64(20 * 60 * 1000)
	theftBlackMarketDelayMS   = int64(24 * 60 * 60 * 1000)
	theftProtectionMS         = int64(10 * 60 * 60 * 1000)
	ecoUserAdvisoryLockOffset = int64(7_000_000_000_000)
)

type ClaimPrizeInput struct {
	UserID     int64
	PrizeID    string
	MakePublic bool
	NowMs      int64
}

type ClaimPrizeResult struct {
	Success  bool
	Message  string
	PrizeKey string
	LotID    string
}

type SellPrizeInput struct {
	UserID   int64
	Key      string
	Quantity int64
	NowMs    int64
}

type SellPrizeResult struct {
	Success      bool
	Message      string
	PrizeKey     string
	QuantitySold int64
	Price        int64
	PointsEarned int64
	Balance      int64
}

type SellPrizeToMerchantInput struct {
	UserID int64
	Key    string
	NowMs  int64
}

type SellStolenPrizeInput struct {
	UserID int64
	Key    string
	NowMs  int64
}

type StealPublicPrizeInput struct {
	UserID  int64
	EntryID string
	Message string
	NowMs   int64
}

type StealPublicPrizeResult struct {
	Success bool
	Message string
}

func (service *Service) ClaimPrize(ctx context.Context, input ClaimPrizeInput) (ClaimPrizeResult, error) {
	if input.UserID <= 0 {
		return ClaimPrizeResult{}, errors.New("userID must be positive")
	}
	input.PrizeID = strings.TrimSpace(input.PrizeID)
	if input.PrizeID == "" {
		return ClaimPrizeResult{Success: false, Message: "参数错误"}, nil
	}
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ClaimPrizeResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensurePlaceholderUser(ctx, tx, input.UserID); err != nil {
		return ClaimPrizeResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, input.UserID); err != nil {
		return ClaimPrizeResult{}, err
	}
	if err := ensureEcoState(ctx, tx, input.UserID, input.NowMs); err != nil {
		return ClaimPrizeResult{}, err
	}

	snapshot, err := service.loadCollectStateForUpdate(ctx, tx, input.UserID, input.NowMs)
	if err != nil {
		return ClaimPrizeResult{}, err
	}
	next, tick, err := service.advanceStateForUpdate(ctx, tx, snapshot, input.NowMs, true)
	if err != nil {
		return ClaimPrizeResult{}, err
	}
	if _, err := service.creditTrash(ctx, tx, &next, tick.AutoCollected, input.NowMs, "自动回收"); err != nil {
		return ClaimPrizeResult{}, err
	}

	visible, ok := findVisiblePrize(next.VisiblePrizes, input.PrizeID)
	if !ok {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return ClaimPrizeResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return ClaimPrizeResult{}, err
		}
		return ClaimPrizeResult{Success: false, Message: "奖品已不存在"}, tx.Commit(ctx)
	}

	lotID := randomID()
	availableAt := nextChinaSixMs(input.NowMs)
	if err := deleteVisiblePrize(ctx, tx, input.UserID, input.PrizeID); err != nil {
		return ClaimPrizeResult{}, err
	}
	if err := upsertPrizeInventory(ctx, tx, input.UserID, visible.PrizeKey, visible.Limited); err != nil {
		return ClaimPrizeResult{}, err
	}
	if err := insertPrizeLot(ctx, tx, input.UserID, lotID, visible, input.NowMs, availableAt); err != nil {
		return ClaimPrizeResult{}, err
	}
	if input.MakePublic {
		entryID := randomID()
		ownerName, err := getEcoOwnerName(ctx, tx, input.UserID)
		if err != nil {
			return ClaimPrizeResult{}, err
		}
		if err := markPrizeLotPublic(ctx, tx, lotID, entryID, input.NowMs, availableAt); err != nil {
			return ClaimPrizeResult{}, err
		}
		if err := insertPublicPrize(ctx, tx, entryID, visible.PrizeKey, input.UserID, ownerName, lotID, input.NowMs, availableAt); err != nil {
			return ClaimPrizeResult{}, err
		}
	}
	if err := incrementPrizeClaimStats(ctx, tx, visible.PrizeKey, chinaDateKey(input.NowMs)); err != nil {
		return ClaimPrizeResult{}, err
	}

	next.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, next); err != nil {
		return ClaimPrizeResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ClaimPrizeResult{}, err
	}
	return ClaimPrizeResult{Success: true, PrizeKey: visible.PrizeKey, LotID: lotID}, nil
}

func (service *Service) StealPublicPrize(ctx context.Context, input StealPublicPrizeInput) (StealPublicPrizeResult, error) {
	if input.UserID <= 0 {
		return StealPublicPrizeResult{}, errors.New("userID must be positive")
	}
	input.EntryID = strings.TrimSpace(input.EntryID)
	input.Message = truncateRunes(strings.TrimSpace(input.Message), 40)
	if input.EntryID == "" || input.Message == "" {
		return StealPublicPrizeResult{Success: false, Message: "请输入偷盗留言"}, nil
	}
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	target, ok, err := findPublicPrizeForSteal(ctx, tx, input.EntryID, input.NowMs)
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	if !ok {
		return StealPublicPrizeResult{Success: false, Message: "这个奖品已经不能偷了"}, nil
	}
	if target.OwnerUserID == input.UserID {
		return StealPublicPrizeResult{Success: false, Message: "不能偷自己的奖品"}, nil
	}
	if err := lockEcoUsers(ctx, tx, target.OwnerUserID, input.UserID); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := ensurePlaceholderUser(ctx, tx, target.OwnerUserID); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := ensurePlaceholderUser(ctx, tx, input.UserID); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, target.OwnerUserID); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, input.UserID); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := ensureEcoState(ctx, tx, target.OwnerUserID, input.NowMs); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := ensureEcoState(ctx, tx, input.UserID, input.NowMs); err != nil {
		return StealPublicPrizeResult{}, err
	}

	active, err := hasActiveTheftTx(ctx, tx, input.UserID)
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	if active {
		return StealPublicPrizeResult{Success: false, Message: "你还有正在被警察追查的奖品，逃脱或被抓后才能继续偷盗"}, nil
	}

	ownerSnapshot, err := service.loadCollectStateForUpdate(ctx, tx, target.OwnerUserID, input.NowMs)
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	thiefSnapshot, err := service.loadCollectStateForUpdate(ctx, tx, input.UserID, input.NowMs)
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	ownerNext, ownerTick, err := service.advanceStateForUpdate(ctx, tx, ownerSnapshot, input.NowMs, false)
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	if _, err := service.creditTrash(ctx, tx, &ownerNext, ownerTick.AutoCollected, input.NowMs, "自动回收"); err != nil {
		return StealPublicPrizeResult{}, err
	}
	thiefNext, thiefTick, err := service.advanceStateForUpdate(ctx, tx, thiefSnapshot, input.NowMs, false)
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	if _, err := service.creditTrash(ctx, tx, &thiefNext, thiefTick.AutoCollected, input.NowMs, "自动回收"); err != nil {
		return StealPublicPrizeResult{}, err
	}

	lot, ok, err := findOwnerPublicLotForUpdate(ctx, tx, target.OwnerUserID, target.OwnerLotID, input.EntryID)
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	if !ok {
		return StealPublicPrizeResult{Success: false, Message: "这个奖品已经不存在了"}, nil
	}
	if lot.PrizeKey != target.PrizeKey {
		return StealPublicPrizeResult{Success: false, Message: "这个奖品已经不能偷了"}, nil
	}

	thiefLotID := randomID()
	theftID := randomID()
	blackMarketAvailableAt := input.NowMs + theftBlackMarketDelayMS
	thiefName, err := getEcoOwnerName(ctx, tx, input.UserID)
	if err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := markPublicPrizeStolen(ctx, tx, input.EntryID, input.UserID, thiefName, input.Message, input.NowMs); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := insertTheftRecord(ctx, tx, theftID, lot.PrizeKey, target.OwnerUserID, input.UserID, input.EntryID, lot.ID, thiefLotID, input.NowMs, input.Message, blackMarketAvailableAt); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := deletePrizeLots(ctx, tx, []sellablePrizeLot{lot}); err != nil {
		return StealPublicPrizeResult{}, err
	}
	limitedDelta := int64(0)
	if lot.Limited {
		limitedDelta = 1
	}
	if err := decrementPrizeInventory(ctx, tx, target.OwnerUserID, lot.PrizeKey, 1, limitedDelta); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := upsertStolenPrizeInventory(ctx, tx, input.UserID, lot.PrizeKey, limitedDelta); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := insertStolenPrizeLot(ctx, tx, thiefLotID, input.UserID, lot.PrizeKey, target.OwnerUserID, theftID, input.NowMs, blackMarketAvailableAt, lot.Limited); err != nil {
		return StealPublicPrizeResult{}, err
	}

	ownerNext.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, ownerNext); err != nil {
		return StealPublicPrizeResult{}, err
	}
	thiefNext.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, thiefNext); err != nil {
		return StealPublicPrizeResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return StealPublicPrizeResult{}, err
	}
	return StealPublicPrizeResult{Success: true}, nil
}

func (service *Service) SellPrizeToMerchant(ctx context.Context, input SellPrizeToMerchantInput) (SellPrizeResult, error) {
	if input.UserID <= 0 {
		return SellPrizeResult{}, errors.New("userID must be positive")
	}
	if !isPrizeKey(input.Key) {
		return SellPrizeResult{Success: false, Message: "未知奖品", PrizeKey: input.Key}, nil
	}
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SellPrizeResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensurePlaceholderUser(ctx, tx, input.UserID); err != nil {
		return SellPrizeResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, input.UserID); err != nil {
		return SellPrizeResult{}, err
	}
	if err := ensureEcoState(ctx, tx, input.UserID, input.NowMs); err != nil {
		return SellPrizeResult{}, err
	}

	snapshot, err := service.loadCollectStateForUpdate(ctx, tx, input.UserID, input.NowMs)
	if err != nil {
		return SellPrizeResult{}, err
	}
	next, tick, err := service.advanceStateForUpdate(ctx, tx, snapshot, input.NowMs, true)
	if err != nil {
		return SellPrizeResult{}, err
	}
	if _, err := service.creditTrash(ctx, tx, &next, tick.AutoCollected, input.NowMs, "自动回收"); err != nil {
		return SellPrizeResult{}, err
	}

	lot, ok, err := findMerchantPrizeLotForUpdate(ctx, tx, input.UserID, input.Key, input.NowMs)
	if err != nil {
		return SellPrizeResult{}, err
	}
	if !ok {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return SellPrizeResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return SellPrizeResult{}, err
		}
		return SellPrizeResult{Success: false, Message: "商人还没有到，公开后的奖品需等到次日早上 6 点", PrizeKey: input.Key, Balance: balance}, tx.Commit(ctx)
	}

	inventory, err := getPrizeInventoryForUpdate(ctx, tx, input.UserID, input.Key)
	if err != nil {
		return SellPrizeResult{}, err
	}
	if inventory.InventoryCount <= 0 {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return SellPrizeResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return SellPrizeResult{}, err
		}
		return SellPrizeResult{Success: false, Message: "背包库存不足", PrizeKey: input.Key, Balance: balance}, tx.Commit(ctx)
	}

	dateKey := chinaDateKey(input.NowMs)
	stats, err := service.loadPrizeClaimStats(ctx, previousDateKey(dateKey))
	if err != nil {
		return SellPrizeResult{}, err
	}
	marketPrice := ecoPrizePrice(input.Key, dateKey, stats)
	total := int64(float64(marketPrice) * 1.2)

	balance, err := getBalanceForUpdate(ctx, tx, input.UserID)
	if err != nil {
		return SellPrizeResult{}, err
	}
	nextBalance := balance + total
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		input.UserID,
	); err != nil {
		return SellPrizeResult{}, err
	}
	if err := insertPointLog(ctx, tx, input.UserID, total, SourceGamePlay, "环保行动商人收购·"+ecoPrizeDefinitions[input.Key].Name, nextBalance); err != nil {
		return SellPrizeResult{}, err
	}

	if err := deletePrizeLots(ctx, tx, []sellablePrizeLot{lot}); err != nil {
		return SellPrizeResult{}, err
	}
	if err := deletePublicPrizeEntriesForLots(ctx, tx, []sellablePrizeLot{lot}); err != nil {
		return SellPrizeResult{}, err
	}
	limitedSold := int64(0)
	if lot.Limited {
		limitedSold = 1
	}
	if err := decrementPrizeInventory(ctx, tx, input.UserID, input.Key, 1, limitedSold); err != nil {
		return SellPrizeResult{}, err
	}
	if limitedSold > 0 {
		if err := decrementGlobalPrizeStock(ctx, tx, input.Key, limitedSold); err != nil {
			return SellPrizeResult{}, err
		}
	}

	next.PointsSnapshot = nextBalance
	next.LifetimePoints += total
	next.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, next); err != nil {
		return SellPrizeResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SellPrizeResult{}, err
	}

	return SellPrizeResult{
		Success:      true,
		PrizeKey:     input.Key,
		QuantitySold: 1,
		Price:        total,
		PointsEarned: total,
		Balance:      nextBalance,
	}, nil
}

func (service *Service) SellStolenPrize(ctx context.Context, input SellStolenPrizeInput) (SellPrizeResult, error) {
	if input.UserID <= 0 {
		return SellPrizeResult{}, errors.New("userID must be positive")
	}
	if !isPrizeKey(input.Key) {
		return SellPrizeResult{Success: false, Message: "未知奖品", PrizeKey: input.Key}, nil
	}
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SellPrizeResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensurePlaceholderUser(ctx, tx, input.UserID); err != nil {
		return SellPrizeResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, input.UserID); err != nil {
		return SellPrizeResult{}, err
	}
	if err := ensureEcoState(ctx, tx, input.UserID, input.NowMs); err != nil {
		return SellPrizeResult{}, err
	}

	snapshot, err := service.loadCollectStateForUpdate(ctx, tx, input.UserID, input.NowMs)
	if err != nil {
		return SellPrizeResult{}, err
	}
	next, tick, err := service.advanceStateForUpdate(ctx, tx, snapshot, input.NowMs, true)
	if err != nil {
		return SellPrizeResult{}, err
	}
	if _, err := service.creditTrash(ctx, tx, &next, tick.AutoCollected, input.NowMs, "自动回收"); err != nil {
		return SellPrizeResult{}, err
	}

	lot, ok, err := findBlackMarketPrizeLotForUpdate(ctx, tx, input.UserID, input.Key, input.NowMs)
	if err != nil {
		return SellPrizeResult{}, err
	}
	if !ok {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return SellPrizeResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return SellPrizeResult{}, err
		}
		return SellPrizeResult{Success: false, Message: "黑市还没有接货，偷来的奖品需要躲过 24 小时追查", PrizeKey: input.Key, Balance: balance}, tx.Commit(ctx)
	}

	inventory, err := getPrizeInventoryForUpdate(ctx, tx, input.UserID, input.Key)
	if err != nil {
		return SellPrizeResult{}, err
	}
	if inventory.InventoryCount <= 0 {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return SellPrizeResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return SellPrizeResult{}, err
		}
		return SellPrizeResult{Success: false, Message: "背包库存不足", PrizeKey: input.Key, Balance: balance}, tx.Commit(ctx)
	}

	total := ecoPrizeDefinitions[input.Key].MaxPrice
	balance, err := getBalanceForUpdate(ctx, tx, input.UserID)
	if err != nil {
		return SellPrizeResult{}, err
	}
	nextBalance := balance + total
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		input.UserID,
	); err != nil {
		return SellPrizeResult{}, err
	}
	if err := insertPointLog(ctx, tx, input.UserID, total, SourceGamePlay, "环保行动黑市出售·"+ecoPrizeDefinitions[input.Key].Name, nextBalance); err != nil {
		return SellPrizeResult{}, err
	}

	if err := deletePrizeLots(ctx, tx, []sellablePrizeLot{lot}); err != nil {
		return SellPrizeResult{}, err
	}
	limitedSold := int64(0)
	if lot.Limited {
		limitedSold = 1
	}
	if err := decrementPrizeInventory(ctx, tx, input.UserID, input.Key, 1, limitedSold); err != nil {
		return SellPrizeResult{}, err
	}
	if limitedSold > 0 {
		if err := decrementGlobalPrizeStock(ctx, tx, input.Key, limitedSold); err != nil {
			return SellPrizeResult{}, err
		}
	}
	if lot.TheftID != nil && *lot.TheftID != "" {
		if err := markTheftEscapedAndDeletePublicPrize(ctx, tx, *lot.TheftID, input.NowMs); err != nil {
			return SellPrizeResult{}, err
		}
	}

	next.PointsSnapshot = nextBalance
	next.LifetimePoints += total
	next.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, next); err != nil {
		return SellPrizeResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SellPrizeResult{}, err
	}

	return SellPrizeResult{
		Success:      true,
		PrizeKey:     input.Key,
		QuantitySold: 1,
		Price:        total,
		PointsEarned: total,
		Balance:      nextBalance,
	}, nil
}

func (service *Service) SellPrize(ctx context.Context, input SellPrizeInput) (SellPrizeResult, error) {
	if input.UserID <= 0 {
		return SellPrizeResult{}, errors.New("userID must be positive")
	}
	if !isPrizeKey(input.Key) {
		return SellPrizeResult{Success: false, Message: "未知奖品", PrizeKey: input.Key}, nil
	}
	if input.Quantity <= 0 {
		return SellPrizeResult{Success: false, Message: "出售数量无效", PrizeKey: input.Key}, nil
	}
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SellPrizeResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensurePlaceholderUser(ctx, tx, input.UserID); err != nil {
		return SellPrizeResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, input.UserID); err != nil {
		return SellPrizeResult{}, err
	}
	if err := ensureEcoState(ctx, tx, input.UserID, input.NowMs); err != nil {
		return SellPrizeResult{}, err
	}

	snapshot, err := service.loadCollectStateForUpdate(ctx, tx, input.UserID, input.NowMs)
	if err != nil {
		return SellPrizeResult{}, err
	}
	next, tick, err := service.advanceStateForUpdate(ctx, tx, snapshot, input.NowMs, true)
	if err != nil {
		return SellPrizeResult{}, err
	}
	if _, err := service.creditTrash(ctx, tx, &next, tick.AutoCollected, input.NowMs, "自动回收"); err != nil {
		return SellPrizeResult{}, err
	}

	inventory, err := getPrizeInventoryForUpdate(ctx, tx, input.UserID, input.Key)
	if err != nil {
		return SellPrizeResult{}, err
	}
	if inventory.InventoryCount < input.Quantity {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return SellPrizeResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return SellPrizeResult{}, err
		}
		return SellPrizeResult{Success: false, Message: "背包库存不足", PrizeKey: input.Key, Balance: balance}, tx.Commit(ctx)
	}

	eligibleLots, err := listSellablePrizeLotsForUpdate(ctx, tx, input.UserID, input.Key, input.NowMs)
	if err != nil {
		return SellPrizeResult{}, err
	}
	totalLots, err := countPrizeLots(ctx, tx, input.UserID, input.Key)
	if err != nil {
		return SellPrizeResult{}, err
	}
	legacySellable := maxInt64(0, inventory.InventoryCount-totalLots)
	if legacySellable+int64(len(eligibleLots)) < input.Quantity {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return SellPrizeResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return SellPrizeResult{}, err
		}
		return SellPrizeResult{Success: false, Message: "该奖品需要等到次日早上 6 点后才能出售", PrizeKey: input.Key, Balance: balance}, tx.Commit(ctx)
	}

	dateKey := chinaDateKey(input.NowMs)
	stats, err := service.loadPrizeClaimStats(ctx, previousDateKey(dateKey))
	if err != nil {
		return SellPrizeResult{}, err
	}
	price := ecoPrizePrice(input.Key, dateKey, stats)
	total := price * input.Quantity

	balance, err := getBalanceForUpdate(ctx, tx, input.UserID)
	if err != nil {
		return SellPrizeResult{}, err
	}
	nextBalance := balance + total
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		input.UserID,
	); err != nil {
		return SellPrizeResult{}, err
	}
	if err := insertPointLog(ctx, tx, input.UserID, total, SourceGamePlay, "环保行动出售·"+ecoPrizeDefinitions[input.Key].Name, nextBalance); err != nil {
		return SellPrizeResult{}, err
	}

	removedLots := eligibleLots
	if int64(len(removedLots)) > input.Quantity {
		removedLots = removedLots[:input.Quantity]
	}
	if len(removedLots) > 0 {
		if err := deletePrizeLots(ctx, tx, removedLots); err != nil {
			return SellPrizeResult{}, err
		}
		if err := deletePublicPrizeEntriesForLots(ctx, tx, removedLots); err != nil {
			return SellPrizeResult{}, err
		}
	}
	limitedSold := minInt64(countLimitedLots(removedLots), inventory.LimitedCount)
	if err := decrementPrizeInventory(ctx, tx, input.UserID, input.Key, input.Quantity, limitedSold); err != nil {
		return SellPrizeResult{}, err
	}
	if limitedSold > 0 {
		if err := decrementGlobalPrizeStock(ctx, tx, input.Key, limitedSold); err != nil {
			return SellPrizeResult{}, err
		}
	}

	next.PointsSnapshot = nextBalance
	next.LifetimePoints += total
	next.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, next); err != nil {
		return SellPrizeResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SellPrizeResult{}, err
	}

	return SellPrizeResult{
		Success:      true,
		PrizeKey:     input.Key,
		QuantitySold: input.Quantity,
		Price:        price,
		PointsEarned: total,
		Balance:      nextBalance,
	}, nil
}

type sellablePrizeLot struct {
	ID            string
	PrizeKey      string
	Limited       bool
	PublicEntryID *string
	TheftID       *string
}

type stealPublicPrizeTarget struct {
	ID          string
	PrizeKey    string
	OwnerUserID int64
	OwnerLotID  string
}

func findPublicPrizeForSteal(ctx context.Context, tx pgx.Tx, entryID string, nowMs int64) (stealPublicPrizeTarget, bool, error) {
	var target stealPublicPrizeTarget
	err := tx.QueryRow(ctx,
		`SELECT id, prize_key, owner_user_id, owner_lot_id
		   FROM eco_public_prizes
		  WHERE id = $1
		    AND status = 'listed'
		    AND NOT EXISTS (
		      SELECT 1
		        FROM eco_thefts t
		       WHERE t.public_entry_id = eco_public_prizes.id
		         AND t.outcome = 'caught'
		         AND t.resolved_at_ms IS NOT NULL
		         AND t.resolved_at_ms + $2 > $3
		    )
		  FOR UPDATE`,
		entryID,
		theftProtectionMS,
		nowMs,
	).Scan(&target.ID, &target.PrizeKey, &target.OwnerUserID, &target.OwnerLotID)
	if errors.Is(err, pgx.ErrNoRows) {
		return stealPublicPrizeTarget{}, false, nil
	}
	if err != nil {
		return stealPublicPrizeTarget{}, false, err
	}
	return target, true, nil
}

func lockEcoUsers(ctx context.Context, tx pgx.Tx, firstUserID int64, secondUserID int64) error {
	low := firstUserID
	high := secondUserID
	if low > high {
		low, high = high, low
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, ecoUserAdvisoryLockOffset+low); err != nil {
		return err
	}
	if high != low {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, ecoUserAdvisoryLockOffset+high); err != nil {
			return err
		}
	}
	return nil
}

func hasActiveTheftTx(ctx context.Context, tx pgx.Tx, userID int64) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM eco_thefts WHERE thief_user_id = $1 AND resolved_at_ms IS NULL
		 )`,
		userID,
	).Scan(&exists)
	return exists, err
}

func findOwnerPublicLotForUpdate(ctx context.Context, tx pgx.Tx, ownerUserID int64, lotID string, publicEntryID string) (sellablePrizeLot, bool, error) {
	var lot sellablePrizeLot
	err := tx.QueryRow(ctx,
		`SELECT id, prize_key, limited, public_entry_id
		   FROM eco_prize_lots
		  WHERE id = $1
		    AND user_id = $2
		    AND public_entry_id = $3
		    AND source <> 'stolen'
		  FOR UPDATE`,
		lotID,
		ownerUserID,
		publicEntryID,
	).Scan(&lot.ID, &lot.PrizeKey, &lot.Limited, &publicEntryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sellablePrizeLot{}, false, nil
	}
	if err != nil {
		return sellablePrizeLot{}, false, err
	}
	lot.PublicEntryID = ptrString(publicEntryID)
	return lot, true, nil
}

func markPublicPrizeStolen(ctx context.Context, tx pgx.Tx, entryID string, thiefUserID int64, thiefName string, message string, stolenAtMs int64) error {
	_, err := tx.Exec(ctx,
		`UPDATE eco_public_prizes
		    SET status = 'stolen',
		        thief_user_id = $2,
		        thief_name = $3,
		        theft_message = $4,
		        stolen_at_ms = $5,
		        updated_at = now()
		  WHERE id = $1
		    AND status = 'listed'`,
		entryID,
		thiefUserID,
		thiefName,
		message,
		stolenAtMs,
	)
	return err
}

func insertTheftRecord(ctx context.Context, tx pgx.Tx, theftID string, prizeKey string, ownerUserID int64, thiefUserID int64, publicEntryID string, ownerLotID string, thiefLotID string, stolenAtMs int64, message string, blackMarketAvailableAtMs int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_thefts (
		   id, prize_key, original_user_id, thief_user_id, public_entry_id,
		   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		   black_market_available_at_ms, message
		 ) VALUES (
		   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
		 )`,
		theftID,
		prizeKey,
		ownerUserID,
		thiefUserID,
		publicEntryID,
		ownerLotID,
		thiefLotID,
		stolenAtMs,
		stolenAtMs+theftCheckIntervalMS,
		blackMarketAvailableAtMs,
		message,
	)
	return err
}

func upsertStolenPrizeInventory(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string, limitedDelta int64) error {
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

func insertStolenPrizeLot(ctx context.Context, tx pgx.Tx, lotID string, userID int64, prizeKey string, ownerUserID int64, theftID string, stolenAtMs int64, blackMarketAvailableAtMs int64, limited bool) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		   stolen_from_user_id, stolen_at_ms, theft_id, black_market_available_at_ms
		 ) VALUES (
		   $1, $2, $3, $4, $5, $6, 'stolen', $7, $4, $8, $5
		 )`,
		lotID,
		userID,
		prizeKey,
		stolenAtMs,
		blackMarketAvailableAtMs,
		limited,
		ownerUserID,
		theftID,
	)
	return err
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func getPrizeInventoryForUpdate(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string) (PrizeInventory, error) {
	var inventory PrizeInventory
	err := tx.QueryRow(ctx,
		`SELECT inventory_count, limited_count, lifetime_claim_count
		   FROM eco_prize_inventory
		  WHERE user_id = $1 AND prize_key = $2
		  FOR UPDATE`,
		userID,
		prizeKey,
	).Scan(&inventory.InventoryCount, &inventory.LimitedCount, &inventory.LifetimeClaimCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return PrizeInventory{}, nil
	}
	return inventory, err
}

func listSellablePrizeLotsForUpdate(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string, nowMs int64) ([]sellablePrizeLot, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, limited, public_entry_id
		   FROM eco_prize_lots
		  WHERE user_id = $1
		    AND prize_key = $2
		    AND source <> 'stolen'
		    AND available_at_ms <= $3
		  ORDER BY acquired_at_ms, id
		  FOR UPDATE`,
		userID,
		prizeKey,
		nowMs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	lots := []sellablePrizeLot{}
	for rows.Next() {
		var lot sellablePrizeLot
		var publicEntryID sql.NullString
		if err := rows.Scan(&lot.ID, &lot.Limited, &publicEntryID); err != nil {
			return nil, err
		}
		if publicEntryID.Valid {
			lot.PublicEntryID = ptrString(publicEntryID.String)
		}
		lots = append(lots, lot)
	}
	return lots, rows.Err()
}

func findMerchantPrizeLotForUpdate(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string, nowMs int64) (sellablePrizeLot, bool, error) {
	var lot sellablePrizeLot
	var publicEntryID string
	err := tx.QueryRow(ctx,
		`SELECT id, limited, public_entry_id
		   FROM eco_prize_lots
		  WHERE user_id = $1
		    AND prize_key = $2
		    AND public_entry_id IS NOT NULL
		    AND source <> 'stolen'
		    AND merchant_available_at_ms IS NOT NULL
		    AND merchant_available_at_ms <= $3
		  ORDER BY merchant_available_at_ms, acquired_at_ms, id
		  LIMIT 1
		  FOR UPDATE`,
		userID,
		prizeKey,
		nowMs,
	).Scan(&lot.ID, &lot.Limited, &publicEntryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sellablePrizeLot{}, false, nil
	}
	if err != nil {
		return sellablePrizeLot{}, false, err
	}
	lot.PublicEntryID = ptrString(publicEntryID)
	return lot, true, nil
}

func findBlackMarketPrizeLotForUpdate(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string, nowMs int64) (sellablePrizeLot, bool, error) {
	var lot sellablePrizeLot
	var theftID sql.NullString
	err := tx.QueryRow(ctx,
		`SELECT id, limited, theft_id
		   FROM eco_prize_lots
		  WHERE user_id = $1
		    AND prize_key = $2
		    AND source = 'stolen'
		    AND black_market_available_at_ms IS NOT NULL
		    AND black_market_available_at_ms <= $3
		  ORDER BY black_market_available_at_ms, acquired_at_ms, id
		  LIMIT 1
		  FOR UPDATE`,
		userID,
		prizeKey,
		nowMs,
	).Scan(&lot.ID, &lot.Limited, &theftID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sellablePrizeLot{}, false, nil
	}
	if err != nil {
		return sellablePrizeLot{}, false, err
	}
	if theftID.Valid {
		lot.TheftID = ptrString(theftID.String)
	}
	return lot, true, nil
}

func countPrizeLots(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string) (int64, error) {
	var count int64
	err := tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM eco_prize_lots WHERE user_id = $1 AND prize_key = $2`,
		userID,
		prizeKey,
	).Scan(&count)
	return count, err
}

func deletePrizeLots(ctx context.Context, tx pgx.Tx, lots []sellablePrizeLot) error {
	ids := make([]string, 0, len(lots))
	for _, lot := range lots {
		ids = append(ids, lot.ID)
	}
	_, err := tx.Exec(ctx, `DELETE FROM eco_prize_lots WHERE id = ANY($1)`, ids)
	return err
}

func deletePublicPrizeEntriesForLots(ctx context.Context, tx pgx.Tx, lots []sellablePrizeLot) error {
	entryIDs := make([]string, 0, len(lots))
	for _, lot := range lots {
		if lot.PublicEntryID != nil && *lot.PublicEntryID != "" {
			entryIDs = append(entryIDs, *lot.PublicEntryID)
		}
	}
	if len(entryIDs) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `DELETE FROM eco_public_prizes WHERE id = ANY($1)`, entryIDs)
	return err
}

func decrementPrizeInventory(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string, quantity int64, limitedSold int64) error {
	_, err := tx.Exec(ctx,
		`UPDATE eco_prize_inventory
		    SET inventory_count = inventory_count - $3,
		        limited_count = GREATEST(0, limited_count - $4),
		        updated_at = now()
		  WHERE user_id = $1
		    AND prize_key = $2`,
		userID,
		prizeKey,
		quantity,
		limitedSold,
	)
	return err
}

func decrementGlobalPrizeStock(ctx context.Context, tx pgx.Tx, prizeKey string, delta int64) error {
	_, err := tx.Exec(ctx,
		`UPDATE eco_global_prize_stock
		    SET claimed_count = GREATEST(0, claimed_count - $2),
		        updated_at = now()
		  WHERE prize_key = $1`,
		prizeKey,
		delta,
	)
	return err
}

func markTheftEscapedAndDeletePublicPrize(ctx context.Context, tx pgx.Tx, theftID string, nowMs int64) error {
	var publicEntryID string
	err := tx.QueryRow(ctx,
		`UPDATE eco_thefts
		    SET resolved_at_ms = $2,
		        outcome = 'escaped',
		        updated_at = now()
		  WHERE id = $1
		  RETURNING public_entry_id`,
		theftID,
		nowMs,
	).Scan(&publicEntryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM eco_public_prizes WHERE id = $1`, publicEntryID)
	return err
}

func countLimitedLots(lots []sellablePrizeLot) int64 {
	count := int64(0)
	for _, lot := range lots {
		if lot.Limited {
			count++
		}
	}
	return count
}

func findVisiblePrize(prizes []VisiblePrize, id string) (VisiblePrize, bool) {
	for _, prize := range prizes {
		if prize.ID == id {
			return prize, true
		}
	}
	return VisiblePrize{}, false
}

func deleteVisiblePrize(ctx context.Context, tx pgx.Tx, userID int64, prizeID string) error {
	_, err := tx.Exec(ctx,
		`DELETE FROM eco_visible_prizes WHERE user_id = $1 AND id = $2`,
		userID,
		prizeID,
	)
	return err
}

func upsertPrizeInventory(ctx context.Context, tx pgx.Tx, userID int64, prizeKey string, limited bool) error {
	limitedDelta := int64(0)
	if limited {
		limitedDelta = 1
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_prize_inventory (
		   user_id, prize_key, inventory_count, limited_count, lifetime_claim_count, updated_at
		 ) VALUES (
		   $1, $2, 1, $3, 1, now()
		 )
		 ON CONFLICT (user_id, prize_key) DO UPDATE SET
		   inventory_count = eco_prize_inventory.inventory_count + 1,
		   limited_count = eco_prize_inventory.limited_count + excluded.limited_count,
		   lifetime_claim_count = eco_prize_inventory.lifetime_claim_count + 1,
		   updated_at = now()`,
		userID,
		prizeKey,
		limitedDelta,
	)
	return err
}

func insertPrizeLot(ctx context.Context, tx pgx.Tx, userID int64, lotID string, prize VisiblePrize, acquiredAtMs int64, availableAtMs int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source
		 ) VALUES (
		   $1, $2, $3, $4, $5, $6, 'claim'
		 )`,
		lotID,
		userID,
		prize.PrizeKey,
		acquiredAtMs,
		availableAtMs,
		prize.Limited,
	)
	return err
}

func markPrizeLotPublic(ctx context.Context, tx pgx.Tx, lotID string, entryID string, publicAtMs int64, merchantAvailableAtMs int64) error {
	_, err := tx.Exec(ctx,
		`UPDATE eco_prize_lots
		    SET public_entry_id = $2,
		        publicly_listed_at_ms = $3,
		        merchant_available_at_ms = $4,
		        updated_at = now()
		  WHERE id = $1`,
		lotID,
		entryID,
		publicAtMs,
		merchantAvailableAtMs,
	)
	return err
}

func insertPublicPrize(ctx context.Context, tx pgx.Tx, entryID string, prizeKey string, ownerUserID int64, ownerName string, lotID string, publicAtMs int64, merchantAvailableAtMs int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status
		 ) VALUES (
		   $1, $2, $3, $4, $5, $6, $7, 'listed'
		 )`,
		entryID,
		prizeKey,
		ownerUserID,
		ownerName,
		lotID,
		publicAtMs,
		merchantAvailableAtMs,
	)
	return err
}

func incrementPrizeClaimStats(ctx context.Context, tx pgx.Tx, prizeKey string, dateKey string) error {
	for _, key := range []string{prizeKey, "total"} {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_prize_claim_stats (stat_date, prize_key, claim_count, updated_at)
			 VALUES ($1::date, $2, 1, now())
			 ON CONFLICT (stat_date, prize_key) DO UPDATE SET
			   claim_count = eco_prize_claim_stats.claim_count + 1,
			   updated_at = now()`,
			dateKey,
			key,
		); err != nil {
			return err
		}
	}
	return nil
}

func getEcoOwnerName(ctx context.Context, tx pgx.Tx, userID int64) (string, error) {
	var username string
	var displayName string
	err := tx.QueryRow(ctx,
		`SELECT username, display_name FROM users WHERE id = $1`,
		userID,
	).Scan(&username, &displayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return "#" + intString(userID), nil
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(username) != "" {
		return username, nil
	}
	if strings.TrimSpace(displayName) != "" {
		return displayName, nil
	}
	return "#" + intString(userID), nil
}

func nextChinaSixMs(nowMs int64) int64 {
	location := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.UnixMilli(nowMs).In(location)
	year, month, day := now.Date()
	return time.Date(year, month, day+1, 6, 0, 0, 0, location).UnixMilli()
}
