package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"redemption/backend/internal/pianotiles"
)

type pianoTilesHandlers struct {
	deps    Dependencies
	service *pianotiles.Service
}

const pianoTilesMaxEventBodyBytes = 512 << 10

func newPianoTilesHandlers(deps Dependencies) pianoTilesHandlers {
	return pianoTilesHandlers{deps: deps, service: pianotiles.NewService(deps.DB)}
}

func (h pianoTilesHandlers) status(w http.ResponseWriter, r *http.Request) {
	shared := economyHandlers{deps: h.deps}
	user, ok := shared.requireUser(w, r)
	if !ok {
		return
	}
	data, err := h.service.Status(r.Context(), *user)
	if err != nil {
		h.writeErr(w, "查询钢琴块状态失败", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (h pianoTilesHandlers) personalBests(w http.ResponseWriter, r *http.Request) {
	shared := economyHandlers{deps: h.deps}
	user, ok := shared.requireUser(w, r)
	if !ok {
		return
	}
	data, err := h.service.PersonalBests(r.Context(), *user)
	if err != nil {
		h.writeErr(w, "查询钢琴块个人战绩失败", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (h pianoTilesHandlers) start(w http.ResponseWriter, r *http.Request) {
	shared := economyHandlers{deps: h.deps}
	if shared.rejectUntrustedUnsafeRequest(w, r) {
		return
	}
	user, ok := shared.requireUser(w, r)
	if !ok {
		return
	}
	if shared.rejectRateLimited(w, r, *user, gameStartRateLimit) {
		return
	}
	var in pianotiles.StartInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	res, err := h.service.Start(r.Context(), *user, in)
	if err != nil {
		h.writeErr(w, "开始钢琴块失败", err)
		return
	}
	if !res.Success {
		code := http.StatusBadRequest
		writeJSON(w, code, map[string]any{"success": false, "message": res.Message})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"sessionId": res.Session.ID, "chartId": res.Session.ChartID, "mode": res.Session.Mode, "startedAt": res.Session.StartedAt}})
}

func (h pianoTilesHandlers) checkpoint(w http.ResponseWriter, r *http.Request) {
	shared := economyHandlers{deps: h.deps}
	if shared.rejectUntrustedUnsafeRequest(w, r) {
		return
	}
	user, ok := shared.requireUser(w, r)
	if !ok {
		return
	}
	if shared.rejectRateLimited(w, r, *user, gameActionRateLimit) {
		return
	}
	var in pianotiles.CheckpointInput
	if err := decodePianoTilesEventBody(w, r, &in); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"success": false, "message": "checkpoint 请求体过大，请分批同步"})
			return
		}
		writeJSON(w, 400, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	if strings.TrimSpace(in.SessionID) == "" {
		writeJSON(w, 400, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	if len(in.Events) > pianotiles.MaxEventsPerBatch {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"success": false, "message": "单次最多同步 2048 条事件，请分批重试"})
		return
	}
	res, err := h.service.Checkpoint(r.Context(), *user, in)
	if err != nil {
		if errors.Is(err, pianotiles.ErrBatchTooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"success": false, "message": "单次最多同步 2048 条事件，请分批重试"})
			return
		}
		if pianotiles.IsValidationError(err) {
			writeJSON(w, 409, map[string]any{"success": false, "message": err.Error()})
			return
		}
		h.writeErr(w, "保存钢琴块 checkpoint 失败", err)
		return
	}
	if !res.Success {
		writeJSON(w, 400, map[string]any{"success": false, "message": res.Message})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": res})
}

func (h pianoTilesHandlers) submit(w http.ResponseWriter, r *http.Request) {
	shared := economyHandlers{deps: h.deps}
	if shared.rejectUntrustedUnsafeRequest(w, r) {
		return
	}
	user, ok := shared.requireUser(w, r)
	if !ok {
		return
	}
	if shared.rejectRateLimited(w, r, *user, gameSubmitRateLimit) {
		return
	}
	var in pianotiles.SubmitInput
	if err := decodePianoTilesEventBody(w, r, &in); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"success": false, "message": "结算请求体过大，请先分批同步事件"})
			return
		}
		writeJSON(w, 400, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	if strings.TrimSpace(in.SessionID) == "" {
		writeJSON(w, 400, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	if len(in.Events) > pianotiles.MaxEventsPerBatch {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"success": false, "message": "单次最多提交 2048 条事件，请先分批同步"})
		return
	}
	res, err := h.service.Submit(r.Context(), *user, in)
	if err != nil {
		if errors.Is(err, pianotiles.ErrBatchTooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"success": false, "message": "单次最多提交 2048 条事件，请先分批同步"})
			return
		}
		if pianotiles.IsValidationError(err) {
			writeJSON(w, 409, map[string]any{"success": false, "message": err.Error()})
			return
		}
		h.writeErr(w, "钢琴块结算失败", err)
		return
	}
	if !res.Success {
		writeJSON(w, 400, map[string]any{"success": false, "message": res.Message})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"score": res.Score, "pointsAwarded": res.PointsAwarded, "record": res.Record}})
}

func (h pianoTilesHandlers) cancel(w http.ResponseWriter, r *http.Request) {
	shared := economyHandlers{deps: h.deps}
	if shared.rejectUntrustedUnsafeRequest(w, r) {
		return
	}
	user, ok := shared.requireUser(w, r)
	if !ok {
		return
	}
	var in pianotiles.CancelInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	if strings.TrimSpace(in.SessionID) == "" {
		writeJSON(w, 400, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	res, err := h.service.Cancel(r.Context(), *user, in)
	if err != nil {
		h.writeErr(w, "取消钢琴块失败", err)
		return
	}
	if !res.Success {
		writeJSON(w, 400, map[string]any{"success": false, "message": res.Message})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": "游戏已取消"})
}

// decodePianoTilesEventBody 必须读到 JSON 文档末尾。只解码第一个对象会让
// “合法对象 + 超大空白/第二个 JSON”绕过 MaxBytesReader 的 512KiB 限制。
func decodePianoTilesEventBody(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, pianoTilesMaxEventBodyBytes)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing json.RawMessage
	err := decoder.Decode(&trailing)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("multiple JSON values")
	}
	return err
}

func (h pianoTilesHandlers) writeErr(w http.ResponseWriter, msg string, err error) {
	if errors.Is(err, pianotiles.ErrUnavailable) {
		writeJSON(w, 503, map[string]any{"success": false, "message": "钢琴块数据库未配置"})
		return
	}
	h.deps.Logger.Error(msg, "error", err)
	writeJSON(w, 500, map[string]any{"success": false, "message": "服务器错误"})
}
