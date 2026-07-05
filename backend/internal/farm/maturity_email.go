package farm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"
)

const defaultResendEmailAPIURL = "https://api.resend.com/emails"

type MaturityEmailScanInput struct {
	MaxUsers int
	Cursor   int64
	Sender   FarmEmailSender
	NowMs    int64
}

type MaturityEmailScanResult struct {
	Success        bool  `json:"success"`
	ScannedUsers   int   `json:"scannedUsers"`
	ProcessedUsers int   `json:"processedUsers"`
	LockedUsers    int   `json:"lockedUsers"`
	CheckedEvents  int   `json:"checkedEvents"`
	Sent           int   `json:"sent"`
	Skipped        int   `json:"skipped"`
	Failed         int   `json:"failed"`
	Cursor         int64 `json:"cursor"`
}

type MaturityEmailProcessResult struct {
	Checked int
	Sent    int
	Skipped int
	Failed  int
}

type FarmEmailSender interface {
	IsConfigured() bool
	SendMaturityEmail(ctx context.Context, input FarmMaturityEmailInput) (FarmEmailSendResult, error)
	SendWaterReminderEmail(ctx context.Context, input FarmWaterReminderEmailInput) (FarmEmailSendResult, error)
}

type FarmMaturityEmailInput struct {
	To       string
	CropName string
	MatureAt int64
	PetName  string
}

type FarmWaterReminderEmailInput struct {
	To         string
	CropName   string
	LandIndex  int
	WaterDueAt int64
	PetName    string
}

type FarmEmailSendResult struct {
	Sent    bool
	Skipped bool
	Reason  string
}

type ResendEmailConfig struct {
	APIKey string
	APIURL string
	From   string
	Client *http.Client
}

type ResendEmailSender struct {
	apiKey string
	apiURL string
	from   string
	client *http.Client
}

func NewResendEmailSender(config ResendEmailConfig) *ResendEmailSender {
	apiURL := strings.TrimSpace(config.APIURL)
	if apiURL == "" {
		apiURL = defaultResendEmailAPIURL
	}
	client := config.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &ResendEmailSender{
		apiKey: strings.TrimSpace(config.APIKey),
		apiURL: apiURL,
		from:   strings.TrimSpace(config.From),
		client: client,
	}
}

func (sender *ResendEmailSender) IsConfigured() bool {
	return sender != nil && sender.apiKey != "" && sender.from != ""
}

func (sender *ResendEmailSender) SendMaturityEmail(ctx context.Context, input FarmMaturityEmailInput) (FarmEmailSendResult, error) {
	return sender.send(ctx, farmEmailPayload{
		To:      input.To,
		Subject: fmt.Sprintf("开心农场：%s 成熟啦", input.CropName),
		Text:    buildMaturityEmailText(input),
		HTML:    buildMaturityEmailHTML(input),
	})
}

func (sender *ResendEmailSender) SendWaterReminderEmail(ctx context.Context, input FarmWaterReminderEmailInput) (FarmEmailSendResult, error) {
	return sender.send(ctx, farmEmailPayload{
		To:      input.To,
		Subject: fmt.Sprintf("开心农场：第 %d 块地该浇水啦", input.LandIndex),
		Text:    buildWaterReminderEmailText(input),
		HTML:    buildWaterReminderEmailHTML(input),
	})
}

type farmEmailPayload struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

func (sender *ResendEmailSender) send(ctx context.Context, input farmEmailPayload) (FarmEmailSendResult, error) {
	if !sender.IsConfigured() {
		return FarmEmailSendResult{Skipped: true, Reason: "email_not_configured"}, nil
	}
	body, err := json.Marshal(map[string]any{
		"from":    sender.from,
		"to":      []string{input.To},
		"subject": input.Subject,
		"text":    input.Text,
		"html":    input.HTML,
	})
	if err != nil {
		return FarmEmailSendResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, sender.apiURL, bytes.NewReader(body))
	if err != nil {
		return FarmEmailSendResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+sender.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := sender.client.Do(request)
	if err != nil {
		return FarmEmailSendResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return FarmEmailSendResult{}, fmt.Errorf("邮件发送失败: %d", response.StatusCode)
	}
	return FarmEmailSendResult{Sent: true}, nil
}

type maturityEmailEvent struct {
	ID        string `json:"id"`
	Ts        int64  `json:"ts"`
	Type      string `json:"type"`
	CropID    CropID `json:"cropId,omitempty"`
	LandIndex int    `json:"landIndex,omitempty"`
}

type waterReminderTarget struct {
	LandIndex      int
	CropID         CropID
	PlantedAt      int64
	NextWaterDueAt int64
	WaterMissCount int64
	WaterDueAt     int64
}

type farmEmailPet struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Stage string `json:"stage"`
}

