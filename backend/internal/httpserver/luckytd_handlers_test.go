package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLuckyTdRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/lucky-td/start", `{"mapId":"training_field","squad":["vanguard"]}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLuckyTdRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	status := performJSONRequest(handler, http.MethodGet, "/api/games/lucky-td/status", "", true)
	if status.Code != http.StatusServiceUnavailable || !strings.Contains(status.Body.String(), "幸运塔防数据库未配置") {
		t.Fatalf("unexpected status unavailable response: status=%d body=%s", status.Code, status.Body.String())
	}

	start := performJSONRequest(handler, http.MethodPost, "/api/games/lucky-td/start", `{"mapId":"training_field","squad":["vanguard"]}`, true)
	if start.Code != http.StatusServiceUnavailable || !strings.Contains(start.Body.String(), "幸运塔防数据库未配置") {
		t.Fatalf("unexpected start unavailable response: status=%d body=%s", start.Code, start.Body.String())
	}
}

func TestLuckyTdCheckpointAndSubmitValidatePayload(t *testing.T) {
	handler := New(testDependencies())

	checkpoint := performJSONRequest(handler, http.MethodPost, "/api/games/lucky-td/checkpoint", `{"sessionId":"","waveIndex":1,"frame":1,"stateHash":1}`, true)
	if checkpoint.Code != http.StatusBadRequest || !strings.Contains(checkpoint.Body.String(), "参数错误") {
		t.Fatalf("unexpected checkpoint validation response: status=%d body=%s", checkpoint.Code, checkpoint.Body.String())
	}

	submit := performJSONRequest(handler, http.MethodPost, "/api/games/lucky-td/submit", `{"sessionId":"","finalFrame":1,"claimedScore":0}`, true)
	if submit.Code != http.StatusBadRequest || !strings.Contains(submit.Body.String(), "参数错误") {
		t.Fatalf("unexpected submit validation response: status=%d body=%s", submit.Code, submit.Body.String())
	}
}

func TestLuckyTdUnsafeRoutesRejectCrossSiteOrigin(t *testing.T) {
	handler := New(testDependencies())
	request := httptest.NewRequest(http.MethodPost, "/api/games/lucky-td/cancel", strings.NewReader(`{"sessionId":"s1"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookie())

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site request to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}
}
