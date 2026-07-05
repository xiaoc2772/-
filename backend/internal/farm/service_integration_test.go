//go:build integration

package farm

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServiceBuildsStatusFromPostgresState(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(99472)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_99472', 'farm_99472', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 777, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	nowMs := time.Date(2026, 6, 23, 2, 30, 0, 0, time.UTC).UnixMilli()
	stateJSON := []byte(`{
		"userId":99472,
		"points":321,
		"lands":[
			{"index":1,"status":"growing","crop":{"cropId":"wheat","plantedAt":1782178200000,"matureAt":1782189000000,"lastWaterAt":1782178200000,"nextWaterDueAt":1782180000000,"waterMissCount":0,"fertilizer":null,"plantedSeason":"spring","weatherAtPlant":"sunny","birdNetUntil":null,"stolenAmount":0,"stolenCount":0,"speedUsed":0,"speedReducedMinutes":0}},
			{"index":2,"status":"empty","crop":null},
			{"index":3,"status":"empty","crop":null},
			{"index":4,"status":"empty","crop":null},
			{"index":5,"status":"locked","crop":null},
			{"index":6,"status":"locked","crop":null},
			{"index":7,"status":"locked","crop":null},
			{"index":8,"status":"locked","crop":null}
		],
		"scarecrowUntil":null,
		"bellUntil":null,
		"pet":null,
		"stolenTodayCount":0,
		"stolenByMap":{},
		"myStealMap":{},
		"inventory":{},
		"purchasedSkillBooks":{},
		"seedInventory":{},
		"events":[],
		"lastDailyResetAt":0,
		"lastSeasonProcessedAt":0,
		"lastTickAt":0,
		"bonuses":{"firstWater":false,"firstHarvest":false,"firstAdopt":false},
		"createdAt":1782178200000,
		"updatedAt":1782178200000
	}`)
	store := NewStore(db)
	if err := store.SaveState(ctx, StateRecord{UserID: userID, StateJSON: stateJSON, LastTickAtMs: nowMs, UpdatedAtMs: nowMs}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO farm_daily_shop_purchases
		   (user_id, purchase_date, item_key, purchase_count, updated_at_ms)
		 VALUES ($1, '2026-06-23', 'pet_food_normal', 2, $2)`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("insert daily purchase failed: %v", err)
	}

	status, err := NewService(store).GetStatus(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	if status.State.UserID != userID || status.State.Points != 777 {
		t.Fatalf("unexpected state in status: %+v", status.State)
	}
	if status.World.Date != "2026-06-23" || status.World.GeneratedAt != nowMs {
		t.Fatalf("unexpected world state: %+v", status.World)
	}
	if status.ShopDailyPurchases["pet_food_normal"] != 2 {
		t.Fatalf("unexpected daily purchases: %+v", status.ShopDailyPurchases)
	}
	if len(status.ComputedLands) != 8 || status.ComputedLands[0].Status != LandStatusThirsty {
		t.Fatalf("unexpected computed lands: %+v", status.ComputedLands)
	}
	if status.ComputedLands[0].Stage == nil || *status.ComputedLands[0].Stage != CropStageSprout {
		t.Fatalf("unexpected computed crop stage: %+v", status.ComputedLands[0].Stage)
	}
	if len(status.PlantableCrops) == 0 {
		t.Fatalf("expected plantable crops")
	}
	record, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read synced state failed: %v", err)
	}
	var synced struct {
		Points int64 `json:"points"`
	}
	if err := json.Unmarshal(record.StateJSON, &synced); err != nil {
		t.Fatalf("decode synced state failed: %v", err)
	}
	if synced.Points != 777 {
		t.Fatalf("expected synced state points 777, got %d", synced.Points)
	}
	var persistedState FarmState
	if err := json.Unmarshal(record.StateJSON, &persistedState); err != nil {
		t.Fatalf("decode persisted farm state failed: %v", err)
	}
	if persistedState.Lands[0].Status != LandStatusThirsty || persistedState.Lands[0].Crop == nil || persistedState.Lands[0].Crop.WaterMissCount == 0 {
		t.Fatalf("expected basic tick to persist thirsty state: %+v", persistedState.Lands[0])
	}

	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal status failed: %v", err)
	}
	if !json.Valid(raw) {
		t.Fatalf("status json is invalid: %s", string(raw))
	}
}

func TestServiceProcessMaturityEmailsSendsAndDedupes(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(99512)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_email_99512', 'farm_email_99512', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_profiles (user_id, qq_email, updated_at_ms)
		 VALUES ($1, '123456@qq.com', $2)`,
		userID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("insert user profile failed: %v", err)
	}

	nowMs := time.Date(2026, 6, 25, 8, 0, 0, 0, time.UTC).UnixMilli()
	matureAt := nowMs - 60_000
	stateJSON := []byte(fmt.Sprintf(`{
		"userId":%d,
		"points":100,
		"lands":[
			{"index":1,"status":"mature","crop":{"cropId":"wheat","plantedAt":%d,"matureAt":%d,"lastWaterAt":%d,"nextWaterDueAt":%d,"waterMissCount":0,"fertilizer":null,"plantedSeason":"spring","weatherAtPlant":"sunny","birdNetUntil":null,"stolenAmount":0,"stolenCount":0,"speedUsed":0,"speedReducedMinutes":0}},
			{"index":2,"status":"empty","crop":null},
			{"index":3,"status":"empty","crop":null},
			{"index":4,"status":"empty","crop":null}
		],
		"scarecrowUntil":null,
		"bellUntil":null,
		"pet":{"type":"rabbit","name":"团子","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":70,"thirst":80,"hydrationVersion":2,"health":90,"learnedSkills":[],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"stealTarget":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":%d},
		"stolenTodayCount":0,
		"stolenByMap":{},
		"myStealMap":{},
		"inventory":{},
		"purchasedSkillBooks":{},
		"seedInventory":{},
		"events":[{"id":"event-mature-99512","ts":%d,"type":"mature","text":"小麦 成熟了，快去收获","cropId":"wheat","landIndex":1}],
		"lastDailyResetAt":0,
		"lastSeasonProcessedAt":%d,
		"lastTickAt":%d,
		"bonuses":{"firstWater":false,"firstHarvest":false,"firstAdopt":false},
		"createdAt":%d,
		"updatedAt":%d
	}`, userID, nowMs-30*60*1000, matureAt, nowMs-30*60*1000, nowMs-15*60*1000, nowMs, matureAt, nowMs, nowMs, nowMs-30*60*1000, nowMs))

	store := NewStore(db)
	if err := store.SaveState(ctx, StateRecord{UserID: userID, StateJSON: stateJSON, LastTickAtMs: nowMs, UpdatedAtMs: nowMs}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}

	sender := &recordingFarmEmailSender{configured: true}
	first, err := NewService(store).ProcessMaturityEmails(ctx, MaturityEmailScanInput{
		MaxUsers: 1,
		Cursor:   userID - 1,
		Sender:   sender,
		NowMs:    nowMs,
	})
	if err != nil {
		t.Fatalf("process maturity emails failed: %v", err)
	}
	if first.CheckedEvents != 1 || first.Sent != 1 || first.Skipped != 0 || first.Failed != 0 {
		t.Fatalf("unexpected first result: %+v", first)
	}
	if len(sender.maturityInputs) != 1 || sender.maturityInputs[0].To != "123456@qq.com" || sender.maturityInputs[0].CropName != "小麦" {
		t.Fatalf("unexpected maturity email inputs: %+v", sender.maturityInputs)
	}

	second, err := NewService(store).ProcessMaturityEmails(ctx, MaturityEmailScanInput{
		MaxUsers: 1,
		Cursor:   userID - 1,
		Sender:   sender,
		NowMs:    nowMs,
	})
	if err != nil {
		t.Fatalf("process maturity emails second pass failed: %v", err)
	}
	if second.CheckedEvents != 1 || second.Sent != 0 || second.Skipped != 1 || second.Failed != 0 {
		t.Fatalf("unexpected second result: %+v", second)
	}
	if len(sender.maturityInputs) != 1 {
		t.Fatalf("second pass should be deduped, got sends=%d", len(sender.maturityInputs))
	}
}

