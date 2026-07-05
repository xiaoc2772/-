package economy

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrStoreItemNotFound     = errors.New("store item not found")
	ErrStoreCategoryNotFound = errors.New("store category not found")
)

func (service *Service) GetStoreAdmin(ctx context.Context) (StoreAdminData, error) {
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return StoreAdminData{}, err
	}
	defer rollbackSilently(ctx, tx)

	categories, err := listStoreCategories(ctx, tx, true)
	if err != nil {
		return StoreAdminData{}, err
	}
	items, err := listStoreItems(ctx, tx, true)
	if err != nil {
		return StoreAdminData{}, err
	}
	farmItems, err := listFarmShopItems(ctx, tx)
	if err != nil {
		return StoreAdminData{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return StoreAdminData{}, err
	}
	return StoreAdminData{
		Items:      items,
		Categories: categories,
		FarmItems:  farmItems,
	}, nil
}

func (service *Service) SaveStoreCategory(ctx context.Context, input StoreCategoryMutationInput) (*StoreCategory, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.Name = strings.TrimSpace(input.Name)
	input.Color = strings.TrimSpace(input.Color)

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer rollbackSilently(ctx, tx)

	var category StoreCategory
	if input.ID == "" {
		input.ID = randomID()
		category, err = queryStoreCategory(ctx, tx,
			`INSERT INTO store_categories (id, name, color, sort_order, enabled, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, now(), now())
			 RETURNING id, name, color, sort_order, enabled, created_at, updated_at`,
			input.ID,
			input.Name,
			input.Color,
			input.SortOrder,
			input.Enabled,
		)
		if err != nil {
			return nil, err
		}
	} else {
		category, err = queryStoreCategory(ctx, tx,
			`UPDATE store_categories
			 SET name = $2, color = $3, sort_order = $4, enabled = $5, updated_at = now()
			 WHERE id = $1
			 RETURNING id, name, color, sort_order, enabled, created_at, updated_at`,
			input.ID,
			input.Name,
			input.Color,
			input.SortOrder,
			input.Enabled,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrStoreCategoryNotFound
		}
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &category, nil
}

func (service *Service) CreateStoreItem(ctx context.Context, input StoreItemMutationInput) (*StoreItem, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.Type = strings.TrimSpace(input.Type)
	input.CategoryID = strings.TrimSpace(input.CategoryID)

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer rollbackSilently(ctx, tx)

	if ok, err := storeCategoryExists(ctx, tx, input.CategoryID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrStoreCategoryNotFound
	}

	id := randomID()
	item, err := queryStoreItem(ctx, tx,
		`INSERT INTO store_items
		   (id, name, description, type, category_id, points_cost, value, daily_limit, sort_order, enabled, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
		 RETURNING id, name, description, type, COALESCE(category_id, ''),
		           points_cost, value, daily_limit, total_stock, purchase_count,
		           sort_order, enabled, created_at, updated_at`,
		id,
		input.Name,
		input.Description,
		input.Type,
		input.CategoryID,
		input.PointsCost,
		input.Value,
		optionalInt64(input.DailyLimit),
		input.SortOrder,
		input.Enabled,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &item, nil
}

func (service *Service) UpdateStoreItem(ctx context.Context, input StoreItemUpdateInput) (*StoreItem, error) {
	input.ID = strings.TrimSpace(input.ID)

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer rollbackSilently(ctx, tx)

	item, err := getStoreItemForUpdate(ctx, tx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrStoreItemNotFound
	}
	if err != nil {
		return nil, err
	}

	if input.Name != nil {
		item.Name = strings.TrimSpace(*input.Name)
	}
	if input.Description != nil {
		item.Description = strings.TrimSpace(*input.Description)
	}
	if input.Type != nil {
		item.Type = strings.TrimSpace(*input.Type)
	}
	if input.CategoryID != nil {
		categoryID := strings.TrimSpace(*input.CategoryID)
		if ok, err := storeCategoryExists(ctx, tx, categoryID); err != nil {
			return nil, err
		} else if !ok {
			return nil, ErrStoreCategoryNotFound
		}
		item.CategoryID = categoryID
	}
	if input.PointsCost != nil {
		item.PointsCost = *input.PointsCost
	}
	if input.Value != nil {
		item.Value = *input.Value
	}
	if input.DailyLimitSet {
		item.DailyLimit = input.DailyLimit
	}
	if input.SortOrder != nil {
		item.SortOrder = *input.SortOrder
	}
	if input.Enabled != nil {
		item.Enabled = *input.Enabled
	}

	updated, err := queryStoreItem(ctx, tx,
		`UPDATE store_items
		 SET name = $2,
		     description = $3,
		     type = $4,
		     category_id = $5,
		     points_cost = $6,
		     value = $7,
		     daily_limit = $8,
		     sort_order = $9,
		     enabled = $10,
		     updated_at = now()
		 WHERE id = $1
		 RETURNING id, name, description, type, COALESCE(category_id, ''),
		           points_cost, value, daily_limit, total_stock, purchase_count,
		           sort_order, enabled, created_at, updated_at`,
		item.ID,
		item.Name,
		item.Description,
		item.Type,
		optionalText(item.CategoryID),
		item.PointsCost,
		item.Value,
		optionalInt64(item.DailyLimit),
		item.SortOrder,
		item.Enabled,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &updated, nil
}

func (service *Service) DeleteStoreItem(ctx context.Context, itemID string) (bool, error) {
	itemID = strings.TrimSpace(itemID)
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, err
	}
	defer rollbackSilently(ctx, tx)

	if _, err := tx.Exec(ctx, `DELETE FROM store_daily_purchases WHERE item_id = $1`, itemID); err != nil {
		return false, err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM store_items WHERE id = $1`, itemID)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func queryStoreItem(ctx context.Context, tx pgx.Tx, sql string, args ...any) (StoreItem, error) {
	return scanStoreItem(tx.QueryRow(ctx, sql, args...))
}

func queryStoreCategory(ctx context.Context, tx pgx.Tx, sql string, args ...any) (StoreCategory, error) {
	return scanStoreCategory(tx.QueryRow(ctx, sql, args...))
}

type storeCategoryScanner interface {
	Scan(dest ...any) error
}

func scanStoreCategory(scanner storeCategoryScanner) (StoreCategory, error) {
	var category StoreCategory
	var createdAt time.Time
	var updatedAt time.Time
	if err := scanner.Scan(
		&category.ID,
		&category.Name,
		&category.Color,
		&category.SortOrder,
		&category.Enabled,
		&createdAt,
		&updatedAt,
	); err != nil {
		return StoreCategory{}, err
	}
	category.CreatedAt = millis(createdAt)
	category.UpdatedAt = millis(updatedAt)
	return category, nil
}

func storeCategoryExists(ctx context.Context, tx pgx.Tx, categoryID string) (bool, error) {
	if strings.TrimSpace(categoryID) == "" {
		return false, nil
	}
	var exists bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM store_categories WHERE id = $1)`, categoryID).Scan(&exists)
	return exists, err
}

func optionalInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func optionalText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}
