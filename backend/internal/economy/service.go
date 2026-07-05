package economy

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/systemconfig"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const maxRetryableTxRetries = 12

type Service struct {
	db          *pgxpool.Pool
	redis       RedisLockClient
	quotaClient WalletQuotaClient
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func NewServiceWithRedis(db *pgxpool.Pool, redisClient *redis.Client) *Service {
	return &Service{db: db, redis: redisClient}
}

func NewServiceWithWalletDeps(db *pgxpool.Pool, redisClient RedisLockClient, quotaClient WalletQuotaClient) *Service {
	return &Service{db: db, redis: redisClient, quotaClient: quotaClient}
}

func (service *Service) GetPointsSummary(ctx context.Context, user auth.User, limit int) (PointsSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return PointsSummary{}, err
	}
	defer rollbackSilently(ctx, tx)

	if err := ensureUser(ctx, tx, user); err != nil {
		return PointsSummary{}, err
	}

	balance, err := getBalance(ctx, tx, user.ID)
	if err != nil {
		return PointsSummary{}, err
	}
	logs, err := listPointLogs(ctx, tx, user.ID, limit)
	if err != nil {
		return PointsSummary{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return PointsSummary{}, err
	}
	return PointsSummary{Balance: balance, Logs: logs}, nil
}

func (service *Service) ApplyPointsDelta(ctx context.Context, user auth.User, input PointMutationInput) (PointMutationResult, error) {
	if input.Source == "" {
		return PointMutationResult{}, errors.New("source is required")
	}
	input.Description = strings.TrimSpace(input.Description)
	if input.Description == "" {
		return PointMutationResult{}, errors.New("description is required")
	}
	if input.Delta == 0 && !input.RecordZero {
		summary, err := service.GetPointsSummary(ctx, user, 0)
		if err != nil {
			return PointMutationResult{}, err
		}
		return PointMutationResult{Success: true, Balance: summary.Balance}, nil
	}

	var output PointMutationResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		scope := fmt.Sprintf("points:delta:%d", user.ID)
		if ok, err := beginIdempotency(ctx, tx, scope, input.IdempotencyKey, &output); ok || err != nil {
			return err
		}

		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		balance, err := getBalanceForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if input.Delta < 0 && balance < -input.Delta {
			output = PointMutationResult{Success: false, Balance: balance, Message: "积分不足"}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}

		nextBalance := balance + input.Delta
		if _, err := tx.Exec(ctx,
			`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
			nextBalance,
			user.ID,
		); err != nil {
			return err
		}

		if err := insertPointLog(ctx, tx, user.ID, input.Delta, input.Source, input.Description, nextBalance); err != nil {
			return err
		}

		output = PointMutationResult{Success: true, Balance: nextBalance}
		return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
	})
	return output, err
}

func (service *Service) AddGamePointsWithLimit(
	ctx context.Context,
	user auth.User,
	score int64,
	dailyLimit int64,
	source string,
	description string,
	idempotencyKey string,
) (GamePointsResult, error) {
	if score < 0 {
		return GamePointsResult{}, errors.New("score must be non-negative")
	}
	if dailyLimit < 0 {
		dailyLimit = 0
	}
	if source == "" {
		source = "game_play"
	}
	description = strings.TrimSpace(description)
	if description == "" {
		description = "游戏积分"
	}

	var output GamePointsResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		scope := fmt.Sprintf("points:game:%d", user.ID)
		if ok, err := beginIdempotency(ctx, tx, scope, idempotencyKey, &output); ok || err != nil {
			return err
		}
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}

		statDate := todayChina()
		if _, err := tx.Exec(ctx,
			`INSERT INTO daily_game_points (user_id, stat_date, earned_points, updated_at)
			 VALUES ($1, $2, 0, now())
			 ON CONFLICT (user_id, stat_date) DO NOTHING`,
			user.ID,
			statDate,
		); err != nil {
			return err
		}

		var dailyEarned int64
		if err := tx.QueryRow(ctx,
			`SELECT earned_points
			 FROM daily_game_points
			 WHERE user_id = $1 AND stat_date = $2
			 FOR UPDATE`,
			user.ID,
			statDate,
		).Scan(&dailyEarned); err != nil {
			return err
		}

		balance, err := getBalanceForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}

		remaining := maxInt64(0, dailyLimit-dailyEarned)
		grant := minInt64(maxInt64(0, score), remaining)
		nextDailyEarned := dailyEarned + grant
		nextBalance := balance + grant

		if grant > 0 {
			if _, err := tx.Exec(ctx,
				`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
				nextBalance,
				user.ID,
			); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`UPDATE daily_game_points
				 SET earned_points = $1, updated_at = now()
				 WHERE user_id = $2 AND stat_date = $3`,
				nextDailyEarned,
				user.ID,
				statDate,
			); err != nil {
				return err
			}
			if err := insertPointLog(ctx, tx, user.ID, grant, source, description, nextBalance); err != nil {
				return err
			}
		}

		output = GamePointsResult{
			Success:      true,
			PointsEarned: grant,
			Balance:      nextBalance,
			DailyEarned:  nextDailyEarned,
			LimitReached: nextDailyEarned >= dailyLimit,
		}
		return completeIdempotency(ctx, tx, scope, idempotencyKey, output)
	})
	return output, err
}

