//go:build integration

package welfare

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestListProjectsFiltersAndSortsPublicItems(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	pinnedID := fmt.Sprintf("project-pinned-%d", suffix)
	normalID := fmt.Sprintf("project-normal-%d", suffix)
	pausedID := fmt.Sprintf("project-paused-%d", suffix)

	if err := seedProject(ctx, service, normalID, "普通项目", "active", false, 0, 1000); err != nil {
		t.Fatalf("seed normal project failed: %v", err)
	}
	if err := seedProject(ctx, service, pinnedID, "置顶项目", "active", true, 3000, 900); err != nil {
		t.Fatalf("seed pinned project failed: %v", err)
	}
	if err := seedProject(ctx, service, pausedID, "暂停项目", "paused", true, 4000, 1100); err != nil {
		t.Fatalf("seed paused project failed: %v", err)
	}

	projects, err := service.ListProjects(ctx)
	if err != nil {
		t.Fatalf("list projects failed: %v", err)
	}

	var pinnedIndex = -1
	var normalIndex = -1
	for index, project := range projects {
		if project.ID == pausedID {
			t.Fatalf("paused project should not be returned")
		}
		if project.ID == pinnedID {
			pinnedIndex = index
		}
		if project.ID == normalID {
			normalIndex = index
		}
	}
	if pinnedIndex < 0 || normalIndex < 0 {
		t.Fatalf("seeded projects missing: pinned=%d normal=%d", pinnedIndex, normalIndex)
	}
	if pinnedIndex > normalIndex {
		t.Fatalf("pinned project should be sorted before normal project")
	}
}

