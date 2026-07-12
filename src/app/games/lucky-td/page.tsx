'use client';

// 幸运塔防页面：准备室（状态/编队/地图/战绩）+ 横屏战斗屏 + 结算。
// 服务端契约见 src/lib/lucky-td/api.ts；M2 未接入时自动进入本地试玩模式（不计积分）。

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Clock3, Heart, Loader2, Map as MapIcon, Play, ShieldCheck, Swords, Target, Zap } from 'lucide-react';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import {
  buildLocalSubmitData,
  cancelLuckyTdGame,
  checkpointLuckyTdGame,
  createLocalSession,
  fetchLuckyTdStatus,
  startLuckyTdGame,
  submitLuckyTdGame,
  type LuckyTdActiveSession,
  type LuckyTdStatusData,
  type LuckyTdSubmitPayload,
} from '@/lib/lucky-td/api';
import { getEngineData } from '@/lib/lucky-td/engine/data';
import type { GameAction, MapConfig } from '@/lib/lucky-td/engine/types';
import { LuckyTdBattle, type HudSnapshot, type TerminalInfo, type WaveClearInfo } from '@/lib/lucky-td/renderer/renderer';
import { UNIT_STYLE } from '@/lib/lucky-td/renderer/draw';
import { MAX_SQUAD_SIZE } from '@/lib/lucky-td/constants';
import { BattleHudTop, BattleHudTray } from './_components/BattleHud';
import { MapScenePreview, UnitPortrait } from './_components/ArtThumbs';
import { BlessingPicker, ResultModal, RotateHint, RulesModal, type ResultInfo } from './_components/Overlays';

const DATA = getEngineData();
const DEFAULT_SQUAD = DATA.config.units.slice(0, MAX_SQUAD_SIZE).map((unit) => unit.id);
const UNIT_TRAITS = [
  '击杀回费',
  '三挡承伤',
  '连击近卫',
  '近战溅射',
  '高速远射',
  '法术群伤',
  '定向治疗',
  '幸运光环',
  '低血处决',
  '重炮溅射',
  '控场回推',
  '团队鼓舞',
  '盾反守线',
  '防空点杀',
  '毒雾减速',
  '群体治疗',
  '部署支援',
  '比例坍缩',
];
const SETTLE_COOLDOWN_SECONDS = 5;

interface BattleSession {
  sessionId: string;
  seed: string;
  mapId: string;
  squad: string[];
  initialActions: GameAction[];
  isLocal: boolean;
}

