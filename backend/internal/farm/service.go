package farm

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type Service struct {
	store *Store
}

func NewService(store *Store) *Service {
	return &Service{store: store}
}

func (service *Service) ListShopItems(ctx context.Context) ([]ShopItem, error) {
	if service == nil || service.store == nil {
		return nil, ErrUnavailable
	}
	return service.store.ListEffectiveShopItems(ctx)
}

func (service *Service) GetStatus(ctx context.Context, userID int64, nowMs int64) (StatusResponse, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return StatusResponse{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return StatusResponse{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return StatusResponse{}, err
	}
	state = normalizeState(state, nowMs)
	if _, err := service.advanceStateTx(ctx, tx, userID, &state, nowMs); err != nil {
		return StatusResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return StatusResponse{}, err
	}

	date := getChinaDateString(nowMs)
	season := getCurrentSeason(nowMs)
	weather := getWeatherForDate(date, season)
	tomorrowAtMidnight := getChinaMidnight(nowMs) + dayMs
	tomorrowSeason := getCurrentSeason(tomorrowAtMidnight)
	tomorrowDate := getChinaDateString(tomorrowAtMidnight)
	tomorrowWeather := getWeatherForDate(tomorrowDate, tomorrowSeason)
	purchases, err := service.store.ListDailyPurchases(ctx, userID, date)
	if err != nil {
		return StatusResponse{}, err
	}

	return StatusResponse{
		State:         state,
		ComputedLands: buildComputedLands(state, nowMs),
		World: WorldState{
			Date:        date,
			Weather:     weather,
			Season:      season,
			GeneratedAt: nowMs,
		},
		WeatherForecast: WeatherForecast{
			Tomorrow: WorldState{
				Date:        tomorrowDate,
				Weather:     tomorrowWeather,
				Season:      tomorrowSeason,
				GeneratedAt: nowMs,
			},
		},
		ShopDailyPurchases: purchases,
		ServerNow:          nowMs,
		PlantableCrops:     getPlantableCrops(state, season),
		NextSeasonInMs:     getNextSeasonChangeMs(nowMs),
		NextDailyInMs:      getNextDailyResetMs(nowMs),
	}, nil
}

// advanceStateTx 在已持有 farm_states 行锁的事务内推进状态（宠物被动技能、积分同步），
// 有变更时持久化，返回是否发生变更。积分入账与状态保存同事务提交，
// 避免无锁读改写覆盖并发动作或重复发放被动收菜积分。
func (service *Service) advanceStateTx(ctx context.Context, tx pgx.Tx, userID int64, state *FarmState, nowMs int64) (bool, error) {
	stateChanged := tickBasicCropState(state, nowMs)
	passiveChanged, err := service.processPassivePetSkillsTx(ctx, tx, userID, state, nowMs)
	if err != nil {
		return false, err
	}
	pointsBefore := state.Points
	if err := syncStatePointsTx(ctx, tx, userID, state); err != nil {
		return false, err
	}
	pointsChanged := state.Points != pointsBefore
	if pointsChanged {
		state.UpdatedAt = nowMs
	}
	changed := stateChanged || passiveChanged || pointsChanged
	if changed {
		if err := service.store.saveStateTx(ctx, tx, *state, nowMs); err != nil {
			return false, err
		}
	}
	return changed, nil
}

// advanceUserStateLocked 对已存在的农场状态加锁推进并提交，状态不存在时返回 false。
func (service *Service) advanceUserStateLocked(ctx context.Context, userID int64, nowMs int64) (FarmState, bool, error) {
	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return FarmState{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, exists, err := service.store.getStateForUpdateTx(ctx, tx, userID)
	if err != nil || !exists {
		return FarmState{}, false, err
	}
	state = normalizeState(state, nowMs)
	if _, err := service.advanceStateTx(ctx, tx, userID, &state, nowMs); err != nil {
		return FarmState{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return FarmState{}, false, err
	}
	return state, true, nil
}

func (service *Service) processPassivePetSkillsTx(ctx context.Context, tx pgx.Tx, userID int64, state *FarmState, nowMs int64) (bool, error) {
	changed := false
	total, count, ledgerID, harvested := processPassivePetHarvest(state, nowMs)
	if harvested {
		balance := state.Points
		if total > 0 {
			nextBalance, _, err := service.store.addFarmPointsTx(
				ctx,
				tx,
				userID,
				total,
				ledgerID,
				fmt.Sprintf("宠物被动收菜: %d 块", count),
				nowMs,
			)
			if err != nil {
				return false, err
			}
			balance = nextBalance
		}
		if !bonusFlag(state.Bonuses, "firstHarvest") {
			state.Bonuses = setBonusFlag(state.Bonuses, "firstHarvest", true)
			nextBalance, _, err := service.store.addFarmPointsTx(
				ctx,
				tx,
				userID,
				firstHarvestBonus,
				fmt.Sprintf("farm_first_harvest_%d", userID),
				"农场首次收获奖励",
				nowMs,
			)
			if err != nil {
				return false, err
			}
			balance = nextBalance
		}
		state.Points = balance
		changed = true
	}
	if processPassivePetPlant(state, nowMs) {
		changed = true
	}
	if changed {
		state.LastTickAt = nowMs
		state.UpdatedAt = nowMs
	}
	return changed, nil
}

var timeNowMs = func() int64 {
	return timeNow().UnixMilli()
}

var timeNow = func() time.Time {
	return time.Now()
}
