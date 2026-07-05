package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"redemption/backend/internal/config"
)

func TestRaffleJoinRouteRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/raffle/test-raffle/join", "", false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected login required response, got %s", response.Body.String())
	}
}

func TestRaffleJoinRouteRejectsCrossSiteOrigin(t *testing.T) {
	handler := New(testDependencies())

	request, _ := http.NewRequest(http.MethodPost, "/api/raffle/test-raffle/join", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site join to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestRaffleJoinRouteRateLimit(t *testing.T) {
	handler := New(testDependencies())

	for index := 0; index < 20; index++ {
		response := performJSONRequest(handler, http.MethodPost, "/api/raffle/test-raffle/join", "", true)
		if response.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d should not be rate limited: body=%s", index+1, response.Body.String())
		}
	}

	response := performJSONRequest(handler, http.MethodPost, "/api/raffle/test-raffle/join", "", true)
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), "请求过于频繁") {
		t.Fatalf("expected 429 after rate limit, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminRaffleDrawRouteRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config = config.Config{
		SessionSecret:  testSessionSecret,
		AdminUsernames: map[string]struct{}{"admin": {}},
	}
	handler := New(deps)

	request, _ := http.NewRequest(http.MethodPost, "/api/admin/raffle/test-raffle/draw", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin required response, got %s", response.Body.String())
	}
}

func TestAdminRaffleListRouteRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config = config.Config{
		SessionSecret:  testSessionSecret,
		AdminUsernames: map[string]struct{}{"admin": {}},
	}
	handler := New(deps)

	request, _ := http.NewRequest(http.MethodGet, "/api/admin/raffle", nil)
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin required response, got %s", response.Body.String())
	}
}

func TestAdminProjectRoutesRequireAdmin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/projects", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated admin projects response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	request, _ := http.NewRequest(http.MethodGet, "/api/admin/projects", nil)
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden admin projects response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminProjectUnsafeRoutesRejectCrossSiteOrigin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	request, _ := http.NewRequest(http.MethodPost, "/api/admin/projects", strings.NewReader("name=测试&maxClaims=1&directPoints=1"))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site admin project response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminProjectRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	list := httptest.NewRequest(http.MethodGet, "/api/admin/projects", nil)
	list.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	listResponse := performRequest(handler, list)
	if listResponse.Code != http.StatusServiceUnavailable || !strings.Contains(listResponse.Body.String(), "项目管理数据库未配置") {
		t.Fatalf("expected unavailable list response, got status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}

	create := httptest.NewRequest(http.MethodPost, "/api/admin/projects", strings.NewReader("name=测试&maxClaims=1&directPoints=1"))
	create.Host = "example.com"
	create.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	create.Header.Set("Origin", "http://example.com")
	create.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	createResponse := performRequest(handler, create)
	if createResponse.Code != http.StatusServiceUnavailable || !strings.Contains(createResponse.Body.String(), "项目管理数据库未配置") {
		t.Fatalf("expected unavailable create response, got status=%d body=%s", createResponse.Code, createResponse.Body.String())
	}

	detail := httptest.NewRequest(http.MethodGet, "/api/admin/projects/test-project", nil)
	detail.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	detailResponse := performRequest(handler, detail)
	if detailResponse.Code != http.StatusServiceUnavailable || !strings.Contains(detailResponse.Body.String(), "项目管理数据库未配置") {
		t.Fatalf("expected unavailable detail response, got status=%d body=%s", detailResponse.Code, detailResponse.Body.String())
	}
}

func TestAdminRaffleCreateRouteRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config = config.Config{
		SessionSecret:  testSessionSecret,
		AdminUsernames: map[string]struct{}{"admin": {}},
	}
	handler := New(deps)

	request, _ := http.NewRequest(http.MethodPost, "/api/admin/raffle", strings.NewReader(`{"title":"测试","description":"说明","prizes":[{"name":"积分","points":1,"quantity":1}]}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin required response, got %s", response.Body.String())
	}
}

func TestAdminRafflePublishRouteRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config = config.Config{
		SessionSecret:  testSessionSecret,
		AdminUsernames: map[string]struct{}{"admin": {}},
	}
	handler := New(deps)

	request, _ := http.NewRequest(http.MethodPost, "/api/admin/raffle/test-raffle/publish", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin required response, got %s", response.Body.String())
	}
}

func TestAdminRaffleCancelRouteRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config = config.Config{
		SessionSecret:  testSessionSecret,
		AdminUsernames: map[string]struct{}{"admin": {}},
	}
	handler := New(deps)

	request, _ := http.NewRequest(http.MethodPost, "/api/admin/raffle/test-raffle/cancel", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin required response, got %s", response.Body.String())
	}
}

func TestAdminRaffleDeleteRouteRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config = config.Config{
		SessionSecret:  testSessionSecret,
		AdminUsernames: map[string]struct{}{"admin": {}},
	}
	handler := New(deps)

	request, _ := http.NewRequest(http.MethodDelete, "/api/admin/raffle/test-raffle", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin required response, got %s", response.Body.String())
	}
}

func TestAdminRaffleUpdateRouteRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config = config.Config{
		SessionSecret:  testSessionSecret,
		AdminUsernames: map[string]struct{}{"admin": {}},
	}
	handler := New(deps)

	request, _ := http.NewRequest(http.MethodPut, "/api/admin/raffle/test-raffle", strings.NewReader(`{"title":"更新"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin required response, got %s", response.Body.String())
	}
}

func TestAdminRaffleRetryRouteRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config = config.Config{
		SessionSecret:  testSessionSecret,
		AdminUsernames: map[string]struct{}{"admin": {}},
	}
	handler := New(deps)

	request, _ := http.NewRequest(http.MethodPost, "/api/admin/raffle/test-raffle/retry", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin required response, got %s", response.Body.String())
	}
}