func TestServiceCreatesInitialStateWhenMissing(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(99473)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_99473', 'farm_99473', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	nowMs := time.Date(2026, 6, 23, 2, 30, 0, 0, time.UTC).UnixMilli()
	status, err := NewService(NewStore(db)).GetStatus(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get status should create initial state: %v", err)
	}
	if status.State.UserID != userID || status.State.Points != initialPoints {
		t.Fatalf("unexpected initial state: %+v", status.State)
	}
	if len(status.State.Lands) != maxLandCount || status.State.Lands[0].Status != LandStatusEmpty || status.State.Lands[4].Status != LandStatusLocked {
		t.Fatalf("unexpected initial lands: %+v", status.State.Lands)
	}
	if len(status.ComputedLands) != maxLandCount || len(status.PlantableCrops) == 0 {
		t.Fatalf("unexpected initial status: %+v", status)
	}

	record, err := NewStore(db).GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read created state failed: %v", err)
	}
	if !record.Exists {
		t.Fatalf("expected created farm state to be persisted")
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read initial point account failed: %v", err)
	}
	if balance != initialPoints {
		t.Fatalf("expected initial point balance %d, got %d", initialPoints, balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND id = $2 AND amount = $3 AND source = 'game_play' AND description = '开心农场初始积分'`,
		userID,
		fmt.Sprintf("farm_initial_%d", userID),
		initialPoints,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read initial point ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected exactly one initial point ledger, got %d", ledgerCount)
	}
}

func TestServiceExecutePlantPersistsState(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99482)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_plant")

	result, err := NewService(NewStore(db)).ExecutePlant(ctx, userID, 0, CropWheat, nowMs)
	if err != nil {
		t.Fatalf("execute plant failed: %v", err)
	}
	if !result.OK || result.Balance != initialPoints {
		t.Fatalf("unexpected plant result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, NewStore(db), userID)
	if persisted.Lands[0].Status != LandStatusGrowing || persisted.Lands[0].Crop == nil || persisted.Lands[0].Crop.CropID != CropWheat {
		t.Fatalf("expected persisted wheat crop, got %+v", persisted.Lands[0])
	}
	if decodeIntMap(persisted.SeedInventory)["wheat"] != 3 {
		t.Fatalf("expected persisted seed consumption, got %s", string(persisted.SeedInventory))
	}
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != initialPoints {
		t.Fatalf("expected initial point balance %d, got %d", initialPoints, balance)
	}
}

func TestServiceExecuteWaterPersistsStateAndBonus(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99483)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_water")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Bonuses = json.RawMessage(`{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`)
	state.Lands[0].Status = LandStatusThirsty
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs - 1,
		WaterMissCount: 1,
		PlantedSeason:  SeasonSpring,
		WeatherAtPlant: WeatherSunny,
	}
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteWater(ctx, userID, 0, nowMs)
	if err != nil {
		t.Fatalf("execute water failed: %v", err)
	}
	if !result.OK || result.Bonus != firstWaterBonus || result.Balance != 100+firstWaterBonus {
		t.Fatalf("unexpected water result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	if persisted.Lands[0].Status != LandStatusGrowing || persisted.Lands[0].Crop == nil || persisted.Lands[0].Crop.LastWaterAt != nowMs {
		t.Fatalf("expected persisted watered crop, got %+v", persisted.Lands[0])
	}
	if persisted.Points != 100+firstWaterBonus || !bonusFlag(persisted.Bonuses, "firstWater") {
		t.Fatalf("expected persisted bonus state, points=%d bonuses=%s", persisted.Points, string(persisted.Bonuses))
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != 100+firstWaterBonus {
		t.Fatalf("expected point balance %d, got %d", 100+firstWaterBonus, balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND id = $2 AND amount = $3 AND description = '农场首次浇水奖励'`,
		userID,
		fmt.Sprintf("farm_first_water_%d", userID),
		firstWaterBonus,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read first water ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one first water ledger, got %d", ledgerCount)
	}
}

func TestServiceExecuteWaterAllPersistsEligibleCrops(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99484)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_water_all")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	for index := 0; index < 3; index++ {
		state.Lands[index].Status = LandStatusGrowing
		state.Lands[index].Crop = &CropInstance{
			CropID:         CropWheat,
			PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
			MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
			LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
			NextWaterDueAt: nowMs - 1,
			PlantedSeason:  SeasonSpring,
			WeatherAtPlant: WeatherSunny,
		}
	}
	state.Lands[1].Status = LandStatusThirsty
	state.Lands[2].Status = LandStatusMature
	state.Lands[2].Crop.MatureAt = nowMs - 1
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteWaterAll(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("execute water-all failed: %v", err)
	}
	if !result.OK || result.Count != 2 {
		t.Fatalf("unexpected water-all result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	for _, index := range []int{0, 1} {
		if persisted.Lands[index].Status != LandStatusGrowing || persisted.Lands[index].Crop == nil || persisted.Lands[index].Crop.LastWaterAt != nowMs {
			t.Fatalf("expected persisted land %d watered, got %+v", index, persisted.Lands[index])
		}
	}
	if persisted.Lands[2].Status != LandStatusMature || persisted.Lands[2].Crop == nil || persisted.Lands[2].Crop.LastWaterAt == nowMs {
		t.Fatalf("expected mature land unchanged, got %+v", persisted.Lands[2])
	}
}