export default function LuckyTdPage() {
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<LuckyTdStatusData | null>(null);
  const [isLocalMode, setIsLocalMode] = useState(false);

  const [mapId, setMapId] = useState(DATA.config.maps[0]?.id ?? 'training_field');
  const [readyStep, setReadyStep] = useState<'map' | 'squad'>('map');
  const [squadSel, setSquadSel] = useState<string[]>(DEFAULT_SQUAD);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [pendingMapId, setPendingMapId] = useState<string | null>(null);

  const [session, setSession] = useState<BattleSession | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [blessingOptions, setBlessingOptions] = useState<number[] | null>(null);
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const battleRef = useRef<LuckyTdBattle | null>(null);
  const confirmedActionsRef = useRef(0);
  const checkpointChainRef = useRef<Promise<void>>(Promise.resolve());
  const submitPayloadRef = useRef<LuckyTdSubmitPayload | null>(null);
  const surrenderingRef = useRef(false);
  const surrenderWasPausedRef = useRef(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    const out = await fetchLuckyTdStatus();
    if (out.unavailable) {
      setIsLocalMode(true);
      setStatusData(null);
    } else if (out.ok && out.data) {
      setIsLocalMode(false);
      setStatusData(out.data);
      setCooldownRemaining((current) => Math.max(current, out.data?.cooldownRemaining ?? 0));
    } else {
      setStatusError(out.message);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (cooldownRemaining <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setCooldownRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownRemaining]);

  const toggleSquadUnit = (unitId: string) => {
    setSquadSel((current) => {
      if (current.includes(unitId)) {
        return current.filter((id) => id !== unitId);
      }
      if (current.length >= MAX_SQUAD_SIZE) {
        return current;
      }
      return [...current, unitId];
    });
  };

  const selectMap = (nextMapId: string) => {
    setMapId(nextMapId);
    setStartError(null);
    setPendingMapId(null);
    setReadyStep('squad');
  };

  const requestMapSelect = (map: MapConfig, index: number) => {
    if (index >= 3) {
      setPendingMapId(map.id);
      return;
    }
    selectMap(map.id);
  };

  const returnToMapSelect = () => {
    setStartError(null);
    setPendingMapId(null);
    setReadyStep('map');
  };

  const startBattle = useCallback(
    async (resume?: LuckyTdActiveSession) => {
      if (starting || cooldownRemaining > 0) {
        return;
      }
      setStarting(true);
      setStartError(null);
      setResultInfo(null);
      setBlessingOptions(null);
      setHud(null);
      setConfirmSurrender(false);
      setRulesOpen(false);
      surrenderingRef.current = false;
      surrenderWasPausedRef.current = false;
      try {
        if (resume) {
          confirmedActionsRef.current = resume.actions.length;
          setSession({
            sessionId: resume.sessionId,
            seed: resume.seed,
            mapId: resume.mapId,
            squad: resume.squad,
            initialActions: resume.actions,
            isLocal: false,
          });
          return;
        }
        if (squadSel.length < 1) {
          setStartError('请至少选择 1 名干员');
          return;
        }
        if (!isLocalMode) {
          const out = await startLuckyTdGame(mapId, squadSel);
          if (out.unavailable) {
            setIsLocalMode(true);
          } else if (!out.ok || !out.data) {
            setStartError(out.message);
            return;
          } else {
            confirmedActionsRef.current = 0;
            setSession({
              sessionId: out.data.sessionId,
              seed: out.data.seed,
              mapId,
              squad: squadSel,
              initialActions: [],
              isLocal: false,
            });
            return;
          }
        }
        const local = createLocalSession();
        confirmedActionsRef.current = 0;
        setSession({ sessionId: local.sessionId, seed: local.seed, mapId, squad: squadSel, initialActions: [], isLocal: true });
      } finally {
        setStarting(false);
      }
    },
    [starting, cooldownRemaining, squadSel, isLocalMode, mapId],
  );

  const exitBattle = useCallback((refreshStatus = true) => {
    setSession(null);
    setHud(null);
    setBlessingOptions(null);
    setResultInfo(null);
    setConfirmSurrender(false);
    setRulesOpen(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    if (refreshStatus) {
      void loadStatus();
    }
  }, [loadStatus]);

  const handleWaveCleared = useCallback(
    (info: WaveClearInfo, current: BattleSession) => {
      if (current.isLocal || surrenderingRef.current) {
        return;
      }
      checkpointChainRef.current = checkpointChainRef.current.then(async () => {
        const delta = info.actions.slice(confirmedActionsRef.current);
        const out = await checkpointLuckyTdGame({
          sessionId: current.sessionId,
          waveIndex: info.waveIndex,
          frame: info.frame,
          stateHash: info.stateHash,
          actionsDelta: delta,
        });
        if (out.ok) {
          confirmedActionsRef.current = info.actions.length;
        }
      });
    },
    [],
  );

  const doSubmit = useCallback(async (payload: LuckyTdSubmitPayload) => {
    setResultInfo((current) => (current ? { ...current, submitting: true, submitError: null } : current));
    const out = await submitLuckyTdGame(payload);
    setResultInfo((current) => {
      if (!current) {
        return current;
      }
      if (!out.ok || !out.data) {
        return { ...current, submitting: false, submitError: out.message || '结算上报失败' };
      }
      return { ...current, submitting: false, submitError: null, submit: out.data };
    });
    if (out.ok) {
      setCooldownRemaining(SETTLE_COOLDOWN_SECONDS);
    }
  }, []);

  const handleTerminal = useCallback(
    (info: TerminalInfo, current: BattleSession) => {
      if (surrenderingRef.current) {
        return;
      }
      if (current.isLocal) {
        setResultInfo({
          result: info.result,
          submit: buildLocalSubmitData(info.result, current.squad.length),
          isLocal: true,
          submitError: null,
          submitting: false,
        });
        setCooldownRemaining(SETTLE_COOLDOWN_SECONDS);
        return;
      }
      setResultInfo({ result: info.result, submit: null, isLocal: false, submitError: null, submitting: true });
      void checkpointChainRef.current.then(() => {
        const payload: LuckyTdSubmitPayload = {
          sessionId: current.sessionId,
          finalFrame: info.finalFrame,
          claimedScore: info.result.score,
          actionsDelta: info.actions.slice(confirmedActionsRef.current),
        };
        submitPayloadRef.current = payload;
        void doSubmit(payload);
      });
    },
    [doSubmit],
  );

  const handleSurrenderConfirm = useCallback(() => {
    const current = session;
    surrenderingRef.current = true;
    setConfirmSurrender(false);
    battleRef.current?.destroy();
    battleRef.current = null;
    exitBattle(false);
    if (current && !current.isLocal) {
      void cancelLuckyTdGame(current.sessionId)
        .catch(() => undefined)
        .then(() => void loadStatus());
      return;
    }
    void loadStatus();
  }, [session, exitBattle, loadStatus]);

  const restartFromResult = useCallback(() => {
    const current = session;
    setSession(null);
    setResultInfo(null);
    setHud(null);
    setBlessingOptions(null);
    setConfirmSurrender(false);
    setRulesOpen(false);
    window.setTimeout(() => {
      void startBattle();
    }, 30);
    void current;
  }, [session, startBattle]);

  // ── 战斗屏 ────────────────────────────────
  if (session) {
    return (
      <BattleScreen
        key={session.sessionId}
        session={session}
        hud={hud}
        blessingOptions={blessingOptions}
        resultInfo={resultInfo}
        cooldownRemaining={cooldownRemaining}
        confirmSurrender={confirmSurrender}
        battleRef={battleRef}
        onHud={setHud}
        onBlessing={setBlessingOptions}
        onWaveCleared={(info) => handleWaveCleared(info, session)}
        onTerminal={(info) => handleTerminal(info, session)}
        onPickBlessing={(idx) => battleRef.current?.requestBless(idx)}
        onSelectSquadUnit={(typeIdx) => battleRef.current?.selectSquadUnit(typeIdx)}
        onTrayDragStart={(typeIdx, point) => battleRef.current?.beginTrayDrag(typeIdx, point)}
        onRetreat={(unitId) => battleRef.current?.requestRetreat(unitId)}
        onUseSkill={(unitId) => battleRef.current?.requestSkill(unitId)}
        onUpgradeSkill={(unitId) => battleRef.current?.requestSkillUpgrade(unitId)}
        onToggleSpeed={() => battleRef.current?.setSpeed(hud?.speed === 2 ? 1 : 2)}
        onTogglePause={() => battleRef.current?.setPaused(!(hud?.paused ?? false))}
        onSurrender={() => {
          surrenderWasPausedRef.current = hud?.paused ?? false;
          battleRef.current?.setPaused(true);
          setConfirmSurrender(true);
        }}
        onSurrenderConfirm={handleSurrenderConfirm}
        onSurrenderClose={() => {
          setConfirmSurrender(false);
          if (!surrenderWasPausedRef.current) {
            battleRef.current?.setPaused(false);
          }
        }}
        onRetrySubmit={() => {
          if (submitPayloadRef.current) {
            void doSubmit(submitPayloadRef.current);
          }
        }}
        onRestart={restartFromResult}
        onExit={exitBattle}
      />
    );
  }

  // ── 准备室 ────────────────────────────────
  const activeSession = statusData?.activeSession ?? null;
  const selectedMap = DATA.config.maps.find((map) => map.id === mapId) ?? DATA.config.maps[0];
  const pendingMap = pendingMapId ? DATA.config.maps.find((map) => map.id === pendingMapId) ?? null : null;
  const pickedUnits = squadSel
    .map((unitId) => DATA.config.units.find((unit) => unit.id === unitId))
    .filter((unit): unit is (typeof DATA.config.units)[number] => Boolean(unit));
  const readyStepLabel = readyStep === 'map' ? '选择地图' : '选择编队';
  const readyMessage = startError
    ?? (activeSession
      ? `检测到未完成对局：${mapName(activeSession.mapId)}，已同步 ${activeSession.actions.length} 步。`
      : cooldownRemaining > 0
        ? `结算冷却中，还需 ${cooldownRemaining} 秒。`
        : readyStep === 'map'
          ? '先选择一张地图，随后配置本局编队。'
          : `已选择 ${selectedMap.name}，现在选择本局编队。`);
  return (
    <div className="ltd-page">
      <div className="ltd-mesh-bg" aria-hidden />
      <div className="ltd-stars" aria-hidden>
        <span style={{ top: '9%', left: '7%', fontSize: 14 }}>✦</span>
        <span style={{ top: '18%', left: '88%', fontSize: 11, animationDelay: '1s' }}>✧</span>
        <span style={{ top: '43%', left: '4%', fontSize: 16, animationDelay: '2.2s' }}>✦</span>
        <span style={{ top: '72%', left: '93%', fontSize: 12, animationDelay: '0.6s' }}>✧</span>
        <span style={{ top: '88%', left: '16%', fontSize: 13, animationDelay: '1.7s' }}>✦</span>
      </div>

      <header className="ltd-topbar">
        <Link href="/games" className="ltd-exit-btn" aria-label="返回游戏中心">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="ltd-container">
        {statusError && (
          <div className="ltd-error-banner" role="alert">
            <span>{statusError}</span>
            <button type="button" onClick={() => void loadStatus()}>
              重试
            </button>
          </div>
        )}

        <section className="ltd-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              <span>防线整备</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500">
                {readyStepLabel} · {readyStep === 'map' ? `${DATA.config.maps.length} 张地图` : `${selectedMap.name} · ${squadSel.length}/${MAX_SQUAD_SIZE}`}
              </span>
            </div>
            <div className="ltd-ready-message-row">
              {readyStep === 'squad' && (
                <button type="button" onClick={returnToMapSelect} className="ltd-reselect-map-btn">
                  <span className="arrow">
                    <ArrowLeft size={13} strokeWidth={2.5} />
                  </span>
                  重选地图
                </button>
              )}
              <p className={`truncate text-lg font-black sm:text-xl ${startError ? 'text-rose-600' : 'text-slate-950'}`}>
                {readyMessage}
              </p>
            </div>
          </div>
          <div className="ltd-command-actions">
            <button type="button" onClick={() => setRulesOpen(true)} className="ltd-action-btn">
              <BookOpen className="h-4 w-4" />
              规则
            </button>
          </div>
        </section>

        {activeSession && (
          <section className="ltd-resume-banner">
            <ShieldCheck className="h-5 w-5" />
            <div className="min-w-0">
              <strong>未完成对局</strong>
              <span>{mapName(activeSession.mapId)} · 已同步 {activeSession.actions.length} 步</span>
            </div>
            <div className="ltd-resume-actions">
              <button
                type="button"
                onClick={() => void startBattle(activeSession)}
                className="ltd-mini-btn primary"
              >
                恢复对局
              </button>
              <button
                type="button"
                onClick={() => {
                  void cancelLuckyTdGame(activeSession.sessionId)
                    .catch(() => undefined)
                    .then(() => void loadStatus());
                }}
                className="ltd-mini-btn"
              >
                放弃
              </button>
            </div>
          </section>
        )}

        <div className={`ltd-ready-layout ${readyStep === 'map' ? 'is-map-step' : 'is-squad-step'}`}>
          <section className="glass-card stage-card ltd-loadout-card">
            <div className="ltd-section-head">
              <h2 className="section-title">
                <span className="st-icon">
                  {readyStep === 'map' ? <MapIcon size={18} /> : <Swords size={18} />}
                </span>
                {readyStep === 'map' ? '选择地图' : '选择编队'}
              </h2>
              <span className="ltd-cute-pill">
                {readyStep === 'map' ? <Target className="h-4 w-4" /> : <Swords className="h-4 w-4" />}
                {readyStep === 'map' ? '先定战场' : `已选 ${squadSel.length}/${MAX_SQUAD_SIZE}`}
              </span>
            </div>

            {readyStep === 'map' ? (
              <div className="ltd-map-grid">
                {DATA.config.maps.map((map, index) => {
                  const selected = mapId === map.id;
                  return (
                    <button
                      key={map.id}
                      type="button"
                      onClick={() => requestMapSelect(map, index)}
                      className={`ltd-map-card ${selected ? 'is-selected' : ''}`}
                      style={{ animationDelay: `${index * 45}ms` }}
                    >
                      <MapPreview map={map} />
                      <div className="ltd-map-copy">
                        <h3>{map.name}</h3>
                        <p>
                          {map.difficulty} · {map.waves.length} 波 · 生命 ×{formatPermyriad(map.hpPermyriad)}
                          {map.scorePermyriad > 10000 ? ` · 分数 ×${formatPermyriad(map.scorePermyriad)}` : ''}
                          {map.mechanics[0] ? (
                            <span className="ltd-map-mechanic-line">
                              {map.mechanics[0].name} · {map.mechanics[0].desc}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="ltd-map-meter" aria-hidden>
                        <span style={{ width: `${mapPressurePercent(map)}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="ltd-selected-map-strip">
                  <div className="min-w-0">
                    <span>已选地图</span>
                    <strong>{selectedMap.name}</strong>
                    <small>{selectedMap.difficulty} · {selectedMap.paths.length} 条路线 · {selectedMap.waves.length} 波</small>
                  </div>
                </div>

                <div className="ltd-unit-grid">
                  {DATA.config.units.map((unit, idx) => {
                    const picked = squadSel.includes(unit.id);
                    return (
                      <button
                        key={unit.id}
                        type="button"
                        onClick={() => toggleSquadUnit(unit.id)}
                        className={`ltd-unit-card ${picked ? 'is-picked' : ''}`}
                        style={picked ? { boxShadow: `0 14px 28px rgba(16, 185, 129, 0.18), inset 0 -4px 0 ${UNIT_STYLE[idx]?.color ?? '#10b981'}` } : undefined}
                      >
                        <span
                          className="ltd-unit-avatar"
                          style={{ background: `${UNIT_STYLE[idx]?.color ?? '#10b981'}22`, borderColor: UNIT_STYLE[idx]?.color ?? '#10b981' }}
                        >
                          <UnitPortrait typeIdx={idx} size={40} />
                        </span>
                        <span className="ltd-unit-name">{unit.name}</span>
                        <span className="ltd-unit-cost">
                          <Zap className="h-3 w-3" fill="currentColor" />
                          {unit.cost} · {unit.block > 0 ? `挡${unit.block}` : '远程'}
                        </span>
                        <span className="ltd-unit-trait">{UNIT_TRAITS[idx] ?? '战术角色'}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {readyStep === 'squad' && (
            <aside className="ltd-side-panel">
              <section className="glass-card stage-card ltd-launch-card">
                <div className="ltd-selected-map">
                  <MapPreview map={selectedMap} large />
                  <div className="ltd-selected-copy">
                    <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700/80">当前战场</div>
                    <h2>{selectedMap.name}</h2>
                    <p>{selectedMap.difficulty}难度，{selectedMap.paths.length} 条进攻路线，{selectedMap.rangedCells.length} 个高台位。</p>
                    {selectedMap.mechanics[0] ? (
                      <p className="ltd-map-mechanic-summary">
                        机制：{selectedMap.mechanics.map((mechanic) => `${mechanic.name}（${mechanic.desc}）`).join('；')}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="ltd-intel-grid">
                  <InfoTile icon={<MapIcon className="h-4 w-4" />} label="路线" value={`${selectedMap.paths.length} 条`} />
                  <InfoTile icon={<Target className="h-4 w-4" />} label="难度" value={selectedMap.difficulty} />
                  <InfoTile icon={<Clock3 className="h-4 w-4" />} label="波次" value={`${selectedMap.waves.length} 波`} />
                  <InfoTile icon={<Heart className="h-4 w-4" />} label="生命" value={`×${formatPermyriad(selectedMap.hpPermyriad)}`} />
                </div>

                <div className="ltd-picked-line">
                  {pickedUnits.length === 0 ? (
                    <span className="text-slate-400">尚未选择干员</span>
                  ) : (
                    pickedUnits.map((unit) => {
                      const idx = DATA.config.units.findIndex((item) => item.id === unit.id);
                      return (
                        <span key={unit.id} title={unit.name}>
                          <UnitPortrait typeIdx={idx} size={24} />
                        </span>
                      );
                    })
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void startBattle()}
                  disabled={starting || statusLoading || cooldownRemaining > 0 || squadSel.length < 1}
                  className="ltd-start-btn"
                >
                  {starting || statusLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
                  {statusLoading ? '加载中' : cooldownRemaining > 0 ? `冷却中 ${cooldownRemaining}s` : '开始防守'}
                </button>
                <p className="ltd-launch-note">横屏战场 · 30 波防守 · 结算后同步积分</p>
              </section>
            </aside>
          )}
        </div>
      </main>
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <CancelConfirmModal
        open={Boolean(pendingMap)}
        title="确认挑战高难地图？"
        description={pendingMap ? `你选择的是 ${pendingMap.name}，${pendingMap.difficulty} 难度会明显提高路线、敌人和机制压力。` : ''}
        detail="建议先确认编队里有阻挡、治疗、防空和群体输出；进入编队后仍可重选地图。"
        confirmLabel="继续选择"
        cancelLabel="返回选图"
        onConfirm={() => {
          if (pendingMap) {
            selectMap(pendingMap.id);
          }
        }}
        onClose={() => setPendingMapId(null)}
      />
      <LuckyTdStyles />
    </div>
  );
}

function formatPermyriad(value: number): string {
  const scaled = value / 10000;
  return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
}

function mapPressurePercent(map: MapConfig): number {
  const routePressure = map.paths.length * 15;
  const hpPressure = Math.max(0, (map.hpPermyriad - 10000) / 180);
  const rewardPressure = Math.max(0, (map.scorePermyriad - 10000) / 280);
  return Math.max(34, Math.min(100, Math.round(routePressure + hpPressure + rewardPressure)));
}

function MapPreview({ map, large = false }: { map: MapConfig; large?: boolean }) {
  return (
    <div className={`ltd-map-preview ${large ? 'is-large' : ''}`} aria-hidden>
      <MapScenePreview mapIdx={DATA.mapIdToIdx[map.id] ?? 0} />
    </div>
  );
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="ltd-info-tile">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function LuckyTdStyles() {
  return (
    <style jsx global>{`
      .ltd-page {
        --ltd-emerald: #10b981;
        --ltd-emerald-700: #047857;
        --ltd-emerald-900: #064e3b;
        --ltd-slate: #0f172a;
        --ltd-soft: #64748b;
        min-height: 100vh;
        position: relative;
        overflow-x: hidden;
        background: #f8fafc;
        color: var(--ltd-slate);
      }

      .ltd-mesh-bg {
        position: fixed;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background:
          radial-gradient(circle at 12% 18%, rgba(167, 243, 208, 0.62), transparent 46%),
          radial-gradient(circle at 88% 22%, rgba(125, 211, 252, 0.34), transparent 42%),
          radial-gradient(circle at 68% 92%, rgba(251, 191, 36, 0.22), transparent 44%),
          linear-gradient(180deg, #f8fafc 0%, #ecfdf5 48%, #f1f5f9 100%);
        filter: blur(42px);
        transform: scale(1.04);
      }

      .ltd-stars {
        position: fixed;
        inset: 0;
        z-index: 1;
        pointer-events: none;
      }

      .ltd-stars span {
        position: absolute;
        color: rgba(16, 185, 129, 0.42);
        animation: ltd-twinkle 3.2s ease-in-out infinite;
      }

      @keyframes ltd-twinkle {
        0%, 100% { opacity: 0.28; transform: translateY(0) scale(1); }
        50% { opacity: 0.86; transform: translateY(-5px) scale(1.18); }
      }

      .ltd-topbar {
        position: sticky;
        top: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding: 18px 48px;
        padding-top: max(18px, env(safe-area-inset-top));
        background: rgba(239, 253, 248, 0.68);
        border-bottom: 1px solid rgba(255, 255, 255, 0.74);
        backdrop-filter: blur(22px) saturate(1.45);
        -webkit-backdrop-filter: blur(22px) saturate(1.45);
      }

      .ltd-exit-btn {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.82);
        background: rgba(255, 255, 255, 0.62);
        padding: 8px 18px 8px 8px;
        color: #065f46;
        font-size: 13px;
        font-weight: 900;
        letter-spacing: 1.5px;
        text-decoration: none;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
        backdrop-filter: blur(16px);
        transition: transform 160ms ease, box-shadow 160ms ease;
      }

      .ltd-exit-btn:hover,
      .ltd-reselect-map-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 14px 30px rgba(16, 185, 129, 0.16);
      }

      .ltd-exit-btn .arrow,
      .ltd-reselect-map-btn .arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        flex-shrink: 0;
        border-radius: 50%;
        background: linear-gradient(135deg, #34d399, #047857);
        color: #fff;
        box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
      }

      .ltd-container {
        position: relative;
        z-index: 2;
        width: min(1440px, 100%);
        margin: 0 auto;
        padding: 22px 48px 92px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .ltd-error-banner,
      .ltd-command-bar,
      .ltd-resume-banner,
      .ltd-page .glass-card {
        border: 1px solid rgba(255, 255, 255, 0.9);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.72));
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        box-shadow: 0 20px 44px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.92);
      }

      .ltd-command-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        min-height: 88px;
        padding: 20px 24px;
        border-radius: 28px;
      }

      .ltd-command-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
        flex: 0 0 auto;
      }

      .ltd-ready-message-row {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 12px;
      }

      .ltd-ready-message-row p {
        min-width: 0;
      }

      .ltd-reselect-map-btn {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        flex: 0 0 auto;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.82);
        background: rgba(255, 255, 255, 0.68);
        padding: 6px 14px 6px 6px;
        color: #065f46;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.4px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
        backdrop-filter: blur(16px);
        transition: transform 160ms ease, box-shadow 160ms ease;
      }

      .ltd-action-btn,
      .ltd-mini-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border: 0;
        border-radius: 999px;
        background: #fff;
        color: #047857;
        font-size: 13px;
        font-weight: 900;
        padding: 10px 15px;
        box-shadow: 0 8px 18px rgba(16, 185, 129, 0.12);
        transition: transform 140ms ease, background 180ms ease;
      }

      .ltd-action-btn:hover,
      .ltd-mini-btn:hover {
        transform: translateY(-1px);
        background: #ecfdf5;
      }

      .ltd-status-pill {
        display: inline-flex;
        align-items: center;
        min-height: 38px;
        padding: 0 14px;
        border-radius: 999px;
        background: #ecfdf5;
        color: #047857;
        border: 1px solid rgba(16, 185, 129, 0.18);
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .ltd-status-pill.amber {
        background: #fffbeb;
        color: #b45309;
        border-color: rgba(245, 158, 11, 0.25);
      }

      .ltd-error-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 13px 18px;
        border-radius: 20px;
        background: #fff1f2;
        color: #be123c;
        font-size: 14px;
        font-weight: 800;
      }

      .ltd-error-banner button {
        border: 0;
        background: transparent;
        color: #be123c;
        font-weight: 900;
        text-decoration: underline;
      }

      .ltd-resume-banner {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 15px 18px;
        border-radius: 22px;
        background: linear-gradient(180deg, #eff6ff, #ecfeff);
        color: #075985;
      }

      .ltd-resume-banner strong,
      .ltd-resume-banner span {
        display: block;
      }

      .ltd-resume-banner strong {
        font-size: 14px;
        font-weight: 900;
      }

      .ltd-resume-banner span {
        color: #0f766e;
        font-size: 12px;
        font-weight: 800;
      }

      .ltd-resume-actions {
        display: flex;
        gap: 8px;
        margin-left: auto;
      }

      .ltd-mini-btn {
        min-height: 34px;
        padding: 0 14px;
        border: 1px solid rgba(14, 165, 233, 0.22);
        color: #0369a1;
        font-size: 12px;
      }

      .ltd-mini-btn.primary {
        background: #0284c7;
        color: #fff;
      }

      .ltd-ready-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(340px, 390px);
        gap: 18px;
        align-items: start;
      }

      .ltd-ready-layout.is-map-step {
        grid-template-columns: 1fr;
      }

      .ltd-ready-layout.is-map-step .ltd-loadout-card {
        width: 100%;
      }

      .ltd-page .stage-card {
        border-radius: 28px;
        padding: 22px;
      }

      .ltd-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }

      .ltd-section-head-spaced {
        margin-top: 24px;
      }

      .ltd-page .section-title {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin: 0;
        color: #0f172a;
        font-size: 20px;
        font-weight: 900;
        letter-spacing: 0;
      }

      .ltd-page .st-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 12px;
        background: linear-gradient(135deg, #10b981, #047857);
        color: #fff;
        box-shadow: 0 10px 20px rgba(16, 185, 129, 0.28);
      }

      .ltd-cute-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 34px;
        padding: 0 13px;
        border-radius: 999px;
        background: #ecfdf5;
        color: #047857;
        border: 1px solid rgba(16, 185, 129, 0.18);
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .ltd-cute-pill.slate {
        background: #f8fafc;
        color: #475569;
        border-color: #e2e8f0;
      }

      .ltd-map-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 13px;
      }

      .ltd-ready-layout.is-map-step .ltd-map-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .ltd-map-card {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 11px;
        min-height: 178px;
        padding: 12px;
        border-radius: 22px;
        border: 2px solid rgba(226, 232, 240, 0.9);
        background: linear-gradient(180deg, #fff, #f8fafc);
        color: inherit;
        text-align: left;
        cursor: pointer;
        overflow: hidden;
        animation: ltd-card-in 0.36s ease both;
        transition: transform 170ms ease, border-color 170ms ease, box-shadow 170ms ease;
      }

      @keyframes ltd-card-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .ltd-map-card:hover {
        transform: translateY(-4px);
        border-color: rgba(16, 185, 129, 0.45);
        box-shadow: 0 18px 34px rgba(16, 185, 129, 0.14);
      }

      .ltd-map-card.is-selected {
        border-color: #10b981;
        background: linear-gradient(180deg, #ecfdf5, #fff);
        box-shadow: 0 16px 30px rgba(16, 185, 129, 0.18), inset 0 0 0 1px rgba(16, 185, 129, 0.2);
      }

      .ltd-map-copy h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 900;
        color: #0f172a;
      }

      .ltd-map-copy p {
        margin: 4px 0 0;
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.45;
      }

      .ltd-map-meter {
        height: 6px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }

      .ltd-map-meter span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #10b981, #f59e0b, #f43f5e);
      }

      .ltd-map-preview {
        width: 100%;
        padding: 8px;
        border-radius: 16px;
        overflow: hidden;
        background:
          linear-gradient(135deg, rgba(167, 243, 208, 0.52), rgba(186, 230, 253, 0.42)),
          #ecfdf5;
        border: 1px solid rgba(16, 185, 129, 0.16);
      }

      .ltd-map-preview canvas {
        border-radius: 10px;
      }

      .ltd-map-preview.is-large {
        border-radius: 18px;
        padding: 10px;
      }

      .ltd-map-mechanic-line {
        display: block;
        max-width: 100%;
        margin-top: 3px;
        overflow: hidden;
        color: #0f766e;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ltd-unit-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 10px;
      }

      .ltd-selected-map-strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 16px;
        padding: 14px 16px;
        border-radius: 18px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }

      .ltd-selected-map-strip span,
      .ltd-selected-map-strip strong,
      .ltd-selected-map-strip small {
        display: block;
      }

      .ltd-selected-map-strip span {
        color: #047857;
        font-size: 11px;
        font-weight: 900;
      }

      .ltd-selected-map-strip strong {
        color: #0f172a;
        font-size: 18px;
        font-weight: 900;
      }

      .ltd-selected-map-strip small {
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
      }

      .ltd-unit-card {
        display: flex;
        min-width: 0;
        min-height: 132px;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 7px;
        padding: 12px 8px 10px;
        border-radius: 20px;
        border: 2px solid rgba(226, 232, 240, 0.9);
        background: linear-gradient(180deg, #fff, #f8fafc);
        transition: transform 150ms ease, border-color 150ms ease, opacity 150ms ease;
      }

      .ltd-unit-card:hover {
        transform: translateY(-3px);
        border-color: rgba(16, 185, 129, 0.42);
      }

      .ltd-unit-card.is-picked {
        border-color: #10b981;
        background: linear-gradient(180deg, #ecfdf5, #fff);
      }

      .ltd-unit-avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 15px;
        border: 1.5px solid #10b981;
        font-size: 24px;
      }

      .ltd-unit-name {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #0f172a;
        font-size: 12px;
        font-weight: 900;
      }

      .ltd-unit-cost {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        color: #b45309;
        font-size: 11px;
        font-weight: 900;
      }

      .ltd-unit-trait {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-radius: 999px;
        background: #f1f5f9;
        color: #64748b;
        padding: 3px 8px;
        font-size: 10px;
        font-weight: 900;
      }

      .ltd-side-panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ltd-selected-map {
        display: grid;
        gap: 14px;
      }

      .ltd-selected-copy h2 {
        margin: 5px 0 4px;
        color: #0f172a;
        font-size: 24px;
        font-weight: 900;
        letter-spacing: 0;
      }

      .ltd-selected-copy p {
        margin: 0;
        color: #64748b;
        font-size: 13px;
        font-weight: 800;
      }

      .ltd-selected-copy .ltd-map-mechanic-summary {
        margin-top: 7px;
        color: #0f766e;
        line-height: 1.45;
      }

      .ltd-intel-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin-top: 14px;
      }

      .ltd-info-tile {
        display: flex;
        min-height: 86px;
        flex-direction: column;
        align-items: flex-start;
        justify-content: space-between;
        gap: 7px;
        min-width: 0;
        padding: 10px;
        border-radius: 16px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }

      .ltd-info-tile > span {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 11px;
        background: #ecfdf5;
        color: #047857;
        flex: 0 0 auto;
      }

      .ltd-info-tile small,
      .ltd-info-tile strong {
        display: block;
      }

      .ltd-info-tile small {
        color: #94a3b8;
        font-size: 10px;
        font-weight: 900;
      }

      .ltd-info-tile strong {
        color: #0f172a;
        font-size: 13px;
        font-weight: 900;
        white-space: nowrap;
      }

      .ltd-picked-line {
        display: flex;
        align-items: center;
        gap: 7px;
        min-height: 44px;
        margin-top: 12px;
        padding: 8px 10px;
        border-radius: 16px;
        background: #f8fafc;
        border: 1px dashed #cbd5e1;
      }

      .ltd-picked-line span:not(.text-slate-400) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08);
      }

      .ltd-start-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        width: 100%;
        min-height: 54px;
        margin-top: 12px;
        border: 0;
        border-radius: 18px;
        background: linear-gradient(135deg, #10b981, #047857);
        color: #fff;
        font-size: 15px;
        font-weight: 900;
        box-shadow: 0 16px 30px rgba(16, 185, 129, 0.32);
        transition: transform 150ms ease, filter 150ms ease, opacity 150ms ease;
      }

      .ltd-start-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        filter: brightness(1.04);
      }

      .ltd-start-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
        filter: grayscale(0.25);
      }

      .ltd-launch-note {
        margin: 9px 0 0;
        color: #94a3b8;
        text-align: center;
        font-size: 12px;
        font-weight: 800;
      }

      .ltd-battle-screen {
        position: fixed;
        inset: 0;
        z-index: 70;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background:
          radial-gradient(circle at 15% 0%, rgba(16, 185, 129, 0.18), transparent 34%),
          radial-gradient(circle at 86% 100%, rgba(14, 165, 233, 0.16), transparent 36%),
          #07111f;
        color: #fff;
      }

      .ltd-battle-loading {
        display: flex;
        height: 58px;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.86);
        color: rgba(255, 255, 255, 0.72);
        font-size: 12px;
        font-weight: 900;
        backdrop-filter: blur(18px);
      }

      .ltd-battle-field {
        position: relative;
        display: flex;
        min-height: 0;
        flex: 1;
        align-items: center;
        justify-content: center;
        padding: 10px 14px;
      }

      .ltd-battle-stage {
        position: relative;
        width: min(100%, calc((100dvh - 204px) * 24 / 11));
        aspect-ratio: 24 / 11;
        border-radius: 18px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34), 0 0 0 1px rgba(255, 255, 255, 0.1);
        overflow: hidden;
      }

      .ltd-battle-stage canvas {
        border-radius: 18px;
      }

      .ltd-wave-banner {
        pointer-events: none;
        position: absolute;
        left: 50%;
        top: 12px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(251, 191, 36, 0.38);
        color: #fcd34d;
        padding: 7px 16px;
        font-size: 12px;
        font-weight: 900;
        backdrop-filter: blur(14px);
      }

      .ltd-paused-mask {
        pointer-events: auto;
        position: absolute;
        inset: 0;
        z-index: 12;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.52);
        color: #fff;
        font-size: 26px;
        font-weight: 900;
        backdrop-filter: blur(4px);
      }

      .ltd-hud-top {
        display: flex;
        min-height: 58px;
        flex-shrink: 0;
        align-items: center;
        gap: 10px;
        padding: 9px 16px;
        background: rgba(15, 23, 42, 0.82);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(20px) saturate(1.4);
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
      }

      .ltd-hud-stats {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .ltd-hud-stats::-webkit-scrollbar,
      .ltd-squad-rail::-webkit-scrollbar {
        display: none;
      }

      .ltd-hud-stat {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 38px;
        padding: 0 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #fff;
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .ltd-hud-stat strong {
        color: #fff;
        font-variant-numeric: tabular-nums;
      }

      .ltd-hud-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
        flex: 0 0 auto;
      }

      .ltd-hud-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 38px;
        min-height: 38px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.09);
        color: #fff;
        padding: 0 12px;
        font-size: 12px;
        font-weight: 900;
        transition: background 150ms ease, transform 150ms ease;
      }

      .ltd-hud-button:hover {
        transform: translateY(-1px);
        background: rgba(255, 255, 255, 0.16);
      }

      .ltd-hud-button:disabled {
        cursor: not-allowed;
        opacity: 0.48;
        transform: none;
      }

      .ltd-hud-button.danger {
        background: rgba(244, 63, 94, 0.9);
        border-color: rgba(251, 113, 133, 0.8);
      }

      .ltd-battle-tray {
        position: relative;
        display: flex;
        min-height: 142px;
        flex-shrink: 0;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: rgba(15, 23, 42, 0.86);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(22px) saturate(1.35);
      }

      .ltd-battle-tray.is-disabled .ltd-squad-card:not(.is-disabled) {
        opacity: 0.55;
      }

      .ltd-tray-message {
        pointer-events: none;
        position: absolute;
        left: 50%;
        top: -38px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: rgba(244, 63, 94, 0.96);
        color: #fff;
        padding: 8px 16px;
        font-size: 12px;
        font-weight: 900;
        box-shadow: 0 14px 30px rgba(0, 0, 0, 0.24);
      }

      .ltd-field-card {
        position: fixed;
        left: 18px;
        top: auto;
        bottom: 158px;
        z-index: 180;
        display: flex;
        width: min(370px, calc(100vw - 32px));
        max-height: calc(100dvh - 236px);
        flex-direction: column;
        overflow-y: auto;
        border-radius: 20px;
        background: rgba(15, 23, 42, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(18px) saturate(1.35);
      }

      .ltd-field-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .ltd-field-main strong {
        color: #fff;
        font-size: 13px;
        font-weight: 900;
      }

      .ltd-field-main span {
        color: #86efac;
        font-size: 11px;
        font-weight: 900;
      }

      .ltd-field-main button,
      .ltd-skill-actions button {
        border: 0;
        border-radius: 999px;
        min-height: 30px;
        padding: 0 10px;
        font-size: 12px;
        font-weight: 900;
      }

      .ltd-field-main button {
        background: #fbbf24;
        color: #422006;
      }

      .ltd-field-main button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      .ltd-skill-panel {
        display: flex;
        min-width: 0;
        flex-direction: column;
        justify-content: space-between;
        gap: 8px;
        padding: 12px;
      }

      .ltd-field-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
      }

      .ltd-field-stats div {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 4px 6px;
        min-height: 46px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.07);
        padding: 8px;
      }

      .ltd-field-stats svg {
        color: #93c5fd;
      }

      .ltd-field-stats span {
        color: rgba(255, 255, 255, 0.56);
        font-size: 10px;
        font-weight: 900;
      }

      .ltd-field-stats strong {
        grid-column: 1 / -1;
        color: #fff;
        font-size: 13px;
        font-weight: 900;
        font-variant-numeric: tabular-nums;
      }

      .ltd-skill-title {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        color: #fff;
        font-size: 12px;
        font-weight: 900;
      }

      .ltd-skill-title span:first-of-type {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ltd-skill-level {
        flex: 0 0 auto;
        border-radius: 999px;
        background: rgba(56, 189, 248, 0.18);
        color: #bae6fd;
        padding: 2px 7px;
        font-size: 10px;
        font-weight: 900;
      }

      .ltd-skill-desc {
        color: rgba(255, 255, 255, 0.72);
        font-size: 11px;
        font-weight: 800;
        line-height: 1.55;
      }

      .ltd-skill-detail {
        margin-top: 4px;
        color: #fde68a;
        font-size: 11px;
        font-weight: 900;
        line-height: 1.45;
      }

      .ltd-skill-meta {
        display: grid;
        gap: 4px;
        margin-top: 8px;
        color: rgba(186, 230, 253, 0.92);
        font-size: 11px;
        font-weight: 900;
      }

      .ltd-danger-panel {
        border-radius: 14px;
        border: 1px solid rgba(251, 113, 133, 0.28);
        background: rgba(127, 29, 29, 0.28);
        padding: 9px;
      }

      .ltd-danger-title {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #fecaca;
        font-size: 11px;
        font-weight: 900;
      }

      .ltd-danger-list {
        display: grid;
        gap: 7px;
        margin-top: 7px;
      }

      .ltd-danger-list div {
        display: grid;
        gap: 2px;
      }

      .ltd-danger-list strong {
        color: #fff;
        font-size: 11px;
        font-weight: 900;
      }

      .ltd-danger-list span {
        color: rgba(255, 255, 255, 0.72);
        font-size: 10px;
        font-weight: 800;
        line-height: 1.45;
      }

      .ltd-skill-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .ltd-skill-actions button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        color: #fff;
        background: #0ea5e9;
      }

      .ltd-skill-actions button:last-child {
        background: #10b981;
      }

      .ltd-skill-actions button:disabled {
        cursor: not-allowed;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.42);
      }

      .ltd-squad-rail {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        justify-content: center;
        gap: 9px;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .ltd-squad-card {
        position: relative;
        display: flex;
        width: 72px;
        height: 82px;
        flex: 0 0 auto;
        touch-action: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        border-radius: 18px;
        border: 2px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.09);
        color: #fff;
        transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
      }

      .ltd-squad-card:hover:not(:disabled) {
        transform: translateY(-2px);
        background: rgba(255, 255, 255, 0.15);
      }

      .ltd-squad-card.is-selected {
        border-color: #38bdf8;
        background: rgba(56, 189, 248, 0.22);
        box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.2), 0 12px 26px rgba(14, 165, 233, 0.22);
      }

      .ltd-squad-card.is-disabled {
        opacity: 0.58;
      }

      .ltd-squad-card .emoji {
        font-size: 25px;
        line-height: 1;
      }

      .ltd-squad-card .name {
        max-width: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10px;
        font-weight: 900;
      }

      .ltd-squad-card .cost {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        color: #fde68a;
        font-size: 10px;
        font-weight: 900;
      }

      .ltd-hp-bar {
        position: absolute;
        left: 9px;
        right: 9px;
        bottom: 6px;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
      }

      .ltd-hp-bar span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: #34d399;
      }

      .ltd-redeploy-mask {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 18px;
        background: rgba(2, 6, 23, 0.74);
        color: #fff;
        font-size: 14px;
        font-weight: 900;
      }

      @media (max-width: 1180px) {
        .ltd-ready-layout {
          grid-template-columns: 1fr;
        }

        .ltd-side-panel {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .ltd-launch-card {
          grid-row: span 2;
        }
      }

      @media (max-width: 900px) {
        .ltd-topbar {
          padding: 12px 16px;
          padding-top: max(12px, env(safe-area-inset-top));
        }

        .ltd-container {
          padding: 18px 16px 60px;
        }

        .ltd-command-bar,
        .ltd-resume-banner {
          align-items: flex-start;
          flex-direction: column;
        }

        .ltd-command-actions,
        .ltd-resume-actions {
          width: 100%;
          justify-content: flex-start;
          margin-left: 0;
        }

        .ltd-map-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .ltd-unit-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .ltd-side-panel {
          display: flex;
        }
      }

      @media (max-width: 640px) {
        .ltd-topbar {
          padding: 10px 14px;
          padding-top: max(10px, env(safe-area-inset-top));
        }

        .ltd-container {
          padding: 14px 12px 46px;
          gap: 14px;
        }

        .ltd-command-bar,
        .ltd-page .stage-card {
          border-radius: 22px;
          padding: 16px;
        }

        .ltd-map-grid {
          grid-template-columns: 1fr;
        }

        .ltd-unit-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .ltd-unit-card {
          min-height: 124px;
        }

        .ltd-intel-grid {
          grid-template-columns: 1fr;
        }

        .ltd-battle-field {
          padding: 6px;
        }

        .ltd-hud-top {
          min-height: 52px;
          padding: 7px 10px;
        }

        .ltd-hud-button span {
          display: none;
        }

        .ltd-battle-tray {
          min-height: 116px;
          padding: 8px 10px;
        }

        .ltd-field-card {
          display: flex;
          left: 10px;
          right: 10px;
          top: auto;
          bottom: 126px;
          width: auto;
          max-height: calc(100dvh - 190px);
        }

        .ltd-squad-card {
          width: 64px;
          height: 74px;
        }
      }

      /* 手机横屏通常宽于 640px，按可用高度压缩 HUD，为战场留出更多空间。 */
      @media (orientation: landscape) and (max-height: 600px) {
        .ltd-hud-top {
          min-height: 46px;
          gap: 6px;
          padding: 4px max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left));
        }

        .ltd-hud-stats {
          gap: 5px;
        }

        .ltd-hud-stat {
          min-height: 36px;
          gap: 5px;
          padding: 0 8px;
          border-radius: 12px;
          font-size: 11px;
        }

        .ltd-hud-actions {
          gap: 5px;
        }

        .ltd-hud-button {
          min-width: 36px;
          min-height: 36px;
          padding: 0 8px;
          border-radius: 12px;
        }

        .ltd-hud-button span {
          display: none;
        }

        .ltd-battle-field {
          padding: 4px 6px;
        }

        .ltd-battle-stage {
          width: min(100%, calc((100dvh - 150px) * 24 / 11));
          border-radius: 14px;
        }

        .ltd-battle-stage canvas,
        .ltd-paused-mask {
          border-radius: 14px;
        }

        .ltd-battle-tray {
          min-height: 82px;
          gap: 6px;
          padding-top: 6px;
          padding-right: max(8px, env(safe-area-inset-right));
          padding-bottom: max(6px, env(safe-area-inset-bottom));
          padding-left: max(8px, env(safe-area-inset-left));
        }

        .ltd-squad-rail {
          justify-content: flex-start;
          justify-content: safe center;
          gap: 6px;
        }

        .ltd-squad-card {
          --ltd-unit-portrait-size: 30px;
          width: 56px;
          height: 64px;
          gap: 2px;
          border-radius: 12px;
        }

        .ltd-squad-card .name,
        .ltd-squad-card .cost {
          max-width: 48px;
          font-size: 9px;
        }

        .ltd-hp-bar {
          left: 6px;
          right: 6px;
          bottom: 3px;
          height: 3px;
        }

        .ltd-redeploy-mask {
          border-radius: 12px;
          font-size: 12px;
        }

        .ltd-field-card {
          left: max(8px, env(safe-area-inset-left));
          right: max(8px, env(safe-area-inset-right));
          bottom: calc(90px + env(safe-area-inset-bottom));
          max-height: calc(100dvh - 150px - env(safe-area-inset-bottom));
        }
      }
    `}</style>
  );
}

function mapName(id: string): string {
  return DATA.config.maps.find((map) => map.id === id)?.name ?? id;
}

// ── 战斗屏 ────────────────────────────────

interface BattleScreenProps {
  session: BattleSession;
  hud: HudSnapshot | null;
  blessingOptions: number[] | null;
  resultInfo: ResultInfo | null;
  cooldownRemaining: number;
  confirmSurrender: boolean;
  battleRef: React.MutableRefObject<LuckyTdBattle | null>;
  onHud: (snapshot: HudSnapshot) => void;
  onBlessing: (options: number[] | null) => void;
  onWaveCleared: (info: WaveClearInfo) => void;
  onTerminal: (info: TerminalInfo) => void;
  onPickBlessing: (idx: number) => void;
  onSelectSquadUnit: (typeIdx: number) => void;
  onTrayDragStart: (typeIdx: number, point: { clientX: number; clientY: number }) => void;
  onRetreat: (unitId: number) => void;
  onUseSkill: (unitId: number) => void;
  onUpgradeSkill: (unitId: number) => void;
  onToggleSpeed: () => void;
  onTogglePause: () => void;
  onSurrender: () => void;
  onSurrenderConfirm: () => void;
  onSurrenderClose: () => void;
  onRetrySubmit: () => void;
  onRestart: () => void;
  onExit: () => void;
}

function BattleScreen(props: BattleScreenProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const callbacksRef = useRef({
    onHud: props.onHud,
    onBlessing: props.onBlessing,
    onWaveCleared: props.onWaveCleared,
    onTerminal: props.onTerminal,
  });
  useEffect(() => {
    callbacksRef.current = {
      onHud: props.onHud,
      onBlessing: props.onBlessing,
      onWaveCleared: props.onWaveCleared,
      onTerminal: props.onTerminal,
    };
  });
  const { session, battleRef } = props;

  useEffect(() => {
    const bgCanvas = bgCanvasRef.current;
    const mainCanvas = mainCanvasRef.current;
    if (!bgCanvas || !mainCanvas) {
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const battle = new LuckyTdBattle({
      bgCanvas,
      mainCanvas,
      seed: session.seed,
      mapId: session.mapId,
      squad: session.squad,
      initialActions: session.initialActions,
      reducedMotion,
      callbacks: {
        onHud: (snapshot) => callbacksRef.current.onHud(snapshot),
        onBlessing: (options) => callbacksRef.current.onBlessing(options),
        onWaveCleared: (info) => callbacksRef.current.onWaveCleared(info),
        onTerminal: (info) => callbacksRef.current.onTerminal(info),
      },
    });
    battleRef.current = battle;
    const wrapper = wrapperRef.current;
    if (wrapper) {
      void wrapper.requestFullscreen?.().catch(() => undefined);
      const orientation = screen.orientation as unknown as { lock?: (mode: string) => Promise<void> };
      void orientation.lock?.('landscape').catch(() => undefined);
    }
    return () => {
      battle.destroy();
      battleRef.current = null;
      const orientation = screen.orientation as unknown as { unlock?: () => void };
      try {
        orientation.unlock?.();
      } catch {
        // 忽略不支持的浏览器
      }
    };
  }, [session, battleRef]);

  return (
    <div ref={wrapperRef} className="ltd-battle-screen">
      <LuckyTdStyles />
      {props.hud ? (
        <BattleHudTop
          hud={props.hud}
          onToggleSpeed={props.onToggleSpeed}
          onTogglePause={props.onTogglePause}
          onSurrender={props.onSurrender}
        />
      ) : (
        <div className="ltd-battle-loading">
          战场初始化中…
        </div>
      )}

      <div className="ltd-battle-field">
        <div
          className="ltd-battle-stage"
        >
          <canvas ref={bgCanvasRef} className="absolute inset-0 h-full w-full" />
          <canvas ref={mainCanvasRef} className="absolute inset-0 h-full w-full touch-none" />
          {props.hud && props.hud.phase === 0 && props.hud.status === 0 && !props.resultInfo && (
            <div className="ltd-wave-banner">
              第 {props.hud.waveIndex} 波来袭 · {props.hud.intermissionSeconds}s
            </div>
          )}
          {props.hud?.paused && !props.resultInfo && (
            <div className="ltd-paused-mask">
              已暂停
            </div>
          )}
        </div>

        <BlessingPicker options={props.blessingOptions} onPick={props.onPickBlessing} />
        <ResultModal
          info={props.resultInfo}
          cooldownRemaining={props.cooldownRemaining}
          onRetrySubmit={props.onRetrySubmit}
          onRestart={props.onRestart}
          onExit={props.onExit}
        />
      </div>

      {props.hud && (
        <BattleHudTray
          hud={props.hud}
          disabled={props.hud.paused}
          onSelectSquadUnit={props.onSelectSquadUnit}
          onTrayDragStart={props.onTrayDragStart}
          onRetreat={props.onRetreat}
          onUseSkill={props.onUseSkill}
          onUpgradeSkill={props.onUpgradeSkill}
        />
      )}

      <RotateHint />
      <CancelConfirmModal
        open={props.confirmSurrender}
        title="确认放弃本局？"
        description="放弃后本局不发放积分，会话将被取消。"
        detail="当前波次进度、部署与幸运祝福都不会保留。"
        onConfirm={props.onSurrenderConfirm}
        onClose={props.onSurrenderClose}
      />
    </div>
  );
}