func (service *Service) ProcessMaturityEmails(ctx context.Context, input MaturityEmailScanInput) (MaturityEmailScanResult, error) {
	if service == nil || service.store == nil {
		return MaturityEmailScanResult{}, ErrUnavailable
	}
	nowMs := input.NowMs
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}
	limit := normalizeMaturityEmailScanLimit(input.MaxUsers)
	userIDs, nextCursor, err := service.store.ListFarmStateUserIDsAfterCursor(ctx, input.Cursor, limit)
	if err != nil {
		return MaturityEmailScanResult{}, err
	}
	result := MaturityEmailScanResult{Success: true, Cursor: nextCursor}
	for _, userID := range userIDs {
		result.ScannedUsers++
		state, exists, err := service.advanceUserStateLocked(ctx, userID, nowMs)
		if err != nil {
			result.Failed++
			continue
		}
		if !exists {
			continue
		}
		emailResult, err := service.processMaturityEmailEventsForState(ctx, &state, input.Sender, nowMs)
		if err != nil {
			result.Failed++
		}
		result.ProcessedUsers++
		result.CheckedEvents += emailResult.Checked
		result.Sent += emailResult.Sent
		result.Skipped += emailResult.Skipped
		result.Failed += emailResult.Failed
	}
	return result, nil
}

func (service *Service) processMaturityEmailEventsForState(ctx context.Context, state *FarmState, sender FarmEmailSender, nowMs int64) (MaturityEmailProcessResult, error) {
	events := matureEmailEvents(*state)
	waterTargets := waterReminderTargets(*state, nowMs)
	result := MaturityEmailProcessResult{Checked: len(events) + len(waterTargets)}
	if result.Checked == 0 {
		return result, nil
	}
	pet, ok := adultEmailPet(state.Pet)
	if !ok {
		result.Skipped = result.Checked
		return result, nil
	}
	if sender == nil || !sender.IsConfigured() {
		result.Skipped = result.Checked
		return result, nil
	}
	qqEmail, err := service.store.GetUserQQEmail(ctx, state.UserID)
	if err != nil {
		return result, err
	}
	if qqEmail == "" {
		result.Skipped = result.Checked
		return result, nil
	}
	petName := resolveEmailPetName(pet)
	for _, event := range events {
		claimed, err := service.store.ClaimMaturityEmail(ctx, state.UserID, event.ID, nowMs)
		if err != nil {
			return result, err
		}
		if !claimed {
			result.Skipped++
			continue
		}
		sendResult, err := sender.SendMaturityEmail(ctx, FarmMaturityEmailInput{
			To:       qqEmail,
			CropName: cropName(event.CropID),
			MatureAt: event.Ts,
			PetName:  petName,
		})
		if err != nil {
			_ = service.store.DeleteMaturityEmailClaim(ctx, state.UserID, event.ID)
			result.Failed++
			continue
		}
		if sendResult.Sent {
			result.Sent++
			continue
		}
		_ = service.store.DeleteMaturityEmailClaim(ctx, state.UserID, event.ID)
		result.Skipped++
	}
	for _, target := range waterTargets {
		claimed, err := service.store.ClaimWaterEmail(ctx, state.UserID, target.LandIndex, target.PlantedAt, target.NextWaterDueAt, target.WaterMissCount, nowMs)
		if err != nil {
			return result, err
		}
		if !claimed {
			result.Skipped++
			continue
		}
		sendResult, err := sender.SendWaterReminderEmail(ctx, FarmWaterReminderEmailInput{
			To:         qqEmail,
			CropName:   cropName(target.CropID),
			LandIndex:  target.LandIndex,
			WaterDueAt: target.WaterDueAt,
			PetName:    petName,
		})
		if err != nil {
			_ = service.store.DeleteWaterEmailClaim(ctx, state.UserID, target.LandIndex, target.PlantedAt, target.NextWaterDueAt, target.WaterMissCount)
			result.Failed++
			continue
		}
		if sendResult.Sent {
			result.Sent++
			continue
		}
		_ = service.store.DeleteWaterEmailClaim(ctx, state.UserID, target.LandIndex, target.PlantedAt, target.NextWaterDueAt, target.WaterMissCount)
		result.Skipped++
	}
	return result, nil
}

func normalizeMaturityEmailScanLimit(maxUsers int) int {
	if maxUsers <= 0 {
		return 100
	}
	if maxUsers > 500 {
		return 500
	}
	return maxUsers
}

func matureEmailEvents(state FarmState) []maturityEmailEvent {
	var rawEvents []maturityEmailEvent
	if len(state.Events) > 0 && string(state.Events) != "null" {
		_ = json.Unmarshal(state.Events, &rawEvents)
	}
	events := make([]maturityEmailEvent, 0, len(rawEvents))
	for _, event := range rawEvents {
		if event.Type != "mature" || event.ID == "" || event.CropID == "" || event.LandIndex <= 0 {
			continue
		}
		land := findLandByIndex(state.Lands, event.LandIndex)
		if land == nil || land.Crop == nil || land.Status != LandStatusMature {
			continue
		}
		if land.Crop.CropID == event.CropID && land.Crop.MatureAt == event.Ts {
			events = append(events, event)
		}
	}
	return events
}

