package newapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type User struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        int64  `json:"role"`
	Status      int64  `json:"status"`
	Email       string `json:"email"`
	Quota       int64  `json:"quota"`
	UsedQuota   int64  `json:"used_quota"`
}

type LoginResult struct {
	Success bool
	Message string
	Cookies string
	User    *User
}

type loginEnvelope struct {
	Success bool            `json:"success"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func Login(ctx context.Context, baseURL string, username string, password string, httpClient *http.Client) (LoginResult, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return LoginResult{}, errors.New("NEW_API_URL is not set")
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 8 * time.Second}
	}

	body, err := json.Marshal(map[string]string{
		"username": strings.TrimSpace(username),
		"password": strings.TrimSpace(password),
	})
	if err != nil {
		return LoginResult{}, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/api/user/login", bytes.NewReader(body))
	if err != nil {
		return LoginResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := httpClient.Do(request)
	if err != nil {
		return LoginResult{}, err
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return LoginResult{}, err
	}
	var envelope loginEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return LoginResult{}, err
	}

	if response.StatusCode >= 500 {
		return LoginResult{}, fmt.Errorf("%s", fallbackMessage(envelope.Message, "new-api 登录服务错误"))
	}
	if !envelope.Success {
		return LoginResult{
			Success: false,
			Message: fallbackMessage(envelope.Message, "登录失败"),
		}, nil
	}

	user, err := parseLoginUser(envelope.Data)
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{
		Success: true,
		Message: "登录成功",
		Cookies: cookieHeader(response.Cookies()),
		User:    &user,
	}, nil
}

func cookieHeader(cookies []*http.Cookie) string {
	values := make([]string, 0, len(cookies))
	for _, cookie := range cookies {
		if cookie == nil || strings.TrimSpace(cookie.Name) == "" {
			continue
		}
		values = append(values, cookie.Name+"="+cookie.Value)
	}
	return strings.Join(values, "; ")
}

func parseLoginUser(raw json.RawMessage) (User, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return User{}, errors.New("new-api login response missing user data")
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return User{}, err
	}
	user := userFromMap(data)
	if user.ID <= 0 || user.Username == "" {
		// 新版 new-api（认证重构后）登录成功时用户资料嵌套在 data.user，顶层为 access_token 等令牌信息
		if nested, ok := data["user"].(map[string]any); ok {
			user = userFromMap(nested)
		}
	}
	if user.ID <= 0 || user.Username == "" {
		return User{}, errors.New("new-api login response has invalid user data")
	}
	if user.DisplayName == "" {
		user.DisplayName = user.Username
	}
	return user, nil
}

func userFromMap(data map[string]any) User {
	return User{
		ID:          readInt64(data["id"]),
		Username:    strings.TrimSpace(readString(data["username"])),
		DisplayName: strings.TrimSpace(readString(data["display_name"])),
		Role:        readInt64(data["role"]),
		Status:      readInt64(data["status"]),
		Email:       strings.TrimSpace(readString(data["email"])),
		Quota:       readInt64(data["quota"]),
		UsedQuota:   readInt64(data["used_quota"]),
	}
}

func readString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}