func (service *Service) GetStoreHome(ctx context.Context, user auth.User) (StoreHomeData, error) {
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return StoreHomeData{}, err
	}
	defer rollbackSilently(ctx, tx)

	if err := ensureUser(ctx, tx, user); err != nil {
		return StoreHomeData{}, err
	}

	categories, err := listStoreCategories(ctx, tx, false)
	if err != nil {
		return StoreHomeData{}, err
	}
	items, err := listStoreItems(ctx, tx, false)
	if err != nil {
		return StoreHomeData{}, err
	}
	balance, err := getBalance(ctx, tx, user.ID)
	if err != nil {
		return StoreHomeData{}, err
	}
	exchanges, err := listExchangeLogs(ctx, tx, user.ID, 10)
	if err != nil {
		return StoreHomeData{}, err
	}
	dailyEarned, err := getDailyEarned(ctx, tx, user.ID, todayChina())
	if err != nil {
		return StoreHomeData{}, err
	}
	dailyLimit, err := systemconfig.DailyPointsLimit(ctx, tx)
	if err != nil {
		return StoreHomeData{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return StoreHomeData{}, err
	}

	return StoreHomeData{
		Items:           items,
		Categories:      categories,
		Balance:         balance,
		RecentExchanges: exchanges,
		DailyLimit:      dailyLimit,
		DailyEarned:     dailyEarned,
	}, nil
}

