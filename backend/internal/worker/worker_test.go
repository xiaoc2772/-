package worker

import (
	"io"
	"log/slog"
	"testing"
)

func TestSchedulerRecoversFromPanickingJob(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	scheduler := newScheduler(logger)
	entryID, err := scheduler.AddFunc("0 0 0 1 1 *", func() { panic("boom") })
	if err != nil {
		t.Fatalf("add func failed: %v", err)
	}
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("定时任务 panic 应被恢复而不是击穿 worker: %v", r)
		}
	}()
	scheduler.Entry(entryID).WrappedJob.Run()
}
