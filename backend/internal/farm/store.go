package farm

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnavailable = errors.New("farm database unavailable")

type Store struct {
	db *pgxpool.Pool
}

type stealCandidateRecord struct {
	UserID    int64
	Nickname  string
	AvatarURL *string
	State     FarmState
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (store *Store) GetState(ctx context.Context, userID int64) (StateRecord, error) {
	if store.db == nil {
		return StateRecord{}, ErrUnavailable
	}
	if userID <= 0 {
		return StateRecord{}, errors.New("userID must be positive")
	}

	var record StateRecord
	var raw []byte
	err := store.db.QueryRow(ctx,
		`SELECT user_id, state_json, last_tick_at_ms, updated_at_ms, created_at, updated_at
		   FROM farm_states
		  WHERE user_id = $1`,
		userID,
	).Scan(
		&record.UserID,
		&raw,
		&record.LastTickAtMs,
		&record.UpdatedAtMs,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return StateRecord{UserID: userID}, nil
	}
	if err != nil {
		return StateRecord{}, err
	}
	record.Exists = true
	record.StateJSON = append(json.RawMessage(nil), raw...)
	return record, nil
}

func (store *Store) SaveState(ctx context.Context, record StateRecord) error {
	if store.db == nil {
		return ErrUnavailable
	}
	if record.UserID <= 0 {
		return errors.New("userID must be positive")
	}
	if len(record.StateJSON) == 0 || !json.Valid(record.StateJSON) {
		return errors.New("state JSON must be valid")
	}
	var object map[string]any
	if err := json.Unmarshal(record.StateJSON, &object); err != nil || object == nil {
		return errors.New("state JSON must be an object")
	}

	nowMs := time.Now().UnixMilli()
	lastTickAtMs := record.LastTickAtMs
	if lastTickAtMs < 0 {
		lastTickAtMs = 0
	}
	updatedAtMs := record.UpdatedAtMs
	if updatedAtMs <= 0 {
		updatedAtMs = nowMs
	}
	createdAt := record.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	updatedAt := record.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}

	commandTag, err := store.db.Exec(ctx,
		`INSERT INTO farm_states (
		   user_id, state_json, last_tick_at_ms, updated_at_ms, created_at, updated_at
		 ) VALUES (
		   $1, $2::jsonb, $3, $4, $5, $6
		 )
		 ON CONFLICT (user_id) DO UPDATE SET
		   state_json = excluded.state_json,
		   last_tick_at_ms = excluded.last_tick_at_ms,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_at = excluded.updated_at`,
		record.UserID,
		string(record.StateJSON),
		lastTickAtMs,
		updatedAtMs,
		createdAt,
		updatedAt,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return fmt.Errorf("farm state %d was not saved", record.UserID)
	}
	return nil
}

func (store *Store) ListDailyPurchases(ctx context.Context, userID int64, purchaseDate string) (map[string]int64, error) {
	if store.db == nil {
		return nil, ErrUnavailable
	}
	if userID <= 0 {
		return nil, errors.New("userID must be positive")
	}
	purchaseDate = strings.TrimSpace(purchaseDate)
	if purchaseDate == "" {
		return nil, errors.New("purchaseDate is required")
	}

	rows, err := store.db.Query(ctx,
		`SELECT item_key, purchase_count
		   FROM farm_daily_shop_purchases
		  WHERE user_id = $1 AND purchase_date = $2::date`,
		userID,
		purchaseDate,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]int64{}
	for rows.Next() {
		var itemKey string
		var purchaseCount int64
		if err := rows.Scan(&itemKey, &purchaseCount); err != nil {
			return nil, err
		}
		if purchaseCount < 0 {
			purchaseCount = 0
		}
		result[itemKey] = purchaseCount
	}
	return result, rows.Err()
}