func TestServiceExecuteHarvestPersistsStateAndPoints(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99485)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_harvest")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Bonuses = json.RawMessage(`{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`)
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs,
		WaterMissCount: 0,
		PlantedSeason:  SeasonSpring,
		WeatherAtPlant: WeatherSunny,
	}
	expectedHarvest, ok := buildHarvestResult(state, 0, nowMs)
	if !ok {
		t.Fatalf("expected harvest fixture")
	}
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteHarvest(ctx, userID, 0, nowMs)
	if err != nil {
		t.Fatalf("execute harvest failed: %v", err)
	}
	expectedBalance := int64(100) + expectedHarvest.FinalYield + firstHarvestBonus
	if !result.OK || result.Harvest == nil || result.Harvest.FinalYield != expectedHarvest.FinalYield || result.Bonus != firstHarvestBonus || result.Balance != expectedBalance {
		t.Fatalf("unexpected harvest result: %+v harvest=%+v expected=%+v", result, result.Harvest, expectedHarvest)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	if persisted.Lands[0].Status != LandStatusEmpty || persisted.Lands[0].Crop != nil || persisted.Points != expectedBalance || !bonusFlag(persisted.Bonuses, "firstHarvest") {
		t.Fatalf("unexpected persisted harvest state: land=%+v points=%d bonuses=%s", persisted.Lands[0], persisted.Points, string(persisted.Bonuses))
	}
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != expectedBalance {
		t.Fatalf("expected point balance %d, got %d", expectedBalance, balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND (description LIKE '农场收获: 小麦（%' OR description = '农场首次收获奖励')`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read harvest ledgers failed: %v", err)
	}
	if ledgerCount != 2 {
		t.Fatalf("expected harvest and first harvest ledgers, got %d", ledgerCount)
	}
}

func TestServiceExecuteHarvestAllPersistsStateAndPoints(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99486)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_harvest_all")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Bonuses = json.RawMessage(`{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`)
	birdNetUntil := nowMs + 1
	for index := 0; index < 2; index++ {
		state.Lands[index].Status = LandStatusMature
		state.Lands[index].Crop = &CropInstance{
			CropID:         CropWheat,
			PlantedAt:      nowMs - int64(time.Duration(index+1)*time.Hour/time.Millisecond),
			MatureAt:       nowMs - 1,
			LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
			NextWaterDueAt: nowMs,
			WaterMissCount: 0,
			PlantedSeason:  SeasonSpring,
			WeatherAtPlant: WeatherSunny,
			BirdNetUntil:   &birdNetUntil,
		}
	}
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteHarvestAll(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("execute harvest-all failed: %v", err)
	}
	expectedBalance := int64(100) + result.Total + firstHarvestBonus
	if !result.OK || len(result.Harvests) != 2 || result.Total <= 0 || result.Bonus != firstHarvestBonus || result.Balance != expectedBalance {
		t.Fatalf("unexpected harvest-all result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	for _, index := range []int{0, 1} {
		if persisted.Lands[index].Status != LandStatusEmpty || persisted.Lands[index].Crop != nil {
			t.Fatalf("expected land %d empty after harvest-all, got %+v", index, persisted.Lands[index])
		}
	}
	if persisted.Points != expectedBalance || !bonusFlag(persisted.Bonuses, "firstHarvest") {
		t.Fatalf("unexpected persisted harvest-all points=%d bonuses=%s", persisted.Points, string(persisted.Bonuses))
	}
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != expectedBalance {
		t.Fatalf("expected point balance %d, got %d", expectedBalance, balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND (description = '农场一键收获: 2 块' OR description = '农场首次收获奖励')`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read harvest-all ledgers failed: %v", err)
	}
	if ledgerCount != 2 {
		t.Fatalf("expected harvest-all and first harvest ledgers, got %d", ledgerCount)
	}
}

func TestServiceExecuteRemovePersistsClearedLand(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99487)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_remove")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Lands[0].Status = LandStatusWithered
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs,
		PlantedSeason:  SeasonSpring,
		WeatherAtPlant: WeatherSunny,
	}
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteRemove(ctx, userID, 0, nowMs)
	if err != nil {
		t.Fatalf("execute remove failed: %v", err)
	}
	if !result.OK || result.Balance != 100 {
		t.Fatalf("unexpected remove result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	if persisted.Lands[0].Status != LandStatusEmpty || persisted.Lands[0].Crop != nil {
		t.Fatalf("expected cleared land, got %+v", persisted.Lands[0])
	}
}

func TestServiceExecuteBuySeedsPersistsInventoryAndPoints(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99488)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_buy_seeds")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.SeedInventory = json.RawMessage(`{"wheat":4}`)
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteBuySeeds(ctx, userID, CropWheat, 3, nowMs)
	if err != nil {
		t.Fatalf("execute buy seeds failed: %v", err)
	}
	if !result.OK || result.Balance != 85 {
		t.Fatalf("unexpected buy seeds result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	if persisted.Points != 85 || decodeIntMap(persisted.SeedInventory)["wheat"] != 7 {
		t.Fatalf("unexpected persisted buy seeds state: points=%d seeds=%s", persisted.Points, string(persisted.SeedInventory))
	}
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != 85 {
		t.Fatalf("expected point balance 85, got %d", balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND amount = -15 AND source = 'exchange' AND description = '农场购买种子: 小麦 x3' AND balance_after = 85`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read buy seeds ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one buy seeds ledger, got %d", ledgerCount)
	}
}

func TestServiceExecuteBuyLandPersistsLandAndPoints(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99489)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_buy_land")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteBuyLand(ctx, userID, 5, nowMs)
	if err != nil {
		t.Fatalf("execute buy land failed: %v", err)
	}
	if !result.OK || result.Balance != 50 {
		t.Fatalf("unexpected buy land result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	if persisted.Points != 50 || persisted.Lands[4].Status != LandStatusEmpty {
		t.Fatalf("unexpected persisted buy land state: points=%d land=%+v", persisted.Points, persisted.Lands[4])
	}
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != 50 {
		t.Fatalf("expected point balance 50, got %d", balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND amount = -50 AND source = 'exchange' AND description = '农场购买第 5 块土地' AND balance_after = 50`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read buy land ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one buy land ledger, got %d", ledgerCount)
	}
}

func TestServiceExecuteBuyShopItemPersistsInventoryPointsAndDailyCount(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99490)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_buy_shop")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteBuyShopItem(ctx, userID, "pet_food_normal", 2, nowMs)
	if err != nil {
		t.Fatalf("execute buy shop item failed: %v", err)
	}
	if !result.OK || result.Balance != 70 {
		t.Fatalf("unexpected buy shop item result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	inventory := decodeInventory(persisted.Inventory)
	if persisted.Points != 70 || inventory["pet_food_normal"].Count != 2 {
		t.Fatalf("unexpected persisted shop buy state: points=%d inventory=%+v", persisted.Points, inventory)
	}
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != 70 {
		t.Fatalf("expected point balance 70, got %d", balance)
	}
	var purchaseCount int64
	if err := db.QueryRow(ctx,
		`SELECT purchase_count
		   FROM farm_daily_shop_purchases
		  WHERE user_id = $1 AND purchase_date = '2025-01-06'::date AND item_key = 'pet_food_normal'`,
		userID,
	).Scan(&purchaseCount); err != nil {
		t.Fatalf("read daily purchase count failed: %v", err)
	}
	if purchaseCount != 2 {
		t.Fatalf("expected daily purchase count 2, got %d", purchaseCount)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND amount = -30 AND source = 'exchange' AND description = '农场购买: 普通宠粮 x2' AND balance_after = 70`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read shop buy ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one shop buy ledger, got %d", ledgerCount)
	}
}

func TestServiceExecuteUseShopItemPersistsState(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99491)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_use_shop")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Lands[0].Status = LandStatusGrowing
	state.Lands[0].Crop = &CropInstance{
		CropID:              CropWheat,
		PlantedAt:           nowMs,
		MatureAt:            nowMs + computeActualGrowthMs(CropWheat, SeasonSpring),
		LastWaterAt:         nowMs,
		NextWaterDueAt:      nowMs + 30*60*1000,
		PlantedSeason:       SeasonSpring,
		WeatherAtPlant:      WeatherSunny,
		SpeedUsed:           0,
		SpeedReducedMinutes: 0,
	}
	addToInventory(&state, "fert_normal", 1, nowMs)
	previousMatureAt := state.Lands[0].Crop.MatureAt
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	plotIndex := 0
	result, err := NewService(store).ExecuteUseShopItem(ctx, userID, "fert_normal", &plotIndex, nowMs)
	if err != nil {
		t.Fatalf("execute use shop item failed: %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected use shop item result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	inventory := decodeInventory(persisted.Inventory)
	if inventory["fert_normal"].Count != 0 {
		t.Fatalf("expected fertilizer consumed, inventory=%+v", inventory)
	}
	if persisted.Lands[0].Crop == nil || persisted.Lands[0].Crop.Fertilizer == nil || *persisted.Lands[0].Crop.Fertilizer != "normal" {
		t.Fatalf("expected normal fertilizer persisted, land=%+v", persisted.Lands[0])
	}
	if persisted.Lands[0].Crop.MatureAt >= previousMatureAt {
		t.Fatalf("expected matureAt reduced, previous=%d got=%d", previousMatureAt, persisted.Lands[0].Crop.MatureAt)
	}
}

func TestServiceExecuteAdoptPetPersistsPetAndFirstBonus(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99492)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_adopt_pet")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteAdoptPet(ctx, userID, "red_panda", " 小红 ", nowMs)
	if err != nil {
		t.Fatalf("execute adopt pet failed: %v", err)
	}
	if !result.OK || result.Balance != 110 || result.Bonus != firstAdoptBonus {
		t.Fatalf("unexpected adopt pet result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	pet := decodePetForTest(t, persisted.Pet)
	if pet["type"] != "red_panda" || pet["name"] != "小红" {
		t.Fatalf("unexpected persisted pet: %+v", pet)
	}
	if persisted.Points != 110 || !bonusFlag(persisted.Bonuses, "firstAdopt") {
		t.Fatalf("unexpected persisted adopt points=%d bonuses=%s", persisted.Points, string(persisted.Bonuses))
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND amount = 10 AND source = 'game_play' AND description = '农场首次领养奖励' AND balance_after = 110`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read adopt ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one adopt ledger, got %d", ledgerCount)
	}
}

func TestServiceExecuteFeedPetPersistsPetAndInventory(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99493)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_feed_pet")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Pet = newPetJSON("cat", "小咪", nowMs)
	addToInventory(&state, "pet_food_normal", 1, nowMs)
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteFeedPet(ctx, userID, "normal", nowMs)
	if err != nil {
		t.Fatalf("execute feed pet failed: %v", err)
	}
	if !result.OK || result.Balance != 100 {
		t.Fatalf("unexpected feed pet result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	pet := decodePetForTest(t, persisted.Pet)
	feedToday := pet["feedToday"].(map[string]any)
	if feedToday["normal"].(float64) != 1 || pet["growth"].(float64) != 5 {
		t.Fatalf("unexpected persisted pet after feed: %+v", pet)
	}
	if decodeInventory(persisted.Inventory)["pet_food_normal"].Count != 0 {
		t.Fatalf("expected food consumed, inventory=%s", string(persisted.Inventory))
	}
}

func TestServiceExecuteUsePetItemPersistsPetAndInventory(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99494)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_pet_item")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Pet = newPetJSON("cat", "小咪", nowMs)
	addToInventory(&state, "pet_milk", 1, nowMs)
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteUsePetItem(ctx, userID, "pet_milk", "drink", nowMs)
	if err != nil {
		t.Fatalf("execute use pet item failed: %v", err)
	}
	if !result.OK || result.Balance != 100 {
		t.Fatalf("unexpected use pet item result: %+v", result)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	pet := decodePetForTest(t, persisted.Pet)
	if pet["thirst"].(float64) != 100 || pet["growth"].(float64) != 3 {
		t.Fatalf("unexpected persisted pet after item: %+v", pet)
	}
	if decodeInventory(persisted.Inventory)["pet_milk"].Count != 0 {
		t.Fatalf("expected milk consumed, inventory=%s", string(persisted.Inventory))
	}
}

func TestServicePersistsFridayEventTick(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := fridayNoonUTC()
	userID := findFridayEventUserInRange(t, nowMs, 1, 99500, 99999)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_friday', 'farm_friday', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Events = json.RawMessage(`[]`)
	state.LastFridayEventDate = ""
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal state failed: %v", err)
	}
	store := NewStore(db)
	if err := store.SaveState(ctx, StateRecord{UserID: userID, StateJSON: stateJSON, LastTickAtMs: nowMs - 60*60*1000, UpdatedAtMs: nowMs - 60*60*1000}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}

	status, err := NewService(store).GetStatus(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	if status.State.LastFridayEventDate != "2025-01-10" {
		t.Fatalf("expected friday event date to be persisted in response, got %s", status.State.LastFridayEventDate)
	}
	inventory := decodeInventory(status.State.Inventory)
	if inventory["fert_normal"].Count != 1 {
		t.Fatalf("expected friday event inventory grant, got %+v", inventory)
	}

	record, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read persisted state failed: %v", err)
	}
	var persisted FarmState
	if err := json.Unmarshal(record.StateJSON, &persisted); err != nil {
		t.Fatalf("decode persisted state failed: %v", err)
	}
	if persisted.LastFridayEventDate != "2025-01-10" || decodeInventory(persisted.Inventory)["fert_normal"].Count != 1 {
		t.Fatalf("unexpected persisted friday state: %+v inventory=%s", persisted, string(persisted.Inventory))
	}
}

func TestServicePersistsPetLazyTick(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 10, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99474)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_pet', 'farm_pet', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.LastDailyResetAt = nowMs - 24*60*60*1000
	state.LastTickAt = nowMs - 2*60*60*1000
	state.Pet = json.RawMessage(`{"type":"cat","name":"奶糖","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":10,"thirst":80,"hydrationVersion":2,"health":85,"currentTask":"guard","taskStartAt":1,"taskEndAt":9999999999999,"cooldownEndAt":9999999999999,"feedToday":{"normal":2,"premium":1},"washToday":1,"waterToday":2,"playToday":2,"toyToday":1,"dailyResetAt":1736380800000}`)
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal state failed: %v", err)
	}
	store := NewStore(db)
	if err := store.SaveState(ctx, StateRecord{UserID: userID, StateJSON: stateJSON, LastTickAtMs: state.LastTickAt, UpdatedAtMs: state.LastTickAt}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}

	status, err := NewService(store).GetStatus(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	pet := decodePetForTest(t, status.State.Pet)
	if pet["currentTask"] != nil {
		t.Fatalf("expected low mood guard task cleared, got %+v", pet)
	}
	if status.State.LastDailyResetAt != nowMs {
		t.Fatalf("expected daily reset persisted in response, got %d", status.State.LastDailyResetAt)
	}

	record, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read persisted state failed: %v", err)
	}
	var persisted FarmState
	if err := json.Unmarshal(record.StateJSON, &persisted); err != nil {
		t.Fatalf("decode persisted state failed: %v", err)
	}
	persistedPet := decodePetForTest(t, persisted.Pet)
	if persistedPet["currentTask"] != nil || persisted.LastDailyResetAt != nowMs {
		t.Fatalf("unexpected persisted pet state: pet=%+v lastDaily=%d", persistedPet, persisted.LastDailyResetAt)
	}
}

func TestServicePersistsPetWaterTaskTick(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := int64(60 * 60 * 1000)
	userID := int64(99475)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_pet_water', 'farm_pet_water', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.LastTickAt = 1
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"currentTask":"water","taskStartAt":0,"taskEndAt":3600000,"cooldownEndAt":7200000,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	state.Lands[0].Status = LandStatusThirsty
	birdNetUntil := nowMs + 1
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      0,
		MatureAt:       2 * 60 * 60 * 1000,
		LastWaterAt:    0,
		NextWaterDueAt: 30 * 60 * 1000,
		WaterMissCount: 1,
		PlantedSeason:  getCurrentSeason(nowMs),
		BirdNetUntil:   &birdNetUntil,
	}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal state failed: %v", err)
	}
	store := NewStore(db)
	if err := store.SaveState(ctx, StateRecord{UserID: userID, StateJSON: stateJSON, LastTickAtMs: 1, UpdatedAtMs: 1}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}

	status, err := NewService(store).GetStatus(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	if status.State.Lands[0].Status != LandStatusGrowing || status.State.Lands[0].Crop == nil || status.State.Lands[0].Crop.LastWaterAt <= 0 {
		t.Fatalf("unexpected pet water response land: %+v", status.State.Lands[0])
	}
	pet := decodePetForTest(t, status.State.Pet)
	if pet["currentTask"] != nil {
		t.Fatalf("expected water task to be cleared in response, got %+v", pet)
	}

	record, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read persisted state failed: %v", err)
	}
	var persisted FarmState
	if err := json.Unmarshal(record.StateJSON, &persisted); err != nil {
		t.Fatalf("decode persisted state failed: %v", err)
	}
	if persisted.Lands[0].Status != LandStatusGrowing || persisted.Lands[0].Crop == nil || persisted.Lands[0].Crop.LastWaterAt <= 0 {
		t.Fatalf("unexpected persisted pet water land: %+v", persisted.Lands[0])
	}
}

