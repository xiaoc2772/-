package httpserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestPianoTilesRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/start", `{"chartId":"101","mode":"classic","checksum":"deadbeef"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}

	personalBests := performJSONRequest(handler, http.MethodGet, "/api/games/piano-tiles/personal-bests", "", false)
	if personalBests.Code != http.StatusUnauthorized || !strings.Contains(personalBests.Body.String(), "未登录") {
		t.Fatalf("expected personal bests to require login, got status=%d body=%s", personalBests.Code, personalBests.Body.String())
	}
}

func TestPianoTilesCheckpointValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	missingSession := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/checkpoint", `{"events":[{"t":100,"lane":0,"j":"p"}]}`, true)
	if missingSession.Code != http.StatusBadRequest || !strings.Contains(missingSession.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing session response: status=%d body=%s", missingSession.Code, missingSession.Body.String())
	}

	badJSON := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/checkpoint", `{`, true)
	if badJSON.Code != http.StatusBadRequest || !strings.Contains(badJSON.Body.String(), "参数错误") {
		t.Fatalf("unexpected bad json response: status=%d body=%s", badJSON.Code, badJSON.Body.String())
	}
}

func TestPianoTilesSubmitValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	missingSession := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/submit", `{"result":{"status":"completed"}}`, true)
	if missingSession.Code != http.StatusBadRequest || !strings.Contains(missingSession.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing session response: status=%d body=%s", missingSession.Code, missingSession.Body.String())
	}
}

func TestPianoTilesEventBatchAndBodySizeLimits(t *testing.T) {
	handler := New(testDependencies())
	event := `{"t":0,"lane":0,"j":"h","b":0}`
	events := strings.Repeat(event+",", 2048) + event

	checkpointBody := `{"sessionId":"s1","eventOffset":0,"events":[` + events + `]}`
	checkpoint := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/checkpoint", checkpointBody, true)
	if checkpoint.Code != http.StatusRequestEntityTooLarge || !strings.Contains(checkpoint.Body.String(), "2048") {
		t.Fatalf("unexpected checkpoint batch limit response: status=%d body=%s", checkpoint.Code, checkpoint.Body.String())
	}

	submitBody := `{"sessionId":"s1","eventOffset":0,"result":{"status":"failed","score":0,"tilesHit":0,"crowns":0,"laps":0,"playedMs":0},"events":[` + events + `]}`
	submit := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/submit", submitBody, true)
	if submit.Code != http.StatusRequestEntityTooLarge || !strings.Contains(submit.Body.String(), "2048") {
		t.Fatalf("unexpected submit batch limit response: status=%d body=%s", submit.Code, submit.Body.String())
	}

	oversizedBody := `{"sessionId":"s1","eventOffset":0,"padding":"` + strings.Repeat("x", pianoTilesMaxEventBodyBytes) + `","events":[]}`
	oversized := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/checkpoint", oversizedBody, true)
	if oversized.Code != http.StatusRequestEntityTooLarge || !strings.Contains(oversized.Body.String(), "请求体过大") {
		t.Fatalf("unexpected checkpoint body limit response: status=%d body=%s", oversized.Code, oversized.Body.String())
	}

	// 解码器必须继续读取合法对象后的空白，否则超大尾部不会触发 MaxBytesReader。
	oversizedTrailing := `{"sessionId":"s1","eventOffset":0,"events":[]}` + strings.Repeat(" ", pianoTilesMaxEventBodyBytes)
	trailing := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/checkpoint", oversizedTrailing, true)
	if trailing.Code != http.StatusRequestEntityTooLarge || !strings.Contains(trailing.Body.String(), "请求体过大") {
		t.Fatalf("unexpected trailing body limit response: status=%d body=%s", trailing.Code, trailing.Body.String())
	}

	multipleJSON := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/checkpoint", `{"sessionId":"s1","events":[]} {}`, true)
	if multipleJSON.Code != http.StatusBadRequest || !strings.Contains(multipleJSON.Body.String(), "参数错误") {
		t.Fatalf("unexpected multiple JSON response: status=%d body=%s", multipleJSON.Code, multipleJSON.Body.String())
	}
}

func TestPianoTilesRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	status := performJSONRequest(handler, http.MethodGet, "/api/games/piano-tiles/status", "", true)
	if status.Code != http.StatusServiceUnavailable || !strings.Contains(status.Body.String(), "钢琴块数据库未配置") {
		t.Fatalf("unexpected status unavailable response: status=%d body=%s", status.Code, status.Body.String())
	}

	personalBests := performJSONRequest(handler, http.MethodGet, "/api/games/piano-tiles/personal-bests", "", true)
	if personalBests.Code != http.StatusServiceUnavailable || !strings.Contains(personalBests.Body.String(), "钢琴块数据库未配置") {
		t.Fatalf("unexpected personal bests unavailable response: status=%d body=%s", personalBests.Code, personalBests.Body.String())
	}

	start := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/start", `{"chartId":"101","mode":"classic","checksum":"deadbeef"}`, true)
	if start.Code != http.StatusServiceUnavailable || !strings.Contains(start.Body.String(), "钢琴块数据库未配置") {
		t.Fatalf("unexpected start unavailable response: status=%d body=%s", start.Code, start.Body.String())
	}

	cancel := performJSONRequest(handler, http.MethodPost, "/api/games/piano-tiles/cancel", `{"sessionId":"s1"}`, true)
	if cancel.Code != http.StatusServiceUnavailable || !strings.Contains(cancel.Body.String(), "钢琴块数据库未配置") {
		t.Fatalf("unexpected cancel unavailable response: status=%d body=%s", cancel.Code, cancel.Body.String())
	}
}
