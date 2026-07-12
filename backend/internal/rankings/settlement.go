package rankings

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrSettlementInProgress = errors.New("ranking settlement is already running")

const (
	settlementStatusSuccess = "success"
	settlementStatusPartial = "partial"
	settlementStatusFailed  = "failed"

	rewardStatusGranted = "granted"
	rewardStatusSkipped = "skipped"
	rewardStatusFailed  = "failed"

	sourceRankingReward = "ranking_reward"
	peakFirstTTL        = 30 * 24 * time.Hour
)

var (
	defaultWeeklyRewards  = []int64{500, 300, 200, 100, 50}
	defaultMonthlyRewards = []int64{1500, 1000, 600, 300, 200, 100}
)

type settlementRange struct {
	startAt int64
	endAt   int64
	label   string
}

func (service *Service) SettleRankingPeriod(ctx context.Context, input SettleInput) (SettleResult, error) {
	if service.db == nil {
		return SettleResult{}, ErrUnavailable
	}
	period := normalizeSettlementPeriod(string(input.Period))
	input.Period = period
	currentRange := previousSettlementRange(period, service.now())

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SettleResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := acquireSettlementLock(ctx, tx, period, currentRange); err != nil {
		return SettleResult{}, err
	}

	existing, found, err := getSettlementForUpdate(ctx, tx, period, currentRange)
	if err != nil {
		return SettleResult{}, err
	}
	if found && !input.RetryFailed {
		if err := tx.Commit(ctx); err != nil {
			return SettleResult{}, err
		}
		return SettleResult{AlreadySettled: true, Record: existing}, nil
	}
	if found && input.RetryFailed {
		record, err := service.retryFailedSettlementRewards(ctx, tx, existing, input, currentRange)
		if err != nil {
			return SettleResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return SettleResult{}, err
		}
		return SettleResult{Retried: true, Record: record}, nil
	}

	policy := normalizeRewardPolicy(input)
	winners, err := service.overallGamesLeaderboardByRangeTx(ctx, tx, currentRange.startAt, currentRange.endAt, policy.TopN)
	if err != nil {
		return SettleResult{}, err
	}
	rewards := make([]SettlementReward, 0, len(winners))
	for index, winner := range winners {
		rewardPoints := int64(0)
		if index < len(policy.RewardPoints) {
			rewardPoints = policy.RewardPoints[index]
		}
		reward, err := service.settleSingleRewardTx(ctx, tx, period, currentRange, winner, rewardPoints, input.DryRun)
		if err != nil {
			return SettleResult{}, err
		}
		rewards = append(rewards, reward)
	}

	nowMs := service.now().UnixMilli()
	record := buildSettlementRecord(input, currentRange, policy, int64(len(winners)), rewards, nowMs, 0)
	if !input.DryRun {
		if err := saveSettlementRecord(ctx, tx, record); err != nil {
			return SettleResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return SettleResult{}, err
	}
	return SettleResult{Record: record}, nil
}

func (service *Service) retryFailedSettlementRewards(ctx context.Context, tx pgx.Tx, existing SettlementRecord, input SettleInput, currentRange settlementRange) (SettlementRecord, error) {
	rewards := settlementRewardsFromAny(existing.Rewards)
	if len(rewards) == 0 {
		return existing, nil
	}
	period := normalizeSettlementPeriod(string(existing.Period))
	changed := false
	for index := range rewards {
		reward := rewards[index]
		if reward.Status != rewardStatusFailed || reward.RewardPoints <= 0 {
			continue
		}
		winner := OverallEntry{
			UserEntry:   UserEntry{Rank: reward.Rank, UserID: reward.UserID, Username: reward.Username},
			TotalScore:  reward.TotalScore,
			TotalPoints: reward.TotalPoints,
			GamesPlayed: reward.GamesPlayed,
		}
		nextReward, err := service.settleSingleRewardTx(ctx, tx, period, currentRange, winner, reward.RewardPoints, input.DryRun)
		if err != nil {
			return SettlementRecord{}, err
		}
		rewards[index] = nextReward
		changed = true
	}
	if !changed {
		return existing, nil
	}

	existing.Rewards = rewardsToAny(rewards)
	existing.Summary = summaryToMap(summarizeSettlementRewards(rewards))
	existing.Status = settlementStatusFromRewards(rewards)
	existing.RetryCount++
	existing.SettledAt = service.now().UnixMilli()
	existing.TriggeredBy = operatorToMap(SettlementOperator{ID: input.OperatorID, Username: fallbackUsername(input.OperatorID, input.OperatorUsername)})
	if !input.DryRun {
		if err := saveSettlementRecord(ctx, tx, existing); err != nil {
			return SettlementRecord{}, err
		}
	}
	return existing, nil
}

func (service *Service) settleSingleRewardTx(ctx context.Context, tx pgx.Tx, period SettlementPeriod, currentRange settlementRange, winner OverallEntry, rewardPoints int64, dryRun bool) (SettlementReward, error) {
	processedAt := service.now().UnixMilli()
	reward := SettlementReward{
		Rank:         winner.Rank,
		UserID:       winner.UserID,
		Username:     winner.Username,
		TotalScore:   winner.TotalScore,
		TotalPoints:  winner.TotalPoints,
		GamesPlayed:  winner.GamesPlayed,
		RewardPoints: rewardPoints,
		Status:       rewardStatusSkipped,
		ProcessedAt:  processedAt,
	}
	if rewardPoints <= 0 {
		reward.Reason = "reward_zero"
		return reward, nil
	}
	if dryRun {
		reward.Reason = "dry_run"
		return reward, nil
	}

	tag, err := tx.Exec(ctx,
		`INSERT INTO ranking_reward_claims (period, period_start_ms, period_end_ms, user_id, processed_at_ms)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT DO NOTHING`,
		period,
		currentRange.startAt,
		currentRange.endAt,
		winner.UserID,
		processedAt,
	)
	if err != nil {
		reward.Status = rewardStatusFailed
		reward.Reason = err.Error()
		return reward, nil
	}
	if tag.RowsAffected() == 0 {
		reward.Reason = "already_rewarded"
		return reward, nil
	}

	balance, err := grantRankingPoints(ctx, tx, winner.UserID, rewardPoints, period, winner.Rank)
	if err != nil {
		reward.Status = rewardStatusFailed
		reward.Reason = truncateReason(err)
		return reward, nil
	}
	if err := createRankingRewardNotification(ctx, tx, winner.UserID, period, winner.Rank, rewardPoints, currentRange.label, processedAt); err != nil {
		reward.Status = rewardStatusFailed
		reward.Reason = truncateReason(err)
		return reward, nil
	}
	if period == SettlementPeriodMonthly && winner.Rank == 1 {
		if err := grantPeakFirst(ctx, tx, winner.UserID, currentRange, processedAt); err != nil {
			reward.Status = rewardStatusFailed
			reward.Reason = truncateReason(err)
			return reward, nil
		}
	}

	reward.Status = rewardStatusGranted
	reward.Balance = &balance
	return reward, nil
}

func (service *Service) overallGamesLeaderboardByRangeTx(ctx context.Context, tx pgx.Tx, startAt int64, endAt int64, limit int64) ([]OverallEntry, error) {
	safeLimit := clampLimitWithMin(limit, 20, 1, 100)
	gameTypes := make([]string, 0, len(supportedGames))
	for _, game := range supportedGames {
		gameTypes = append(gameTypes, game.dbName)
	}
	rows, err := tx.Query(ctx,
		`WITH grouped AS (
		   SELECT user_id,
		          SUM(score)::bigint AS total_score,
		          SUM(points_earned)::bigint AS total_points,
		          COUNT(*)::bigint AS games_played
		     FROM game_records
		    WHERE game_type = ANY($1::text[])
		      AND created_at >= $2
		      AND created_at < $3
		      AND COALESCE(payload->>'pending', 'false') <> 'true'
		    GROUP BY user_id
		 )
		 SELECT u.id, u.username, u.display_name, p.display_name, p.avatar_url,
		        a.achievement_id, a.expires_at_ms,
		        g.total_score, g.total_points, g.games_played
		   FROM grouped g
		   JOIN users u ON u.id = g.user_id
		   LEFT JOIN user_profiles p ON p.user_id = u.id
		   LEFT JOIN LATERAL (`+equippedAchievementSQL("$4")+`) a ON true
		  ORDER BY g.total_score DESC, g.total_points DESC, g.games_played DESC, u.id ASC
		  LIMIT $5`,
		gameTypes,
		time.UnixMilli(startAt),
		time.UnixMilli(endAt),
		service.now().UnixMilli(),
		safeLimit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	leaderboard := []OverallEntry{}
	rank := int64(1)
	for rows.Next() {
		var entry OverallEntry
		var raw rawUserEntry
		if err := rows.Scan(
			&raw.userID,
			&raw.username,
			&raw.baseDisplayName,
			&raw.profileDisplayName,
			&raw.avatarURL,
			&raw.achievementID,
			&raw.achievementExpiresAt,
			&entry.TotalScore,
			&entry.TotalPoints,
			&entry.GamesPlayed,
		); err != nil {
			return nil, err
		}
		entry.UserEntry = raw.toUserEntry()
		entry.Rank = rank
		entry.GameBreakdown = map[string]OverallGameBreakdownItem{}
		leaderboard = append(leaderboard, entry)
		rank++
	}
	return leaderboard, rows.Err()
}

func acquireSettlementLock(ctx context.Context, tx pgx.Tx, period SettlementPeriod, currentRange settlementRange) error {
	var locked bool
	err := tx.QueryRow(ctx,
		`SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint)`,
		fmt.Sprintf("rankings:settlement:%s:%d:%d", period, currentRange.startAt, currentRange.endAt),
	).Scan(&locked)
	if err != nil {
		return err
	}
	if !locked {
		return ErrSettlementInProgress
	}
	return nil
}

func getSettlementForUpdate(ctx context.Context, tx pgx.Tx, period SettlementPeriod, currentRange settlementRange) (SettlementRecord, bool, error) {
	row := tx.QueryRow(ctx,
		`SELECT id, period, period_start_ms, period_end_ms, period_label, status,
		        reward_policy, total_participants, rewards, summary,
		        created_at_ms, settled_at_ms, retry_count, triggered_by
		   FROM ranking_settlements
		  WHERE period = $1 AND period_start_ms = $2 AND period_end_ms = $3
		  FOR UPDATE`,
		period,
		currentRange.startAt,
		currentRange.endAt,
	)
	record, err := scanSettlementRecord(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return SettlementRecord{}, false, nil
	}
	return record, err == nil, err
}

type settlementScanner interface {
	Scan(dest ...any) error
}

func scanSettlementRecord(row settlementScanner) (SettlementRecord, error) {
	var record SettlementRecord
	var rewardPolicy []byte
	var rewards []byte
	var summary []byte
	var triggeredBy []byte
	if err := row.Scan(
		&record.ID,
		&record.Period,
		&record.PeriodStart,
		&record.PeriodEnd,
		&record.PeriodLabel,
		&record.Status,
		&rewardPolicy,
		&record.TotalParticipants,
		&rewards,
		&summary,
		&record.CreatedAt,
		&record.SettledAt,
		&record.RetryCount,
		&triggeredBy,
	); err != nil {
		return SettlementRecord{}, err
	}
	record.RewardPolicy = decodeJSONMap(rewardPolicy)
	record.Rewards = decodeJSONArray(rewards)
	record.Summary = decodeJSONMap(summary)
	record.TriggeredBy = decodeJSONMap(triggeredBy)
	return record, nil
}

func saveSettlementRecord(ctx context.Context, tx pgx.Tx, record SettlementRecord) error {
	rewardPolicy, err := json.Marshal(record.RewardPolicy)
	if err != nil {
		return err
	}
	rewards, err := json.Marshal(record.Rewards)
	if err != nil {
		return err
	}
	summary, err := json.Marshal(record.Summary)
	if err != nil {
		return err
	}
	triggeredBy, err := json.Marshal(record.TriggeredBy)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO ranking_settlements (
		   id, period, period_start_ms, period_end_ms, period_label, status,
		   reward_policy, total_participants, rewards, summary,
		   created_at_ms, settled_at_ms, retry_count, triggered_by, updated_at
		 ) VALUES (
		   $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb,
		   $11, $12, $13, $14::jsonb, now()
		 )
		 ON CONFLICT (period, period_start_ms, period_end_ms) DO UPDATE SET
		   status = excluded.status,
		   reward_policy = excluded.reward_policy,
		   total_participants = excluded.total_participants,
		   rewards = excluded.rewards,
		   summary = excluded.summary,
		   settled_at_ms = excluded.settled_at_ms,
		   retry_count = excluded.retry_count,
		   triggered_by = excluded.triggered_by,
		   updated_at = now()`,
		record.ID,
		record.Period,
		record.PeriodStart,
		record.PeriodEnd,
		record.PeriodLabel,
		record.Status,
		string(rewardPolicy),
		record.TotalParticipants,
		string(rewards),
		string(summary),
		record.CreatedAt,
		record.SettledAt,
		record.RetryCount,
		string(triggeredBy),
	)
	return err
}

func grantRankingPoints(ctx context.Context, tx pgx.Tx, userID int64, amount int64, period SettlementPeriod, rank int64) (int64, error) {
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
	nextBalance := balance + amount
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		userID,
	); err != nil {
		return 0, err
	}
	description := fmt.Sprintf("%s奖励：第%d名", settlementPeriodLabel(period), rank)
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())`,
		randomSettlementID("rank_reward"),
		userID,
		amount,
		sourceRankingReward,
		description,
		nextBalance,
	); err != nil {
		return 0, err
	}
	return nextBalance, nil
}

func createRankingRewardNotification(ctx context.Context, tx pgx.Tx, userID int64, period SettlementPeriod, rank int64, rewardPoints int64, periodLabel string, nowMs int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms, created_at, updated_at)
		 VALUES ($1, $2, 'system', $3, $4,
		         jsonb_build_object('kind', 'ranking_reward', 'period', $5::text, 'rank', $6::bigint, 'rewardPoints', $7::bigint, 'periodLabel', $8::text),
		         $9, now(), now())
		 ON CONFLICT (id) DO NOTHING`,
		randomSettlementID("notification"),
		userID,
		fmt.Sprintf("排行榜奖励已发放（%s）", settlementPeriodLabel(period)),
		fmt.Sprintf("你在 %s 的%s中获得第 %d 名，奖励 %d 积分已到账。", periodLabel, settlementPeriodLabel(period), rank, rewardPoints),
		period,
		rank,
		rewardPoints,
		periodLabel,
		nowMs,
	)
	return err
}

func grantPeakFirst(ctx context.Context, tx pgx.Tx, userID int64, currentRange settlementRange, nowMs int64) error {
	expiresAt := nowMs + peakFirstTTL.Milliseconds()
	metadata, _ := json.Marshal(map[string]any{
		"periodStart": currentRange.startAt,
		"periodEnd":   currentRange.endAt,
		"periodLabel": currentRange.label,
	})
	if _, err := tx.Exec(ctx,
		`INSERT INTO user_achievement_grants (
		   user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason, metadata, updated_at
		 ) VALUES (
		   $1, 'peak_first', 'ranking_monthly', $2, $3, $4, $5::jsonb, now()
		 )
		 ON CONFLICT (user_id, achievement_id) DO UPDATE SET
		   source = excluded.source,
		   granted_at_ms = LEAST(user_achievement_grants.granted_at_ms, excluded.granted_at_ms),
		   expires_at_ms = GREATEST(COALESCE(user_achievement_grants.expires_at_ms, 0), excluded.expires_at_ms),
		   reason = excluded.reason,
		   metadata = excluded.metadata,
		   updated_at = now()`,
		userID,
		nowMs,
		expiresAt,
		"风云榜月榜第一："+currentRange.label,
		string(metadata),
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms, updated_at)
		 VALUES ($1, 'peak_first', $2, now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   achievement_id = excluded.achievement_id,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_at = now()`,
		userID,
		nowMs,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO user_forced_achievements (user_id, achievement_id, until_ms, updated_at_ms, updated_at)
		 VALUES ($1, 'peak_first', $2, $3, now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   achievement_id = excluded.achievement_id,
		   until_ms = GREATEST(user_forced_achievements.until_ms, excluded.until_ms),
		   updated_at_ms = excluded.updated_at_ms,
		   updated_at = now()`,
		userID,
		expiresAt,
		nowMs,
	)
	return err
}

func previousSettlementRange(period SettlementPeriod, now time.Time) settlementRange {
	chinaNow := now.UTC().Add(chinaOffset)
	if period == SettlementPeriodMonthly {
		currentMonthStart := time.Date(chinaNow.Year(), chinaNow.Month(), 1, 0, 0, 0, 0, time.UTC)
		previousMonthStart := currentMonthStart.AddDate(0, -1, 0)
		startAt := previousMonthStart.Add(-chinaOffset).UnixMilli()
		endAt := currentMonthStart.Add(-chinaOffset).UnixMilli()
		return settlementRange{startAt: startAt, endAt: endAt, label: formatSettlementRangeLabel(startAt, endAt)}
	}
	currentWeekStart := time.Date(chinaNow.Year(), chinaNow.Month(), chinaNow.Day(), 0, 0, 0, 0, time.UTC)
	weekday := int(currentWeekStart.Weekday())
	diffToMonday := weekday - 1
	if weekday == 0 {
		diffToMonday = 6
	}
	currentWeekStart = currentWeekStart.AddDate(0, 0, -diffToMonday)
	endAt := currentWeekStart.Add(-chinaOffset).UnixMilli()
	startAt := endAt - int64(7*24*time.Hour/time.Millisecond)
	return settlementRange{startAt: startAt, endAt: endAt, label: formatSettlementRangeLabel(startAt, endAt)}
}

func formatSettlementRangeLabel(startAt int64, endAt int64) string {
	return fmt.Sprintf("%s ~ %s", formatChinaDate(startAt), formatChinaDate(endAt-1))
}

func formatChinaDate(timestamp int64) string {
	return time.UnixMilli(timestamp).UTC().Add(chinaOffset).Format("2006-01-02")
}

func normalizeRewardPolicy(input SettleInput) RewardPolicy {
	defaultRewards := defaultWeeklyRewards
	if input.Period == SettlementPeriodMonthly {
		defaultRewards = defaultMonthlyRewards
	}
	rewards := make([]int64, 0, len(input.RewardPoints))
	for _, value := range input.RewardPoints {
		if value < 0 {
			continue
		}
		rewards = append(rewards, value)
	}
	if len(rewards) == 0 {
		rewards = append([]int64{}, defaultRewards...)
	}
	topN := input.TopN
	if topN <= 0 {
		topN = int64(len(rewards))
	}
	if topN < 1 {
		topN = 1
	}
	if topN > 100 {
		topN = 100
	}
	for int64(len(rewards)) < topN {
		rewards = append(rewards, 0)
	}
	if int64(len(rewards)) > topN {
		rewards = rewards[:topN]
	}
	return RewardPolicy{TopN: topN, RewardPoints: rewards}
}

func buildSettlementRecord(input SettleInput, currentRange settlementRange, policy RewardPolicy, participants int64, rewards []SettlementReward, nowMs int64, retryCount int64) SettlementRecord {
	return SettlementRecord{
		ID:                fmt.Sprintf("%s:%d:%d:%s", input.Period, currentRange.startAt, currentRange.endAt, randomSettlementID("")),
		Period:            input.Period,
		PeriodStart:       currentRange.startAt,
		PeriodEnd:         currentRange.endAt,
		PeriodLabel:       currentRange.label,
		Status:            settlementStatusFromRewards(rewards),
		RewardPolicy:      rewardPolicyToMap(policy),
		TotalParticipants: participants,
		Rewards:           rewardsToAny(rewards),
		Summary:           summaryToMap(summarizeSettlementRewards(rewards)),
		CreatedAt:         nowMs,
		SettledAt:         nowMs,
		RetryCount:        retryCount,
		TriggeredBy:       operatorToMap(SettlementOperator{ID: input.OperatorID, Username: fallbackUsername(input.OperatorID, input.OperatorUsername)}),
	}
}

func settlementStatusFromRewards(rewards []SettlementReward) string {
	if len(rewards) == 0 {
		return settlementStatusSuccess
	}
	failed := int64(0)
	for _, reward := range rewards {
		if reward.Status == rewardStatusFailed {
			failed++
		}
	}
	if failed == 0 {
		return settlementStatusSuccess
	}
	if failed == int64(len(rewards)) {
		return settlementStatusFailed
	}
	return settlementStatusPartial
}

func summarizeSettlementRewards(rewards []SettlementReward) SettlementSummary {
	var summary SettlementSummary
	for _, reward := range rewards {
		switch reward.Status {
		case rewardStatusGranted:
			summary.Granted++
			summary.TotalRewardPoints += reward.RewardPoints
		case rewardStatusFailed:
			summary.Failed++
		default:
			summary.Skipped++
		}
	}
	return summary
}

func rewardPolicyToMap(policy RewardPolicy) map[string]any {
	points := make([]any, 0, len(policy.RewardPoints))
	for _, point := range policy.RewardPoints {
		points = append(points, point)
	}
	return map[string]any{"topN": policy.TopN, "rewardPoints": points}
}

func summaryToMap(summary SettlementSummary) map[string]any {
	return map[string]any{
		"granted":           summary.Granted,
		"skipped":           summary.Skipped,
		"failed":            summary.Failed,
		"totalRewardPoints": summary.TotalRewardPoints,
	}
}

func operatorToMap(operator SettlementOperator) map[string]any {
	return map[string]any{"id": operator.ID, "username": operator.Username}
}

func rewardsToAny(rewards []SettlementReward) []any {
	result := make([]any, 0, len(rewards))
	for _, reward := range rewards {
		raw, _ := json.Marshal(reward)
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err == nil {
			result = append(result, item)
		}
	}
	return result
}

func settlementRewardsFromAny(items []any) []SettlementReward {
	rewards := make([]SettlementReward, 0, len(items))
	for _, item := range items {
		raw, err := json.Marshal(item)
		if err != nil {
			continue
		}
		var reward SettlementReward
		if err := json.Unmarshal(raw, &reward); err == nil {
			rewards = append(rewards, reward)
		}
	}
	sort.SliceStable(rewards, func(i, j int) bool { return rewards[i].Rank < rewards[j].Rank })
	return rewards
}

func settlementPeriodLabel(period SettlementPeriod) string {
	if period == SettlementPeriodMonthly {
		return "月榜"
	}
	return "周榜"
}

func truncateReason(err error) string {
	if err == nil {
		return ""
	}
	reason := strings.TrimSpace(err.Error())
	if len(reason) > 200 {
		return reason[:200]
	}
	return reason
}

func randomSettlementID(prefix string) string {
	var buffer [8]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		if prefix == "" {
			return fmt.Sprintf("%d", time.Now().UnixNano())
		}
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}
	value := hex.EncodeToString(buffer[:])
	if prefix == "" {
		return value
	}
	return prefix + "_" + value
}
