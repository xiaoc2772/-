//go:build integration

package httpserver

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestCheckUserRateLimitHealsKeyWithoutTTL(t *testing.T) {
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("TEST_REDIS_URL 未设置，跳过 Redis 集成测试")
	}

	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis url failed: %v", err)
	}
	client := redis.NewClient(options)
	defer client.Close()

	ctx := context.Background()
	rule := userRateLimitRule{prefix: "ratelimit:test:heal", windowSeconds: 60, maxRequests: 100}
	userID := int64(88001 + time.Now().UnixNano()%1_000_000)
	key := fmt.Sprintf("%s:%d", rule.prefix, userID)
	if err := client.Del(ctx, key).Err(); err != nil {
		t.Fatalf("cleanup key failed: %v", err)
	}
	defer func() {
		_ = client.Del(ctx, key).Err()
	}()

	// 模拟历史上 INCR 成功但 EXPIRE 失败遗留的无过期 key
	if err := client.Set(ctx, key, 5, 0).Err(); err != nil {
		t.Fatalf("seed key without ttl failed: %v", err)
	}

	handlers := economyHandlers{deps: Dependencies{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Redis:  client,
	}}
	result := handlers.checkUserRateLimit(ctx, userID, rule)
	if !result.allowed {
		t.Fatalf("expected request allowed, got %+v", result)
	}

	ttl, err := client.TTL(ctx, key).Result()
	if err != nil {
		t.Fatalf("query ttl failed: %v", err)
	}
	if ttl <= 0 {
		t.Fatalf("无 TTL 的限流 key 应被补上过期时间，否则用户会被永久限流，got ttl=%v", ttl)
	}
}

func TestCheckUserRateLimitSetsTTLAtomically(t *testing.T) {
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("TEST_REDIS_URL 未设置，跳过 Redis 集成测试")
	}

	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis url failed: %v", err)
	}
	client := redis.NewClient(options)
	defer client.Close()

	ctx := context.Background()
	rule := userRateLimitRule{prefix: "ratelimit:test:atomic", windowSeconds: 60, maxRequests: 3}
	userID := int64(88001 + time.Now().UnixNano()%1_000_000)
	key := fmt.Sprintf("%s:%d", rule.prefix, userID)
	if err := client.Del(ctx, key).Err(); err != nil {
		t.Fatalf("cleanup key failed: %v", err)
	}
	defer func() {
		_ = client.Del(ctx, key).Err()
	}()

	handlers := economyHandlers{deps: Dependencies{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Redis:  client,
	}}
	for index := 0; index < 3; index++ {
		if result := handlers.checkUserRateLimit(ctx, userID, rule); !result.allowed {
			t.Fatalf("request %d should be allowed, got %+v", index+1, result)
		}
	}
	if result := handlers.checkUserRateLimit(ctx, userID, rule); result.allowed {
		t.Fatalf("4th request should be limited, got %+v", result)
	}

	ttl, err := client.TTL(ctx, key).Result()
	if err != nil {
		t.Fatalf("query ttl failed: %v", err)
	}
	if ttl <= 0 || ttl > time.Duration(rule.windowSeconds)*time.Second {
		t.Fatalf("expected ttl in (0, %ds], got %v", rule.windowSeconds, ttl)
	}
}
