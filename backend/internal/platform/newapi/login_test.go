package newapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoginParsesUserNestedInDataForNewAuthAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/user/login" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		writeLoginEnvelope(t, writer, true, "", map[string]any{
			"access_token":      "at-123",
			"token_type":        "Bearer",
			"access_expires_at": 1790000000,
			"session": map[string]any{
				"sid":     "sid-abc",
				"current": true,
			},
			"user": map[string]any{
				"id":           7,
				"username":     "lucky",
				"display_name": "Lucky",
				"role":         100,
				"status":       1,
				"email":        "lucky@example.com",
				"quota":        1000000,
				"used_quota":   500,
			},
		})
	}))
	defer server.Close()

	result, err := Login(context.Background(), server.URL, "lucky", "password", http.DefaultClient)
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	if !result.Success || result.User == nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.User.ID != 7 || result.User.Username != "lucky" || result.User.Role != 100 || result.User.Quota != 1000000 {
		t.Fatalf("unexpected user: %+v", result.User)
	}
}