func (service *Service) ExchangeItem(ctx context.Context, user auth.User, input ExchangeInput) (ExchangeResult, error) {
	input.ItemID = strings.TrimSpace(input.ItemID)
	if input.ItemID == "" {
		return ExchangeResult{Success: false, Message: "参数错误"}, nil
	}
	if input.Quantity == 0 {
		input.Quantity = 1
	}
	if input.Quantity < 1 || input.Quantity > math.MaxInt32 {
		return ExchangeResult{Success: false, Message: "数量参数错误"}, nil
	}

	var output ExchangeResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		scope := fmt.Sprintf("store:exchange:%d", user.ID)
		if ok, err := beginIdempotency(ctx, tx, scope, input.IdempotencyKey, &output); ok || err != nil {
			return err
		}
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}

		item, err := getStoreItemForUpdate(ctx, tx, input.ItemID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				output = ExchangeResult{Success: false, Message: "商品不存在"}
				return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
			}
			return err
		}
		if !item.Enabled {
			output = ExchangeResult{Success: false, Message: "商品已下架"}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}
		if !isSupportedRewardType(item.Type) {
			output = ExchangeResult{Success: false, Message: "该商品类型尚未迁移到 Go"}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}
		if item.PointsCost < 1 || item.Value < 1 {
			output = ExchangeResult{Success: false, Message: "商品配置异常，请联系管理员"}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}
		if item.DailyLimit != nil && *item.DailyLimit > 0 && input.Quantity != 1 {
			output = ExchangeResult{Success: false, Message: "该商品为限购商品，不支持选择数量"}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}

		totalCost, ok := safeMul(item.PointsCost, input.Quantity)
		if !ok || totalCost < 1 {
			output = ExchangeResult{Success: false, Message: "兑换数量过大，请减少数量后重试"}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}
		totalValue, ok := safeMul(item.Value, input.Quantity)
		if !ok || totalValue < 1 {
			output = ExchangeResult{Success: false, Message: "兑换数量过大，请减少数量后重试"}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}

		if item.DailyLimit != nil && *item.DailyLimit > 0 {
			count, err := lockDailyPurchaseCount(ctx, tx, user.ID, item.ID, todayChina())
			if err != nil {
				return err
			}
			if count+input.Quantity > *item.DailyLimit {
				output = ExchangeResult{
					Success: false,
					Message: fmt.Sprintf("今日已达限购上限（%d次）", *item.DailyLimit),
				}
				return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
			}
		}

		if item.TotalStock != nil && item.PurchaseCount+input.Quantity > *item.TotalStock {
			output = ExchangeResult{Success: false, Message: "商品库存不足"}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}

		balance, err := getBalanceForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if balance < totalCost {
			output = ExchangeResult{Success: false, Message: "积分不足", Balance: balance}
			return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
		}

		nextBalance := balance - totalCost
		if _, err := tx.Exec(ctx,
			`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
			nextBalance,
			user.ID,
		); err != nil {
			return err
		}

		description := "兑换 " + item.Name
		if input.Quantity > 1 {
			description = fmt.Sprintf("%s ×%d", description, input.Quantity)
		}
		if err := insertPointLog(ctx, tx, user.ID, -totalCost, SourceExchange, description, nextBalance); err != nil {
			return err
		}

		if item.DailyLimit != nil && *item.DailyLimit > 0 {
			if _, err := tx.Exec(ctx,
				`UPDATE store_daily_purchases
				 SET purchase_count = purchase_count + $1, updated_at = now()
				 WHERE user_id = $2 AND item_id = $3 AND stat_date = $4`,
				input.Quantity,
				user.ID,
				item.ID,
				todayChina(),
			); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx,
			`UPDATE store_items
			 SET purchase_count = purchase_count + $1, updated_at = now()
			 WHERE id = $2`,
			input.Quantity,
			item.ID,
		); err != nil {
			return err
		}

		rewardKind, drawsAvailable, err := grantStoreReward(ctx, tx, user.ID, item.Type, totalValue)
		if err != nil {
			return err
		}

		log := ExchangeLog{
			ID:         randomID(),
			UserID:     user.ID,
			ItemID:     item.ID,
			ItemName:   item.Name,
			PointsCost: totalCost,
			Value:      totalValue,
			Type:       item.Type,
			CreatedAt:  millis(time.Now()),
		}
		if input.Quantity > 1 {
			log.ItemName = fmt.Sprintf("%s ×%d", item.Name, input.Quantity)
		}
		if err := insertExchangeLog(ctx, tx, log, input.Quantity); err != nil {
			return err
		}

		output = ExchangeResult{
			Success:         true,
			Message:         rewardMessage(item.Type, totalValue),
			Log:             &log,
			DrawsAvailable:  drawsAvailable,
			Balance:         nextBalance,
			RewardAssetKind: rewardKind,
		}
		return completeIdempotency(ctx, tx, scope, input.IdempotencyKey, output)
	})
	return output, err
}

func (service *Service) withRetryableTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	var lastErr error
	for attempt := 0; attempt <= maxRetryableTxRetries; attempt++ {
		tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
		if err != nil {
			return err
		}

		err = fn(tx)
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err == nil {
			return nil
		}

		rollbackSilently(ctx, tx)
		lastErr = err
		if !isRetryableTxError(err) || attempt == maxRetryableTxRetries {
			return err
		}
		if err := sleepBeforeRetry(ctx, attempt); err != nil {
			return err
		}
	}
	return lastErr
}

func rollbackSilently(ctx context.Context, tx pgx.Tx) {
	_ = tx.Rollback(ctx)
}

func ensureUser(ctx context.Context, tx pgx.Tx, user auth.User) error {
	displayName := strings.TrimSpace(user.DisplayName)
	if displayName == "" {
		displayName = user.Username
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())
		 ON CONFLICT (id) DO UPDATE SET
		   username = excluded.username,
		   display_name = excluded.display_name,
		   updated_at = now()`,
		user.ID,
		user.Username,
		displayName,
	); err != nil {
		return err
	}

	_, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	)
	return err
}

