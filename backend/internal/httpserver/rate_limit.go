package httpserver

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"redemption/backend/internal/auth"

	"github.com/redis/go-redis/v9"
)

type userRateLimitRule struct {
	prefix        string
	windowSeconds int64
	maxRequests   int64
}

type rateLimitResult struct {
	allowed    bool
	remaining  int64
	resetAt    int64
	retryAfter int64
}

type inMemoryRateLimitBucket struct {
	count   int64
	resetAt int64
}

var (
	storeExchangeRateLimit       = userRateLimitRule{prefix: "ratelimit:store:exchange", windowSeconds: 60, maxRequests: 20}
	storeBalanceRateLimit        = userRateLimitRule{prefix: "ratelimit:store:balance", windowSeconds: 60, maxRequests: 30}
	ecoGameActionRateLimit       = userRateLimitRule{prefix: "ratelimit:eco:game:action", windowSeconds: 60, maxRequests: 120}
	ecoCollectRateLimit          = userRateLimitRule{prefix: "ratelimit:eco:collect", windowSeconds: 60, maxRequests: 60}
	gameStartRateLimit           = userRateLimitRule{prefix: "ratelimit:game:start", windowSeconds: 60, maxRequests: 20}
	gameActionRateLimit          = userRateLimitRule{prefix: "ratelimit:game:action", windowSeconds: 60, maxRequests: 180}
	gameSubmitRateLimit          = userRateLimitRule{prefix: "ratelimit:game:submit", windowSeconds: 60, maxRequests: 60}
	farmActionRateLimit          = userRateLimitRule{prefix: "ratelimit:farm:action", windowSeconds: 60, maxRequests: 120}
	notificationsListRateLimit   = userRateLimitRule{prefix: "ratelimit:notifications:list", windowSeconds: 60, maxRequests: 60}
	notificationsReadRateLimit   = userRateLimitRule{prefix: "ratelimit:notifications:read", windowSeconds: 60, maxRequests: 60}
	notificationsDeleteRateLimit = userRateLimitRule{prefix: "ratelimit:notifications:delete", windowSeconds: 60, maxRequests: 30}
	notificationsClaimRateLimit  = userRateLimitRule{prefix: "ratelimit:rewards:claim", windowSeconds: 60, maxRequests: 20}
	announcementsListRateLimit   = userRateLimitRule{prefix: "ratelimit:announcements:list", windowSeconds: 60, maxRequests: 30}
	announcementsAdminRateLimit  = userRateLimitRule{prefix: "ratelimit:announcements:admin", windowSeconds: 60, maxRequests: 30}
	cardsReadRateLimit           = userRateLimitRule{prefix: "ratelimit:cards:read", windowSeconds: 60, maxRequests: 60}
	cardsDrawRateLimit           = userRateLimitRule{prefix: "ratelimit:cards:draw", windowSeconds: 30, maxRequests: 30}
	cardsExchangeRateLimit       = userRateLimitRule{prefix: "ratelimit:cards:exchange", windowSeconds: 60, maxRequests: 10}
	cardsClaimRewardRateLimit    = userRateLimitRule{prefix: "ratelimit:cards:claim-reward", windowSeconds: 60, maxRequests: 10}
	checkinRateLimit             = userRateLimitRule{prefix: "ratelimit:checkin", windowSeconds: 60, maxRequests: 5}
	checkinMakeupRateLimit       = userRateLimitRule{prefix: "ratelimit:checkin:makeup", windowSeconds: 60, maxRequests: 10}
	lotterySpinRateLimit         = userRateLimitRule{prefix: "ratelimit:lottery:spin", windowSeconds: 60, maxRequests: 20}
	lotteryAdminRateLimit        = userRateLimitRule{prefix: "ratelimit:lottery:admin", windowSeconds: 60, maxRequests: 30}
	numberBombReadRateLimit      = userRateLimitRule{prefix: "ratelimit:lottery:number-bomb:read", windowSeconds: 60, maxRequests: 60}
	numberBombWriteRateLimit     = userRateLimitRule{prefix: "ratelimit:lottery:number-bomb:write", windowSeconds: 60, maxRequests: 20}
	rankingsSettleRateLimit      = userRateLimitRule{prefix: "ratelimit:rankings:settle", windowSeconds: 60, maxRequests: 20}
	raffleJoinRateLimit          = userRateLimitRule{prefix: "ratelimit:welfare:raffle:join", windowSeconds: 60, maxRequests: 20}
	adminAlertsRateLimit         = userRateLimitRule{prefix: "ratelimit:admin:alerts", windowSeconds: 60, maxRequests: 60}
	adminRewardsRateLimit        = userRateLimitRule{prefix: "ratelimit:admin:rewards", windowSeconds: 60, maxRequests: 30}

	inMemoryRateLimits = struct {
		sync.Mutex
		buckets map[string]inMemoryRateLimitBucket
	}{buckets: make(map[string]inMemoryRateLimitBucket)}
)

