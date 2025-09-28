import React, { useEffect, useId, useRef } from 'react';
import './PromptModal.css';

type PromptModalTone = 'default' | 'warning';
type PromptModalActionVariant = 'accent' | 'danger' | 'ghost';

interface PromptModalAction {
  label: string;
  onSelect: () => void;
  variant?: PromptModalActionVariant;
  autoFocus?: boolean;
  disabled?: boolean;
}

interface PromptModalProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  body?: React.ReactNode;
  tone?: PromptModalTone;
  primaryAction: PromptModalAction;
  secondaryAction?: PromptModalAction;
  onDismiss?: () => void;
  allowBackdropDismiss?: boolean;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  open,
  title,
  description,
  body,
  tone = 'default',
  primaryAction,
  secondaryAction,
  onDismiss,
  allowBackdropDismiss = true
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const secondaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (secondaryAction?.autoFocus && secondaryRef.current) {
        secondaryRef.current.focus();
        return;
      }
      if (primaryRef.current) {
        primaryRef.current.focus();
      }
    }, 20);
    return () => window.clearTimeout(timer);
  }, [open, secondaryAction?.autoFocus]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss?.();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [open, onDismiss]);

  if (!open) return null;

  const handleBackdropClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!allowBackdropDismiss) return;
    if (event.target === event.currentTarget) {
      onDismiss?.();
    }
  };

  const primaryVariant: PromptModalActionVariant = primaryAction.variant ?? 'accent';
  const secondaryVariant: PromptModalActionVariant | undefined = secondaryAction?.variant ?? 'ghost';

  return (
    <div className="prompt-modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        className="prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-tone={tone === 'default' ? undefined : tone}
      >
        <h3 id={titleId}>{title}</h3>
        {description && (
          <div id={descriptionId} className="prompt-modal-body">
            {typeof description === 'string' ? <p>{description}</p> : description}
          </div>
        )}
        {body && (
          <div className="prompt-modal-body">
            {body}
          </div>
        )}
        <div className="prompt-modal-actions">
          {secondaryAction && (
            <button
              ref={secondaryRef}
              type="button"
              onClick={secondaryAction.onSelect}
              data-variant={secondaryVariant}
              disabled={secondaryAction.disabled}
            >
              {secondaryAction.label}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            onClick={primaryAction.onSelect}
            data-variant={primaryVariant}
            disabled={primaryAction.disabled}
          >
            {primaryAction.label}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptModal;
