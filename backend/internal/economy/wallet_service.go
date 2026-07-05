package economy

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/platform/newapi"

	"github.com/jackc/pgx/v5"
)

var ErrWalletQuotaClientUnavailable = errors.New("wallet quota client is not configured")

// 必须小于 walletOperationLockTTL，避免收尾还在进行时锁已过期、并发请求闯入。
const walletOperationFinishTimeout = 55 * time.Second

type WalletQuotaClient interface {
	GetQuotaBalance(ctx context.Context, userID int64) (newapi.QuotaBalance, error)
	CreditQuota(ctx context.Context, userID int64, dollars float64) (newapi.QuotaResult, error)
	DeductQuota(ctx context.Context, userID int64, dollars float64) (newapi.QuotaResult, error)
}

func (service *Service) GetWalletQuotaBalance(ctx context.Context, user auth.User) (newapi.QuotaBalance, error) {
	if service.quotaClient == nil {
		return newapi.QuotaBalance{}, ErrWalletQuotaClientUnavailable
	}
	return service.quotaClient.GetQuotaBalance(ctx, user.ID)
}

func (service *Service) ExecuteWithdraw(ctx context.Context, user auth.User, points int64) (WithdrawResult, error) {
	if service.quotaClient == nil {
		return WithdrawResult{}, ErrWalletQuotaClientUnavailable
	}

	var output WithdrawResult
	err := service.RunWithWalletOperationLock(ctx, user.ID, WalletOperationWithdraw, func() error {
		result, err := service.executeWithdrawInner(ctx, user, points)
		output = result
		return err
	})
	if errors.Is(err, ErrWalletOperationBusy) {
		return WithdrawResult{
			Success: false,
			Message: "已有提现请求正在处理中，请稍后再试",
		}, nil
	}
	return output, err
}