func TestProcessAutoPauseProjectsPausesDueActiveProjects(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	dueID := fmt.Sprintf("project-auto-pause-due-%d", suffix)
	futureID := fmt.Sprintf("project-auto-pause-future-%d", suffix)
	pausedID := fmt.Sprintf("project-auto-pause-paused-%d", suffix)
	nowMs := int64(2_000_000)

	if err := seedProject(ctx, service, dueID, "到期项目", "active", false, 0, 1000); err != nil {
		t.Fatalf("seed due project failed: %v", err)
	}
	if err := seedProject(ctx, service, futureID, "未到期项目", "active", false, 0, 1000); err != nil {
		t.Fatalf("seed future project failed: %v", err)
	}
	if err := seedProject(ctx, service, pausedID, "已暂停项目", "paused", false, 0, 1000); err != nil {
		t.Fatalf("seed paused project failed: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`UPDATE projects
		    SET auto_pause_at_ms = CASE id
		      WHEN $1 THEN $4::bigint
		      WHEN $2 THEN $5::bigint
		      WHEN $3 THEN $4::bigint
		    END
		  WHERE id IN ($1, $2, $3)`,
		dueID,
		futureID,
		pausedID,
		nowMs-1,
		nowMs+60_000,
	); err != nil {
		t.Fatalf("seed auto pause fields failed: %v", err)
	}

	result, err := service.ProcessAutoPauseProjects(ctx, nowMs, 100)
	if err != nil {
		t.Fatalf("process auto pause failed: %v", err)
	}
	if result.Paused != 1 {
		t.Fatalf("expected one project paused, got %+v", result)
	}

	statuses := map[string]string{}
	pausedAt := map[string]int64{}
	rows, err := service.db.Query(ctx, `SELECT id, status, COALESCE(auto_paused_at_ms, 0) FROM projects WHERE id IN ($1, $2, $3)`, dueID, futureID, pausedID)
	if err != nil {
		t.Fatalf("query projects failed: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var status string
		var pausedAtMs int64
		if err := rows.Scan(&id, &status, &pausedAtMs); err != nil {
			t.Fatalf("scan project failed: %v", err)
		}
		statuses[id] = status
		pausedAt[id] = pausedAtMs
	}
	if statuses[dueID] != "paused" || pausedAt[dueID] != nowMs {
		t.Fatalf("due project should be paused at now, status=%s pausedAt=%d", statuses[dueID], pausedAt[dueID])
	}
	if statuses[futureID] != "active" || pausedAt[futureID] != 0 {
		t.Fatalf("future project should remain active, status=%s pausedAt=%d", statuses[futureID], pausedAt[futureID])
	}
	if statuses[pausedID] != "paused" || pausedAt[pausedID] != 0 {
		t.Fatalf("already paused project should not be touched, status=%s pausedAt=%d", statuses[pausedID], pausedAt[pausedID])
	}
}

func TestListRafflesFiltersPublicItems(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	createdAt := millis(time.Now())
	activeID := fmt.Sprintf("raffle-active-%d", suffix)
	endedID := fmt.Sprintf("raffle-ended-%d", suffix)
	draftID := fmt.Sprintf("raffle-draft-%d", suffix)

	if err := seedRaffle(ctx, service, activeID, "active", createdAt+3); err != nil {
		t.Fatalf("seed active raffle failed: %v", err)
	}
	if err := seedRaffle(ctx, service, endedID, "ended", createdAt+2); err != nil {
		t.Fatalf("seed ended raffle failed: %v", err)
	}
	if err := seedRaffle(ctx, service, draftID, "draft", createdAt+4); err != nil {
		t.Fatalf("seed draft raffle failed: %v", err)
	}

	all, err := service.ListRaffles(ctx, RaffleListFilter{})
	if err != nil {
		t.Fatalf("list raffles failed: %v", err)
	}
	if !containsRaffle(all, activeID) {
		t.Fatalf("active raffle should be returned")
	}
	if containsRaffle(all, draftID) {
		t.Fatalf("draft raffle should not be public")
	}

	endedOnly, err := service.ListRaffles(ctx, RaffleListFilter{Status: "ended"})
	if err != nil {
		t.Fatalf("list ended raffles failed: %v", err)
	}
	if !containsRaffle(endedOnly, endedID) || containsRaffle(endedOnly, draftID) {
		t.Fatalf("ended status filter should return ended raffle only")
	}

	activeOnly, err := service.ListRaffles(ctx, RaffleListFilter{ActiveOnly: true})
	if err != nil {
		t.Fatalf("list active raffles failed: %v", err)
	}
	if !containsRaffle(activeOnly, activeID) || containsRaffle(activeOnly, endedID) {
		t.Fatalf("activeOnly should return active raffles only")
	}
}

func TestGetRaffleDetailReturnsEntriesAndUserStatus(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("raffle-detail-%d", suffix)
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}
	if err := seedRaffleEntry(ctx, service, raffleID, fmt.Sprintf("entry-1-%d", suffix), 1001, "alice", 1, 2100); err != nil {
		t.Fatalf("seed entry failed: %v", err)
	}

	userID := int64(1001)
	detail, err := service.GetRaffleDetail(ctx, raffleID, &userID)
	if err != nil {
		t.Fatalf("get raffle detail failed: %v", err)
	}
	if detail.Raffle.ID != raffleID || len(detail.Entries) != 1 {
		t.Fatalf("unexpected detail: %+v", detail)
	}
	if len(detail.Raffle.Winners) != 0 {
		t.Fatalf("active raffle should not expose winners: %s", string(detail.Raffle.Winners))
	}
	if detail.UserStatus == nil || !detail.UserStatus.HasJoined || detail.UserStatus.Entry == nil || detail.UserStatus.Entry.UserID != userID {
		t.Fatalf("unexpected user status: %+v", detail.UserStatus)
	}
}

func TestGetRaffleDetailReturnsEndedWinnersAndHidesDrafts(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	endedID := fmt.Sprintf("raffle-ended-detail-%d", suffix)
	draftID := fmt.Sprintf("raffle-draft-detail-%d", suffix)
	if err := seedRaffle(ctx, service, endedID, "ended", 2000); err != nil {
		t.Fatalf("seed ended raffle failed: %v", err)
	}
	winnerEntryID := fmt.Sprintf("entry-winner-%d", suffix)
	if err := seedRaffleEntry(ctx, service, endedID, winnerEntryID, 1002, "bob", 1, 2100); err != nil {
		t.Fatalf("seed winner entry failed: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`UPDATE raffles
		 SET winners = jsonb_build_array(jsonb_build_object('entryId', $2::text, 'userId', 1002, 'username', 'bob', 'prizeId', 'p1', 'prizeName', '积分', 'points', 10, 'rewardStatus', 'delivered')),
		     winners_count = 1,
		     drawn_at_ms = 2200
		 WHERE id = $1`,
		endedID,
		winnerEntryID,
	); err != nil {
		t.Fatalf("seed winners failed: %v", err)
	}
	if err := seedRaffle(ctx, service, draftID, "draft", 3000); err != nil {
		t.Fatalf("seed draft raffle failed: %v", err)
	}

	userID := int64(1002)
	detail, err := service.GetRaffleDetail(ctx, endedID, &userID)
	if err != nil {
		t.Fatalf("get ended raffle detail failed: %v", err)
	}
	if len(detail.Raffle.Winners) == 0 || detail.UserStatus == nil || !detail.UserStatus.IsWinner || len(detail.UserStatus.Prize) == 0 {
		t.Fatalf("ended raffle should expose winner status: %+v", detail)
	}

	if _, err := service.GetRaffleDetail(ctx, draftID, nil); !errors.Is(err, ErrRaffleNotFound) {
		t.Fatalf("draft raffle should be hidden, got %v", err)
	}
}

func TestJoinRaffleCreatesEntryAndRejectsDuplicate(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	raffleID := fmt.Sprintf("raffle-join-%d", time.Now().UnixNano())
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}

	user := auth.User{ID: 11001, Username: "alice", DisplayName: "Alice"}
	result, err := service.JoinRaffle(ctx, raffleID, user)
	if err != nil {
		t.Fatalf("join raffle failed: %v", err)
	}
	if !result.Success || result.Entry == nil || result.Entry.EntryNumber != 1 || result.ShouldDraw {
		t.Fatalf("unexpected join result: %+v", result)
	}

	duplicate, err := service.JoinRaffle(ctx, raffleID, user)
	if err != nil {
		t.Fatalf("duplicate join failed: %v", err)
	}
	if duplicate.Success || duplicate.Message != "您已经参与过了" {
		t.Fatalf("duplicate join should be rejected: %+v", duplicate)
	}

	detail, err := service.GetRaffleDetail(ctx, raffleID, &user.ID)
	if err != nil {
		t.Fatalf("get raffle detail failed: %v", err)
	}
	if len(detail.Entries) != 1 || detail.UserStatus == nil || !detail.UserStatus.HasJoined {
		t.Fatalf("joined entry should be readable through detail: %+v", detail)
	}
	if count := raffleParticipantsCount(t, ctx, service, raffleID); count != 1 {
		t.Fatalf("expected participants_count 1, got %d", count)
	}
}

func TestJoinRaffleRejectsInvalidStates(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	endedID := fmt.Sprintf("raffle-join-ended-%d", suffix)
	packetID := fmt.Sprintf("raffle-join-packet-%d", suffix)
	if err := seedRaffle(ctx, service, endedID, "ended", 2000); err != nil {
		t.Fatalf("seed ended raffle failed: %v", err)
	}
	if err := seedRaffleMode(ctx, service, packetID, "red_packet", "active", 2000); err != nil {
		t.Fatalf("seed red packet raffle failed: %v", err)
	}

	user := auth.User{ID: 11002, Username: "bob", DisplayName: "Bob"}
	ended, err := service.JoinRaffle(ctx, endedID, user)
	if err != nil {
		t.Fatalf("join ended raffle failed: %v", err)
	}
	if ended.Success || ended.Message != "活动已结束" {
		t.Fatalf("ended raffle should reject join: %+v", ended)
	}

	packet, err := service.JoinRaffle(ctx, packetID, user)
	if err != nil {
		t.Fatalf("join red packet raffle failed: %v", err)
	}
	if packet.Success || packet.Message != "请使用抢红包入口参与活动" {
		t.Fatalf("red packet should reject normal join: %+v", packet)
	}
}

func TestJoinRaffleContinuesImportedParticipantCount(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	raffleID := fmt.Sprintf("raffle-join-imported-count-%d", time.Now().UnixNano())
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`UPDATE raffles SET participants_count = 5 WHERE id = $1`,
		raffleID,
	); err != nil {
		t.Fatalf("seed participants_count failed: %v", err)
	}

	user := auth.User{ID: 11003, Username: "carol", DisplayName: "Carol"}
	result, err := service.JoinRaffle(ctx, raffleID, user)
	if err != nil {
		t.Fatalf("join raffle failed: %v", err)
	}
	if !result.Success || result.Entry == nil || result.Entry.EntryNumber != 6 {
		t.Fatalf("entry number should continue imported count: %+v", result)
	}
	if count := raffleParticipantsCount(t, ctx, service, raffleID); count != 6 {
		t.Fatalf("expected participants_count 6, got %d", count)
	}
}

func TestJoinRaffleConcurrentRequestsStayConsistent(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	raffleID := fmt.Sprintf("raffle-join-concurrent-%d", time.Now().UnixNano())
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}

	const workers = 20
	results := make([]JoinRaffleResult, workers)
	errs := make([]error, workers)
	var waitGroup sync.WaitGroup
	waitGroup.Add(workers)
	for index := 0; index < workers; index++ {
		index := index
		go func() {
			defer waitGroup.Done()
			userID := int64(12000 + index)
			results[index], errs[index] = service.JoinRaffle(ctx, raffleID, auth.User{
				ID:          userID,
				Username:    fmt.Sprintf("user_%d", userID),
				DisplayName: fmt.Sprintf("User %d", userID),
			})
		}()
	}
	waitGroup.Wait()

	entryNumbers := map[int64]bool{}
	for index, err := range errs {
		if err != nil {
			t.Fatalf("join %d failed: %v", index, err)
		}
		result := results[index]
		if !result.Success || result.Entry == nil {
			t.Fatalf("join %d should succeed: %+v", index, result)
		}
		if entryNumbers[result.Entry.EntryNumber] {
			t.Fatalf("duplicate entry number: %d", result.Entry.EntryNumber)
		}
		entryNumbers[result.Entry.EntryNumber] = true
	}

	if len(entryNumbers) != workers {
		t.Fatalf("expected %d unique entry numbers, got %d", workers, len(entryNumbers))
	}
	if count := raffleParticipantsCount(t, ctx, service, raffleID); count != workers {
		t.Fatalf("expected participants_count %d, got %d", workers, count)
	}
}

func TestGrabRedPacketDeliversPointsAndEndsLastPacket(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("red-packet-last-%d", suffix)
	userID := 16001 + suffix%1_000_000_000
	if err := seedRedPacketRaffle(ctx, service, raffleID, "active", 7, 1, []int64{7}, 2000); err != nil {
		t.Fatalf("seed red packet failed: %v", err)
	}

	result, err := service.GrabRedPacket(ctx, raffleID, auth.User{ID: userID, Username: "alice", DisplayName: "Alice"})
	if err != nil {
		t.Fatalf("grab red packet failed: %v", err)
	}
	if !result.Success || result.Entry == nil || result.Reward == nil || result.Reward.Points != 7 {
		t.Fatalf("unexpected red packet result: %+v", result)
	}
	if result.Reward.RewardStatus != "delivered" || result.Message != "抢到 7 积分，已到账" {
		t.Fatalf("red packet reward should be delivered: %+v", result)
	}
	if balance := pointBalance(t, ctx, service, userID); balance != 7 {
		t.Fatalf("expected balance 7, got %d", balance)
	}
	if count := pointLedgerCount(t, ctx, service, userID, "raffle_win"); count != 1 {
		t.Fatalf("expected one raffle_win ledger, got %d", count)
	}
	if count := userRaffleWinCount(t, ctx, service, userID); count != 1 {
		t.Fatalf("expected one user raffle win, got %d", count)
	}
	if count := notificationCount(t, ctx, service, userID, "raffle_win"); count != 1 {
		t.Fatalf("expected one raffle_win notification, got %d", count)
	}

	detail, err := service.GetRaffleDetail(ctx, raffleID, &userID)
	if err != nil {
		t.Fatalf("get red packet detail failed: %v", err)
	}
	if detail.Raffle.Status != "ended" || detail.Raffle.WinnersCount != 1 || *detail.Raffle.RedPacketRemainingSlots != 0 || *detail.Raffle.RedPacketRemainingPoints != 0 {
		t.Fatalf("red packet should be ended and empty: %+v", detail.Raffle)
	}
	if detail.UserStatus == nil || !detail.UserStatus.HasJoined || !detail.UserStatus.IsWinner {
		t.Fatalf("user should be joined winner: %+v", detail.UserStatus)
	}
}

func TestGrabRedPacketRejectsDuplicateBeforeConsumingPacket(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("red-packet-duplicate-%d", suffix)
	userID := 17001 + suffix%1_000_000_000
	if err := seedRedPacketRaffle(ctx, service, raffleID, "active", 7, 2, []int64{3, 4}, 2000); err != nil {
		t.Fatalf("seed red packet failed: %v", err)
	}

	first, err := service.GrabRedPacket(ctx, raffleID, auth.User{ID: userID, Username: "bob", DisplayName: "Bob"})
	if err != nil {
		t.Fatalf("first grab failed: %v", err)
	}
	if !first.Success || first.Reward == nil || first.Reward.Points != 3 {
		t.Fatalf("unexpected first grab: %+v", first)
	}

	duplicate, err := service.GrabRedPacket(ctx, raffleID, auth.User{ID: userID, Username: "bob", DisplayName: "Bob"})
	if err != nil {
		t.Fatalf("duplicate grab failed: %v", err)
	}
	if duplicate.Success || duplicate.Message != "您已经抢过红包了" {
		t.Fatalf("duplicate should be rejected before consuming packet: %+v", duplicate)
	}

	status, remainingSlots, remainingPoints := redPacketState(t, ctx, service, raffleID)
	if status != "active" || remainingSlots != 1 || remainingPoints != 4 {
		t.Fatalf("duplicate should not consume remaining packet, status=%s slots=%d points=%d", status, remainingSlots, remainingPoints)
	}
}

func TestGrabRedPacketConcurrentRequestsDoNotOverIssue(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("red-packet-concurrent-%d", suffix)
	if err := seedRedPacketRaffle(ctx, service, raffleID, "active", 15, 5, []int64{1, 2, 3, 4, 5}, 2000); err != nil {
		t.Fatalf("seed red packet failed: %v", err)
	}

	const workers = 12
	results := make([]JoinRaffleResult, workers)
	errs := make([]error, workers)
	var waitGroup sync.WaitGroup
	waitGroup.Add(workers)
	for index := 0; index < workers; index++ {
		index := index
		go func() {
			defer waitGroup.Done()
			userID := int64(18000+index) + suffix%1_000_000_000
			results[index], errs[index] = service.GrabRedPacket(ctx, raffleID, auth.User{
				ID:          userID,
				Username:    fmt.Sprintf("packet_user_%d", userID),
				DisplayName: fmt.Sprintf("Packet User %d", userID),
			})
		}()
	}
	waitGroup.Wait()

	successes := 0
	var deliveredTotal int64
	for index, err := range errs {
		if err != nil {
			t.Fatalf("grab %d failed: %v", index, err)
		}
		result := results[index]
		if result.Success {
			successes++
			if result.Reward == nil || result.Reward.RewardStatus != "delivered" {
				t.Fatalf("successful grab should return delivered reward: %+v", result)
			}
			deliveredTotal += result.Reward.Points
		} else if result.Message != "红包已抢完" {
			t.Fatalf("failed grab should report sold out: %+v", result)
		}
	}
	if successes != 5 || deliveredTotal != 15 {
		t.Fatalf("expected 5 successes and 15 total points, got successes=%d points=%d", successes, deliveredTotal)
	}
	if count := raffleParticipantsCount(t, ctx, service, raffleID); count != 5 {
		t.Fatalf("expected participants_count 5, got %d", count)
	}
	if count := raffleEntryCount(t, ctx, service, raffleID); count != 5 {
		t.Fatalf("expected 5 entries, got %d", count)
	}
	status, remainingSlots, remainingPoints := redPacketState(t, ctx, service, raffleID)
	if status != "ended" || remainingSlots != 0 || remainingPoints != 0 {
		t.Fatalf("red packet should be exhausted, status=%s slots=%d points=%d", status, remainingSlots, remainingPoints)
	}
}

func TestGrabRedPacketEndsInvalidEmptyQueue(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	raffleID := fmt.Sprintf("red-packet-empty-%d", time.Now().UnixNano())
	if err := seedRedPacketRaffle(ctx, service, raffleID, "active", 0, 1, []int64{}, 2000); err != nil {
		t.Fatalf("seed red packet failed: %v", err)
	}

	result, err := service.GrabRedPacket(ctx, raffleID, auth.User{ID: 19001, Username: "empty", DisplayName: "Empty"})
	if err != nil {
		t.Fatalf("grab empty red packet failed: %v", err)
	}
	if result.Success || result.Message != "红包已抢完" {
		t.Fatalf("empty queue should be sold out: %+v", result)
	}
	status, remainingSlots, remainingPoints := redPacketState(t, ctx, service, raffleID)
	if status != "ended" || remainingSlots != 0 || remainingPoints != 0 {
		t.Fatalf("empty queue should mark ended, status=%s slots=%d points=%d", status, remainingSlots, remainingPoints)
	}
	if count := raffleEntryCount(t, ctx, service, raffleID); count != 0 {
		t.Fatalf("empty queue should not create entry, got %d", count)
	}
}

func TestExecuteRaffleDrawEndsRaffleAndStoresPendingWinners(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("raffle-draw-%d", suffix)
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`UPDATE raffles
		 SET prizes = '[{"id":"p1","name":"一等奖","points":5,"quantity":2},{"id":"p2","name":"二等奖","dollars":7,"quantity":1}]'::jsonb,
		     participants_count = 4
		 WHERE id = $1`,
		raffleID,
	); err != nil {
		t.Fatalf("seed prizes failed: %v", err)
	}
	for index := int64(1); index <= 4; index++ {
		if err := seedRaffleEntry(ctx, service, raffleID, fmt.Sprintf("entry-draw-%d-%d", suffix, index), 13000+index, fmt.Sprintf("user_%d", index), index, 2100+index); err != nil {
			t.Fatalf("seed entry %d failed: %v", index, err)
		}
	}

	result, err := service.ExecuteRaffleDraw(ctx, raffleID)
	if err != nil {
		t.Fatalf("execute draw failed: %v", err)
	}
	if !result.Success || len(result.Winners) != 3 || result.Message != "开奖成功，共 3 人中奖" {
		t.Fatalf("unexpected draw result: %+v", result)
	}

	winnerUsers := map[int64]bool{}
	hasDollarFallbackPrize := false
	for _, winner := range result.Winners {
		if winner.RewardStatus != "pending" {
			t.Fatalf("winner should be pending before delivery: %+v", winner)
		}
		if winnerUsers[winner.UserID] {
			t.Fatalf("duplicate winner user: %+v", result.Winners)
		}
		winnerUsers[winner.UserID] = true
		if winner.PrizeID == "p2" && winner.Points == 7 {
			hasDollarFallbackPrize = true
		}
	}
	if !hasDollarFallbackPrize {
		t.Fatalf("expected legacy dollars prize to normalize to points: %+v", result.Winners)
	}

	detail, err := service.GetRaffleDetail(ctx, raffleID, nil)
	if err != nil {
		t.Fatalf("get raffle detail failed: %v", err)
	}
	if detail.Raffle.Status != "ended" || detail.Raffle.WinnersCount != 3 || len(detail.Raffle.Winners) == 0 || detail.Raffle.DrawnAt == nil {
		t.Fatalf("ended raffle should expose winners and drawnAt: %+v", detail.Raffle)
	}

	var storedWinners []RaffleWinner
	if err := json.Unmarshal(detail.Raffle.Winners, &storedWinners); err != nil {
		t.Fatalf("stored winners should decode: %v", err)
	}
	if len(storedWinners) != 3 {
		t.Fatalf("expected 3 stored winners, got %+v", storedWinners)
	}
}

func TestExecuteRaffleDrawEndsEmptyRaffle(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	raffleID := fmt.Sprintf("raffle-draw-empty-%d", time.Now().UnixNano())
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}

	result, err := service.ExecuteRaffleDraw(ctx, raffleID)
	if err != nil {
		t.Fatalf("execute empty draw failed: %v", err)
	}
	if !result.Success || result.Message != "无人参与，活动已结束" || len(result.Winners) != 0 {
		t.Fatalf("unexpected empty draw result: %+v", result)
	}

	detail, err := service.GetRaffleDetail(ctx, raffleID, nil)
	if err != nil {
		t.Fatalf("get raffle detail failed: %v", err)
	}
	if detail.Raffle.Status != "ended" || detail.Raffle.WinnersCount != 0 || detail.Raffle.DrawnAt == nil {
		t.Fatalf("empty raffle should be ended with no winners: %+v", detail.Raffle)
	}
}

func TestExecuteRaffleDrawRejectsInvalidModesAndStates(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	endedID := fmt.Sprintf("raffle-draw-ended-%d", suffix)
	packetID := fmt.Sprintf("raffle-draw-packet-%d", suffix)
	if err := seedRaffle(ctx, service, endedID, "ended", 2000); err != nil {
		t.Fatalf("seed ended raffle failed: %v", err)
	}
	if err := seedRaffleMode(ctx, service, packetID, "red_packet", "active", 2000); err != nil {
		t.Fatalf("seed red packet raffle failed: %v", err)
	}

	ended, err := service.ExecuteRaffleDraw(ctx, endedID)
	if err != nil {
		t.Fatalf("draw ended raffle failed: %v", err)
	}
	if ended.Success || ended.Message != "活动状态不是进行中" {
		t.Fatalf("ended raffle should reject draw: %+v", ended)
	}

	packet, err := service.ExecuteRaffleDraw(ctx, packetID)
	if err != nil {
		t.Fatalf("draw red packet raffle failed: %v", err)
	}
	if packet.Success || packet.Message != "抢红包活动无需开奖" {
		t.Fatalf("red packet should reject draw: %+v", packet)
	}
}

func TestExecuteRaffleDrawConcurrentRequestsOnlyDrawOnce(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("raffle-draw-concurrent-%d", suffix)
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}
	if err := seedRaffleEntry(ctx, service, raffleID, fmt.Sprintf("entry-draw-concurrent-%d", suffix), 14001, "alice", 1, 2100); err != nil {
		t.Fatalf("seed entry failed: %v", err)
	}

	const workers = 2
	results := make([]DrawRaffleResult, workers)
	errs := make([]error, workers)
	var waitGroup sync.WaitGroup
	waitGroup.Add(workers)
	for index := 0; index < workers; index++ {
		index := index
		go func() {
			defer waitGroup.Done()
			results[index], errs[index] = service.ExecuteRaffleDraw(ctx, raffleID)
		}()
	}
	waitGroup.Wait()

	successes := 0
	rejections := 0
	for index, err := range errs {
		if err != nil {
			t.Fatalf("draw %d failed: %v", index, err)
		}
		if results[index].Success {
			successes++
		} else if results[index].Message == "活动状态不是进行中" {
			rejections++
		}
	}
	if successes != 1 || rejections != 1 {
		t.Fatalf("expected one successful draw and one status rejection, got %+v", results)
	}
}

func TestDeliverRaffleRewardsAwardsPointsAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("raffle-delivery-%d", suffix)
	userID := 15001 + suffix%1_000_000_000
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}
	if err := seedRaffleEntry(ctx, service, raffleID, fmt.Sprintf("entry-delivery-%d", suffix), userID, "alice", 1, 2100); err != nil {
		t.Fatalf("seed entry failed: %v", err)
	}

	drawResult, err := service.ExecuteRaffleDraw(ctx, raffleID)
	if err != nil {
		t.Fatalf("execute draw failed: %v", err)
	}
	if !drawResult.Success || len(drawResult.Winners) != 1 {
		t.Fatalf("unexpected draw result: %+v", drawResult)
	}
	winner := drawResult.Winners[0]

	delivery, err := service.DeliverRaffleRewards(ctx, raffleID)
	if err != nil {
		t.Fatalf("deliver raffle rewards failed: %v", err)
	}
	if !delivery.Success || len(delivery.Results) != 1 || !delivery.Results[0].Success {
		t.Fatalf("unexpected delivery result: %+v", delivery)
	}
	if balance := pointBalance(t, ctx, service, winner.UserID); balance != winner.Points {
		t.Fatalf("expected winner balance %d, got %d", winner.Points, balance)
	}
	if count := pointLedgerCount(t, ctx, service, winner.UserID, "raffle_win"); count != 1 {
		t.Fatalf("expected one raffle_win ledger entry, got %d", count)
	}
	if count := userRaffleWinCount(t, ctx, service, winner.UserID); count != 1 {
		t.Fatalf("expected one user raffle win entry, got %d", count)
	}
	if count := notificationCount(t, ctx, service, winner.UserID, "raffle_win"); count != 1 {
		t.Fatalf("expected one raffle_win notification, got %d", count)
	}

	second, err := service.DeliverRaffleRewards(ctx, raffleID)
	if err != nil {
		t.Fatalf("repeat deliver raffle rewards failed: %v", err)
	}
	if !second.Success || len(second.Results) != 1 || !second.Results[0].Success {
		t.Fatalf("unexpected repeat delivery result: %+v", second)
	}
	if balance := pointBalance(t, ctx, service, winner.UserID); balance != winner.Points {
		t.Fatalf("repeat delivery should not change balance, got %d", balance)
	}
	if count := pointLedgerCount(t, ctx, service, winner.UserID, "raffle_win"); count != 1 {
		t.Fatalf("repeat delivery should not add ledger entries, got %d", count)
	}
	if count := userRaffleWinCount(t, ctx, service, winner.UserID); count != 1 {
		t.Fatalf("repeat delivery should not add user raffle wins, got %d", count)
	}
	if count := notificationCount(t, ctx, service, winner.UserID, "raffle_win"); count != 1 {
		t.Fatalf("repeat delivery should not add notifications, got %d", count)
	}

	detail, err := service.GetRaffleDetail(ctx, raffleID, nil)
	if err != nil {
		t.Fatalf("get raffle detail failed: %v", err)
	}
	var storedWinners []RaffleWinner
	if err := json.Unmarshal(detail.Raffle.Winners, &storedWinners); err != nil {
		t.Fatalf("stored winners should decode: %v", err)
	}
	if len(storedWinners) != 1 || storedWinners[0].RewardStatus != "delivered" || storedWinners[0].DeliveredAt == 0 {
		t.Fatalf("winner should be marked delivered: %+v", storedWinners)
	}
}

func TestRaffleDeliveryQueueProcessesPendingWinner(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("raffle-delivery-queue-%d", suffix)
	entryID := fmt.Sprintf("entry-delivery-queue-%d", suffix)
	userID := 15501 + suffix%1_000_000_000
	if err := seedRaffle(ctx, service, raffleID, "ended", 2000); err != nil {
		t.Fatalf("seed ended raffle failed: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`UPDATE raffles
		 SET winners = jsonb_build_array(jsonb_build_object(
		       'entryId', $2::text,
		       'userId', $3::bigint,
		       'username', 'queue_user',
		       'prizeId', 'p1',
		       'prizeName', '队列积分',
		       'points', 12,
		       'rewardStatus', 'pending'
		     )),
		     winners_count = 1,
		     drawn_at_ms = 2200
		 WHERE id = $1`,
		raffleID,
		entryID,
		userID,
	); err != nil {
		t.Fatalf("seed pending winner failed: %v", err)
	}

	enqueued, err := service.EnqueueRaffleDelivery(ctx, raffleID, "draw")
	if err != nil {
		t.Fatalf("enqueue delivery failed: %v", err)
	}
	if !enqueued {
		t.Fatalf("first enqueue should create job")
	}
	duplicate, err := service.EnqueueRaffleDelivery(ctx, raffleID, "draw")
	if err != nil {
		t.Fatalf("duplicate enqueue failed: %v", err)
	}
	if duplicate {
		t.Fatalf("duplicate enqueue should be ignored")
	}

	result, err := service.ProcessRaffleDeliveryQueue(ctx, 5)
	if err != nil {
		t.Fatalf("process delivery queue failed: %v", err)
	}
	if !result.Success || result.ProcessedJobs != 1 || result.Delivered != 1 || result.Failed != 0 {
		t.Fatalf("unexpected queue result: %+v", result)
	}
	if balance := pointBalance(t, ctx, service, userID); balance != 12 {
		t.Fatalf("expected balance 12, got %d", balance)
	}
	if status := raffleDeliveryJobStatus(t, ctx, service, raffleID); status != "done" {
		t.Fatalf("expected queue job done, got %s", status)
	}
}

func TestDeliverRaffleRewardsRejectsActiveRaffle(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	raffleID := fmt.Sprintf("raffle-delivery-active-%d", time.Now().UnixNano())
	if err := seedRaffle(ctx, service, raffleID, "active", 2000); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}

	result, err := service.DeliverRaffleRewards(ctx, raffleID)
	if err != nil {
		t.Fatalf("deliver active raffle failed: %v", err)
	}
	if result.Success || result.Message != "活动尚未开奖" {
		t.Fatalf("active raffle should reject delivery: %+v", result)
	}
}

func TestDeliverRaffleRewardsKeepsInvalidPrizePending(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("raffle-delivery-invalid-%d", suffix)
	userID := 15002 + suffix%1_000_000_000
	if err := seedRaffle(ctx, service, raffleID, "ended", 2000); err != nil {
		t.Fatalf("seed ended raffle failed: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`UPDATE raffles
		 SET winners = jsonb_build_array(jsonb_build_object(
		       'entryId', $2::text,
		       'userId', $3::bigint,
		       'username', 'bob',
		       'prizeId', 'bad-prize',
		       'prizeName', '坏奖品',
		       'points', 0,
		       'rewardStatus', 'pending'
		     )),
		     winners_count = 1,
		     drawn_at_ms = 2200
		 WHERE id = $1`,
		raffleID,
		fmt.Sprintf("entry-invalid-%d", suffix),
		userID,
	); err != nil {
		t.Fatalf("seed invalid winner failed: %v", err)
	}

	result, err := service.DeliverRaffleRewards(ctx, raffleID)
	if err != nil {
		t.Fatalf("deliver invalid winner failed: %v", err)
	}
	if !result.Success || len(result.Results) != 1 || result.Results[0].Success || result.Results[0].Message != "奖品积分配置异常" {
		t.Fatalf("invalid prize should remain pending: %+v", result)
	}
	if count := pointLedgerCount(t, ctx, service, userID, "raffle_win"); count != 0 {
		t.Fatalf("invalid prize should not write ledger, got %d", count)
	}

	detail, err := service.GetRaffleDetail(ctx, raffleID, nil)
	if err != nil {
		t.Fatalf("get raffle detail failed: %v", err)
	}
	var storedWinners []RaffleWinner
	if err := json.Unmarshal(detail.Raffle.Winners, &storedWinners); err != nil {
		t.Fatalf("stored winners should decode: %v", err)
	}
	if len(storedWinners) != 1 || storedWinners[0].RewardStatus != "pending" || storedWinners[0].RewardMessage != "奖品积分配置异常" {
		t.Fatalf("invalid winner should stay pending with message: %+v", storedWinners)
	}
}

func TestClaimPublicProjectNewUserOnlyNotConsumedByNormalClaim(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	normalID := fmt.Sprintf("project-normal-%d", suffix)
	newUserOnlyID := fmt.Sprintf("project-newuser-%d", suffix)
	user := auth.User{ID: suffix, Username: fmt.Sprintf("tester-%d", suffix)}

	if err := seedClaimableProject(ctx, service, normalID, "普通福利", false); err != nil {
		t.Fatalf("seed 普通项目失败: %v", err)
	}
	if err := seedClaimableProject(ctx, service, newUserOnlyID, "新人福利", true); err != nil {
		t.Fatalf("seed 新人项目失败: %v", err)
	}

	normalResult, err := service.ClaimPublicProject(ctx, normalID, user)
	if err != nil {
		t.Fatalf("领取普通项目出错: %v", err)
	}
	if !normalResult.Success {
		t.Fatalf("领取普通福利应成功，却返回: %s", normalResult.Message)
	}

	newUserResult, err := service.ClaimPublicProject(ctx, newUserOnlyID, user)
	if err != nil {
		t.Fatalf("领取新人项目出错: %v", err)
	}
	if !newUserResult.Success {
		t.Fatalf("领取普通福利不应消耗新人资格，但领取新人福利失败: %s", newUserResult.Message)
	}
}

func TestClaimPublicProjectNewUserOnlyConsumedByNewUserClaim(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	firstID := fmt.Sprintf("project-newuser-a-%d", suffix)
	secondID := fmt.Sprintf("project-newuser-b-%d", suffix)
	user := auth.User{ID: suffix, Username: fmt.Sprintf("tester-%d", suffix)}

	if err := seedClaimableProject(ctx, service, firstID, "新人福利A", true); err != nil {
		t.Fatalf("seed 新人项目A失败: %v", err)
	}
	if err := seedClaimableProject(ctx, service, secondID, "新人福利B", true); err != nil {
		t.Fatalf("seed 新人项目B失败: %v", err)
	}

	firstResult, err := service.ClaimPublicProject(ctx, firstID, user)
	if err != nil {
		t.Fatalf("领取首个新人项目出错: %v", err)
	}
	if !firstResult.Success {
		t.Fatalf("首次领取新人福利应成功，却返回: %s", firstResult.Message)
	}

	secondResult, err := service.ClaimPublicProject(ctx, secondID, user)
	if err != nil {
		t.Fatalf("领取第二个新人项目出错: %v", err)
	}
	if secondResult.Success {
		t.Fatalf("领取新人福利后资格应已用尽，第二个新人福利不应可领，却返回成功")
	}
}

func TestClaimPublicProjectNewUserOnlyConcurrentClaimsConsumeOnce(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	suffix := time.Now().UnixNano()
	firstID := fmt.Sprintf("project-newuser-conc-a-%d", suffix)
	secondID := fmt.Sprintf("project-newuser-conc-b-%d", suffix)
	user := auth.User{ID: suffix, Username: fmt.Sprintf("tester-conc-%d", suffix)}

	if err := seedClaimableProject(ctx, service, firstID, "新人福利并发A", true); err != nil {
		t.Fatalf("seed 新人项目A失败: %v", err)
	}
	if err := seedClaimableProject(ctx, service, secondID, "新人福利并发B", true); err != nil {
		t.Fatalf("seed 新人项目B失败: %v", err)
	}

	// 预建用户与积分账户，并用外部事务锁住积分账户行，
	// 让两笔领取都推进到入账前，制造新人资格校验的并发窗口
	if _, err := service.db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		user.ID,
		user.Username,
	); err != nil {
		t.Fatalf("seed 用户失败: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())`,
		user.ID,
	); err != nil {
		t.Fatalf("seed 积分账户失败: %v", err)
	}
	blocker, err := service.db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin blocker tx failed: %v", err)
	}
	defer func() { _ = blocker.Rollback(ctx) }()
	if _, err := blocker.Exec(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		user.ID,
	); err != nil {
		t.Fatalf("lock point account failed: %v", err)
	}

	type claimOutcome struct {
		result ClaimProjectResult
		err    error
	}
	outcomes := make(chan claimOutcome, 2)
	for _, projectID := range []string{firstID, secondID} {
		projectID := projectID
		go func() {
			result, err := service.ClaimPublicProject(ctx, projectID, user)
			outcomes <- claimOutcome{result: result, err: err}
		}()
	}
	time.Sleep(700 * time.Millisecond)
	if err := blocker.Rollback(ctx); err != nil {
		t.Fatalf("release blocker tx failed: %v", err)
	}

	successCount := 0
	for i := 0; i < 2; i++ {
		outcome := <-outcomes
		if outcome.err != nil {
			t.Fatalf("并发领取新人项目出错: %v", outcome.err)
		}
		if outcome.result.Success {
			successCount++
		}
	}
	if successCount != 1 {
		t.Fatalf("并发领取两个新人专属项目应只成功一次，实际成功 %d 次", successCount)
	}
	var claimCount int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM exchange_logs WHERE user_id = $1 AND type = 'project_direct'`,
		user.ID,
	).Scan(&claimCount); err != nil {
		t.Fatalf("read exchange logs failed: %v", err)
	}
	if claimCount != 1 {
		t.Fatalf("新人资格只应被消耗一次，实际领取记录 %d 条", claimCount)
	}
}

func newIntegrationService(t *testing.T, ctx context.Context) (*Service, func()) {
	t.Helper()

	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		db.Close()
		t.Fatalf("apply migrations failed: %v", err)
	}

	return NewService(db), db.Close
}

func migrationsDir(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}

func seedProject(ctx context.Context, service *Service, id string, name string, status string, pinned bool, pinnedAt int64, createdAt int64) error {
	_, err := service.db.Exec(ctx,
		`INSERT INTO projects (
		   id, name, description, max_claims, claimed_count, codes_count, status,
		   created_at_ms, created_by, reward_type, direct_points, new_user_only,
		   pinned, pinned_at_ms
		 ) VALUES ($1, $2, '测试项目', 10, 0, 10, $3, $4, 'test', 'direct', 50, false, $5, NULLIF($6, 0))`,
		id,
		name,
		status,
		createdAt,
		pinned,
		pinnedAt,
	)
	return err
}

func seedClaimableProject(ctx context.Context, service *Service, id string, name string, newUserOnly bool) error {
	_, err := service.db.Exec(ctx,
		`INSERT INTO projects (
		   id, name, description, max_claims, claimed_count, codes_count, status,
		   created_at_ms, created_by, reward_type, direct_points, new_user_only,
		   pinned, pinned_at_ms
		 ) VALUES ($1, $2, '测试项目', 10, 0, 10, 'active', 1000, 'test', 'direct', 50, $3, false, NULL)`,
		id,
		name,
		newUserOnly,
	)
	return err
}

func seedRaffle(ctx context.Context, service *Service, id string, status string, createdAt int64) error {
	return seedRaffleMode(ctx, service, id, "draw", status, createdAt)
}

func seedRaffleMode(ctx context.Context, service *Service, id string, mode string, status string, createdAt int64) error {
	_, err := service.db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, $2, '测试抽奖', '测试描述', '[{"id":"p1","name":"积分","points":10,"quantity":1}]'::jsonb,
		           'threshold', 10, $3, 0, 0, 0, $4, $4)`,
		id,
		mode,
		status,
		createdAt,
	)
	return err
}

