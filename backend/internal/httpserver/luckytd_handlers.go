package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"redemption/backend/internal/luckytd"
)

type luckyTdHandlers struct {
	deps    Dependencies
	service *luckytd.Service
}

func newLuckyTdHandlers(deps Dependencies) luckyTdHandlers {
	return luckyTdHandlers{
		deps:    deps,
		service: luckytd.NewService(deps.DB),
	}
}

func (handlers luckyTdHandlers) status(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	data, err := handlers.service.Status(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询幸运塔防状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers luckyTdHandlers) start(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, gameStartRateLimit) {
		return
	}
	var payload luckytd.StartInput
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	result, err := handlers.service.Start(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "开始幸运塔防失败", err)
		return
	}
	if !result.Success || result.Session == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	view := luckytd.BuildSessionView(*result.Session)
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"sessionId": view.SessionID,
			"seed":      view.Seed,
			"expiresAt": view.ExpiresAt,
		},
	})
}

func (handlers luckyTdHandlers) checkpoint(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, gameActionRateLimit) {
		return
	}
	payload, ok := decodeLuckyTdCheckpointInput(writer, request)
	if !ok {
		return
	}
	result, err := handlers.service.Checkpoint(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "同步幸运塔防进度失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]any{"expiresAt": result.ExpiresAt},
	})
}

func (handlers luckyTdHandlers) submit(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, gameSubmitRateLimit) {
		return
	}
	payload, ok := decodeLuckyTdSubmitInput(writer, request)
	if !ok {
		return
	}
	result, err := handlers.service.Submit(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "幸运塔防结算失败", err)
		return
	}
	if !result.Success || result.Data == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": result.Data})
}

func (handlers luckyTdHandlers) cancel(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	var payload luckytd.CancelInput
	_ = json.NewDecoder(request.Body).Decode(&payload)
	result, err := handlers.service.Cancel(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "取消幸运塔防失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"cancelled": true}})
}

func decodeLuckyTdCheckpointInput(writer http.ResponseWriter, request *http.Request) (luckytd.CheckpointInput, bool) {
	var payload luckytd.CheckpointInput
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return luckytd.CheckpointInput{}, false
	}
	if strings.TrimSpace(payload.SessionID) == "" || payload.WaveIndex < 1 || payload.Frame < 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return luckytd.CheckpointInput{}, false
	}
	return payload, true
}

func decodeLuckyTdSubmitInput(writer http.ResponseWriter, request *http.Request) (luckytd.SubmitInput, bool) {
	var payload luckytd.SubmitInput
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return luckytd.SubmitInput{}, false
	}
	if strings.TrimSpace(payload.SessionID) == "" || payload.FinalFrame < 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return luckytd.SubmitInput{}, false
	}
	return payload, true
}

func (handlers luckyTdHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, luckytd.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "幸运塔防数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}
