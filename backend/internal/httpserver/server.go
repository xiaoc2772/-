package httpserver

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"redemption/backend/internal/config"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Dependencies struct {
	Config config.Config
	Logger *slog.Logger
	DB     *pgxpool.Pool
	Redis  *redis.Client
}

func New(deps Dependencies) http.Handler {
	router := chi.NewRouter()
	router.Use(requestIDMiddleware)
	router.Use(loggingMiddleware(deps.Logger))
	router.Use(recoverMiddleware(deps.Logger))

	router.Get("/healthz", healthHandler)
	router.Get("/readyz", readyHandler(deps))

	authHandlers := newAuthHandlers(deps)
	checkinHandlers := newCheckinHandlers(deps)
	economyHandlers := newEconomyHandlers(deps)
	welfareHandlers := newWelfareHandlers(deps)
	ecoHandlers := newEcoHandlers(deps)
	profileHandlers := newProfileHandlers(deps)
	notificationHandlers := newNotificationHandlers(deps)
	gameSummaryHandlers := newGameSummaryHandlers(deps)
	memoryHandlers := newMemoryHandlers(deps)
	match3Handlers := newMatch3Handlers(deps)
	whackMoleHandlers := newWhackMoleHandlers(deps)
	minesweeperHandlers := newMinesweeperHandlers(deps)
	linkgameHandlers := newLinkgameHandlers(deps)
	rogueliteHandlers := newRogueliteHandlers(deps)
	game2048Handlers := newGame2048Handlers(deps)
	luckyTdHandlers := newLuckyTdHandlers(deps)
	farmHandlers := newFarmHandlers(deps)
	cardHandlers := newCardHandlers(deps)
	adminCardHandlers := newAdminCardHandlers(deps)
	feedbackHandlers := newFeedbackHandlers(deps)
	announcementHandlers := newAnnouncementHandlers(deps)
	lotteryHandlers := newLotteryHandlers(deps)
	rankingHandlers := newRankingHandlers(deps)
	adminUserHandlers := newAdminUserHandlers(deps)
	adminDashboardHandlers := newAdminDashboardHandlers(deps)
	adminConfigHandlers := newAdminConfigHandlers(deps)
	adminRewardHandlers := newAdminRewardHandlers(deps)

	router.Route("/api", func(api chi.Router) {
		api.Post("/auth/login", authHandlers.login)
		api.Get("/auth/me", authHandlers.me)
		api.Post("/auth/logout", authHandlers.logout)
		api.Get("/checkin", checkinHandlers.status)
		api.Post("/checkin", checkinHandlers.checkin)
		api.Post("/checkin/makeup", checkinHandlers.makeup)
		api.Get("/projects", welfareHandlers.listProjects)
		api.Get("/projects/my-claims", welfareHandlers.listMyProjectClaims)
		api.Get("/projects/{id}", welfareHandlers.getProjectDetail)
		api.Post("/projects/{id}", welfareHandlers.claimProject)
		api.Get("/raffle", welfareHandlers.listRaffles)
		api.Get("/raffle/{id}", welfareHandlers.getRaffleDetail)
		api.Post("/raffle/{id}/join", welfareHandlers.joinRaffle)
		api.Get("/admin/projects", welfareHandlers.listAdminProjects)
		api.Post("/admin/projects", welfareHandlers.createAdminProject)
		api.Get("/admin/projects/{id}", welfareHandlers.getAdminProjectDetail)
		api.Patch("/admin/projects/{id}", welfareHandlers.updateAdminProject)
		api.Delete("/admin/projects/{id}", welfareHandlers.deleteAdminProject)
		api.Post("/admin/projects/{id}", welfareHandlers.appendAdminProjectClaims)
		api.Get("/admin/raffle", welfareHandlers.listAdminRaffles)
		api.Post("/admin/raffle", welfareHandlers.createAdminRaffle)
		api.Get("/admin/raffle/{id}", welfareHandlers.getAdminRaffleDetail)
		api.Put("/admin/raffle/{id}", welfareHandlers.updateAdminRaffle)
		api.Delete("/admin/raffle/{id}", welfareHandlers.deleteAdminRaffle)
		api.Post("/admin/raffle/{id}/publish", welfareHandlers.publishAdminRaffle)
		api.Post("/admin/raffle/{id}/cancel", welfareHandlers.cancelAdminRaffle)
		api.Post("/admin/raffle/{id}/draw", welfareHandlers.drawRaffleAdmin)
		api.Post("/admin/raffle/{id}/retry", welfareHandlers.retryRaffleRewardsAdmin)
		api.Get("/admin/eco", ecoHandlers.getAdminOverview)
		api.Patch("/admin/eco", ecoHandlers.updateAdminSettings)
		api.Get("/admin/points", economyHandlers.getAdminUserPoints)
		api.Post("/admin/points", economyHandlers.adjustAdminUserPoints)
		api.Get("/admin/dashboard", adminDashboardHandlers.get)
		api.Get("/admin/alerts", adminDashboardHandlers.listAlerts)
		api.Post("/admin/alerts/{id}/resolve", adminDashboardHandlers.resolveAlert)
		api.Get("/admin/config", adminConfigHandlers.get)
		api.Put("/admin/config", adminConfigHandlers.update)
		api.Get("/admin/rewards", adminRewardHandlers.list)
		api.Post("/admin/rewards", adminRewardHandlers.create)
		api.Get("/admin/rewards/{batchId}", adminRewardHandlers.detail)
		api.Get("/admin/users", adminUserHandlers.list)
		api.Get("/admin/users/{id}", adminUserHandlers.detail)
		api.Post("/admin/users/{id}/achievements", adminUserHandlers.updateAchievement)
		api.Post("/admin/sync-users", adminUserHandlers.legacyToolDisabled)
		api.Post("/admin/fix-codes-count", adminUserHandlers.legacyToolDisabled)
		api.Post("/admin/migrate-native-hot-data", adminUserHandlers.legacyToolDisabled)
		api.Post("/admin/migrate-new-user-eligibility", adminUserHandlers.legacyToolDisabled)
		api.Get("/points", economyHandlers.getPoints)
		api.Get("/profile/overview", profileHandlers.getOverview)
		api.Get("/profile/settings", profileHandlers.getSettings)
		api.Put("/profile/settings", profileHandlers.updateSettings)
		api.Put("/profile/achievements/equip", profileHandlers.equipAchievement)
		api.Get("/notifications", notificationHandlers.list)
		api.Get("/notifications/unread-count", notificationHandlers.getUnreadCount)
		api.Post("/notifications/read", notificationHandlers.markRead)
		api.Post("/notifications/delete", notificationHandlers.delete)
		api.Post("/notifications/claim", notificationHandlers.claim)
		api.Get("/announcements", announcementHandlers.listPublished)
		api.Get("/admin/announcements", announcementHandlers.listAdmin)
		api.Post("/admin/announcements", announcementHandlers.createAdmin)
		api.Patch("/admin/announcements/{id}", announcementHandlers.updateAdmin)
		api.Delete("/admin/announcements/{id}", announcementHandlers.archiveAdmin)
		api.Get("/lottery", lotteryHandlers.page)
		api.Post("/lottery/spin", lotteryHandlers.spin)
		api.Get("/lottery/records", lotteryHandlers.records)
		api.Get("/lottery/ranking", lotteryHandlers.dailyRanking)
		api.Get("/lottery/number-bomb", lotteryHandlers.numberBombState)
		api.Post("/lottery/number-bomb/bet", lotteryHandlers.numberBombBet)
		api.Post("/lottery/number-bomb/cancel", lotteryHandlers.numberBombCancel)
		api.Get("/admin/lottery", lotteryHandlers.admin)
		api.Patch("/admin/lottery/config", lotteryHandlers.updateAdminConfig)
		api.Get("/admin/lottery/number-bomb", lotteryHandlers.adminNumberBomb)
		api.Get("/admin/lottery/debug", lotteryHandlers.adminLegacyToolDisabled)
		api.Post("/admin/lottery/recalculate", lotteryHandlers.adminLegacyToolDisabled)
		api.Post("/admin/lottery/reset", lotteryHandlers.adminLegacyToolDisabled)
		api.Get("/admin/lottery/tiers/{tier}/codes", lotteryHandlers.adminLegacyToolDisabled)
		api.Post("/admin/lottery/tiers/{tier}/codes", lotteryHandlers.adminLegacyToolDisabled)
		api.Delete("/admin/lottery/tiers/{tier}/codes", lotteryHandlers.adminLegacyToolDisabled)
		api.Get("/admin/lottery/tiers/{tier}/detail", lotteryHandlers.adminLegacyToolDisabled)
		api.Get("/feedback", feedbackHandlers.list)
		api.Post("/feedback", feedbackHandlers.create)
		api.Get("/feedback/images/*", feedbackHandlers.getImage)
		api.Head("/feedback/images/*", feedbackHandlers.headImage)
		api.Get("/feedback/{id}", feedbackHandlers.detail)
		api.Post("/feedback/{id}/messages", feedbackHandlers.addMessage)
		api.Post("/feedback/{id}/like", feedbackHandlers.toggleLike)
		api.Get("/admin/feedback", feedbackHandlers.listAdmin)
		api.Get("/admin/feedback/{id}", feedbackHandlers.adminDetail)
		api.Patch("/admin/feedback/{id}", feedbackHandlers.updateStatus)
		api.Delete("/admin/feedback/{id}", feedbackHandlers.deleteAdmin)
		api.Post("/admin/feedback/{id}/messages", feedbackHandlers.addAdminMessage)
		api.Get("/cards/inventory", cardHandlers.inventory)
		api.Get("/cards/rules", cardHandlers.rules)
		api.Post("/cards/draw", cardHandlers.draw)
		api.Post("/cards/purchase", cardHandlers.purchaseDisabled)
		api.Post("/cards/exchange", cardHandlers.exchange)
		api.Post("/cards/claim-reward", cardHandlers.claimReward)
		api.Get("/admin/cards/users", adminCardHandlers.users)
		api.Get("/admin/cards/user/{userId}", adminCardHandlers.userDetail)
		api.Post("/admin/cards/reset", adminCardHandlers.reset)
		api.Get("/admin/cards/albums", adminCardHandlers.albums)
		api.Post("/admin/cards/albums", adminCardHandlers.updateReward)
		api.Get("/admin/cards/rules", adminCardHandlers.rules)
		api.Patch("/admin/cards/rules", adminCardHandlers.updateRules)
		api.Get("/games/overview", gameSummaryHandlers.getOverview)
		api.Get("/games/profile", gameSummaryHandlers.getProfile)
		api.Get("/rankings/points", rankingHandlers.points)
		api.Get("/rankings/games", rankingHandlers.games)
		api.Get("/rankings/checkin-streak", rankingHandlers.checkinStreak)
		api.Get("/rankings/history", rankingHandlers.history)
		api.Post("/admin/rankings/settle", rankingHandlers.settle)
		api.Get("/rankings/eco", ecoHandlers.getTrashLeaderboard)
		api.Get("/rankings/lottery", lotteryHandlers.periodRanking)
		api.Get("/farm/status", farmHandlers.status)
		api.Post("/farm/status", farmHandlers.status)
		api.Get("/farm/shop", farmHandlers.shop)
		api.Post("/farm/plant", farmHandlers.plant)
		api.Post("/farm/water", farmHandlers.water)
		api.Post("/farm/water-all", farmHandlers.waterAll)
		api.Post("/farm/harvest", farmHandlers.harvest)
		api.Post("/farm/harvest-all", farmHandlers.harvestAll)
		api.Post("/farm/remove", farmHandlers.remove)
		api.Post("/farm/buy-land", farmHandlers.buyLand)
		api.Post("/farm/shop/buy", farmHandlers.buyShopItem)
		api.Post("/farm/shop/use", farmHandlers.useShopItem)
		api.Post("/farm/seeds/buy", farmHandlers.buySeeds)
		api.Post("/farm/pet/adopt", farmHandlers.adoptPet)
		api.Post("/farm/pet/feed", farmHandlers.feedPet)
		api.Post("/farm/pet/wash", farmHandlers.washPet)
		api.Post("/farm/pet/drink", farmHandlers.drinkPet)
		api.Post("/farm/pet/play", farmHandlers.playPet)
		api.Post("/farm/pet/dispatch", farmHandlers.dispatchPet)
		api.Get("/farm/steal/list", farmHandlers.stealList)
		api.Post("/farm/steal/do", farmHandlers.stealDo)
		api.Get("/store", economyHandlers.getStore)
		api.Post("/store/exchange", economyHandlers.exchangeItem)
		api.Get("/store/topup", economyHandlers.getTopupBalance)
		api.Post("/store/topup", economyHandlers.topupWallet)
		api.Post("/store/withdraw", economyHandlers.withdrawWallet)
		api.Get("/store/admin", economyHandlers.getStoreAdmin)
		api.Post("/store/admin", economyHandlers.createStoreAdminItem)
		api.Put("/store/admin", economyHandlers.updateStoreAdminItem)
		api.Patch("/store/admin", economyHandlers.saveStoreAdminCategory)
		api.Delete("/store/admin", economyHandlers.deleteStoreAdminItem)
		api.Post("/admin/store/reset", economyHandlers.adminStoreResetDisabled)
		api.Route("/games/eco", func(ecoRouter chi.Router) {
			ecoRouter.Get("/status", ecoHandlers.getStatus)
			ecoRouter.Post("/black-market-sell", ecoHandlers.blackMarketSellPrize)
			ecoRouter.Post("/buy", ecoHandlers.buy)
			ecoRouter.Post("/claim-prize", ecoHandlers.claimPrize)
			ecoRouter.Post("/collect", ecoHandlers.collectTrash)
			ecoRouter.Post("/merchant-sell", ecoHandlers.merchantSellPrize)
			ecoRouter.Post("/sell", ecoHandlers.sellPrize)
			ecoRouter.Post("/steal", ecoHandlers.stealPrize)
			ecoRouter.HandleFunc("/*", notMigratedHandler("eco"))
			ecoRouter.HandleFunc("/", notMigratedHandler("eco"))
		})
		api.Route("/games/memory", func(memoryRouter chi.Router) {
			memoryRouter.Get("/status", memoryHandlers.status)
			memoryRouter.Post("/start", memoryHandlers.start)
			memoryRouter.Post("/flip", memoryHandlers.flip)
			memoryRouter.Post("/submit", memoryHandlers.submit)
			memoryRouter.Post("/cancel", memoryHandlers.cancel)
			memoryRouter.HandleFunc("/*", notMigratedHandler("memory"))
			memoryRouter.HandleFunc("/", notMigratedHandler("memory"))
		})
		api.Route("/games/match3", func(match3Router chi.Router) {
			match3Router.Get("/status", match3Handlers.status)
			match3Router.Post("/start", match3Handlers.start)
			match3Router.Post("/submit", match3Handlers.submit)
			match3Router.Post("/cancel", match3Handlers.cancel)
			match3Router.HandleFunc("/*", notMigratedHandler("match3"))
			match3Router.HandleFunc("/", notMigratedHandler("match3"))
		})
		api.Route("/games/whack-mole", func(whackRouter chi.Router) {
			whackRouter.Get("/status", whackMoleHandlers.status)
			whackRouter.Get("/sync", whackMoleHandlers.sync)
			whackRouter.Post("/start", whackMoleHandlers.start)
			whackRouter.Post("/submit", whackMoleHandlers.submit)
			whackRouter.Post("/cancel", whackMoleHandlers.cancel)
			whackRouter.HandleFunc("/*", notMigratedHandler("whack_mole"))
			whackRouter.HandleFunc("/", notMigratedHandler("whack_mole"))
		})
		api.Route("/games/minesweeper", func(minesweeperRouter chi.Router) {
			minesweeperRouter.Get("/status", minesweeperHandlers.status)
			minesweeperRouter.Post("/start", minesweeperHandlers.start)
			minesweeperRouter.Post("/step", minesweeperHandlers.step)
			minesweeperRouter.Post("/submit", minesweeperHandlers.submit)
			minesweeperRouter.Post("/cancel", minesweeperHandlers.cancel)
			minesweeperRouter.HandleFunc("/*", notMigratedHandler("minesweeper"))
			minesweeperRouter.HandleFunc("/", notMigratedHandler("minesweeper"))
		})
		api.Route("/games/linkgame", func(linkgameRouter chi.Router) {
			linkgameRouter.Get("/status", linkgameHandlers.status)
			linkgameRouter.Post("/start", linkgameHandlers.start)
			linkgameRouter.Post("/submit", linkgameHandlers.submit)
			linkgameRouter.Post("/cancel", linkgameHandlers.cancel)
			linkgameRouter.HandleFunc("/*", notMigratedHandler("linkgame"))
			linkgameRouter.HandleFunc("/", notMigratedHandler("linkgame"))
		})
		api.Route("/games/roguelite", func(rogueliteRouter chi.Router) {
			rogueliteRouter.Get("/status", rogueliteHandlers.status)
			rogueliteRouter.Post("/start", rogueliteHandlers.start)
			rogueliteRouter.Post("/step", rogueliteHandlers.step)
			rogueliteRouter.Post("/submit", rogueliteHandlers.submit)
			rogueliteRouter.Post("/cancel", rogueliteHandlers.cancel)
			rogueliteRouter.HandleFunc("/*", notMigratedHandler("roguelite"))
			rogueliteRouter.HandleFunc("/", notMigratedHandler("roguelite"))
		})
		api.Route("/games/2048", func(game2048Router chi.Router) {
			game2048Router.Get("/status", game2048Handlers.status)
			game2048Router.Post("/start", game2048Handlers.start)
			game2048Router.Post("/checkpoint", game2048Handlers.checkpoint)
			game2048Router.Post("/submit", game2048Handlers.submit)
			game2048Router.Post("/cancel", game2048Handlers.cancel)
			game2048Router.HandleFunc("/*", notMigratedHandler("game_2048"))
			game2048Router.HandleFunc("/", notMigratedHandler("game_2048"))
		})
		api.Route("/games/lucky-td", func(luckyTdRouter chi.Router) {
			luckyTdRouter.Get("/status", luckyTdHandlers.status)
			luckyTdRouter.Post("/start", luckyTdHandlers.start)
			luckyTdRouter.Post("/checkpoint", luckyTdHandlers.checkpoint)
			luckyTdRouter.Post("/submit", luckyTdHandlers.submit)
			luckyTdRouter.Post("/cancel", luckyTdHandlers.cancel)
			luckyTdRouter.HandleFunc("/*", notMigratedHandler("lucky_td"))
			luckyTdRouter.HandleFunc("/", notMigratedHandler("lucky_td"))
		})
	})

	return router
}

func healthHandler(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "go-api",
	})
}

func readyHandler(deps Dependencies) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()

		postgresOK := deps.DB != nil && deps.DB.Ping(ctx) == nil
		redisOK := false
		if deps.Redis != nil {
			redisOK = deps.Redis.Ping(ctx).Err() == nil
		}

		status := http.StatusOK
		ok := postgresOK && redisOK
		if !ok {
			status = http.StatusServiceUnavailable
		}

		writeJSON(writer, status, map[string]any{
			"ok":       ok,
			"postgres": postgresOK,
			"redis":    redisOK,
		})
	}
}

func notMigratedHandler(module string) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		writeJSON(writer, http.StatusNotImplemented, map[string]any{
			"success": false,
			"code":    "NOT_MIGRATED",
			"message": "该 Go API 模块尚未迁移完成，请勿将生产流量切到此路径",
			"module":  module,
		})
	}
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}
