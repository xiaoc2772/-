package eco

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	ecoPrizeTTLMS = int64(10 * 60 * 1000)
)

var (
	ecoPrizeDefinitions = map[string]prizeDefinition{
		"diamond":  {Name: "钻石", Emoji: "💎", ImageSrc: "/images-optimized/ui/games/eco/prizes/diamond.webp?v=1", SpawnRate: 0.00005, MinPrice: 1000, MaxPrice: 15000, GlobalLimit: 10},
		"coin":     {Name: "金币", Emoji: "🪙", ImageSrc: "/images-optimized/ui/games/eco/prizes/coin.webp?v=1", SpawnRate: 0.0001, MinPrice: 1000, MaxPrice: 9000, GlobalLimit: 15},
		"necklace": {Name: "项链", Emoji: "📿", ImageSrc: "/images-optimized/ui/games/eco/prizes/necklace.webp?v=1", SpawnRate: 0.0003, MinPrice: 1000, MaxPrice: 7000, GlobalLimit: 15},
		"trophy":   {Name: "奖杯", Emoji: "🏆", ImageSrc: "/images-optimized/ui/games/eco/prizes/trophy.webp?v=1", SpawnRate: 0.0005, MinPrice: 500, MaxPrice: 5000, GlobalLimit: 20},
		"photo":    {Name: "照片", Emoji: "🖼️", ImageSrc: "/images-optimized/ui/games/eco/prizes/photo.webp?v=1", SpawnRate: 0.00001, MinPrice: 5000, MaxPrice: 50000, GlobalLimit: 10},
	}
	ecoItemDefinitions = map[string]itemDefinition{
		"clear_truck":      {Name: "清运车", Emoji: "🚛", Desc: "立即补充 80 个普通垃圾，不生成奖品", Cost: 35, DailyLimit: 3},
		"lucky_flashlight": {Name: "幸运手电", Emoji: "🔦", Desc: "接下来 200 个在线生成物，上述奖品出现概率变为 5 倍", Cost: 20, DailyLimit: 1},
		"recycle_glove":    {Name: "回收手套", Emoji: "🧤", Desc: "接下来 50 次拖拽，每次额外回收 1 个垃圾", Cost: 25, DailyLimit: 2},
	}
)

type StatusResponse struct {
	ServerNow                 int64              `json:"serverNow"`
	Points                    int64              `json:"points"`
	Pending                   int64              `json:"pending"`
	PendingTotal              int64              `json:"pendingTotal"`
	StorageCap                int64              `json:"storageCap"`
	PointBuffer               int64              `json:"pointBuffer"`
	PointDivisor              int64              `json:"pointDivisor"`
	PointMultiplier           int64              `json:"pointMultiplier"`
	SpawnPerMin               int64              `json:"spawnPerMin"`
	AutoPerMin                int64              `json:"autoPerMin"`
	GrabSize                  int64              `json:"grabSize"`
	Exp                       int64              `json:"exp"`
	LifetimeCleared           int64              `json:"lifetimeCleared"`
	LifetimePoints            int64              `json:"lifetimePoints"`
	TodayTrashPoints          int64              `json:"todayTrashPoints"`
	TodayTrashPointsDate      string             `json:"todayTrashPointsDate"`
	Upgrades                  []UpgradeView      `json:"upgrades"`
	Items                     []ItemView         `json:"items"`
	Prizes                    []PrizeView        `json:"prizes"`
	PublicBoard               PublicBoardView    `json:"publicBoard"`
	VisiblePrizes             []VisiblePrizeView `json:"visiblePrizes"`
	LuckyGenerationsRemaining int64              `json:"luckyGenerationsRemaining"`
	GloveUsesRemaining        int64              `json:"gloveUsesRemaining"`
	Offline                   *OfflineSummary    `json:"offline"`
}

type UpgradeView struct {
	Key                string  `json:"key"`
	Name               string  `json:"name"`
	Emoji              string  `json:"emoji"`
	Desc               string  `json:"desc"`
	Level              int64   `json:"level"`
	MaxLevel           int64   `json:"maxLevel"`
	NextCost           *int64  `json:"nextCost"`
	CurrentEffectLabel string  `json:"currentEffectLabel"`
	NextEffectLabel    *string `json:"nextEffectLabel"`
	Maxed              bool    `json:"maxed"`
}

