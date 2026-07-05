//go:build integration

package economy

import (
	"context"
	"testing"
	"time"

	"redemption/backend/internal/platform/newapi"
)

func cleanupWalletReconcileUser(t *testing.T, ctx context.Context, service *Service, userID int64) {
	t.Helper()
	_, _ = service.db.Exec(ctx, `DELETE FROM wallet_transactions WHERE user_id = $1`, userID)
	_, _ = service.db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID)
	_, _ = service.db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
	_, _ = service.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
}

// disconnectingQuotaClient 在外部额度调用进行中取消请求 ctx，
// 模拟客户端断连发生在最敏感的时刻。
type disconnectingQuotaClient struct {
	cancel       context.CancelFunc
	creditResult newapi.QuotaResult
	creditErr    error
	deductResult newapi.QuotaResult
	deductErr    error
}

func (client *disconnectingQuotaClient) GetQuotaBalance(ctx context.Context, userID int64) (newapi.QuotaBalance, error) {
	return newapi.QuotaBalance{}, nil
}

func (client *disconnectingQuotaClient) CreditQuota(ctx context.Context, userID int64, dollars float64) (newapi.QuotaResult, error) {
	client.cancel()
	return client.creditResult, client.creditErr
}

func (client *disconnectingQuotaClient) DeductQuota(ctx context.Context, userID int64, dollars float64) (newapi.QuotaResult, error) {
	client.cancel()
	return client.deductResult, client.deductErr
}

// 提现时额度入账明确失败，且客户端恰在此刻断连：
// 退款与事务审计必须照常完成，不能把用户积分吞掉。
func TestWithdrawRefundSurvivesClientDisconnect(t *testing.T) {
	ctx := context.Background()
	requestCtx, cancelRequest := context.WithCancel(ctx)
	defer cancelRequest()
	quota := &disconnectingQuotaClient{
		cancel:       cancelRequest,
		creditResult: newapi.QuotaResult{Success: false, Message: "账户额度入账失败"},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quota)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 1000)
	defer cleanupWalletReconcileUser(t, ctx, service, user.ID)

	result, err := service.ExecuteWithdraw(requestCtx, user, 100)
	if err != nil {
		t.Fatalf("客户端断连不应中断提现退款收尾: %v", err)
	}
	if result.Success {
		t.Fatalf("额度入账失败的提现不应成功: %+v", result)
	}

	assertBalance(t, ctx, service, user, 1000)
	transaction := latestWalletTransaction(t, ctx, service, user.ID, WalletOperationWithdraw)
	if transaction.Status != WalletStatusFailed {
		t.Fatalf("退款完成后事务应为 failed，got %s (message=%s)", transaction.Status, transaction.Message)
	}
}

// 充值时额度扣减调用因断连返回不确定结果：
// 积分入账与事务状态收尾必须照常完成，交易不能滞留在 pending。
func TestTopupSurvivesClientDisconnectDuringQuotaCall(t *testing.T) {
	ctx := context.Background()
	requestCtx, cancelRequest := context.WithCancel(ctx)
	defer cancelRequest()
	quota := &disconnectingQuotaClient{
		cancel:    cancelRequest,
		deductErr: context.Canceled,
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quota)
	defer cleanup()

	user := integrationUser()
	defer cleanupWalletReconcileUser(t, ctx, service, user.ID)

	result, err := service.ExecuteTopup(requestCtx, user, 1)
	if err != nil {
		t.Fatalf("客户端断连不应中断充值收尾: %v", err)
	}
	if !result.Uncertain {
		t.Fatalf("额度扣减结果未知时应标记 uncertain: %+v", result)
	}

	transaction := latestWalletTransaction(t, ctx, service, user.ID, WalletOperationTopup)
	if transaction.Status == WalletStatusPending {
		t.Fatalf("交易不应滞留在 pending (message=%s)", transaction.Message)
	}
	if transaction.Status != WalletStatusUncertain {
		t.Fatalf("expected uncertain, got %s (message=%s)", transaction.Status, transaction.Message)
	}
}