func (handlers economyHandlers) rejectRateLimited(writer http.ResponseWriter, request *http.Request, user auth.User, rule userRateLimitRule) bool {
	result := handlers.checkUserRateLimit(request.Context(), user.ID, rule)
	if result.allowed {
		writer.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", result.remaining))
		writer.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", result.resetAt))
		return false
	}

	writer.Header().Set("Retry-After", fmt.Sprintf("%d", result.retryAfter))
	writer.Header().Set("X-RateLimit-Remaining", "0")
	writer.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", result.resetAt))
	writeJSON(writer, http.StatusTooManyRequests, map[string]any{
		"success":    false,
		"message":    "请求过于频繁，请稍后再试",
		"retryAfter": result.retryAfter,
	})
	return true
}

// INCR 与 EXPIRE 必须原子执行：分两条命令时 EXPIRE 一旦失败，key 永不过期，
// 用户会被永久限流。TTL < 0 分支同时自愈历史遗留的无过期 key。
var userRateLimitIncrScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
	redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`)

func (handlers economyHandlers) checkUserRateLimit(ctx context.Context, userID int64, rule userRateLimitRule) rateLimitResult {
	key := fmt.Sprintf("%s:%d", rule.prefix, userID)
	if handlers.deps.Redis == nil {
		return checkUserRateLimitInMemory(key, rule, time.Now())
	}

	count, err := userRateLimitIncrScript.Run(ctx, handlers.deps.Redis, []string{key}, rule.windowSeconds).Int64()
	if err != nil {
		handlers.deps.Logger.Warn("Redis 限流失败，降级到进程内限流", "key", key, "error", err)
		return checkUserRateLimitInMemory(key, rule, time.Now())
	}

	ttl, err := handlers.deps.Redis.TTL(ctx, key).Result()
	if err != nil || ttl <= 0 {
		ttl = time.Duration(rule.windowSeconds) * time.Second
	}
	now := time.Now().Unix()
	resetAt := now + int64(ttl.Seconds())
	remaining := rule.maxRequests - count
	if remaining < 0 {
		remaining = 0
	}
	if count > rule.maxRequests {
		return rateLimitResult{allowed: false, remaining: 0, resetAt: resetAt, retryAfter: maxInt64(1, resetAt-now)}
	}
	return rateLimitResult{allowed: true, remaining: remaining, resetAt: resetAt, retryAfter: 0}
}

func checkUserRateLimitInMemory(key string, rule userRateLimitRule, now time.Time) rateLimitResult {
	nowUnix := now.Unix()
	inMemoryRateLimits.Lock()
	defer inMemoryRateLimits.Unlock()

	bucket := inMemoryRateLimits.buckets[key]
	if bucket.resetAt <= nowUnix {
		bucket = inMemoryRateLimitBucket{
			count:   0,
			resetAt: nowUnix + rule.windowSeconds,
		}
	}
	bucket.count++
	inMemoryRateLimits.buckets[key] = bucket

	remaining := rule.maxRequests - bucket.count
	if remaining < 0 {
		remaining = 0
	}
	if bucket.count > rule.maxRequests {
		return rateLimitResult{allowed: false, remaining: 0, resetAt: bucket.resetAt, retryAfter: maxInt64(1, bucket.resetAt-nowUnix)}
	}
	return rateLimitResult{allowed: true, remaining: remaining, resetAt: bucket.resetAt, retryAfter: 0}
}

func resetInMemoryRateLimitsForTest() {
	inMemoryRateLimits.Lock()
	defer inMemoryRateLimits.Unlock()
	inMemoryRateLimits.buckets = make(map[string]inMemoryRateLimitBucket)
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
