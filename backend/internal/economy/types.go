package economy

import "time"

const (
	DailyPointsLimit = int64(5000)

	SourceExchange         = "exchange"
	SourceExchangeRefund   = "exchange_refund"
	SourceExchangeTopup    = "exchange_topup"
	SourceExchangeWithdraw = "exchange_withdraw"
	SourceRaffleWin        = "raffle_win"

	ItemTypeLotterySpin = "lottery_spin"
	ItemTypeQuotaDirect = "quota_direct"
	ItemTypeCardDraw    = "card_draw"
	ItemTypeMakeupCard  = "makeup_card"
)

type PointsLog struct {
	ID          string `json:"id"`
	Amount      int64  `json:"amount"`
	Source      string `json:"source"`
	Description string `json:"description"`
	Balance     int64  `json:"balance"`
	CreatedAt   int64  `json:"createdAt"`
}

type PointsSummary struct {
	Balance int64       `json:"balance"`
	Logs    []PointsLog `json:"logs"`
}

type PointsPagination struct {
	Page       int64 `json:"page"`
	Limit      int64 `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int64 `json:"totalPages"`
	HasMore    bool  `json:"hasMore"`
}

type AdminUserPointsPage struct {
	UserID     int64            `json:"userId"`
	Balance    int64            `json:"balance"`
	Logs       []PointsLog      `json:"logs"`
	Pagination PointsPagination `json:"pagination"`
}

type AdminPointsAdjustmentInput struct {
	UserID      int64
	Amount      int64
	Description string
}

type AdminPointsAdjustmentResult struct {
	UserID     int64 `json:"userId"`
	Adjustment int64 `json:"adjustment"`
	NewBalance int64 `json:"newBalance"`
}

type PointMutationInput struct {
	Delta          int64
	Source         string
	Description    string
	RecordZero     bool
	IdempotencyKey string
}

type PointMutationResult struct {
	Success bool   `json:"success"`
	Balance int64  `json:"balance"`
	Message string `json:"message,omitempty"`
}

type GamePointsResult struct {
	Success      bool  `json:"success"`
	PointsEarned int64 `json:"pointsEarned"`
	Balance      int64 `json:"balance"`
	DailyEarned  int64 `json:"dailyEarned"`
	LimitReached bool  `json:"limitReached"`
}

type StoreCategory struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
	Enabled   bool   `json:"enabled"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type StoreItem struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	Type          string `json:"type"`
	CategoryID    string `json:"categoryId,omitempty"`
	PointsCost    int64  `json:"pointsCost"`
	Value         int64  `json:"value"`
	DailyLimit    *int64 `json:"dailyLimit,omitempty"`
	TotalStock    *int64 `json:"totalStock,omitempty"`
	PurchaseCount int64  `json:"purchaseCount,omitempty"`
	SortOrder     int    `json:"sortOrder"`
	Enabled       bool   `json:"enabled"`
	CreatedAt     int64  `json:"createdAt"`
	UpdatedAt     int64  `json:"updatedAt"`
}

type ExchangeLog struct {
	ID         string `json:"id"`
	UserID     int64  `json:"userId"`
	ItemID     string `json:"itemId"`
	ItemName   string `json:"itemName"`
	PointsCost int64  `json:"pointsCost"`
	Value      int64  `json:"value"`
	Type       string `json:"type"`
	CreatedAt  int64  `json:"createdAt"`
}

type StoreHomeData struct {
	Items           []StoreItem     `json:"items"`
	Categories      []StoreCategory `json:"categories"`
	Balance         int64           `json:"balance"`
	RecentExchanges []ExchangeLog   `json:"recentExchanges"`
	DailyLimit      int64           `json:"dailyLimit"`
	DailyEarned     int64           `json:"dailyEarned"`
}

type StoreAdminData struct {
	Items      []StoreItem         `json:"items"`
	Categories []StoreCategory     `json:"categories"`
	FarmItems  []EffectiveFarmItem `json:"farmItems"`
}

type PetItemEffect map[string]int64

type FarmShopItemOverride struct {
	Key                string        `json:"key"`
	Cost               *int64        `json:"cost,omitempty"`
	DailyLimit         *int64        `json:"dailyLimit,omitempty"`
	DurationMinutes    *int64        `json:"durationMinutes,omitempty"`
	SpeedReduceMinutes *int64        `json:"speedReduceMinutes,omitempty"`
	PetEffect          PetItemEffect `json:"petEffect,omitempty"`
	UpdatedAt          int64         `json:"updatedAt"`
}

type EffectiveFarmItem struct {
	Key                string                `json:"key"`
	Name               string                `json:"name"`
	Emoji              string                `json:"emoji"`
	Category           string                `json:"category"`
	Cost               int64                 `json:"cost"`
	Description        string                `json:"description"`
	DurationMinutes    *int64                `json:"durationMinutes,omitempty"`
	DailyLimit         *int64                `json:"dailyLimit,omitempty"`
	SpeedReduceMinutes *int64                `json:"speedReduceMinutes,omitempty"`
	PetEffect          PetItemEffect         `json:"petEffect,omitempty"`
	Override           *FarmShopItemOverride `json:"override,omitempty"`
}

type FarmShopItemOverrideInput struct {
	Key                string
	Cost               *int64
	DailyLimit         *int64
	DurationMinutes    *int64
	SpeedReduceMinutes *int64
	PetEffect          PetItemEffect
}

type ExchangeInput struct {
	ItemID         string
	Quantity       int64
	IdempotencyKey string
}

type ExchangeResult struct {
	Success         bool         `json:"success"`
	Message         string       `json:"message"`
	Log             *ExchangeLog `json:"log,omitempty"`
	DrawsAvailable  *int64       `json:"drawsAvailable,omitempty"`
	Balance         int64        `json:"balance,omitempty"`
	RewardAssetKind string       `json:"rewardAssetKind,omitempty"`
}

type StoreCategoryMutationInput struct {
	ID        string
	Name      string
	Color     string
	SortOrder int
	Enabled   bool
}

type StoreItemMutationInput struct {
	Name        string
	Description string
	Type        string
	CategoryID  string
	PointsCost  int64
	Value       int64
	DailyLimit  *int64
	SortOrder   int
	Enabled     bool
}

type StoreItemUpdateInput struct {
	ID            string
	Name          *string
	Description   *string
	Type          *string
	CategoryID    *string
	PointsCost    *int64
	Value         *int64
	DailyLimit    *int64
	DailyLimitSet bool
	SortOrder     *int
	Enabled       *bool
}

func millis(t time.Time) int64 {
	return t.UnixNano() / int64(time.Millisecond)
}
