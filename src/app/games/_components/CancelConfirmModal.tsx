'use client';

import { AlertTriangle, X } from 'lucide-react';

interface CancelConfirmModalProps {
  open: boolean;
  loading?: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  detail?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function CancelConfirmModal({
  open,
  loading = false,
  title = '确认放弃本局？',
  description = '当前游戏进度会被取消，本局不会发放结算奖励。',
  confirmLabel = '确认放弃',
  cancelLabel = '继续游戏',
  detail = '未结算的得分、步数和临时进度将不会保留。',
  onConfirm,
  onClose,
}: CancelConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-[10px]" role="dialog" aria-modal="true" aria-labelledby="cancel-confirm-title">
      <div className="w-full max-w-[560px] rounded-[30px] border border-white/90 bg-white/95 p-6 text-slate-950 shadow-[0_28px_90px_rgba(15,23,42,0.24)]">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-lg shadow-rose-200">
            <AlertTriangle className="h-9 w-9" />
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-rose-700/80">
            取消确认
          </div>
          <h2 id="cancel-confirm-title" className="mt-1 text-2xl font-black text-slate-950">
            {title}
          </h2>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
            {description}
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-rose-100 bg-rose-50 px-5 py-3 text-center text-sm font-black text-rose-700 shadow-sm">
          {detail}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 transition-all hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-4 w-4" />
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-rose-200 transition-all hover:-translate-y-0.5 hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-rose-700/40"
          >
            <AlertTriangle className="h-4 w-4" />
            {loading ? '处理中' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
