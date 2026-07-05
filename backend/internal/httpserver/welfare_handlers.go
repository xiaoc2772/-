package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/welfare"

	"github.com/go-chi/chi/v5"
)

type welfareHandlers struct {
	deps    Dependencies
	service *welfare.Service
}

func newWelfareHandlers(deps Dependencies) welfareHandlers {
	return welfareHandlers{
		deps:    deps,
		service: welfare.NewService(deps.DB),
	}
}

func (handlers welfareHandlers) listProjects(writer http.ResponseWriter, request *http.Request) {
	projects, err := handlers.service.ListProjects(request.Context())
	if err != nil {
		handlers.deps.Logger.Error("查询福利项目列表失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取项目列表失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":  true,
		"projects": projects,
	})
}

func (handlers welfareHandlers) getProjectDetail(writer http.ResponseWriter, request *http.Request) {
	id := chi.URLParam(request, "id")

	var userID *int64
	if user, ok := auth.UserFromRequest(
		request,
		handlers.deps.Config.SessionSecret,
		handlers.deps.Config.AdminUsernames,
	); ok {
		userID = &user.ID
	}

	detail, err := handlers.service.GetPublicProjectDetail(request.Context(), id, userID)
	if errors.Is(err, welfare.ErrProjectNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "项目不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("查询福利项目详情失败", "projectID", id, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取项目失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"project": detail.Project,
		"claimed": detail.Claimed,
	})
}

func (handlers welfareHandlers) claimProject(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := economyHandlers{deps: handlers.deps}.requireUser(writer, request)
	if !ok {
		return
	}

	id := chi.URLParam(request, "id")
	result, err := handlers.service.ClaimPublicProject(request.Context(), id, *user)
	if errors.Is(err, welfare.ErrProjectNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "项目不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("领取福利项目失败", "projectID", id, "userID", user.ID, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "领取失败",
		})
		return
	}

	status := http.StatusOK
	if !result.Success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, result)
}

func (handlers welfareHandlers) listMyProjectClaims(writer http.ResponseWriter, request *http.Request) {
	user, ok := economyHandlers{deps: handlers.deps}.requireUser(writer, request)
	if !ok {
		return
	}

	projectIDs, err := handlers.service.ListUserProjectClaimIDs(request.Context(), user.ID)
	if err != nil {
		handlers.deps.Logger.Error("查询我的福利领取记录失败", "userID", user.ID, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取领取记录失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"projectIds": projectIDs,
		},
	})
}

func (handlers welfareHandlers) listAdminProjects(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "项目管理数据库未配置",
		})
		return
	}

	projects, err := handlers.service.ListAdminProjects(request.Context())
	if err != nil {
		handlers.deps.Logger.Error("查询后台项目列表失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取项目列表失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":  true,
		"projects": projects,
	})
}

func (handlers welfareHandlers) createAdminProject(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := handlers.requireAdmin(writer, request)
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "项目管理数据库未配置",
		})
		return
	}

	input, err := parseCreateAdminProjectForm(request, user.Username)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	project, err := handlers.service.CreateAdminProject(request.Context(), input)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":    true,
		"message":    "项目创建成功",
		"project":    project,
		"codesAdded": 0,
	})
}

func (handlers welfareHandlers) getAdminProjectDetail(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "项目管理数据库未配置",
		})
		return
	}

	id := chi.URLParam(request, "id")
	detail, err := handlers.service.GetAdminProjectDetail(request.Context(), id)
	if errors.Is(err, welfare.ErrProjectNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "项目不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("查询后台项目详情失败", "projectID", id, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取项目失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"project": detail.Project,
		"records": detail.Records,
	})
}

func (handlers welfareHandlers) updateAdminProject(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "项目管理数据库未配置",
		})
		return
	}

	input, err := parseUpdateAdminProjectJSON(request)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	id := chi.URLParam(request, "id")
	_, err = handlers.service.UpdateAdminProject(request.Context(), id, input)
	if errors.Is(err, welfare.ErrProjectNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "项目不存在",
		})
		return
	}
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "项目更新成功",
	})
}