type ItemView struct {
	Key            string `json:"key"`
	Name           string `json:"name"`
	Emoji          string `json:"emoji"`
	Desc           string `json:"desc"`
	Cost           int64  `json:"cost"`
	DailyLimit     int64  `json:"dailyLimit"`
	PurchasedToday int64  `json:"purchasedToday"`
	RemainingToday int64  `json:"remainingToday"`
}

type PrizeView struct {
	Key                       string              `json:"key"`
	Name                      string              `json:"name"`
	Emoji                     string              `json:"emoji"`
	ImageSrc                  string              `json:"imageSrc"`
	Inventory                 int64               `json:"inventory"`
	SellableInventory         int64               `json:"sellableInventory"`
	LockedInventory           int64               `json:"lockedInventory"`
	PublicInventory           int64               `json:"publicInventory"`
	StolenInventory           int64               `json:"stolenInventory"`
	MerchantAvailableCount    int64               `json:"merchantAvailableCount"`
	MerchantPrice             int64               `json:"merchantPrice"`
	BlackMarketAvailableCount int64               `json:"blackMarketAvailableCount"`
	TodayPrice                int64               `json:"todayPrice"`
	YesterdayPrice            int64               `json:"yesterdayPrice"`
	Change                    int64               `json:"change"`
	WeekChange                int64               `json:"weekChange"`
	PriceHistory              []PrizeHistoryPoint `json:"priceHistory"`
	MinPrice                  int64               `json:"minPrice"`
	MaxPrice                  int64               `json:"maxPrice"`
	SpawnRate                 float64             `json:"spawnRate"`
}

type PrizeHistoryPoint struct {
	Date                   string `json:"date"`
	Price                  int64  `json:"price"`
	PreviousDayClaimCount  int64  `json:"previousDayClaimCount"`
	PreviousDayTotalClaims int64  `json:"previousDayTotalClaims"`
}

type PublicBoardView struct {
	Remaining map[string]int64   `json:"remaining"`
	Entries   []PublicBoardEntry `json:"entries"`
}

type PublicBoardEntry struct {
	ID                  string  `json:"id"`
	Key                 string  `json:"key"`
	Name                string  `json:"name"`
	Emoji               string  `json:"emoji"`
	ImageSrc            string  `json:"imageSrc"`
	OwnerUserID         int64   `json:"ownerUserId"`
	OwnerName           string  `json:"ownerName"`
	OwnerUsername       *string `json:"ownerUsername"`
	OwnerDisplayName    *string `json:"ownerDisplayName"`
	OwnerAvatarURL      *string `json:"ownerAvatarUrl"`
	MerchantAvailableAt int64   `json:"merchantAvailableAt"`
	Status              string  `json:"status"`
	CanSteal            bool    `json:"canSteal"`
	StealDisabledReason *string `json:"stealDisabledReason"`
	ProtectedUntil      *int64  `json:"protectedUntil"`
	ThiefUserID         *int64  `json:"thiefUserId"`
	ThiefName           *string `json:"thiefName"`
	ThiefAvatarURL      *string `json:"thiefAvatarUrl"`
	TheftMessage        *string `json:"theftMessage"`
	StolenAt            *int64  `json:"stolenAt"`
}

type VisiblePrizeView struct {
	ID        string `json:"id"`
	Key       string `json:"key"`
	Name      string `json:"name"`
	Emoji     string `json:"emoji"`
	ImageSrc  string `json:"imageSrc"`
	ExpiresAt int64  `json:"expiresAt"`
}

type OfflineSummary struct {
	Cleared   int64 `json:"cleared"`
	Points    int64 `json:"points"`
	ElapsedMs int64 `json:"elapsedMs"`
}

type prizeDefinition struct {
	Name        string
	Emoji       string
	ImageSrc    string
	SpawnRate   float64
	MinPrice    int64
	MaxPrice    int64
	GlobalLimit int64
}

type itemDefinition struct {
	Name       string
	Emoji      string
	Desc       string
	Cost       int64
	DailyLimit int64
}

type prizeClaimStats map[string]int64

