package luckytd

const (
	MaxSquadSize                        = 9
	SquadRewardBonusPerMissingPermyriad = 800
)

func clampSquadSize(squadSize int) int {
	if squadSize < 1 {
		return 1
	}
	if squadSize > MaxSquadSize {
		return MaxSquadSize
	}
	return squadSize
}

func SquadBonusPermyriad(squadSize int) int {
	size := clampSquadSize(squadSize)
	return 10000 + (MaxSquadSize-size)*SquadRewardBonusPerMissingPermyriad
}

func PointRewardForScore(score int, squadSize int) int64 {
	if score <= 0 {
		return 0
	}
	return int64(score) * int64(SquadBonusPermyriad(squadSize)) / 10000
}