func (handlers welfareHandlers) deleteAdminProject(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "项目管理数据库未配置",
		})
		return
	}

	id := chi.URLParam(request, "id")
	if err := handlers.service.DeleteAdminProject(request.Context(), id); err != nil {
		handlers.deps.Logger.Error("删除后台项目失败", "projectID", id, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "删除项目失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "项目已删除",
	})
}

func (handlers welfareHandlers) appendAdminProjectClaims(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "项目管理数据库未配置",
		})
		return
	}

	appendClaims, err := parseAppendClaimsForm(request)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	id := chi.URLParam(request, "id")
	project, err := handlers.service.AppendAdminProjectClaims(request.Context(), id, appendClaims)
	if errors.Is(err, welfare.ErrProjectNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "项目不存在",
		})
		return
	}
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":   true,
		"message":   "成功追加 " + strconv.FormatInt(appendClaims, 10) + " 个名额",
		"appended":  appendClaims,
		"maxClaims": project.MaxClaims,
	})
}

func (handlers welfareHandlers) listRaffles(writer http.ResponseWriter, request *http.Request) {
	status := request.URL.Query().Get("status")
	activeOnly := request.URL.Query().Get("active") == "true"

	raffles, err := handlers.service.ListRaffles(request.Context(), welfare.RaffleListFilter{
		Status:     status,
		ActiveOnly: activeOnly,
	})
	if err != nil {
		handlers.deps.Logger.Error("查询抽奖活动列表失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取活动列表失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"raffles": raffles,
	})
}

func (handlers welfareHandlers) getRaffleDetail(writer http.ResponseWriter, request *http.Request) {
	id := chi.URLParam(request, "id")

	var userID *int64
	if user, ok := auth.UserFromRequest(
		request,
		handlers.deps.Config.SessionSecret,
		handlers.deps.Config.AdminUsernames,
	); ok {
		userID = &user.ID
	}

	result, err := handlers.service.GetRaffleDetail(request.Context(), id, userID)
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("查询抽奖活动详情失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取活动详情失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":    true,
		"raffle":     result.Raffle,
		"entries":    result.Entries,
		"userStatus": result.UserStatus,
	})
}

func (handlers welfareHandlers) joinRaffle(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, raffleJoinRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "抽奖数据库未配置",
		})
		return
	}

	id := chi.URLParam(request, "id")
	mode, err := handlers.service.GetRaffleMode(request.Context(), id)
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("查询抽奖活动模式失败", "raffleID", id, "userID", user.ID, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "参与失败，请稍后重试",
		})
		return
	}

	var result welfare.JoinRaffleResult
	if mode == "red_packet" {
		result, err = handlers.service.GrabRedPacket(request.Context(), id, *user)
	} else {
		result, err = handlers.service.JoinRaffle(request.Context(), id, *user)
	}
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("参与抽奖失败", "raffleID", id, "userID", user.ID, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "参与失败，请稍后重试",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	if result.ShouldDraw {
		handlers.drawAndDeliverRaffleRewards(request, id, user.ID)
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":    true,
		"message":    result.Message,
		"entry":      result.Entry,
		"reward":     result.Reward,
		"shouldDraw": result.ShouldDraw,
	})
}

func (handlers welfareHandlers) listAdminRaffles(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}
	handlers.processRaffleDeliveryQueueBestEffort(request, "管理端列表")

	status := request.URL.Query().Get("status")
	raffles, err := handlers.service.ListAdminRaffles(request.Context(), status)
	if err != nil {
		handlers.deps.Logger.Error("查询抽奖后台列表失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取活动列表失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"raffles": raffles,
	})
}

func (handlers welfareHandlers) createAdminRaffle(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := handlers.requireAdmin(writer, request)
	if !ok {
		return
	}

	var input welfare.CreateAdminRaffleInput
	if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式错误",
		})
		return
	}
	input.CreatedBy = user.ID

	raffle, err := handlers.service.CreateAdminRaffle(request.Context(), input)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "活动创建成功",
		"raffle":  raffle,
	})
}

