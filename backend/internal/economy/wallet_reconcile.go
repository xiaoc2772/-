package economy

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type WalletReconcileResult struct {
	MarkedUncertain  int64
	AlertedUncertain int64
}

const walletUncertainAlertSourcePrefix = "wallet_uncertain:"

// ReconcileWalletTransactions 收敛钱包交易的中间状态：
//  1. 滞留超过 pendingOlderThan 的 pending 交易只可能是处理进程中断的遗留
//     （正常流程持锁最多 walletOperationFinishTimeout 就会离开 pending），
//     外部额度调用结果未知，统一收敛为 uncertain；
//  2. 所有 uncertain 交易逐笔生成管理员告警（按交易 ID 幂等）。
//     new-api 额度接口不提供操作流水查询、也非幂等，无法安全地自动补偿，
//     resolution 必须由管理员人工核对后处理。
func (service *Service) ReconcileWalletTransactions(ctx context.Context, pendingOlderThan time.Duration, limit int) (WalletReconcileResult, error) {
	if pendingOlderThan <= 0 {
		pendingOlderThan = 10 * time.Minute
	}
	if limit <= 0 {
		limit = 100
	}

	var result WalletReconcileResult
	tag, err := service.db.Exec(ctx,
		`UPDATE wallet_transactions
		    SET status = $1,
		        message = message || '；处理进程中断，结果未知，待人工核对',
		        updated_at = now()
		  WHERE status = $2
		    AND updated_at < now() - make_interval(secs => $3)`,
		WalletStatusUncertain,
		WalletStatusPending,
		pendingOlderThan.Seconds(),
	)
	if err != nil {
		return result, err
	}
	result.MarkedUncertain = tag.RowsAffected()

	rows, err := service.db.Query(ctx,
		`SELECT id, user_id, operation, points_delta, CAST(dollars_delta AS double precision), message
		   FROM wallet_transactions
		  WHERE status = $1
		  ORDER BY updated_at DESC
		  LIMIT $2`,
		WalletStatusUncertain,
		limit,
	)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	type uncertainTransaction struct {
		id          string
		userID      int64
		operation   string
		pointsDelta int64
		dollars     float64
		message     string
	}
	pendingAlerts := []uncertainTransaction{}
	for rows.Next() {
		var item uncertainTransaction
		if err := rows.Scan(&item.id, &item.userID, &item.operation, &item.pointsDelta, &item.dollars, &item.message); err != nil {
			return result, err
		}
		pendingAlerts = append(pendingAlerts, item)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}

	nowMs := time.Now().UnixMilli()
	for _, item := range pendingAlerts {
		tags, err := json.Marshal(map[string]any{
			"transactionId": item.id,
			"userId":        item.userID,
			"operation":     item.operation,
			"pointsDelta":   item.pointsDelta,
			"dollarsDelta":  item.dollars,
		})
		if err != nil {
			return result, err
		}
		tag, err := service.db.Exec(ctx,
			`INSERT INTO admin_alerts (id, level, name, message, tags, source_key, occurred_at_ms)
			 VALUES ($1, 'critical', 'wallet_uncertain', $2, $3::jsonb, $4, $5)
			 ON CONFLICT (source_key) DO NOTHING`,
			"alert_"+randomID(),
			fmt.Sprintf("钱包交易结果不确定，待人工核对：用户 %d %s，积分变动 %d，美元变动 %.2f（%s）",
				item.userID, item.operation, item.pointsDelta, item.dollars, item.message),
			string(tags),
			walletUncertainAlertSourcePrefix+item.id,
			nowMs,
		)
		if err != nil {
			return result, err
		}
		result.AlertedUncertain += tag.RowsAffected()
	}
	return result, nil
}
