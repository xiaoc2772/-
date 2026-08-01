'use client';

import { ReactNode } from 'react';
import { Trophy, X } from 'lucide-react';

interface ResultStat {
  label: string;
  value: ReactNode;
  /** 强调色：win 用 emerald，info 用 slate，warn 用 amber */
  tone?: 'emerald' | 'slate' | 'amber';
}

interface ResultCardProps {
  /** 是否可见 */
  open: boolean;
  /** 标题：胜利 / 失败 / 时间到 */
  title: string;
  /** 副标题 */
  subtitle?: string;
  /** 主分数（大字） */
  primaryScore?: ReactNode;
  /** 主分数下方的描述（如「获得积分」） */
  primaryLabel?: string;
  /** 状态：胜利显示金色 trophy，失败显示灰色，平局显示蓝色 */
  status?: 'win' | 'lose' | 'neutral';
  /** 数据网格 */
  stats?: ResultStat[];
  /** 主按钮 */
  primaryAction?: {
    label: string;
    onClick: () => void;
    /** 置灰不可点（如结算冷却倒计时）。 */
    disabled?: boolean;
  };
  /** 次按钮 */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  /** 关闭回调（可选，提供则显示 × 按钮） */
  onClose?: () => void;
}

const TONE_CLASS: Record<NonNullable<ResultStat['tone']>, string> = {
  emerald: 'text-emerald-700',
  slate: 'text-slate-700',
  amber: 'text-amber-600',
};

const STATUS_BADGE: Record<NonNullable<ResultCardProps['status']>, string> = {
  win: 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-300/40',
  lose: 'bg-gradient-to-br from-slate-500 to-slate-700 shadow-slate-400/30',
  neutral: 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-emerald-400/30',
};

/**
 * 统一结算面板
 * 全屏遮罩 + 玻璃白卡 + 顶部状态徽章 + 主分数 + 数据网格 + 操作按钮
 */
export default function ResultCard({
  open,
  title,
  subtitle,
  primaryScore,
  primaryLabel,
  status = 'neutral',
  stats = [],
  primaryAction,
  secondaryAction,
  onClose,
}: ResultCardProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-emerald-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-card-title"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl shadow-emerald-950/40 border border-emerald-100 overflow-hidden">
        {/* 顶部装饰带 */}
        <div className="h-2 bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-600" />

        {/* 关闭按钮 */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 rounded-full p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="px-6 pt-6 pb-6 text-center">
          {/* 状态徽章 */}
          <div
            className={`mx-auto w-16 h-16 rounded-2xl ${STATUS_BADGE[status]} shadow-lg flex items-center justify-center mb-4`}
          >
            <Trophy className="h-8 w-8 text-white" />
          </div>

          <h2
            id="result-card-title"
            className="text-2xl font-extrabold text-slate-900 tracking-tight"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          )}

          {/* 主分数 */}
          {primaryScore !== undefined && (
            <div className="mt-5">
              <div className="text-5xl font-extrabold tabular-nums bg-clip-text text-transparent bg-gradient-to-br from-emerald-600 to-emerald-800">
                {primaryScore}
              </div>
              {primaryLabel && (
                <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {primaryLabel}
                </div>
              )}
            </div>
          )}

          {/* 数据网格 */}
          {stats.length > 0 && (
            <div
              className={`mt-5 grid gap-2 ${
                stats.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'
              }`}
            >
              {stats.map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-emerald-50/70 border border-emerald-100 px-3 py-2.5"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700/70">
                    {s.label}
                  </div>
                  <div
                    className={`mt-0.5 font-bold tabular-nums ${
                      TONE_CLASS[s.tone ?? 'emerald']
                    }`}
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 操作按钮 */}
          {(primaryAction || secondaryAction) && (
            <div className="mt-6 flex gap-3">
              {secondaryAction && (
                <button
                  type="button"
                  onClick={secondaryAction.onClick}
                  className="flex-1 rounded-xl bg-slate-100 hover:bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors"
                >
                  {secondaryAction.label}
                </button>
              )}
              {primaryAction && (
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:bg-slate-300"
                >
                  {primaryAction.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