func waterReminderTargets(state FarmState, nowMs int64) []waterReminderTarget {
	targets := []waterReminderTarget{}
	for _, land := range state.Lands {
		if land.Crop == nil {
			continue
		}
		if land.Status == LandStatusLocked || land.Status == LandStatusEmpty || land.Status == LandStatusMature ||
			land.Status == LandStatusWithered || land.Status == LandStatusEaten {
			continue
		}
		crop := land.Crop
		if nowMs >= crop.MatureAt {
			continue
		}
		canWater := land.Status == LandStatusThirsty || nowMs >= crop.NextWaterDueAt || nowMs+waterActionLeadMs >= crop.NextWaterDueAt
		if !canWater {
			continue
		}
		waterDueAt := crop.NextWaterDueAt
		if land.Status == LandStatusThirsty {
			waterDueAt = nowMs
		}
		targets = append(targets, waterReminderTarget{
			LandIndex:      land.Index,
			CropID:         crop.CropID,
			PlantedAt:      crop.PlantedAt,
			NextWaterDueAt: crop.NextWaterDueAt,
			WaterMissCount: crop.WaterMissCount,
			WaterDueAt:     waterDueAt,
		})
	}
	return targets
}

func findLandByIndex(lands []LandPlot, index int) *LandPlot {
	for i := range lands {
		if lands[i].Index == index {
			return &lands[i]
		}
	}
	return nil
}

func adultEmailPet(raw json.RawMessage) (farmEmailPet, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return farmEmailPet{}, false
	}
	var pet farmEmailPet
	if err := json.Unmarshal(raw, &pet); err != nil {
		return farmEmailPet{}, false
	}
	return pet, pet.Stage == "adult"
}

func resolveEmailPetName(pet farmEmailPet) string {
	if strings.TrimSpace(pet.Name) != "" {
		return strings.TrimSpace(pet.Name)
	}
	switch pet.Type {
	case "cat":
		return "小白猫"
	case "dog":
		return "边牧"
	case "rabbit":
		return "兔子"
	case "red_panda":
		return "红熊猫"
	default:
		return ""
	}
}

func buildMaturityEmailText(input FarmMaturityEmailInput) string {
	petLine := "你的成年宠物已经看到了成熟提醒。"
	if input.PetName != "" {
		petLine = fmt.Sprintf("你的宠物 %s 已经看到了成熟提醒。", input.PetName)
	}
	return strings.Join([]string{
		fmt.Sprintf("%s 已经成熟。", input.CropName),
		fmt.Sprintf("成熟时间：%s", formatChinaEmailTime(input.MatureAt)),
		petLine,
		"请回到开心农场及时收获。",
	}, "\n")
}

func buildMaturityEmailHTML(input FarmMaturityEmailInput) string {
	petLine := "你的成年宠物已经看到了成熟提醒。"
	if input.PetName != "" {
		petLine = fmt.Sprintf("你的宠物 %s 已经看到了成熟提醒。", input.PetName)
	}
	return fmt.Sprintf(`<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #1f2937;"><h2 style="margin: 0 0 12px; color: #15803d;">%s 成熟啦</h2><p>成熟时间：<strong>%s</strong></p><p>%s</p><p>请回到开心农场及时收获。</p></div>`,
		html.EscapeString(input.CropName),
		html.EscapeString(formatChinaEmailTime(input.MatureAt)),
		html.EscapeString(petLine),
	)
}

func buildWaterReminderEmailText(input FarmWaterReminderEmailInput) string {
	petLine := "你的成年宠物发现作物快缺水了。"
	if input.PetName != "" {
		petLine = fmt.Sprintf("你的宠物 %s 发现作物快缺水了。", input.PetName)
	}
	return strings.Join([]string{
		fmt.Sprintf("第 %d 块地的 %s 已经可以浇水。", input.LandIndex, input.CropName),
		fmt.Sprintf("缺水时间：%s", formatChinaEmailTime(input.WaterDueAt)),
		petLine,
		"请回到开心农场及时浇水，避免影响收益和品质。",
	}, "\n")
}

func buildWaterReminderEmailHTML(input FarmWaterReminderEmailInput) string {
	petLine := "你的成年宠物发现作物快缺水了。"
	if input.PetName != "" {
		petLine = fmt.Sprintf("你的宠物 %s 发现作物快缺水了。", input.PetName)
	}
	return fmt.Sprintf(`<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #1f2937;"><h2 style="margin: 0 0 12px; color: #0e7490;">第 %d 块地该浇水啦</h2><p>%s 已经进入可浇水窗口。</p><p>缺水时间：<strong>%s</strong></p><p>%s</p><p>请回到开心农场及时浇水，避免影响收益和品质。</p></div>`,
		input.LandIndex,
		html.EscapeString(input.CropName),
		html.EscapeString(formatChinaEmailTime(input.WaterDueAt)),
		html.EscapeString(petLine),
	)
}

func formatChinaEmailTime(timestampMs int64) string {
	t := time.UnixMilli(timestampMs).UTC().Add(8 * time.Hour)
	return t.Format("2006/01/02 15:04")
}
