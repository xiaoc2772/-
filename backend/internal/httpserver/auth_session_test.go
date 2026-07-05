package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIPIgnoresForwardHeadersFromDirectPublicPeer(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	request.RemoteAddr = "203.0.113.50:12345"
	request.Header.Set("Cf-Connecting-Ip", "198.51.100.7")
	request.Header.Set("True-Client-Ip", "198.51.100.8")
	request.Header.Set("X-Real-Ip", "198.51.100.9")
	request.Header.Set("X-Forwarded-For", "198.51.100.10")

	if got := clientIP(request); got != "203.0.113.50" {
		t.Fatalf("直连公网对端时应忽略可伪造的转发头，got %s", got)
	}
}

func TestClientIPIgnoresSingleValueHeadersBehindProxy(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	request.RemoteAddr = "10.0.0.2:52341"
	request.Header.Set("Cf-Connecting-Ip", "198.51.100.7")
	request.Header.Set("X-Real-Ip", "198.51.100.9")

	if got := clientIP(request); got != "10.0.0.2" {
		t.Fatalf("反代后也不应信任客户端可伪造的单值头，got %s", got)
	}
}

func TestClientIPUsesRightmostPublicForwardedIPBehindProxy(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	request.RemoteAddr = "10.0.0.2:52341"
	request.Header.Set("X-Forwarded-For", "198.51.100.9, 203.0.113.50, 172.18.0.5")

	if got := clientIP(request); got != "203.0.113.50" {
		t.Fatalf("应取 X-Forwarded-For 从右数第一个公网 IP（跳过链尾内网代理，不信最左伪造值），got %s", got)
	}
}

func TestClientIPFallsBackToRemoteAddrWithoutHeaders(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	request.RemoteAddr = "203.0.113.50:12345"

	if got := clientIP(request); got != "203.0.113.50" {
		t.Fatalf("无转发头时应使用 RemoteAddr，got %s", got)
	}
}
