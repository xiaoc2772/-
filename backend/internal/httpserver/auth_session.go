package httpserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/auth"

	"github.com/redis/go-redis/v9"
)

const (
	sessionBlacklistGraceSeconds = 60
	sessionBlacklistKeyPrefix    = "auth:session:blacklist:"
	sessionRevokedAfterKeyPrefix = "auth:session:revoked-after:"
	loginFailKeyPrefix           = "auth:login:fail:"
	loginLockKeyPrefix           = "auth:login:lock:"
	loginFailThreshold           = int64(5)
	loginLockSeconds             = int64(2 * 60)
	loginFailWindowSeconds       = int64(15 * 60)
)

var (
	authLoginIPRateLimit   = userRateLimitRule{prefix: "ratelimit:auth:login:ip", windowSeconds: 60, maxRequests: 5}
	authLoginUserRateLimit = userRateLimitRule{prefix: "ratelimit:auth:login:user", windowSeconds: 60 * 60, maxRequests: 10}
)

func userFromRequestWithRevocation(deps Dependencies, writer http.ResponseWriter, request *http.Request) (*auth.User, bool) {
	user, ok := auth.UserFromRequest(
		request,
		deps.Config.SessionSecret,
		deps.Config.AdminUsernames,
	)
	if !ok {
		writeJSON(writer, http.StatusUnauthorized, map[string]any{
			"success": false,
			"message": "未登录",
		})
		return nil, false
	}

	revoked, err := isSessionRevoked(request.Context(), deps.Redis, *user)
	if err != nil {
		deps.Logger.Error("检查会话撤销状态失败", "error", err)
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "会话状态暂时不可用，请稍后重试",
		})
		return nil, false
	}
	if revoked {
		writeJSON(writer, http.StatusUnauthorized, map[string]any{
			"success": false,
			"message": "登录已失效，请重新登录",
		})
		return nil, false
	}

	return user, true
}

func isSessionRevoked(ctx context.Context, client *redis.Client, user auth.User) (bool, error) {
	if client == nil {
		return false, nil
	}

	if strings.TrimSpace(user.JTI) == "" {
		return true, nil
	}

	blacklisted, err := client.Exists(ctx, sessionBlacklistKeyPrefix+user.JTI).Result()
	if err != nil {
		return false, err
	}
	if blacklisted > 0 {
		return true, nil
	}

	rawRevokedAfter, err := client.Get(ctx, sessionRevokedAfterKeyPrefix+strconv.FormatInt(user.ID, 10)).Result()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	revokedAfter, err := strconv.ParseInt(strings.TrimSpace(rawRevokedAfter), 10, 64)
	if err != nil {
		return false, fmt.Errorf("invalid revoked-after value for user %d: %w", user.ID, err)
	}
	return revokedAfter > 0 && user.Iat <= revokedAfter, nil
}

func revokeSessionToken(ctx context.Context, client *redis.Client, user auth.User) error {
	if client == nil {
		return errors.New("redis client is not configured")
	}
	if strings.TrimSpace(user.JTI) == "" {
		return nil
	}

	nowMs := time.Now().UnixMilli()
	ttlSeconds := int64(1)
	if user.Exp > nowMs {
		ttlSeconds = (user.Exp - nowMs + 999) / 1000
	}
	ttlSeconds += sessionBlacklistGraceSeconds

	return client.Set(ctx, sessionBlacklistKeyPrefix+user.JTI, "1", time.Duration(ttlSeconds)*time.Second).Err()
}

func requireRedis(client *redis.Client) error {
	if client == nil {
		return errors.New("redis client is not configured")
	}
	return nil
}

func getLoginLockStatus(ctx context.Context, client *redis.Client, username string) (bool, int64, error) {
	if err := requireRedis(client); err != nil {
		return false, 0, err
	}
	ttl, err := client.TTL(ctx, loginLockKeyPrefix+username).Result()
	if err != nil {
		return false, 0, err
	}
	if ttl > 0 {
		return true, maxInt64(1, int64(ttl.Seconds())), nil
	}
	return false, 0, nil
}