func getBalance(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1`,
		userID,
	).Scan(&balance)
	return balance, err
}

func getBalanceForUpdate(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&balance)
	return balance, err
}

func insertPointLog(
	ctx context.Context,
	tx pgx.Tx,
	userID int64,
	amount int64,
	source string,
	description string,
	balanceAfter int64,
) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())`,
		randomID(),
		userID,
		amount,
		source,
		description,
		balanceAfter,
	)
	return err
}

func listPointLogs(ctx context.Context, tx pgx.Tx, userID int64, limit int) ([]PointsLog, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, amount, source, description, balance_after, created_at
		 FROM point_ledger
		 WHERE user_id = $1
		 ORDER BY created_at DESC, id DESC
		 LIMIT $2`,
		userID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	logs := make([]PointsLog, 0)
	for rows.Next() {
		var log PointsLog
		var createdAt time.Time
		if err := rows.Scan(&log.ID, &log.Amount, &log.Source, &log.Description, &log.Balance, &createdAt); err != nil {
			return nil, err
		}
		log.CreatedAt = millis(createdAt)
		logs = append(logs, log)
	}
	return logs, rows.Err()
}

func getDailyEarned(ctx context.Context, tx pgx.Tx, userID int64, statDate string) (int64, error) {
	var earned int64
	err := tx.QueryRow(ctx,
		`SELECT COALESCE(earned_points, 0)
		 FROM daily_game_points
		 WHERE user_id = $1 AND stat_date = $2`,
		userID,
		statDate,
	).Scan(&earned)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return earned, err
}

func beginIdempotency[T any](ctx context.Context, tx pgx.Tx, scope string, key string, target *T) (bool, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return false, nil
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM idempotency_keys
		 WHERE scope = $1 AND key = $2 AND expires_at <= now()`,
		scope,
		key,
	); err != nil {
		return false, err
	}

	tag, err := tx.Exec(ctx,
		`INSERT INTO idempotency_keys (scope, key, result_json, expires_at, created_at)
		 VALUES ($1, $2, NULL, now() + interval '24 hours', now())
		 ON CONFLICT (scope, key) DO NOTHING`,
		scope,
		key,
	)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 1 {
		return false, nil
	}

	var raw []byte
	err = tx.QueryRow(ctx,
		`SELECT result_json
		 FROM idempotency_keys
		 WHERE scope = $1 AND key = $2
		 FOR UPDATE`,
		scope,
		key,
	).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if len(raw) == 0 {
		return false, errors.New("idempotency key is already in progress")
	}
	return true, json.Unmarshal(raw, target)
}

func completeIdempotency(ctx context.Context, tx pgx.Tx, scope string, key string, result any) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil
	}

	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}

	tag, err := tx.Exec(ctx,
		`UPDATE idempotency_keys
		 SET result_json = $3,
		     expires_at = now() + interval '24 hours'
		 WHERE scope = $1 AND key = $2`,
		scope,
		key,
		raw,
	)
	if err != nil || tag.RowsAffected() > 0 {
		return err
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO idempotency_keys (scope, key, result_json, expires_at, created_at)
		 VALUES ($1, $2, $3, now() + interval '24 hours', now())`,
		scope,
		key,
		raw,
	)
	return err
}

func isRetryableTxError(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "40001" || pgErr.Code == "40P01"
}

func sleepBeforeRetry(ctx context.Context, attempt int) error {
	backoffStep := minInt64(int64(attempt), 5)
	delay := (25 * time.Millisecond) << backoffStep
	jitterLimit := int64(time.Duration(attempt+1) * 10 * time.Millisecond)
	if jitterLimit > 0 {
		delay += time.Duration(time.Now().UnixNano() % jitterLimit)
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func todayChina() string {
	return time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
}

func randomID() string {
	var buffer [16]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer[:])
}

func safeMul(left int64, right int64) (int64, bool) {
	if left == 0 || right == 0 {
		return 0, true
	}
	if left > math.MaxInt64/right {
		return 0, false
	}
	return left * right, true
}

func minInt64(left int64, right int64) int64 {
	if left < right {
		return left
	}
	return right
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
