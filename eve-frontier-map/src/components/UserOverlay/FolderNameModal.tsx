import React, { useEffect, useMemo, useRef, useState, useId } from 'react';
import './FolderNameModal.css';

interface FolderNameModalProps {
  open: boolean;
  scope: 'tribe' | 'personal';
  title?: string;
  description?: string;
  submitLabel?: string;
  initialValue?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit(name: string): Promise<boolean> | boolean;
  onCancel(): void;
}

const DEFAULT_COPY: Record<'tribe' | 'personal', { title: string; description: string; submit: string }> = {
  tribe: {
    title: 'Create tribe folder',
    description: 'Shared folders are visible to your entire tribe. Pick a short, descriptive name.',
    submit: 'Create tribe folder'
  },
  personal: {
    title: 'Create personal folder',
    description: 'Personal folders are stored locally on this device and only visible to you.',
    submit: 'Create folder'
  }
};

const FolderNameModal: React.FC<FolderNameModalProps> = ({
  open,
  scope,
  title,
  description,
  submitLabel,
  initialValue,
  busy,
  error,
  onSubmit,
  onCancel
}) => {
  const [value, setValue] = useState(initialValue || '');
  const [internalError, setInternalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (open) {
      setValue(initialValue || '');
      setInternalError(null);
      setSubmitting(false);
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, initialValue]);

  const combinedError = internalError || error || null;
  const disabled = !!busy || submitting;

  const copy = useMemo(() => {
    return {
      title: title || DEFAULT_COPY[scope].title,
      description: description || DEFAULT_COPY[scope].description,
      submit: submitLabel || DEFAULT_COPY[scope].submit
    };
  }, [scope, title, description, submitLabel]);

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setValue(e.target.value);
    if (internalError) setInternalError(null);
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    if (disabled) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setInternalError('Enter a folder name.');
      return;
    }
    setInternalError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit(trimmed);
      if (!result) {
        setSubmitting(false);
      }
    } catch (err: any) {
      const message = typeof err === 'string' ? err : String(err?.message || err || 'Unable to create folder');
      setInternalError(message);
      setSubmitting(false);
    }
  };

  const handleBackdropClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (disabled) return;
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === 'Escape' && !disabled) {
      e.stopPropagation();
      onCancel();
    }
  };

  if (!open) return null;

  return (
    <div className="folder-modal-backdrop" onClick={handleBackdropClick} onKeyDown={handleKeyDown} role="presentation">
      <div
        className="folder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h3 id={titleId}>{copy.title}</h3>
        <p id={descId}>{copy.description}</p>
        <form onSubmit={handleSubmit} className="folder-modal-form">
          <label className="sr-only" htmlFor={`${titleId}-input`}>
            Folder name
          </label>
          <input
            id={`${titleId}-input`}
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            placeholder="Folder name"
            maxLength={60}
            disabled={disabled}
            spellCheck={false}
          />
          {combinedError && <div className="folder-modal-error" role="alert">{combinedError}</div>}
          <div className="folder-modal-actions">
            <button type="button" onClick={onCancel} disabled={disabled}>
              Cancel
            </button>
            <button type="submit" disabled={disabled}>
              {disabled && !busy && submitting ? 'Working…' : copy.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FolderNameModal;