func recordLoginFailure(ctx context.Context, client *redis.Client, username string) (bool, int64, error) {
	if err := requireRedis(client); err != nil {
		return false, 0, err
	}
	locked, remaining, err := getLoginLockStatus(ctx, client, username)
	if err != nil {
		return false, 0, err
	}
	if locked {
		return true, remaining, nil
	}

	failKey := loginFailKeyPrefix + username
	attempts, err := client.Incr(ctx, failKey).Result()
	if err != nil {
		return false, 0, err
	}
	if attempts == 1 {
		if err := client.Expire(ctx, failKey, time.Duration(loginFailWindowSeconds)*time.Second).Err(); err != nil {
			return false, 0, err
		}
	}
	if attempts >= loginFailThreshold {
		if err := client.Set(ctx, loginLockKeyPrefix+username, "1", time.Duration(loginLockSeconds)*time.Second).Err(); err != nil {
			return false, 0, err
		}
		_ = client.Del(ctx, failKey).Err()
		return true, loginLockSeconds, nil
	}
	return false, 0, nil
}

func clearLoginFailures(ctx context.Context, client *redis.Client, username string) error {
	if err := requireRedis(client); err != nil {
		return err
	}
	return client.Del(ctx, loginFailKeyPrefix+username, loginLockKeyPrefix+username).Err()
}

func checkAuthRateLimit(ctx context.Context, client *redis.Client, key string, rule userRateLimitRule) (rateLimitResult, error) {
	if err := requireRedis(client); err != nil {
		return rateLimitResult{}, err
	}
	fullKey := rule.prefix + ":" + key
	count, err := client.Incr(ctx, fullKey).Result()
	if err != nil {
		return rateLimitResult{}, err
	}
	if count == 1 {
		if err := client.Expire(ctx, fullKey, time.Duration(rule.windowSeconds)*time.Second).Err(); err != nil {
			return rateLimitResult{}, err
		}
	}
	ttl, err := client.TTL(ctx, fullKey).Result()
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
		return rateLimitResult{allowed: false, remaining: 0, resetAt: resetAt, retryAfter: maxInt64(1, resetAt-now)}, nil
	}
	return rateLimitResult{allowed: true, remaining: remaining, resetAt: resetAt, retryAfter: 0}, nil
}

// clientIP 解析请求来源 IP，仅用于登录限流。
// 不信任任何客户端可伪造的单值头（Cf-Connecting-Ip / True-Client-Ip / X-Real-Ip）；
// 仅当直连对端是内网反向代理（本部署为 Caddy，会把真实来源追加到 X-Forwarded-For 链尾）时
// 才解析 X-Forwarded-For，从右往左取第一个公网 IP，跳过代理链上的内网地址。
func clientIP(request *http.Request) string {
	remote := remoteAddrIP(request)
	if remote != "" && isPrivateOrLoopbackIP(remote) {
		if ip := rightmostPublicForwardedIP(request.Header.Get("X-Forwarded-For")); ip != "" {
			return ip
		}
	}
	if remote != "" {
		return remote
	}
	return "unknown"
}

func remoteAddrIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		if ip := normalizeIP(host); ip != "" {
			return ip
		}
	}
	return normalizeIP(request.RemoteAddr)
}

func isPrivateOrLoopbackIP(value string) bool {
	ip := net.ParseIP(value)
	if ip == nil {
		return false
	}
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()
}

func rightmostPublicForwardedIP(value string) string {
	parts := strings.Split(value, ",")
	for index := len(parts) - 1; index >= 0; index-- {
		ip := normalizeIP(parts[index])
		if ip == "" {
			continue
		}
		if !isPrivateOrLoopbackIP(ip) {
			return ip
		}
	}
	return ""
}

func normalizeIP(value string) string {
	value = strings.TrimSpace(strings.Trim(value, `"`))
	if value == "" || strings.EqualFold(value, "unknown") {
		return ""
	}
	if strings.HasPrefix(value, "[") {
		if host, _, err := net.SplitHostPort(value); err == nil {
			value = host
		} else if end := strings.Index(value, "]"); end > 0 {
			value = value[1:end]
		}
	} else if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	if zone := strings.Index(value, "%"); zone >= 0 {
		value = value[:zone]
	}
	if net.ParseIP(value) == nil {
		return ""
	}
	return value
}

func clearSessionCookies(writer http.ResponseWriter, request *http.Request) {
	secure := request.TLS != nil || strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https")
	for _, name := range []string{"app_session", "session", "new_api_session"} {
		http.SetCookie(writer, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   secure,
		})
	}
}