func (handlers welfareHandlers) getAdminRaffleDetail(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}
	handlers.processRaffleDeliveryQueueBestEffort(request, "管理端详情")

	id := chi.URLParam(request, "id")
	raffle, entries, err := handlers.service.GetAdminRaffleDetail(request.Context(), id)
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("查询抽奖后台详情失败", "raffleID", id, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取活动详情失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"raffle":  raffle,
		"entries": entries,
	})
}

func (handlers welfareHandlers) updateAdminRaffle(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	var input welfare.UpdateAdminRaffleInput
	if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式错误",
		})
		return
	}

	id := chi.URLParam(request, "id")
	raffle, err := handlers.service.UpdateAdminRaffle(request.Context(), id, input)
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "更新成功",
		"raffle":  raffle,
	})
}

func (handlers welfareHandlers) deleteAdminRaffle(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	id := chi.URLParam(request, "id")
	deleted, err := handlers.service.DeleteAdminRaffle(request.Context(), id)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if !deleted {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "删除成功",
	})
}

func (handlers welfareHandlers) publishAdminRaffle(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	id := chi.URLParam(request, "id")
	raffle, err := handlers.service.PublishAdminRaffle(request.Context(), id)
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "活动已发布",
		"raffle":  raffle,
	})
}

func (handlers welfareHandlers) cancelAdminRaffle(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	id := chi.URLParam(request, "id")
	raffle, err := handlers.service.CancelAdminRaffle(request.Context(), id)
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "活动已取消",
		"raffle":  raffle,
	})
}

func (handlers welfareHandlers) drawAndDeliverRaffleRewards(request *http.Request, raffleID string, userID int64) {
	drawResult, err := handlers.service.ExecuteRaffleDraw(request.Context(), raffleID)
	if err != nil {
		handlers.deps.Logger.Error("自动开奖失败", "raffleID", raffleID, "userID", userID, "error", err)
		return
	}
	if !drawResult.Success {
		if drawResult.Message != "活动状态不是进行中" {
			handlers.deps.Logger.Error("自动开奖未完成", "raffleID", raffleID, "userID", userID, "message", drawResult.Message)
		}
		return
	}

	enqueued, err := handlers.service.EnqueueRaffleDelivery(request.Context(), raffleID, "draw")
	if err != nil {
		handlers.deps.Logger.Error("自动发奖入队失败", "raffleID", raffleID, "userID", userID, "error", err)
		return
	}
	if !enqueued {
		handlers.deps.Logger.Info("自动发奖任务已存在", "raffleID", raffleID, "userID", userID)
	}
}

func (handlers welfareHandlers) processRaffleDeliveryQueueBestEffort(request *http.Request, source string) {
	if _, err := handlers.service.ProcessRaffleDeliveryQueue(request.Context(), 1); err != nil {
		handlers.deps.Logger.Error("管理端触发发奖队列失败", "source", source, "error", err)
	}
}

func (handlers welfareHandlers) drawRaffleAdmin(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	id := chi.URLParam(request, "id")
	drawResult, err := handlers.service.ExecuteRaffleDraw(request.Context(), id)
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("管理端开奖失败", "raffleID", id, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "开奖失败，请稍后重试",
		})
		return
	}
	if !drawResult.Success {
		message := drawResult.Message
		if message == "抢红包活动无需开奖" {
			message = "抢红包活动会在名额抢完后自动结束，无需手动开奖"
		}
		if message == "活动状态不是进行中" {
			message = "只能对进行中的活动开奖"
		}
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": message,
		})
		return
	}

	deliveryResult, err := handlers.service.DeliverRaffleRewards(request.Context(), id)
	if err != nil {
		handlers.deps.Logger.Error("管理端开奖后发奖失败", "raffleID", id, "error", err)
		writeJSON(writer, http.StatusOK, map[string]any{
			"success": true,
			"message": drawResult.Message + "，但发奖失败，请稍后重试",
			"winners": drawResult.Winners,
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":         true,
		"message":         drawResult.Message,
		"winners":         drawResult.Winners,
		"deliveryResults": deliveryResult.Results,
	})
}

