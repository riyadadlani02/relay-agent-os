import { ArrowDownLeft, BookOpen, Sparkles, ShieldCheck, Zap } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { CheckCheck, X } from 'lucide-react';
import { type Run } from '../shared';

const labels: Record<Run['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_approval: 'Needs approval',
  completed: 'Completed',
  failed: 'Blocked / failed',
  cancelled: 'Cancelled',
};
export function Status({ status }: { status: Run['status'] }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {labels[status]}
    </span>
  );
}

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`avatar ${small ? 'small' : ''} tone-${name.charCodeAt(0) % 4}`}>
      {name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const el = ref.current;
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty">
      <CheckCheck size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export const stageIcons = [ArrowDownLeft, BookOpen, Sparkles, ShieldCheck, Zap, CheckCheck];