func seedRedPacketRaffle(ctx context.Context, service *Service, id string, status string, totalPoints int64, totalSlots int64, packets []int64, createdAt int64) error {
	rawPackets, err := json.Marshal(packets)
	if err != nil {
		return err
	}
	remainingPoints := sumRedPacketPackets(packets)
	remainingSlots := int64(len(packets))
	_, err = service.db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, winners, red_packet_total_points,
		   red_packet_total_slots, red_packet_remaining_points, red_packet_remaining_slots,
		   red_packet_packets, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'red_packet', '红包雨', '测试红包', '[]'::jsonb, 'manual', $2, $3,
		           0, 0, '[]'::jsonb, $4, $5, $6, $7, CAST($8 AS jsonb), 0, $9, $9)`,
		id,
		totalSlots,
		status,
		totalPoints,
		totalSlots,
		remainingPoints,
		remainingSlots,
		string(rawPackets),
		createdAt,
	)
	return err
}

func seedRaffleEntry(ctx context.Context, service *Service, raffleID string, entryID string, userID int64, username string, entryNumber int64, createdAt int64) error {
	_, err := service.db.Exec(ctx,
		`INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		entryID,
		raffleID,
		userID,
		username,
		entryNumber,
		createdAt,
	)
	return err
}

func containsRaffle(raffles []RaffleListItem, id string) bool {
	for _, raffle := range raffles {
		if raffle.ID == id {
			return true
		}
	}
	return false
}