func (service *Service) executeWithdrawInner(ctx context.Context, user auth.User, points int64) (WithdrawResult, error) {
	// 资金操作一旦产生副作用就必须走完补偿与审计收尾：
	// 剥离请求取消信号，客户端断连不再把交易滞留在 pending/uncertain。
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), walletOperationFinishTimeout)
	defer cancel()

	preview := PreviewWithdraw(points)
	if !preview.OK {
		return WithdrawResult{Success: false, Message: fallbackWalletMessage(preview.Message, "参数无效")}, nil
	}

	summary, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		return WithdrawResult{}, err
	}
	if summary.Balance < preview.Deducted {
		return WithdrawResult{Success: false, Message: "积分余额不足", Balance: summary.Balance}, nil
	}

	description := fmt.Sprintf("提现 %d 积分（手续费 %d，到账 $%s）",
		preview.Deducted,
		preview.FeePoints,
		formatWalletDollars(preview.Dollars),
	)
	transaction, err := service.BeginWalletTransaction(ctx, BeginWalletTransactionInput{
		UserID:          user.ID,
		Operation:       WalletOperationWithdraw,
		PointsDelta:     -preview.Deducted,
		DollarsDelta:    preview.Dollars,
		RequestedPoints: &preview.Deducted,
		FeePoints:       &preview.FeePoints,
		NetPoints:       &preview.NetPoints,
		Message:         description,
	})
	if err != nil {
		return WithdrawResult{}, err
	}

	deductResult, err := service.ApplyPointsDelta(ctx, user, PointMutationInput{
		Delta:          -preview.Deducted,
		Source:         SourceExchangeWithdraw,
		Description:    description,
		IdempotencyKey: "wallet-withdraw-deduct:" + transaction.ID,
	})
	if err != nil {
		if _, updateErr := service.UpdateWalletTransaction(ctx, UpdateWalletTransactionInput{
			ID:      transaction.ID,
			Status:  WalletStatusFailed,
			Message: "扣减积分失败",
		}); updateErr != nil {
			return WithdrawResult{}, updateErr
		}
		return WithdrawResult{}, err
	}
	if !deductResult.Success {
		if _, updateErr := service.UpdateWalletTransaction(ctx, UpdateWalletTransactionInput{
			ID:      transaction.ID,
			Status:  WalletStatusFailed,
			Message: fallbackWalletMessage(deductResult.Message, "扣减积分失败"),
		}); updateErr != nil {
			return WithdrawResult{}, updateErr
		}
		return WithdrawResult{
			Success: false,
			Message: fallbackWalletMessage(deductResult.Message, "扣减积分失败"),
			Balance: deductResult.Balance,
		}, nil
	}

	creditResult, creditErr := service.quotaClient.CreditQuota(ctx, user.ID, preview.Dollars)
	if creditErr != nil {
		if errors.Is(creditErr, newapi.ErrAdminAuthFailed) {
			creditResult = newapi.QuotaResult{
				Success: false,
				Message: "new-api 管理端鉴权失败，已退回积分",
			}
		} else {
			creditResult = quotaUncertainResult("提现额度入账结果不确定")
		}
	}

	if creditResult.Success {
		if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
			transaction.ID,
			WalletStatusSuccess,
			fallbackWalletMessage(creditResult.Message, "提现成功到账"),
			creditResult,
		)); err != nil {
			return WithdrawResult{}, err
		}
		return WithdrawResult{
			Success:   true,
			Message:   fmt.Sprintf("已成功提现 %d 积分至账户额度，到账 $%s", preview.Deducted, formatWalletDollars(preview.Dollars)),
			Balance:   deductResult.Balance,
			Dollars:   preview.Dollars,
			FeePoints: preview.FeePoints,
		}, nil
	}

	if creditResult.Uncertain {
		if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
			transaction.ID,
			WalletStatusUncertain,
			fallbackWalletMessage(creditResult.Message, "提现额度入账结果不确定"),
			creditResult,
		)); err != nil {
			return WithdrawResult{}, err
		}
		return WithdrawResult{
			Success:   false,
			Message:   strings.TrimSpace("提现请求已受理，但额度入账结果暂不确定，请稍后查看新 API 余额。" + creditResult.Message),
			Balance:   deductResult.Balance,
			Dollars:   preview.Dollars,
			FeePoints: preview.FeePoints,
			Uncertain: true,
		}, nil
	}

	refund, refundErr := service.ApplyPointsDelta(ctx, user, PointMutationInput{
		Delta:          preview.Deducted,
		Source:         SourceExchangeRefund,
		Description:    "提现失败回滚：" + fallbackWalletMessage(creditResult.Message, "账户额度入账失败"),
		IdempotencyKey: "wallet-withdraw-refund:" + transaction.ID,
	})
	if refundErr != nil || !refund.Success {
		message := "账户额度入账失败，且积分回滚失败"
		if refundErr == nil {
			message = "账户额度入账失败，且积分回滚失败：" + fallbackWalletMessage(refund.Message, "未知错误")
		}
		if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
			transaction.ID,
			WalletStatusUncertain,
			message,
			creditResult,
		)); err != nil {
			return WithdrawResult{}, err
		}
		if refundErr != nil {
			return WithdrawResult{}, refundErr
		}
		return WithdrawResult{
			Success:   false,
			Message:   message,
			Balance:   deductResult.Balance,
			Uncertain: true,
		}, nil
	}

	if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
		transaction.ID,
		WalletStatusFailed,
		fallbackWalletMessage(creditResult.Message, "账户额度入账失败，已退回积分"),
		creditResult,
	)); err != nil {
		return WithdrawResult{}, err
	}
	return WithdrawResult{
		Success: false,
		Message: fallbackWalletMessage(creditResult.Message, "账户额度入账失败，已退回积分"),
		Balance: refund.Balance,
	}, nil
}