func TestServicePersistsPassivePetPlant(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99476)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_pet_plant', 'farm_pet_plant', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"learnedSkills":["plant"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	state.SeedInventory = json.RawMessage(`{"wheat":1,"carrot":1,"lettuce":1}`)
	state.Events = json.RawMessage(`[]`)
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal state failed: %v", err)
	}
	store := NewStore(db)
	if err := store.SaveState(ctx, StateRecord{UserID: userID, StateJSON: stateJSON, LastTickAtMs: nowMs, UpdatedAtMs: nowMs}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}

	status, err := NewService(store).GetStatus(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	if status.State.Lands[0].Crop == nil || status.State.Lands[0].Crop.CropID != CropLettuce {
		t.Fatalf("expected passive plant in response, got %+v", status.State.Lands[0])
	}
	if decodeIntMap(status.State.SeedInventory)["lettuce"] != 0 {
		t.Fatalf("expected lettuce seed consumed, got %s", string(status.State.SeedInventory))
	}

	record, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read persisted state failed: %v", err)
	}
	var persisted FarmState
	if err := json.Unmarshal(record.StateJSON, &persisted); err != nil {
		t.Fatalf("decode persisted state failed: %v", err)
	}
	if persisted.Lands[0].Crop == nil || persisted.Lands[0].Crop.CropID != CropLettuce {
		t.Fatalf("expected persisted passive plant, got %+v", persisted.Lands[0])
	}
}