func raffleParticipantsCount(t *testing.T, ctx context.Context, service *Service, raffleID string) int64 {
	t.Helper()

	var count int64
	if err := service.db.QueryRow(ctx,
		`SELECT participants_count FROM raffles WHERE id = $1`,
		raffleID,
	).Scan(&count); err != nil {
		t.Fatalf("query participants_count failed: %v", err)
	}
	return count
}

func raffleEntryCount(t *testing.T, ctx context.Context, service *Service, raffleID string) int64 {
	t.Helper()

	var count int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM raffle_entries WHERE raffle_id = $1`,
		raffleID,
	).Scan(&count); err != nil {
		t.Fatalf("query raffle entry count failed: %v", err)
	}
	return count
}

func redPacketState(t *testing.T, ctx context.Context, service *Service, raffleID string) (string, int64, int64) {
	t.Helper()

	var status string
	var remainingSlots int64
	var remainingPoints int64
	if err := service.db.QueryRow(ctx,
		`SELECT status, COALESCE(red_packet_remaining_slots, 0), COALESCE(red_packet_remaining_points, 0)
		 FROM raffles
		 WHERE id = $1`,
		raffleID,
	).Scan(&status, &remainingSlots, &remainingPoints); err != nil {
		t.Fatalf("query red packet state failed: %v", err)
	}
	return status, remainingSlots, remainingPoints
}

func pointBalance(t *testing.T, ctx context.Context, service *Service, userID int64) int64 {
	t.Helper()

	var balance int64
	if err := service.db.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1`,
		userID,
	).Scan(&balance); err != nil {
		t.Fatalf("query point balance failed: %v", err)
	}
	return balance
}