func (service *Service) GetStatus(ctx context.Context, userID int64, nowMs int64) (StatusResponse, error) {
	if userID <= 0 {
		return StatusResponse{}, errors.New("userID must be positive")
	}
	if nowMs <= 0 {
		nowMs = nowMillis()
	}

	if err := service.advanceStatusState(ctx, userID, nowMs); err != nil {
		return StatusResponse{}, err
	}
	snapshot, err := service.GetStateSnapshot(ctx, userID, nowMs)
	if err != nil {
		return StatusResponse{}, err
	}
	balance, err := service.getPointBalance(ctx, userID)
	if err != nil {
		return StatusResponse{}, err
	}
	snapshot.PointsSnapshot = balance

	today := chinaDateKey(nowMs)
	todayTrashPoints := int64(0)
	if snapshot.DailyTrashDate == today {
		todayTrashPoints = snapshot.DailyTrashPoints
	}

	prizes, err := service.summarizePrizes(ctx, snapshot, nowMs)
	if err != nil {
		return StatusResponse{}, err
	}
	publicBoard, err := service.summarizePublicBoard(ctx, userID, nowMs)
	if err != nil {
		return StatusResponse{}, err
	}

	return StatusResponse{
		ServerNow:                 nowMs,
		Points:                    balance,
		Pending:                   snapshot.Pending,
		PendingTotal:              snapshot.Pending + int64(len(snapshot.VisiblePrizes)),
		StorageCap:                StorageCap(snapshot),
		PointBuffer:               snapshot.PointBuffer,
		PointDivisor:              PointDivisor,
		PointMultiplier:           PointMultiplier(snapshot),
		SpawnPerMin:               EffectiveSpawnPerMin(snapshot),
		AutoPerMin:                EffectiveAutoPerMin(snapshot),
		GrabSize:                  BaseGrabSize + boolInt64(snapshot.GloveUsesRemaining > 0),
		Exp:                       snapshot.Exp,
		LifetimeCleared:           snapshot.LifetimeCleared,
		LifetimePoints:            snapshot.LifetimePoints,
		TodayTrashPoints:          todayTrashPoints,
		TodayTrashPointsDate:      today,
		Upgrades:                  summarizeUpgrades(snapshot),
		Items:                     summarizeItems(snapshot, today),
		Prizes:                    prizes,
		PublicBoard:               publicBoard,
		VisiblePrizes:             summarizeVisiblePrizes(snapshot),
		LuckyGenerationsRemaining: snapshot.LuckyGenerationsRemaining,
		GloveUsesRemaining:        snapshot.GloveUsesRemaining,
		Offline:                   nil,
	}, nil
}