func (service *Service) ExecuteTopup(ctx context.Context, user auth.User, dollars float64) (TopupResult, error) {
	if service.quotaClient == nil {
		return TopupResult{}, ErrWalletQuotaClientUnavailable
	}

	var output TopupResult
	err := service.RunWithWalletOperationLock(ctx, user.ID, WalletOperationTopup, func() error {
		result, err := service.executeTopupInner(ctx, user, dollars)
		output = result
		return err
	})
	if errors.Is(err, ErrWalletOperationBusy) {
		return TopupResult{
			Success: false,
			Message: "已有充值请求正在处理中，请稍后再试",
		}, nil
	}
	return output, err
}

func (service *Service) executeTopupInner(ctx context.Context, user auth.User, dollars float64) (TopupResult, error) {
	// 同 executeWithdrawInner：断连不得中断额度扣减后的积分入账与状态收尾。
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), walletOperationFinishTimeout)
	defer cancel()

	preview := PreviewTopup(dollars)
	if !preview.OK {
		return TopupResult{Success: false, Message: fallbackWalletMessage(preview.Message, "参数无效")}, nil
	}
	if err := service.ensureWalletUser(ctx, user); err != nil {
		return TopupResult{}, err
	}

	requestedDollars := float64(preview.SpentDollars)
	description := fmt.Sprintf("账户额度充值：扣 $%d 兑换 %d 积分", preview.SpentDollars, preview.PointsGained)
	transaction, err := service.BeginWalletTransaction(ctx, BeginWalletTransactionInput{
		UserID:           user.ID,
		Operation:        WalletOperationTopup,
		PointsDelta:      preview.PointsGained,
		DollarsDelta:     -requestedDollars,
		RequestedDollars: &requestedDollars,
		Message:          description,
	})
	if err != nil {
		return TopupResult{}, err
	}

	deductResult, deductErr := service.quotaClient.DeductQuota(ctx, user.ID, requestedDollars)
	if deductErr != nil {
		if errors.Is(deductErr, newapi.ErrAdminAuthFailed) {
			message := "new-api 管理端鉴权失败，未扣减账户额度"
			if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
				transaction.ID,
				WalletStatusFailed,
				message,
				newapi.QuotaResult{Success: false, Message: message},
			)); err != nil {
				return TopupResult{}, err
			}
			return TopupResult{
				Success: false,
				Message: message,
			}, nil
		}
		deductResult = quotaUncertainResult("账户额度扣减结果不确定")
	}
	if !deductResult.Success && !deductResult.Uncertain {
		if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
			transaction.ID,
			WalletStatusFailed,
			fallbackWalletMessage(deductResult.Message, "账户额度扣减失败"),
			deductResult,
		)); err != nil {
			return TopupResult{}, err
		}
		return TopupResult{
			Success:                   false,
			Message:                   fallbackWalletMessage(deductResult.Message, "账户额度扣减失败"),
			NewAPIBalanceDollars:      deductResult.NewBalanceDollars,
			NewAPIBalanceWholeDollars: deductResult.NewBalanceWholeDollars,
		}, nil
	}

	grantResult, grantErr := service.ApplyPointsDelta(ctx, user, PointMutationInput{
		Delta:          preview.PointsGained,
		Source:         SourceExchangeTopup,
		Description:    description,
		IdempotencyKey: "wallet-topup-grant:" + transaction.ID,
	})
	if grantErr != nil || !grantResult.Success {
		return service.handleTopupGrantFailure(ctx, transaction.ID, user.ID, requestedDollars, grantResult, grantErr, deductResult)
	}

	if deductResult.Uncertain {
		if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
			transaction.ID,
			WalletStatusUncertain,
			fallbackWalletMessage(deductResult.Message, "账户额度扣减结果待确认，积分已入账"),
			deductResult,
		)); err != nil {
			return TopupResult{}, err
		}
		return TopupResult{
			Success:                   true,
			Message:                   fmt.Sprintf("已为您加上 %d 积分；账户额度扣减结果待确认，请稍后核对新 API 余额", preview.PointsGained),
			Balance:                   grantResult.Balance,
			PointsGained:              preview.PointsGained,
			NewAPIBalanceDollars:      deductResult.NewBalanceDollars,
			NewAPIBalanceWholeDollars: deductResult.NewBalanceWholeDollars,
			Uncertain:                 true,
		}, nil
	}

	if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
		transaction.ID,
		WalletStatusSuccess,
		fallbackWalletMessage(deductResult.Message, "充值成功到账"),
		deductResult,
	)); err != nil {
		return TopupResult{}, err
	}
	return TopupResult{
		Success:                   true,
		Message:                   fmt.Sprintf("成功用 $%d 充值 %d 积分", preview.SpentDollars, preview.PointsGained),
		Balance:                   grantResult.Balance,
		PointsGained:              preview.PointsGained,
		NewAPIBalanceDollars:      deductResult.NewBalanceDollars,
		NewAPIBalanceWholeDollars: deductResult.NewBalanceWholeDollars,
	}, nil
}