func (store *Store) listStealCandidateRecords(ctx context.Context, currentUserID int64, limit int64) ([]stealCandidateRecord, error) {
	if store.db == nil {
		return nil, ErrUnavailable
	}
	if currentUserID <= 0 {
		return nil, errors.New("currentUserID must be positive")
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 200 {
		limit = 200
	}

	rows, err := store.db.Query(ctx,
		`SELECT fs.user_id,
		        fs.state_json,
		        COALESCE(NULLIF(up.display_name, ''), NULLIF(u.display_name, ''), NULLIF(u.username, ''), '') AS nickname,
		        up.avatar_url
		   FROM farm_states fs
		   LEFT JOIN users u ON u.id = fs.user_id
		   LEFT JOIN user_profiles up ON up.user_id = fs.user_id
		  WHERE fs.user_id <> $1
		    AND EXISTS (
		      SELECT 1
		        FROM jsonb_array_elements(fs.state_json->'lands') AS land
		       WHERE land->>'status' = 'mature'
		         AND land->'crop' IS NOT NULL
		         AND land->'crop' <> 'null'::jsonb
		    )
		  ORDER BY fs.updated_at_ms DESC, fs.user_id ASC
		  LIMIT $2`,
		currentUserID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []stealCandidateRecord{}
	for rows.Next() {
		var record stealCandidateRecord
		var raw []byte
		var nickname sql.NullString
		var avatarURL sql.NullString
		if err := rows.Scan(&record.UserID, &raw, &nickname, &avatarURL); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &record.State); err != nil {
			return nil, err
		}
		if record.State.UserID <= 0 {
			record.State.UserID = record.UserID
		}
		if nickname.Valid {
			record.Nickname = strings.TrimSpace(nickname.String)
		}
		if avatarURL.Valid && strings.TrimSpace(avatarURL.String) != "" {
			value := strings.TrimSpace(avatarURL.String)
			record.AvatarURL = &value
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (store *Store) getStateForUpdateTx(ctx context.Context, tx pgx.Tx, userID int64) (FarmState, bool, error) {
	if userID <= 0 {
		return FarmState{}, false, errors.New("userID must be positive")
	}
	var raw []byte
	err := tx.QueryRow(ctx,
		`SELECT state_json
		   FROM farm_states
		  WHERE user_id = $1
		  FOR UPDATE`,
		userID,
	).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return FarmState{}, false, nil
	}
	if err != nil {
		return FarmState{}, false, err
	}
	var state FarmState
	if err := json.Unmarshal(raw, &state); err != nil {
		return FarmState{}, false, err
	}
	if state.UserID <= 0 {
		state.UserID = userID
	}
	return state, true, nil
}

func (store *Store) getOrCreateStateForUpdateTx(ctx context.Context, tx pgx.Tx, userID int64, nowMs int64) (FarmState, error) {
	state, exists, err := store.getStateForUpdateTx(ctx, tx, userID)
	if err != nil {
		return FarmState{}, err
	}
	if exists {
		return state, nil
	}

	state = newInitialState(userID, nowMs)
	balance, err := store.ensureInitialPointGrantTx(ctx, tx, userID, initialPoints, nowMs)
	if err != nil {
		return FarmState{}, err
	}
	if balance > 0 {
		state.Points = balance
	}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		return FarmState{}, err
	}
	createdAt := time.UnixMilli(nowMs).UTC()
	if _, err := tx.Exec(ctx,
		`INSERT INTO farm_states (
		   user_id, state_json, last_tick_at_ms, updated_at_ms, created_at, updated_at
		 ) VALUES (
		   $1, $2::jsonb, $3, $4, $5, $5
		 )
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
		string(stateJSON),
		state.LastTickAt,
		nowMs,
		createdAt,
	); err != nil {
		return FarmState{}, err
	}
	return state, nil
}

func (store *Store) saveStateTx(ctx context.Context, tx pgx.Tx, state FarmState, nowMs int64) error {
	if state.UserID <= 0 {
		return errors.New("userID must be positive")
	}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		return err
	}
	commandTag, err := tx.Exec(ctx,
		`UPDATE farm_states
		    SET state_json = $2::jsonb,
		        last_tick_at_ms = $3,
		        updated_at_ms = $4,
		        updated_at = now()
		  WHERE user_id = $1`,
		state.UserID,
		string(stateJSON),
		state.LastTickAt,
		nowMs,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return fmt.Errorf("farm state %d was not saved", state.UserID)
	}
	return nil
}

func (store *Store) ensureInitialPointGrantTx(ctx context.Context, tx pgx.Tx, userID int64, amount int64, nowMs int64) (int64, error) {
	if userID <= 0 {
		return 0, errors.New("userID must be positive")
	}
	if amount <= 0 {
		return 0, errors.New("amount must be positive")
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
	); err != nil {
		return 0, err
	}
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&balance); err != nil {
		return 0, err
	}
	if balance > 0 {
		return balance, nil
	}
	ledgerID := fmt.Sprintf("farm_initial_%d", userID)
	commandTag, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, 'game_play', '开心农场初始积分', $3, to_timestamp($4::double precision / 1000.0))
		 ON CONFLICT (id) DO NOTHING`,
		ledgerID,
		userID,
		amount,
		nowMs,
	)
	if err != nil {
		return 0, err
	}
	if commandTag.RowsAffected() > 0 {
		balance = amount
		if _, err := tx.Exec(ctx,
			`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
			balance,
			userID,
		); err != nil {
			return 0, err
		}
	}
	return balance, nil
}

func (store *Store) addFarmPointsTx(ctx context.Context, tx pgx.Tx, userID int64, amount int64, ledgerID string, description string, nowMs int64) (int64, bool, error) {
	if userID <= 0 {
		return 0, false, errors.New("userID must be positive")
	}
	ledgerID = strings.TrimSpace(ledgerID)
	if ledgerID == "" {
		return 0, false, errors.New("ledgerID is required")
	}
	description = strings.TrimSpace(description)
	if description == "" {
		return 0, false, errors.New("description is required")
	}
	if amount < 0 {
		return 0, false, errors.New("amount must not be negative")
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
	); err != nil {
		return 0, false, err
	}
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&balance); err != nil {
		return 0, false, err
	}
	if amount == 0 {
		return balance, false, nil
	}
	nextBalance := balance + amount
	commandTag, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, 'game_play', $4, $5, to_timestamp($6::double precision / 1000.0))
		 ON CONFLICT (id) DO NOTHING`,
		ledgerID,
		userID,
		amount,
		description,
		nextBalance,
		nowMs,
	)
	if err != nil {
		return 0, false, err
	}
	applied := commandTag.RowsAffected() > 0
	if applied {
		balance = nextBalance
		if _, err := tx.Exec(ctx,
			`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
			balance,
			userID,
		); err != nil {
			return 0, false, err
		}
	}
	return balance, applied, nil
}

func (store *Store) deductFarmPointsTx(ctx context.Context, tx pgx.Tx, userID int64, amount int64, source string, description string, nowMs int64) (int64, bool, error) {
	if userID <= 0 {
		return 0, false, errors.New("userID must be positive")
	}
	source = strings.TrimSpace(source)
	if source == "" {
		return 0, false, errors.New("source is required")
	}
	description = strings.TrimSpace(description)
	if description == "" {
		return 0, false, errors.New("description is required")
	}
	if amount <= 0 {
		return 0, false, errors.New("amount must be positive")
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
	); err != nil {
		return 0, false, err
	}
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&balance); err != nil {
		return 0, false, err
	}
	if balance < amount {
		return balance, false, nil
	}
	nextBalance := balance - amount
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7::double precision / 1000.0))`,
		randomFarmLedgerID(),
		userID,
		-amount,
		source,
		description,
		nextBalance,
		nowMs,
	); err != nil {
		return 0, false, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		userID,
	); err != nil {
		return 0, false, err
	}
	return nextBalance, true, nil
}

func (store *Store) getEffectiveShopItemDefTx(ctx context.Context, tx pgx.Tx, key string) (shopItemDef, bool, error) {
	key = strings.TrimSpace(key)
	item, ok := getBaseShopItemDef(key)
	if !ok {
		return shopItemDef{}, false, nil
	}

	var cost sql.NullInt64
	var dailyLimit sql.NullInt64
	var durationMinutes sql.NullInt64
	var speedReduceMinutes sql.NullInt64
	err := tx.QueryRow(ctx,
		`SELECT cost, daily_limit, duration_minutes, speed_reduce_minutes
		   FROM farm_shop_overrides
		  WHERE key = $1`,
		key,
	).Scan(&cost, &dailyLimit, &durationMinutes, &speedReduceMinutes)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, true, nil
	}
	if err != nil {
		return shopItemDef{}, false, err
	}
	if cost.Valid {
		item.Cost = cost.Int64
	}
	if dailyLimit.Valid {
		item.DailyLimit = dailyLimit.Int64
	}
	if durationMinutes.Valid {
		item.DurationMinutes = durationMinutes.Int64
	}
	if speedReduceMinutes.Valid {
		item.SpeedReduceMinutes = speedReduceMinutes.Int64
	}
	return item, true, nil
}

func (store *Store) ListEffectiveShopItems(ctx context.Context) ([]ShopItem, error) {
	if store.db == nil {
		return nil, ErrUnavailable
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	items := make([]ShopItem, 0, len(shopItemOrder))
	for _, key := range shopItemOrder {
		item, exists, err := store.getEffectiveShopItemDefTx(ctx, tx, key)
		if err != nil {
			return nil, err
		}
		if exists {
			items = append(items, publicShopItem(item))
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return items, nil
}

func (store *Store) ListFarmStateUserIDsAfterCursor(ctx context.Context, cursor int64, limit int) ([]int64, int64, error) {
	if store.db == nil {
		return nil, 0, ErrUnavailable
	}
	if cursor < 0 {
		cursor = 0
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := store.db.Query(ctx,
		`SELECT user_id
		   FROM farm_states
		  WHERE user_id > $1
		  ORDER BY user_id ASC
		  LIMIT $2`,
		cursor,
		limit,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	userIDs := []int64{}
	for rows.Next() {
		var userID int64
		if err := rows.Scan(&userID); err != nil {
			return nil, 0, err
		}
		userIDs = append(userIDs, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	nextCursor := int64(0)
	if len(userIDs) >= limit {
		nextCursor = userIDs[len(userIDs)-1]
	}
	return userIDs, nextCursor, nil
}

func (store *Store) GetUserQQEmail(ctx context.Context, userID int64) (string, error) {
	if store.db == nil {
		return "", ErrUnavailable
	}
	if userID <= 0 {
		return "", errors.New("userID must be positive")
	}
	var qqEmail sql.NullString
	err := store.db.QueryRow(ctx,
		`SELECT qq_email
		   FROM user_profiles
		  WHERE user_id = $1`,
		userID,
	).Scan(&qqEmail)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !qqEmail.Valid {
		return "", nil
	}
	return strings.TrimSpace(qqEmail.String), nil
}

func (store *Store) ClaimMaturityEmail(ctx context.Context, userID int64, eventID string, sentAtMs int64) (bool, error) {
	if store.db == nil {
		return false, ErrUnavailable
	}
	if userID <= 0 {
		return false, errors.New("userID must be positive")
	}
	eventID = strings.TrimSpace(eventID)
	if eventID == "" {
		return false, errors.New("eventID is required")
	}
	if sentAtMs <= 0 {
		return false, errors.New("sentAtMs must be positive")
	}
	commandTag, err := store.db.Exec(ctx,
		`INSERT INTO farm_maturity_email_dedupes (user_id, event_id, sent_at_ms)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, event_id) DO NOTHING`,
		userID,
		eventID,
		sentAtMs,
	)
	if err != nil {
		return false, err
	}
	return commandTag.RowsAffected() > 0, nil
}

func (store *Store) DeleteMaturityEmailClaim(ctx context.Context, userID int64, eventID string) error {
	if store.db == nil {
		return ErrUnavailable
	}
	_, err := store.db.Exec(ctx,
		`DELETE FROM farm_maturity_email_dedupes
		  WHERE user_id = $1 AND event_id = $2`,
		userID,
		strings.TrimSpace(eventID),
	)
	return err
}

func (store *Store) ClaimWaterEmail(ctx context.Context, userID int64, landIndex int, plantedAtMs int64, nextWaterDueAtMs int64, waterMissCount int64, sentAtMs int64) (bool, error) {
	if store.db == nil {
		return false, ErrUnavailable
	}
	if userID <= 0 {
		return false, errors.New("userID must be positive")
	}
	if landIndex <= 0 {
		return false, errors.New("landIndex must be positive")
	}
	if plantedAtMs <= 0 || nextWaterDueAtMs <= 0 || sentAtMs <= 0 {
		return false, errors.New("timestamps must be positive")
	}
	if waterMissCount < 0 {
		return false, errors.New("waterMissCount must not be negative")
	}
	commandTag, err := store.db.Exec(ctx,
		`INSERT INTO farm_water_email_dedupes (
		   user_id, land_index, planted_at_ms, next_water_due_at_ms, water_miss_count, sent_at_ms
		 ) VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id, land_index, planted_at_ms, next_water_due_at_ms, water_miss_count) DO NOTHING`,
		userID,
		landIndex,
		plantedAtMs,
		nextWaterDueAtMs,
		waterMissCount,
		sentAtMs,
	)
	if err != nil {
		return false, err
	}
	return commandTag.RowsAffected() > 0, nil
}

func (store *Store) DeleteWaterEmailClaim(ctx context.Context, userID int64, landIndex int, plantedAtMs int64, nextWaterDueAtMs int64, waterMissCount int64) error {
	if store.db == nil {
		return ErrUnavailable
	}
	_, err := store.db.Exec(ctx,
		`DELETE FROM farm_water_email_dedupes
		  WHERE user_id = $1
		    AND land_index = $2
		    AND planted_at_ms = $3
		    AND next_water_due_at_ms = $4
		    AND water_miss_count = $5`,
		userID,
		landIndex,
		plantedAtMs,
		nextWaterDueAtMs,
		waterMissCount,
	)
	return err
}

func (store *Store) getDailyPurchaseCountForUpdateTx(ctx context.Context, tx pgx.Tx, userID int64, purchaseDate string, itemKey string, nowMs int64) (int64, error) {
	if userID <= 0 {
		return 0, errors.New("userID must be positive")
	}
	purchaseDate = strings.TrimSpace(purchaseDate)
	itemKey = strings.TrimSpace(itemKey)
	if purchaseDate == "" {
		return 0, errors.New("purchaseDate is required")
	}
	if itemKey == "" {
		return 0, errors.New("itemKey is required")
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO farm_daily_shop_purchases
		   (user_id, purchase_date, item_key, purchase_count, updated_at_ms)
		 VALUES ($1, $2::date, $3, 0, $4)
		 ON CONFLICT (user_id, purchase_date, item_key) DO NOTHING`,
		userID,
		purchaseDate,
		itemKey,
		nowMs,
	); err != nil {
		return 0, err
	}
	var count int64
	if err := tx.QueryRow(ctx,
		`SELECT purchase_count
		   FROM farm_daily_shop_purchases
		  WHERE user_id = $1 AND purchase_date = $2::date AND item_key = $3
		  FOR UPDATE`,
		userID,
		purchaseDate,
		itemKey,
	).Scan(&count); err != nil {
		return 0, err
	}
	if count < 0 {
		count = 0
	}
	return count, nil
}

func (store *Store) incrementDailyPurchaseTx(ctx context.Context, tx pgx.Tx, userID int64, purchaseDate string, itemKey string, qty int64, nowMs int64) error {
	if qty <= 0 {
		return errors.New("qty must be positive")
	}
	commandTag, err := tx.Exec(ctx,
		`UPDATE farm_daily_shop_purchases
		    SET purchase_count = purchase_count + $4,
		        updated_at_ms = $5,
		        updated_at = now()
		  WHERE user_id = $1 AND purchase_date = $2::date AND item_key = $3`,
		userID,
		purchaseDate,
		itemKey,
		qty,
		nowMs,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return errors.New("daily purchase row was not updated")
	}
	return nil
}

func randomFarmLedgerID() string {
	var buffer [16]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("farm_ledger_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer[:])
}