// 对账任务：滞留 pending 收敛为 uncertain，所有 uncertain 逐笔生成管理员告警，重复执行幂等。
func TestReconcileWalletTransactionsConvergesStalePendingAndAlerts(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	if _, err := service.db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())`,
		user.ID, user.Username, user.DisplayName,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	stalePendingID := "wallet_rec_pending_" + user.Username + time.Now().Format("150405.000000000")
	uncertainID := "wallet_rec_uncertain_" + user.Username + time.Now().Format("150405.000000000")
	defer func() {
		// Reconcile 会为库里所有 uncertain 交易生成告警（包括其他用例遗留的），
		// 兜底清掉全部 wallet_uncertain 告警，避免污染依赖告警计数的用例
		_, _ = service.db.Exec(ctx, `DELETE FROM admin_alerts WHERE source_key LIKE $1`,
			walletUncertainAlertSourcePrefix+"%")
		_, _ = service.db.Exec(ctx, `DELETE FROM wallet_transactions WHERE user_id = $1`, user.ID)
		_, _ = service.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, user.ID)
	}()

	if _, err := service.db.Exec(ctx,
		`INSERT INTO wallet_transactions (id, user_id, operation, status, points_delta, dollars_delta, message, created_at, updated_at)
		 VALUES ($1, $2, 'withdraw', 'pending', -100, 9.70, '提现处理中', now() - interval '20 minutes', now() - interval '20 minutes'),
		        ($3, $2, 'topup', 'uncertain', 10, -1, '额度扣减结果待确认', now(), now())`,
		stalePendingID, user.ID, uncertainID,
	); err != nil {
		t.Fatalf("seed transactions failed: %v", err)
	}

	first, err := service.ReconcileWalletTransactions(ctx, 10*time.Minute, 100)
	if err != nil {
		t.Fatalf("reconcile failed: %v", err)
	}
	// 测试库是共享的，可能存在其他用例遗留的 pending/uncertain，只做下界断言
	if first.MarkedUncertain < 1 {
		t.Fatalf("expected at least 1 stale pending marked, got %+v", first)
	}
	if first.AlertedUncertain < 2 {
		t.Fatalf("expected at least 2 alerts created, got %+v", first)
	}

	var staleStatus string
	if err := service.db.QueryRow(ctx,
		`SELECT status FROM wallet_transactions WHERE id = $1`, stalePendingID,
	).Scan(&staleStatus); err != nil {
		t.Fatalf("query stale transaction failed: %v", err)
	}
	if staleStatus != WalletStatusUncertain {
		t.Fatalf("滞留 pending 应收敛为 uncertain，got %s", staleStatus)
	}
	var alertCount int64
	if err := service.db.QueryRow(ctx,
		`SELECT count(*) FROM admin_alerts WHERE source_key IN ($1, $2) AND resolved = FALSE`,
		walletUncertainAlertSourcePrefix+stalePendingID, walletUncertainAlertSourcePrefix+uncertainID,
	).Scan(&alertCount); err != nil {
		t.Fatalf("query alerts failed: %v", err)
	}
	if alertCount != 2 {
		t.Fatalf("expected 2 admin alerts, got %d", alertCount)
	}

	second, err := service.ReconcileWalletTransactions(ctx, 10*time.Minute, 100)
	if err != nil {
		t.Fatalf("second reconcile failed: %v", err)
	}
	if second.MarkedUncertain != 0 {
		t.Fatalf("重复执行不应再转移 pending，got %+v", second)
	}
	// 幂等：自己种的两笔交易不会产生重复告警
	if err := service.db.QueryRow(ctx,
		`SELECT count(*) FROM admin_alerts WHERE source_key IN ($1, $2)`,
		walletUncertainAlertSourcePrefix+stalePendingID, walletUncertainAlertSourcePrefix+uncertainID,
	).Scan(&alertCount); err != nil {
		t.Fatalf("query alerts after second run failed: %v", err)
	}
	if alertCount != 2 {
		t.Fatalf("告警应按交易去重，expected 2, got %d", alertCount)
	}
}