func (handlers welfareHandlers) retryRaffleRewardsAdmin(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	id := chi.URLParam(request, "id")
	result, err := handlers.service.DeliverRaffleRewards(request.Context(), id)
	if errors.Is(err, welfare.ErrRaffleNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "活动不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("管理端重试发奖失败", "raffleID", id, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "重试发放失败，请稍后重试",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":         true,
		"message":         result.Message,
		"deliveryResults": result.Results,
	})
}

func (handlers welfareHandlers) rejectUntrustedUnsafeRequest(writer http.ResponseWriter, request *http.Request) bool {
	return economyHandlers{deps: handlers.deps}.rejectUntrustedUnsafeRequest(writer, request)
}

func (handlers welfareHandlers) requireAdmin(writer http.ResponseWriter, request *http.Request) (*auth.User, bool) {
	return economyHandlers{deps: handlers.deps}.requireAdmin(writer, request)
}

func parseCreateAdminProjectForm(request *http.Request, createdBy string) (welfare.CreateAdminProjectInput, error) {
	parseAnyForm(request)

	maxClaims := int64(100)
	if raw := request.FormValue("maxClaims"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			maxClaims = parsed
		}
	}
	directPoints, err := strconv.ParseInt(request.FormValue("directPoints"), 10, 64)
	if err != nil || directPoints <= 0 {
		return welfare.CreateAdminProjectInput{}, errors.New("直充积分必须是正整数")
	}
	autoPauseAt, err := parseChinaDateTimeFormValue(request.FormValue("autoPauseAt"))
	if err != nil {
		return welfare.CreateAdminProjectInput{}, err
	}

	return welfare.CreateAdminProjectInput{
		Name:         request.FormValue("name"),
		Description:  request.FormValue("description"),
		MaxClaims:    maxClaims,
		DirectPoints: directPoints,
		NewUserOnly:  request.FormValue("newUserOnly") == "true",
		CreatedBy:    createdBy,
		AutoPauseAt:  autoPauseAt,
	}, nil
}

func parseChinaDateTimeFormValue(value string) (*int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	location := time.FixedZone("Asia/Shanghai", 8*60*60)
	for _, layout := range []string{"2006-01-02T15:04", "2006-01-02T15:04:05", "2006-01-02 15:04", "2006-01-02 15:04:05"} {
		parsed, err := time.ParseInLocation(layout, value, location)
		if err == nil {
			timestamp := parsed.UTC().UnixMilli()
			return &timestamp, nil
		}
	}
	return nil, errors.New("暂停时间格式不正确，请按中国时间选择有效时间")
}

func parseAppendClaimsForm(request *http.Request) (int64, error) {
	parseAnyForm(request)

	appendClaims, err := strconv.ParseInt(request.FormValue("appendClaims"), 10, 64)
	if err != nil || appendClaims <= 0 {
		return 0, errors.New("追加名额必须是正整数（≥1）")
	}
	return appendClaims, nil
}

func parseAnyForm(request *http.Request) {
	if err := request.ParseMultipartForm(8 << 20); err != nil {
		_ = request.ParseForm()
	}
}

func parseUpdateAdminProjectJSON(request *http.Request) (welfare.UpdateAdminProjectInput, error) {
	var raw struct {
		Status      *string      `json:"status"`
		Pinned      *bool        `json:"pinned"`
		Name        *string      `json:"name"`
		Description *string      `json:"description"`
		MaxClaims   *json.Number `json:"maxClaims"`
	}
	decoder := json.NewDecoder(request.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil {
		return welfare.UpdateAdminProjectInput{}, errors.New("请求体格式错误")
	}

	input := welfare.UpdateAdminProjectInput{
		Status:      raw.Status,
		Pinned:      raw.Pinned,
		Name:        raw.Name,
		Description: raw.Description,
	}
	if raw.Status != nil {
		status := strings.TrimSpace(*raw.Status)
		input.Status = &status
	}
	if raw.MaxClaims != nil {
		maxClaims, err := raw.MaxClaims.Int64()
		if err != nil || maxClaims <= 0 {
			return welfare.UpdateAdminProjectInput{}, errors.New("限领人数必须是正整数（≥1）")
		}
		input.MaxClaims = &maxClaims
		input.MaxClaimsValid = true
	}
	return input, nil
}