func (service *Service) advanceStatusState(ctx context.Context, userID int64, nowMs int64) error {
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensurePlaceholderUser(ctx, tx, userID); err != nil {
		return err
	}
	if err := ensurePointAccount(ctx, tx, userID); err != nil {
		return err
	}
	if err := ensureEcoState(ctx, tx, userID, nowMs); err != nil {
		return err
	}
	snapshot, err := service.loadCollectStateForUpdate(ctx, tx, userID, nowMs)
	if err != nil {
		return err
	}
	next, tick, err := service.advanceStateForUpdate(ctx, tx, snapshot, nowMs, true)
	if err != nil {
		return err
	}
	if _, err := service.creditTrash(ctx, tx, &next, tick.AutoCollected, nowMs, "自动回收"); err != nil {
		return err
	}
	next.UpdatedAtMs = nowMs
	if err := saveEcoState(ctx, tx, next); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (service *Service) getPointBalance(ctx context.Context, userID int64) (int64, error) {
	var balance int64
	err := service.db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return balance, err
}

func summarizeUpgrades(snapshot StateSnapshot) []UpgradeView {
	return []UpgradeView{
		buildUpgradeView("spawn", "刷新速度", "♻️", "街区垃圾刷新更快，单位时间能回收的更多", []int64{50, 90, 160, 280, 480, 820, 1400, 2400}, snapshot),
		buildUpgradeView("storage", "回收袋容量", "🛍️", "挂机时能囤积更多垃圾，离开越久收获越多", []int64{40, 70, 120, 200, 340, 580, 980, 1600}, snapshot),
		buildUpgradeView("value", "积分价格", "💰", "每 10 个垃圾兑换的积分更多", []int64{180, 360, 720, 1400, 2600}, snapshot),
		buildUpgradeView("auto", "自动回收机器人", "🤖", "在线/离线自动回收普通垃圾，不会拾取奖品", []int64{250, 450, 850, 1600, 3000, 5600}, snapshot),
	}
}

func buildUpgradeView(key string, name string, emoji string, desc string, costs []int64, snapshot StateSnapshot) UpgradeView {
	level := minInt64(UpgradeLevel(snapshot, key), int64(len(costs)))
	var nextCost *int64
	var nextEffectLabel *string
	if level < int64(len(costs)) {
		nextCost = ptrInt64(costs[level])
		next := upgradeEffectLabel(key, level+1)
		nextEffectLabel = &next
	}
	return UpgradeView{
		Key:                key,
		Name:               name,
		Emoji:              emoji,
		Desc:               desc,
		Level:              level,
		MaxLevel:           int64(len(costs)),
		NextCost:           nextCost,
		CurrentEffectLabel: upgradeEffectLabel(key, level),
		NextEffectLabel:    nextEffectLabel,
		Maxed:              level >= int64(len(costs)),
	}
}

func upgradeEffectLabel(key string, level int64) string {
	switch key {
	case "spawn":
		return intLabel(BaseSpawnPerMin+level*3, " 个/分钟")
	case "storage":
		return intLabel(BaseStorageCap+level*40, " 容量")
	case "value":
		return "每 10 个 = " + intString(BasePointMultiplier+level) + " 积分"
	case "auto":
		rate := autoRate(level)
		if rate <= 0 {
			return "未启用"
		}
		return intLabel(rate, " 个/分钟")
	default:
		return ""
	}
}

func summarizeItems(snapshot StateSnapshot, today string) []ItemView {
	views := make([]ItemView, 0, len(ItemKeys))
	for _, key := range ItemKeys {
		def := ecoItemDefinitions[key]
		purchased := int64(0)
		for _, item := range snapshot.ItemPurchases {
			if item.ItemKey == key && item.PurchaseDate == today {
				purchased = maxInt64(purchased, item.PurchaseCount)
			}
		}
		views = append(views, ItemView{
			Key:            key,
			Name:           def.Name,
			Emoji:          def.Emoji,
			Desc:           def.Desc,
			Cost:           def.Cost,
			DailyLimit:     def.DailyLimit,
			PurchasedToday: purchased,
			RemainingToday: maxInt64(0, def.DailyLimit-purchased),
		})
	}
	return views
}

func (service *Service) summarizePrizes(ctx context.Context, snapshot StateSnapshot, nowMs int64) ([]PrizeView, error) {
	today := chinaDateKey(nowMs)
	yesterday := previousDateKey(today)
	priceDates := make([]string, 0, 7)
	for index := 6; index >= 0; index-- {
		priceDates = append(priceDates, dateKeyAddDays(today, -index))
	}

	statsByDate := make(map[string]prizeClaimStats, len(priceDates)+1)
	for _, date := range priceDates {
		stats, err := service.loadPrizeClaimStats(ctx, previousDateKey(date))
		if err != nil {
			return nil, err
		}
		statsByDate[date] = stats
	}
	yesterdayStats, err := service.loadPrizeClaimStats(ctx, previousDateKey(yesterday))
	if err != nil {
		return nil, err
	}
	rates, err := service.loadPrizeRateSettings(ctx)
	if err != nil {
		return nil, err
	}

	views := make([]PrizeView, 0, len(PrizeKeys))
	for _, key := range PrizeKeys {
		def := ecoPrizeDefinitions[key]
		todayPrice := ecoPrizePrice(key, today, statsByDate[today])
		yesterdayPrice := ecoPrizePrice(key, yesterday, yesterdayStats)
		history := make([]PrizeHistoryPoint, 0, len(priceDates))
		for _, date := range priceDates {
			stats := statsByDate[date]
			history = append(history, PrizeHistoryPoint{
				Date:                   date,
				Price:                  ecoPrizePrice(key, date, stats),
				PreviousDayClaimCount:  stats[key],
				PreviousDayTotalClaims: stats["total"],
			})
		}

		inventory := snapshot.PrizeInventory[key].InventoryCount
		legacyInventory := maxInt64(0, inventory-prizeLotTotal(snapshot, key))
		sellableLotCount := sellableLotCount(snapshot, key, nowMs)
		blackMarketCount := blackMarketLotCount(snapshot, key, nowMs)
		views = append(views, PrizeView{
			Key:                       key,
			Name:                      def.Name,
			Emoji:                     def.Emoji,
			ImageSrc:                  def.ImageSrc,
			Inventory:                 inventory,
			SellableInventory:         legacyInventory + sellableLotCount,
			LockedInventory:           maxInt64(0, inventory-legacyInventory-sellableLotCount-blackMarketCount),
			PublicInventory:           publicLotCount(snapshot, key),
			StolenInventory:           stolenLotCount(snapshot, key),
			MerchantAvailableCount:    merchantLotCount(snapshot, key, nowMs),
			MerchantPrice:             int64(math.Floor(float64(todayPrice) * 1.2)),
			BlackMarketAvailableCount: blackMarketCount,
			TodayPrice:                todayPrice,
			YesterdayPrice:            yesterdayPrice,
			Change:                    todayPrice - yesterdayPrice,
			WeekChange:                todayPrice - history[0].Price,
			PriceHistory:              history,
			MinPrice:                  def.MinPrice,
			MaxPrice:                  def.MaxPrice,
			SpawnRate:                 rates[key],
		})
	}
	return views, nil
}

func (service *Service) loadPrizeClaimStats(ctx context.Context, dateKey string) (prizeClaimStats, error) {
	stats := prizeClaimStats{}
	rows, err := service.db.Query(ctx,
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

func (service *Service) summarizePublicBoard(ctx context.Context, viewerUserID int64, nowMs int64) (PublicBoardView, error) {
	remaining := defaultPrizeCountMap()
	stock, err := service.loadGlobalPrizeStock(ctx)
	if err != nil {
		return PublicBoardView{}, err
	}
	for _, key := range PrizeKeys {
		remaining[key] = maxInt64(0, ecoPrizeDefinitions[key].GlobalLimit-stock[key])
	}

	hasActiveTheft, err := service.hasActiveTheft(ctx, viewerUserID)
	if err != nil {
		return PublicBoardView{}, err
	}
	entries, err := service.loadPublicBoardEntries(ctx, viewerUserID, hasActiveTheft, nowMs)
	if err != nil {
		return PublicBoardView{}, err
	}
	return PublicBoardView{Remaining: remaining, Entries: entries}, nil
}

func (service *Service) loadGlobalPrizeStock(ctx context.Context) (map[string]int64, error) {
	stock := defaultPrizeCountMap()
	rows, err := service.db.Query(ctx, `SELECT prize_key, claimed_count FROM eco_global_prize_stock`)
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
		if isPrizeKey(key) {
			stock[key] = maxInt64(0, count)
		}
	}
	return stock, rows.Err()
}

func (service *Service) hasActiveTheft(ctx context.Context, userID int64) (bool, error) {
	var exists bool
	err := service.db.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM eco_thefts WHERE thief_user_id = $1 AND resolved_at_ms IS NULL
		 )`,
		userID,
	).Scan(&exists)
	return exists, err
}

func (service *Service) loadPublicBoardEntries(ctx context.Context, viewerUserID int64, viewerHasActiveTheft bool, nowMs int64) ([]PublicBoardEntry, error) {
	rows, err := service.db.Query(ctx,
		`SELECT p.id, p.prize_key, p.owner_user_id, p.owner_name, p.owner_avatar_url,
		        p.merchant_available_at_ms, p.status, p.thief_user_id, p.thief_name,
		        p.theft_message, p.stolen_at_ms,
		        COALESCE((
		          SELECT MAX(t.resolved_at_ms) + $1
		            FROM eco_thefts t
		           WHERE t.public_entry_id = p.id
		             AND t.outcome = 'caught'
		             AND t.resolved_at_ms IS NOT NULL
		        ), 0),
		        owner.username, owner.display_name,
		        thief.username, thief.display_name
		   FROM eco_public_prizes p
		   LEFT JOIN users owner ON owner.id = p.owner_user_id
		   LEFT JOIN users thief ON thief.id = p.thief_user_id
		  WHERE p.status IN ('listed', 'stolen')
		  ORDER BY p.public_at_ms DESC
		  LIMIT 30`,
		theftProtectionMS,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []PublicBoardEntry{}
	for rows.Next() {
		var entry PublicBoardEntry
		var ownerAvatar sql.NullString
		var thiefUserID sql.NullInt64
		var thiefName sql.NullString
		var theftMessage sql.NullString
		var stolenAt sql.NullInt64
		var protectedUntil int64
		var ownerUsername sql.NullString
		var ownerDisplayName sql.NullString
		var thiefUsername sql.NullString
		var thiefDisplayName sql.NullString
		if err := rows.Scan(
			&entry.ID,
			&entry.Key,
			&entry.OwnerUserID,
			&entry.OwnerName,
			&ownerAvatar,
			&entry.MerchantAvailableAt,
			&entry.Status,
			&thiefUserID,
			&thiefName,
			&theftMessage,
			&stolenAt,
			&protectedUntil,
			&ownerUsername,
			&ownerDisplayName,
			&thiefUsername,
			&thiefDisplayName,
		); err != nil {
			return nil, err
		}
		def := ecoPrizeDefinitions[entry.Key]
		entry.Name = def.Name
		entry.Emoji = def.Emoji
		entry.ImageSrc = def.ImageSrc
		if ownerUsername.Valid {
			entry.OwnerUsername = ptrString(ownerUsername.String)
		}
		if ownerDisplayName.Valid && ownerDisplayName.String != "" {
			entry.OwnerDisplayName = ptrString(ownerDisplayName.String)
			entry.OwnerName = ownerDisplayName.String
		}
		if ownerAvatar.Valid {
			entry.OwnerAvatarURL = ptrString(ownerAvatar.String)
		}
		if thiefUserID.Valid {
			entry.ThiefUserID = ptrInt64(thiefUserID.Int64)
		}
		if thiefName.Valid {
			entry.ThiefName = ptrString(thiefName.String)
		} else if thiefDisplayName.Valid && thiefDisplayName.String != "" {
			entry.ThiefName = ptrString(thiefDisplayName.String)
		} else if thiefUsername.Valid {
			entry.ThiefName = ptrString(thiefUsername.String)
		}
		if theftMessage.Valid {
			entry.TheftMessage = ptrString(theftMessage.String)
		}
		if stolenAt.Valid {
			entry.StolenAt = ptrInt64(stolenAt.Int64)
		}
		if protectedUntil > nowMs {
			entry.ProtectedUntil = ptrInt64(protectedUntil)
		}
		entry.CanSteal, entry.StealDisabledReason = stealState(entry, viewerUserID, viewerHasActiveTheft, nowMs)
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func stealState(entry PublicBoardEntry, viewerUserID int64, viewerHasActiveTheft bool, nowMs int64) (bool, *string) {
	if entry.Status != "listed" {
		reason := "追查中"
		return false, &reason
	}
	if entry.ProtectedUntil != nil && *entry.ProtectedUntil > nowMs {
		reason := "保护中"
		return false, &reason
	}
	if entry.OwnerUserID == viewerUserID {
		reason := "自己的奖品"
		return false, &reason
	}
	if viewerHasActiveTheft {
		reason := "已有偷盗"
		return false, &reason
	}
	return true, nil
}

func summarizeVisiblePrizes(snapshot StateSnapshot) []VisiblePrizeView {
	views := make([]VisiblePrizeView, 0, len(snapshot.VisiblePrizes))
	for _, prize := range snapshot.VisiblePrizes {
		def := ecoPrizeDefinitions[prize.PrizeKey]
		views = append(views, VisiblePrizeView{
			ID:        prize.ID,
			Key:       prize.PrizeKey,
			Name:      def.Name,
			Emoji:     def.Emoji,
			ImageSrc:  def.ImageSrc,
			ExpiresAt: prize.CreatedAtMs + ecoPrizeTTLMS,
		})
	}
	return views
}

func prizeLotTotal(snapshot StateSnapshot, key string) int64 {
	total := int64(0)
	for _, lot := range snapshot.PrizeLots {
		if lot.PrizeKey == key {
			total++
		}
	}
	return total
}

func sellableLotCount(snapshot StateSnapshot, key string, nowMs int64) int64 {
	total := int64(0)
	for _, lot := range snapshot.PrizeLots {
		if lot.PrizeKey == key && lot.Source != "stolen" && lot.AvailableAtMs <= nowMs {
			total++
		}
	}
	return total
}

func publicLotCount(snapshot StateSnapshot, key string) int64 {
	total := int64(0)
	for _, lot := range snapshot.PrizeLots {
		if lot.PrizeKey == key && lot.PublicEntryID != nil && lot.Source != "stolen" {
			total++
		}
	}
	return total
}

func stolenLotCount(snapshot StateSnapshot, key string) int64 {
	total := int64(0)
	for _, lot := range snapshot.PrizeLots {
		if lot.PrizeKey == key && lot.Source == "stolen" {
			total++
		}
	}
	return total
}

func merchantLotCount(snapshot StateSnapshot, key string, nowMs int64) int64 {
	total := int64(0)
	for _, lot := range snapshot.PrizeLots {
		if lot.PrizeKey == key && lot.PublicEntryID != nil && lot.Source != "stolen" && lot.MerchantAvailableAtMs != nil && *lot.MerchantAvailableAtMs <= nowMs {
			total++
		}
	}
	return total
}

func blackMarketLotCount(snapshot StateSnapshot, key string, nowMs int64) int64 {
	total := int64(0)
	for _, lot := range snapshot.PrizeLots {
		if lot.PrizeKey == key && lot.Source == "stolen" && lot.BlackMarketAvailableAtMs != nil && *lot.BlackMarketAvailableAtMs <= nowMs {
			total++
		}
	}
	return total
}

func ecoPrizePrice(key string, dateKey string, previousDayClaims prizeClaimStats) int64 {
	def := ecoPrizeDefinitions[key]
	hash := fnv1a32(dateKey + ":" + key + ":eco-prize-price")
	randomRatio := float64(hash%10000) / 9999
	claimTotal := previousDayClaims["total"]
	if claimTotal <= 0 {
		for _, prizeKey := range PrizeKeys {
			claimTotal += previousDayClaims[prizeKey]
		}
	}
	actualRate := float64(0)
	if claimTotal > 0 {
		actualRate = float64(previousDayClaims[key]) / float64(claimTotal)
	}
	expectedRate := float64(0)
	if base := ecoBasePrizeRate(); base > 0 {
		expectedRate = def.SpawnRate / base
	}
	pressure := float64(1)
	if expectedRate > 0 {
		pressure = clamp01(actualRate / expectedRate)
	}
	scarcityShift := 0.35 * (1 - pressure)
	abundantShift := 0.35 * math.Max(0, pressure-1)
	adjustedRatio := clamp01(randomRatio + scarcityShift - abundantShift)
	return def.MinPrice + int64(math.Round(float64(def.MaxPrice-def.MinPrice)*adjustedRatio))
}

func fnv1a32(input string) uint32 {
	hash := uint32(2166136261)
	for _, char := range input {
		hash ^= uint32(char)
		hash *= 16777619
	}
	return hash
}

func ecoBasePrizeRate() float64 {
	total := float64(0)
	for _, key := range PrizeKeys {
		total += ecoPrizeDefinitions[key].SpawnRate
	}
	return total
}

func defaultPrizeCountMap() map[string]int64 {
	values := make(map[string]int64, len(PrizeKeys))
	for _, key := range PrizeKeys {
		values[key] = 0
	}
	return values
}

func dateKeyAddDays(dateKey string, days int) string {
	date, err := time.ParseInLocation("2006-01-02", dateKey, time.FixedZone("Asia/Shanghai", 8*60*60))
	if err != nil {
		return dateKey
	}
	return date.AddDate(0, 0, days).Format("2006-01-02")
}

func previousDateKey(dateKey string) string {
	return dateKeyAddDays(dateKey, -1)
}

func clamp01(value float64) float64 {
	return math.Min(1, math.Max(0, value))
}

func boolInt64(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

func autoRate(level int64) int64 {
	if level < 0 {
		return 0
	}
	if level >= int64(len(AutoRateByLevel)) {
		return AutoRateByLevel[len(AutoRateByLevel)-1]
	}
	return AutoRateByLevel[level]
}

func intLabel(value int64, suffix string) string {
	return intString(value) + suffix
}

func intString(value int64) string {
	return strconv.FormatInt(value, 10)
}