func pointLedgerCount(t *testing.T, ctx context.Context, service *Service, userID int64, source string) int64 {
	t.Helper()

	var count int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source = $2`,
		userID,
		source,
	).Scan(&count); err != nil {
		t.Fatalf("query point ledger count failed: %v", err)
	}
	return count
}

func userRaffleWinCount(t *testing.T, ctx context.Context, service *Service, userID int64) int64 {
	t.Helper()

	var count int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_raffle_wins WHERE user_id = $1`,
		userID,
	).Scan(&count); err != nil {
		t.Fatalf("query user raffle win count failed: %v", err)
	}
	return count
}

func notificationCount(t *testing.T, ctx context.Context, service *Service, userID int64, notificationType string) int64 {
	t.Helper()

	var count int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND type = $2`,
		userID,
		notificationType,
	).Scan(&count); err != nil {
		t.Fatalf("query notification count failed: %v", err)
	}
	return count
}

func raffleDeliveryJobStatus(t *testing.T, ctx context.Context, service *Service, raffleID string) string {
	t.Helper()

	var status string
	if err := service.db.QueryRow(ctx,
		`SELECT status FROM raffle_delivery_jobs WHERE raffle_id = $1 ORDER BY id DESC LIMIT 1`,
		raffleID,
	).Scan(&status); err != nil {
		t.Fatalf("query raffle delivery job status failed: %v", err)
	}
	return status
}
