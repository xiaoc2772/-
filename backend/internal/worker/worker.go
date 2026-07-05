package worker

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"redemption/backend/internal/config"
	"redemption/backend/internal/eco"
	"redemption/backend/internal/economy"
	"redemption/backend/internal/farm"
	"redemption/backend/internal/lottery"
	"redemption/backend/internal/welfare"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/robfig/cron/v3"
)

type Dependencies struct {
	Config config.Config
	Logger *slog.Logger
	DB     *pgxpool.Pool
	Redis  *redis.Client
}

type Runner struct {
	deps            Dependencies
	farmEmailCursor int64
	farmEmailMu     sync.Mutex
}

func New(deps Dependencies) *Runner {
	return &Runner{deps: deps}
}

// newScheduler 挂载 cron.Recover，任一定时任务 panic 时记录日志并继续运行，
// 避免单个任务击穿整个 worker（结算、发奖、邮件全停）。
func newScheduler(logger *slog.Logger) *cron.Cron {
	return cron.New(cron.WithSeconds(), cron.WithChain(cron.Recover(cronSlogLogger{logger: logger})))
}

type cronSlogLogger struct {
	logger *slog.Logger
}

func (adapter cronSlogLogger) Info(msg string, keysAndValues ...any) {
	adapter.logger.Info(msg, keysAndValues...)
}

func (adapter cronSlogLogger) Error(err error, msg string, keysAndValues ...any) {
	adapter.logger.Error(msg, append([]any{"error", err}, keysAndValues...)...)
}

func (runner *Runner) Run(ctx context.Context) error {
	scheduler := newScheduler(runner.deps.Logger)

	if _, err := scheduler.AddFunc("0 */10 * * * *", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := eco.NewService(runner.deps.DB).ProcessTheftInvestigations(ctx, 25, 0)
		if err != nil {
			runner.deps.Logger.Error("环保偷盗追查失败", "error", err)
			return
		}
		if result.Checked > 0 || result.Skipped > 0 {
			runner.deps.Logger.Info(
				"环保偷盗追查完成",
				"checked", result.Checked,
				"caught", result.Caught,
				"escaped", result.Escaped,
				"rescheduled", result.Rescheduled,
				"skipped", result.Skipped,
			)
		}
	}); err != nil {
		return err
	}

	if _, err := scheduler.AddFunc("0 0 16 * * *", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := lottery.NewService(runner.deps.DB).SettleNumberBombDate(ctx, "")
		if err != nil {
			runner.deps.Logger.Error("数字炸弹结算失败", "error", err)
			return
		}
		runner.deps.Logger.Info(
			"数字炸弹结算完成",
			"date", result.Date,
			"systemNumber", result.SystemNumber,
			"processed", result.Processed,
			"won", result.Won,
			"lost", result.Lost,
			"skipped", result.Skipped,
		)
	}); err != nil {
		return err
	}

	if _, err := scheduler.AddFunc("0 */5 * * * *", func() {
		runner.farmEmailMu.Lock()
		defer runner.farmEmailMu.Unlock()

		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()

		emailSender := farm.NewResendEmailSender(farm.ResendEmailConfig{
			APIKey: runner.deps.Config.ResendAPIKey,
			APIURL: runner.deps.Config.ResendAPIURL,
			From:   runner.deps.Config.FarmMailFrom,
		})
		result, err := farm.NewService(farm.NewStore(runner.deps.DB)).ProcessMaturityEmails(ctx, farm.MaturityEmailScanInput{
			MaxUsers: 100,
			Cursor:   runner.farmEmailCursor,
			Sender:   emailSender,
		})
		if err != nil {
			runner.deps.Logger.Error("农场邮件提醒处理失败", "error", err)
			return
		}
		runner.farmEmailCursor = result.Cursor
		if result.CheckedEvents > 0 || result.Sent > 0 || result.Failed > 0 {
			runner.deps.Logger.Info(
				"农场邮件提醒处理完成",
				"scannedUsers", result.ScannedUsers,
				"processedUsers", result.ProcessedUsers,
				"checkedEvents", result.CheckedEvents,
				"sent", result.Sent,
				"skipped", result.Skipped,
				"failed", result.Failed,
				"cursor", result.Cursor,
			)
		}
	}); err != nil {
		return err
	}

	if _, err := scheduler.AddFunc("*/10 * * * * *", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := welfare.NewService(runner.deps.DB).ProcessRaffleDeliveryQueue(ctx, 5)
		if err != nil {
			runner.deps.Logger.Error("处理抽奖发奖队列失败", "error", err)
			return
		}
		if result.ProcessedJobs > 0 || result.RecoveredJobs > 0 || result.Failed > 0 || result.Pending > 0 {
			runner.deps.Logger.Info(
				"抽奖发奖队列处理完成",
				"processedJobs", result.ProcessedJobs,
				"delivered", result.Delivered,
				"failed", result.Failed,
				"pending", result.Pending,
				"recoveredJobs", result.RecoveredJobs,
			)
		}
	}); err != nil {
		return err
	}

	if _, err := scheduler.AddFunc("0 * * * * *", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := welfare.NewService(runner.deps.DB).ProcessDueScheduledRaffleDraws(ctx, 0, 20)
		if err != nil {
			runner.deps.Logger.Error("处理定时抽奖开奖失败", "error", err)
			return
		}
		if result.Checked > 0 || result.Failed > 0 {
			runner.deps.Logger.Info(
				"定时抽奖开奖处理完成",
				"checked", result.Checked,
				"drawn", result.Drawn,
				"enqueued", result.Enqueued,
				"skipped", result.Skipped,
				"failed", result.Failed,
			)
		}
	}); err != nil {
		return err
	}

	if _, err := scheduler.AddFunc("0 * * * * *", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		result, err := welfare.NewService(runner.deps.DB).ProcessAutoPauseProjects(ctx, 0, 100)
		if err != nil {
			runner.deps.Logger.Error("自动暂停福利项目失败", "error", err)
			return
		}
		if result.Paused > 0 {
			runner.deps.Logger.Info("自动暂停福利项目完成", "paused", result.Paused)
		}
	}); err != nil {
		return err
	}

	if _, err := scheduler.AddFunc("0 */5 * * * *", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := economy.NewService(runner.deps.DB).ReconcileWalletTransactions(ctx, 10*time.Minute, 100)
		if err != nil {
			runner.deps.Logger.Error("钱包交易对账失败", "error", err)
			return
		}
		if result.MarkedUncertain > 0 || result.AlertedUncertain > 0 {
			runner.deps.Logger.Warn(
				"钱包交易对账发现待人工核对的交易",
				"markedUncertain", result.MarkedUncertain,
				"alertedUncertain", result.AlertedUncertain,
			)
		}
	}); err != nil {
		return err
	}

	scheduler.Start()
	runner.deps.Logger.Info("Go Worker 已启动")

	<-ctx.Done()
	shutdownCtx := scheduler.Stop()
	select {
	case <-shutdownCtx.Done():
	case <-time.After(10 * time.Second):
		runner.deps.Logger.Warn("Go Worker 定时任务关闭超时")
	}

	runner.deps.Logger.Info("Go Worker 已关闭")
	return nil
}