func TestServicePersistsPassivePetHarvestWithPoints(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99477)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_pet_harvest', 'farm_pet_harvest', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"learnedSkills":["harvest","plant"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	state.Events = json.RawMessage(`[]`)
	state.Bonuses = json.RawMessage(`{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`)
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - 60*60*1000,
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - 60*60*1000,
		NextWaterDueAt: nowMs,
		WaterMissCount: 0,
		PlantedSeason:  getCurrentSeason(nowMs),
		WeatherAtPlant: WeatherSunny,
	}
	expectedHarvest, ok := buildHarvestResult(state, 0, nowMs)
	if !ok {
		t.Fatalf("expected harvest result fixture")
	}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal state failed: %v", err)
	}
	store := NewStore(db)
	if err := store.SaveState(ctx, StateRecord{UserID: userID, StateJSON: stateJSON, LastTickAtMs: nowMs, UpdatedAtMs: nowMs}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}

	status, err := NewService(store).GetStatus(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	expectedBalance := int64(100) + expectedHarvest.FinalYield + firstHarvestBonus
	if status.State.Points != expectedBalance {
		t.Fatalf("expected points %d, got %d", expectedBalance, status.State.Points)
	}
	if status.State.Lands[0].Status != LandStatusGrowing || status.State.Lands[0].Crop == nil || status.State.Lands[0].Crop.PlantedAt != nowMs {
		t.Fatalf("expected passive harvest then passive plant in response, got %+v", status.State.Lands[0])
	}
	if !bonusFlag(status.State.Bonuses, "firstHarvest") {
		t.Fatalf("expected firstHarvest bonus flag")
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != expectedBalance {
		t.Fatalf("expected point account balance %d, got %d", expectedBalance, balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND description IN ('宠物被动收菜: 1 块', '农场首次收获奖励')`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read point ledger failed: %v", err)
	}
	if ledgerCount != 2 {
		t.Fatalf("expected passive harvest and first harvest ledgers, got %d", ledgerCount)
	}

	record, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read persisted state failed: %v", err)
	}
	var persisted FarmState
	if err := json.Unmarshal(record.StateJSON, &persisted); err != nil {
		t.Fatalf("decode persisted state failed: %v", err)
	}
	if persisted.Lands[0].Status != LandStatusGrowing || persisted.Lands[0].Crop == nil || persisted.Lands[0].Crop.PlantedAt != nowMs || !bonusFlag(persisted.Bonuses, "firstHarvest") {
		t.Fatalf("unexpected persisted passive harvest state: %+v bonuses=%s", persisted.Lands[0], string(persisted.Bonuses))
	}
}

func TestServiceExecuteDispatchPetHarvestPersistsStateAndPoints(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99482)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_dispatch_pet")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Pet = readyAdultPetJSON("cat", []string{"harvest"})
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - 2*60*60*1000,
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - 2*60*60*1000,
		NextWaterDueAt: nowMs - 60*60*1000,
		WaterMissCount: 0,
		PlantedSeason:  getCurrentSeason(nowMs),
		WeatherAtPlant: WeatherSunny,
	}
	expectedHarvest, ok := buildHarvestResult(state, 0, nowMs)
	if !ok {
		t.Fatalf("expected harvest fixture")
	}

	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	result, err := NewService(store).ExecuteDispatchPet(ctx, userID, "harvest", nowMs)
	if err != nil {
		t.Fatalf("dispatch pet failed: %v", err)
	}
	if !result.OK || result.Total != expectedHarvest.FinalYield || result.Bonus != firstHarvestBonus || result.Msg == "" {
		t.Fatalf("unexpected dispatch result: %+v expected=%+v", result, expectedHarvest)
	}
	expectedBalance := int64(100) + expectedHarvest.FinalYield + firstHarvestBonus
	if result.Balance != expectedBalance {
		t.Fatalf("expected result balance %d, got %d", expectedBalance, result.Balance)
	}

	persisted := readFarmStateFixture(t, ctx, store, userID)
	if persisted.Lands[0].Status != LandStatusEmpty || persisted.Lands[0].Crop != nil || persisted.Points != expectedBalance {
		t.Fatalf("unexpected persisted state after dispatch: land=%+v points=%d", persisted.Lands[0], persisted.Points)
	}
	pet := decodePetForTest(t, persisted.Pet)
	if pet["currentTask"] != "harvest" || pet["cooldownEndAt"].(float64) != float64(nowMs+120*60*1000) {
		t.Fatalf("unexpected persisted pet task: %+v", pet)
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != expectedBalance {
		t.Fatalf("expected point balance %d, got %d", expectedBalance, balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND description IN ('宠物收菜: 1 块', '农场首次收获奖励')`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read point ledger failed: %v", err)
	}
	if ledgerCount != 2 {
		t.Fatalf("expected dispatch harvest and first harvest ledgers, got %d", ledgerCount)
	}
}

func TestServiceListStealCandidatesFiltersEligibleTargets(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	currentID := int64(99510)
	eligibleID := int64(99511)
	alreadyStolenID := int64(99512)
	emptyID := int64(99513)
	limitID := int64(99514)
	ids := []int64{currentID, eligibleID, alreadyStolenID, emptyID, limitID}
	for _, id := range ids {
		cleanupFarmStoreUser(t, ctx, db, id)
		defer cleanupFarmStoreUser(t, ctx, db, id)
		insertFarmTestUser(t, ctx, db, id, fmt.Sprintf("farm_steal_list_%d", id))
	}

	store := NewStore(db)
	current := newInitialState(currentID, nowMs)
	current.MyStealMap[fmt.Sprintf("%d", alreadyStolenID)] = 1
	saveFarmStateFixture(t, ctx, store, current, nowMs)

	eligible := newInitialState(eligibleID, nowMs)
	makeFarmStateStealableForTest(&eligible, nowMs)
	saveFarmStateFixture(t, ctx, store, eligible, nowMs)

	alreadyStolen := newInitialState(alreadyStolenID, nowMs)
	makeFarmStateStealableForTest(&alreadyStolen, nowMs)
	saveFarmStateFixture(t, ctx, store, alreadyStolen, nowMs)

	empty := newInitialState(emptyID, nowMs)
	saveFarmStateFixture(t, ctx, store, empty, nowMs)

	limitReached := newInitialState(limitID, nowMs)
	limitReached.StolenTodayCount = stealLimitPerPlayerDailyMaxBeingStolen
	makeFarmStateStealableForTest(&limitReached, nowMs)
	saveFarmStateFixture(t, ctx, store, limitReached, nowMs)

	candidates, err := NewService(store).ListStealCandidates(ctx, currentID, 8)
	if err != nil {
		t.Fatalf("list steal candidates failed: %v", err)
	}
	if len(candidates) != 1 {
		t.Fatalf("expected one candidate, got %+v", candidates)
	}
	if candidates[0].UserID != eligibleID || candidates[0].Nickname != fmt.Sprintf("farm_steal_list_%d", eligibleID) || candidates[0].AvatarURL != nil {
		t.Fatalf("unexpected candidate: %+v", candidates[0])
	}
}

func TestServiceExecuteStealSuccessPersistsBothStatesAndPoints(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	thiefID := int64(99478)
	targetID := int64(99479)
	cleanupFarmStoreUser(t, ctx, db, thiefID)
	cleanupFarmStoreUser(t, ctx, db, targetID)
	defer cleanupFarmStoreUser(t, ctx, db, thiefID)
	defer cleanupFarmStoreUser(t, ctx, db, targetID)
	insertFarmTestUser(t, ctx, db, thiefID, "farm_steal_thief")
	insertFarmTestUser(t, ctx, db, targetID, "farm_steal_target")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		thiefID,
	); err != nil {
		t.Fatalf("insert thief point account failed: %v", err)
	}

	thief := newInitialState(thiefID, nowMs)
	thief.Points = 100
	thief.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":80,"thirst":80,"hydrationVersion":2,"health":90,"learnedSkills":["steal"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	target := newInitialState(targetID, nowMs)
	target.Events = json.RawMessage(`[]`)
	birdNetUntil := nowMs + 1
	target.Lands[0].Status = LandStatusMature
	target.Lands[0].Crop = &CropInstance{
		CropID:         CropCarrot,
		PlantedAt:      nowMs - 2*60*60*1000,
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - 2*60*60*1000,
		NextWaterDueAt: nowMs,
		WaterMissCount: 0,
		PlantedSeason:  getCurrentSeason(nowMs),
		WeatherAtPlant: WeatherSunny,
		BirdNetUntil:   &birdNetUntil,
	}
	expectedHarvest, ok := buildHarvestResult(target, 0, nowMs)
	if !ok {
		t.Fatalf("expected target harvest fixture")
	}

	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, thief, nowMs)
	saveFarmStateFixture(t, ctx, store, target, nowMs)

	result, err := NewService(store).executeSteal(ctx, thiefID, targetID, nowMs, &fixedRNG{values: []float64{0, 0}})
	if err != nil {
		t.Fatalf("execute steal failed: %v", err)
	}
	if !result.OK || !result.Success || result.Amount != expectedHarvest.FinalYield || result.CropID != CropCarrot {
		t.Fatalf("unexpected steal result: %+v expected=%+v", result, expectedHarvest)
	}
	expectedBalance := int64(100) + expectedHarvest.FinalYield
	if result.Balance != expectedBalance {
		t.Fatalf("expected result balance %d, got %d", expectedBalance, result.Balance)
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, thiefID).Scan(&balance); err != nil {
		t.Fatalf("read thief balance failed: %v", err)
	}
	if balance != expectedBalance {
		t.Fatalf("expected thief balance %d, got %d", expectedBalance, balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND id = $2 AND amount = $3`,
		thiefID,
		fmt.Sprintf("farm_steal_%d_%d_%s", thiefID, targetID, getChinaDateString(nowMs)),
		expectedHarvest.FinalYield,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("read steal ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one steal ledger, got %d", ledgerCount)
	}

	persistedThief := readFarmStateFixture(t, ctx, store, thiefID)
	if persistedThief.MyStealMap[fmt.Sprintf("%d", targetID)] != 1 || persistedThief.Points != expectedBalance {
		t.Fatalf("unexpected thief state after steal: points=%d mySteal=%+v", persistedThief.Points, persistedThief.MyStealMap)
	}
	thiefPet := decodePetForTest(t, persistedThief.Pet)
	if thiefPet["currentTask"] != "steal" || thiefPet["stealTarget"] == nil {
		t.Fatalf("expected thief pet steal task, got %+v", thiefPet)
	}

	persistedTarget := readFarmStateFixture(t, ctx, store, targetID)
	if persistedTarget.Lands[0].Status != LandStatusEmpty || persistedTarget.Lands[0].Crop != nil ||
		persistedTarget.StolenTodayCount != 1 || persistedTarget.StolenByMap[fmt.Sprintf("%d", thiefID)] != 1 {
		t.Fatalf("unexpected target state after steal: land=%+v count=%d map=%+v", persistedTarget.Lands[0], persistedTarget.StolenTodayCount, persistedTarget.StolenByMap)
	}
}

func TestServiceExecuteStealFailurePersistsAttemptWithoutPoints(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	thiefID := int64(99480)
	targetID := int64(99481)
	cleanupFarmStoreUser(t, ctx, db, thiefID)
	cleanupFarmStoreUser(t, ctx, db, targetID)
	defer cleanupFarmStoreUser(t, ctx, db, thiefID)
	defer cleanupFarmStoreUser(t, ctx, db, targetID)
	insertFarmTestUser(t, ctx, db, thiefID, "farm_steal_fail_thief")
	insertFarmTestUser(t, ctx, db, targetID, "farm_steal_fail_target")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		thiefID,
	); err != nil {
		t.Fatalf("insert thief point account failed: %v", err)
	}

	thief := newInitialState(thiefID, nowMs)
	thief.Points = 100
	thief.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":80,"thirst":80,"hydrationVersion":2,"health":90,"learnedSkills":["steal"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	target := newInitialState(targetID, nowMs)
	target.Events = json.RawMessage(`[]`)
	birdNetUntil := nowMs + 1
	target.Lands[0].Status = LandStatusMature
	target.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - 2*60*60*1000,
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - 2*60*60*1000,
		NextWaterDueAt: nowMs,
		WaterMissCount: 0,
		PlantedSeason:  getCurrentSeason(nowMs),
		WeatherAtPlant: WeatherSunny,
		BirdNetUntil:   &birdNetUntil,
	}

	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, thief, nowMs)
	saveFarmStateFixture(t, ctx, store, target, nowMs)

	result, err := NewService(store).executeSteal(ctx, thiefID, targetID, nowMs, &fixedRNG{values: []float64{0, 0.99}})
	if err != nil {
		t.Fatalf("execute steal failed: %v", err)
	}
	if !result.OK || result.Success {
		t.Fatalf("expected failed steal attempt, got %+v", result)
	}
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, thiefID).Scan(&balance); err != nil {
		t.Fatalf("read thief balance failed: %v", err)
	}
	if balance != 100 {
		t.Fatalf("expected unchanged balance 100, got %d", balance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM point_ledger WHERE user_id = $1`, thiefID).Scan(&ledgerCount); err != nil {
		t.Fatalf("read thief ledger count failed: %v", err)
	}
	if ledgerCount != 0 {
		t.Fatalf("expected no steal ledger on failed attempt, got %d", ledgerCount)
	}

	persistedThief := readFarmStateFixture(t, ctx, store, thiefID)
	if persistedThief.MyStealMap[fmt.Sprintf("%d", targetID)] != 1 {
		t.Fatalf("expected failed attempt to consume daily steal count, got %+v", persistedThief.MyStealMap)
	}
	persistedTarget := readFarmStateFixture(t, ctx, store, targetID)
	if persistedTarget.Lands[0].Status != LandStatusMature || persistedTarget.Lands[0].Crop == nil || persistedTarget.StolenTodayCount != 0 {
		t.Fatalf("expected target crop unchanged on failed steal, got land=%+v count=%d", persistedTarget.Lands[0], persistedTarget.StolenTodayCount)
	}
}

func TestServiceGetStatusSerializesWithConcurrentHarvest(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	userID := int64(99610)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)
	insertFarmTestUser(t, ctx, db, userID, "farm_status_race")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	state := newInitialState(userID, nowMs)
	state.Points = 100
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"learnedSkills":["harvest"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	state.Events = json.RawMessage(`[]`)
	state.Bonuses = json.RawMessage(`{"firstWater":true,"firstHarvest":true,"firstAdopt":true}`)
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - 60*60*1000,
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - 60*60*1000,
		NextWaterDueAt: nowMs,
		WaterMissCount: 0,
		PlantedSeason:  getCurrentSeason(nowMs),
		WeatherAtPlant: WeatherSunny,
	}
	expectedHarvest, ok := buildHarvestResult(state, 0, nowMs)
	if !ok || expectedHarvest.FinalYield <= 0 {
		t.Fatalf("expected positive harvest fixture, got %+v", expectedHarvest)
	}
	store := NewStore(db)
	saveFarmStateFixture(t, ctx, store, state, nowMs)

	// 用外部事务锁住 farm_states 行，制造手动收获与 /status 被动收菜的并发窗口
	blocker, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin blocker tx failed: %v", err)
	}
	defer func() { _ = blocker.Rollback(ctx) }()
	if _, err := blocker.Exec(ctx, `SELECT 1 FROM farm_states WHERE user_id = $1 FOR UPDATE`, userID); err != nil {
		t.Fatalf("lock farm state failed: %v", err)
	}

	service := NewService(store)
	harvestDone := make(chan error, 1)
	statusDone := make(chan error, 1)
	go func() {
		_, err := service.ExecuteHarvest(ctx, userID, 0, nowMs)
		harvestDone <- err
	}()
	time.Sleep(300 * time.Millisecond)
	go func() {
		_, err := service.GetStatus(ctx, userID, nowMs)
		statusDone <- err
	}()
	time.Sleep(700 * time.Millisecond)
	if err := blocker.Rollback(ctx); err != nil {
		t.Fatalf("release blocker tx failed: %v", err)
	}
	if err := <-harvestDone; err != nil {
		t.Fatalf("execute harvest failed: %v", err)
	}
	if err := <-statusDone; err != nil {
		t.Fatalf("get status failed: %v", err)
	}

	var credited int64
	if err := db.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM point_ledger WHERE user_id = $1 AND amount > 0`,
		userID,
	).Scan(&credited); err != nil {
		t.Fatalf("read credited points failed: %v", err)
	}
	if credited != expectedHarvest.FinalYield {
		t.Fatalf("同一作物只应发放一次收获积分 %d，实际发放 %d", expectedHarvest.FinalYield, credited)
	}
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("read point balance failed: %v", err)
	}
	if balance != 100+expectedHarvest.FinalYield {
		t.Fatalf("expected balance %d, got %d", 100+expectedHarvest.FinalYield, balance)
	}
}

func findFridayEventUserInRange(t *testing.T, nowMs int64, targetIndex int, minUserID int64, maxUserID int64) int64 {
	t.Helper()
	date := getChinaDateString(nowMs)
	for userID := minUserID; userID <= maxUserID; userID++ {
		rng := newSeedRandom(fmt.Sprintf("farm-friday-event:%d:%s", userID, date))
		index := int(rng.Float64() * float64(len(fridayRandomEvents)))
		if index == targetIndex {
			return userID
		}
	}
	t.Fatalf("cannot find friday event user in range %d..%d for index %d", minUserID, maxUserID, targetIndex)
	return 0
}

func insertFarmTestUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, username string) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		username,
	); err != nil {
		t.Fatalf("insert farm test user %d failed: %v", userID, err)
	}
}

func saveFarmStateFixture(t *testing.T, ctx context.Context, store *Store, state FarmState, nowMs int64) {
	t.Helper()
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal farm state fixture failed: %v", err)
	}
	if err := store.SaveState(ctx, StateRecord{UserID: state.UserID, StateJSON: stateJSON, LastTickAtMs: state.LastTickAt, UpdatedAtMs: nowMs}); err != nil {
		t.Fatalf("save farm state fixture %d failed: %v", state.UserID, err)
	}
}

func makeFarmStateStealableForTest(state *FarmState, nowMs int64) {
	if state == nil || len(state.Lands) == 0 {
		return
	}
	birdNetUntil := nowMs + 1
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropCarrot,
		PlantedAt:      nowMs - 2*60*60*1000,
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - 2*60*60*1000,
		NextWaterDueAt: nowMs,
		WaterMissCount: 0,
		PlantedSeason:  getCurrentSeason(nowMs),
		WeatherAtPlant: WeatherSunny,
		BirdNetUntil:   &birdNetUntil,
	}
}

func readFarmStateFixture(t *testing.T, ctx context.Context, store *Store, userID int64) FarmState {
	t.Helper()
	record, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read farm state fixture %d failed: %v", userID, err)
	}
	if !record.Exists {
		t.Fatalf("expected farm state fixture %d to exist", userID)
	}
	var state FarmState
	if err := json.Unmarshal(record.StateJSON, &state); err != nil {
		t.Fatalf("decode farm state fixture %d failed: %v", userID, err)
	}
	return state
}

type recordingFarmEmailSender struct {
	configured       bool
	maturityInputs   []FarmMaturityEmailInput
	waterReminderIns []FarmWaterReminderEmailInput
}

func (sender *recordingFarmEmailSender) IsConfigured() bool {
	return sender.configured
}

func (sender *recordingFarmEmailSender) SendMaturityEmail(_ context.Context, input FarmMaturityEmailInput) (FarmEmailSendResult, error) {
	sender.maturityInputs = append(sender.maturityInputs, input)
	return FarmEmailSendResult{Sent: true}, nil
}

func (sender *recordingFarmEmailSender) SendWaterReminderEmail(_ context.Context, input FarmWaterReminderEmailInput) (FarmEmailSendResult, error) {
	sender.waterReminderIns = append(sender.waterReminderIns, input)
	return FarmEmailSendResult{Sent: true}, nil
}