func (service *Service) handleTopupGrantFailure(
	ctx context.Context,
	transactionID string,
	userID int64,
	requestedDollars float64,
	grantResult PointMutationResult,
	grantErr error,
	deductResult newapi.QuotaResult,
) (TopupResult, error) {
	grantMessage := fallbackWalletMessage(grantResult.Message, "积分入账失败")
	if grantErr != nil {
		grantMessage = "积分入账失败"
	}

	if deductResult.Success {
		rollback, rollbackErr := service.quotaClient.CreditQuota(ctx, userID, requestedDollars)
		if rollbackErr != nil {
			rollback = quotaUncertainResult("额度退回失败，请联系管理员")
		}
		rollbackHint := "额度退回失败，请联系管理员"
		status := WalletStatusUncertain
		if rollback.Success {
			rollbackHint = "已自动退回账户额度"
			status = WalletStatusFailed
		}
		if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
			transactionID,
			status,
			fmt.Sprintf("%s（%s）", grantMessage, rollbackHint),
			rollback,
		)); err != nil {
			return TopupResult{}, err
		}
		if grantErr != nil && !rollback.Success {
			return TopupResult{}, grantErr
		}
		return TopupResult{
			Success:   false,
			Message:   fmt.Sprintf("%s（%s）", grantMessage, rollbackHint),
			Uncertain: !rollback.Success,
		}, nil
	}

	if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
		transactionID,
		WalletStatusUncertain,
		"充值失败：积分入账与额度扣减状态均不确定",
		deductResult,
	)); err != nil {
		return TopupResult{}, err
	}
	if grantErr != nil {
		return TopupResult{}, grantErr
	}
	return TopupResult{
		Success:   false,
		Message:   "充值失败：积分入账与额度扣减状态均不确定，请稍后核对账户余额",
		Uncertain: true,
	}, nil
}

func (service *Service) ensureWalletUser(ctx context.Context, user auth.User) error {
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	if err := ensureUser(ctx, tx, user); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func walletTransactionQuotaUpdate(
	transactionID string,
	status string,
	message string,
	result newapi.QuotaResult,
) UpdateWalletTransactionInput {
	newQuota := result.NewQuota
	newBalanceDollars := result.NewBalanceDollars
	newBalanceWholeDollars := result.NewBalanceWholeDollars
	return UpdateWalletTransactionInput{
		ID:                        transactionID,
		Status:                    status,
		Message:                   message,
		NewAPIQuota:               &newQuota,
		NewAPIBalanceDollars:      &newBalanceDollars,
		NewAPIBalanceWholeDollars: &newBalanceWholeDollars,
	}
}

func quotaUncertainResult(message string) newapi.QuotaResult {
	return newapi.QuotaResult{
		Success:   false,
		Message:   message,
		Uncertain: true,
	}
}

func fallbackWalletMessage(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func formatWalletDollars(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", value), "0"), ".")
}
