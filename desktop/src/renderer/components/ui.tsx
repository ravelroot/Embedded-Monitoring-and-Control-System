import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function Card(props: { title?: string; actions?: ComponentChildren; children: ComponentChildren; class?: string; subtitle?: string }) {
  return (
    <section class={`card ${props.class ?? ''}`}>
      {(props.title || props.actions) && (
        <header class="card-head">
          <div>
            {props.title && <h2>{props.title}</h2>}
            {props.subtitle && <p class="muted">{props.subtitle}</p>}
          </div>
          {props.actions && <div class="card-actions">{props.actions}</div>}
        </header>
      )}
      {props.children}
    </section>
  );
}

type ButtonProps = JSX.HTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'default'; small?: boolean; disabled?: boolean; type?: 'button' | 'submit' };

export function Button({ variant = 'default', small, class: className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} class={`btn btn-${variant}${small ? ' btn-sm' : ''} ${className ?? ''}`} {...rest} />;
}

export function Toggle(props: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean; hint?: string }) {
  return (
    <label class={`toggle${props.disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb" />
      </span>
      <span class="toggle-text">
        {props.label}
        {props.hint && <small class="muted">{props.hint}</small>}
      </span>
    </label>
  );
}

export function Field(props: { label: string; hint?: string; children: ComponentChildren; error?: string }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.hint && !props.error && <small class="muted">{props.hint}</small>}
      {props.error && <small class="field-error">{props.error}</small>}
    </label>
  );
}

export function Chip(props: { tone?: 'neutral' | 'ok' | 'info' | 'low' | 'high' | 'critical' | 'accent'; children: ComponentChildren; title?: string }) {
  return (
    <span class={`chip chip-${props.tone ?? 'neutral'}`} title={props.title}>
      {props.children}
    </span>
  );
}

export function severityTone(severity: number): 'neutral' | 'low' | 'high' | 'critical' {
  return severity >= 3 ? 'critical' : severity === 2 ? 'high' : severity === 1 ? 'low' : 'neutral';
}

export function Mark(props: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={props.size} height={props.size} aria-hidden="true" class="mark">
      <path d="M48 20a20 20 0 1 0 4 14" />
      <path d="M48 10v10h-10" />
      <circle cx="32" cy="32" r="5" />
    </svg>
  );
}

export function BrandSquare() {
  return (
    <span class="brand-square">
      <Mark />
    </span>
  );
}

export function PageHead(props: { eyebrow: string; title: string; description?: string; actions?: ComponentChildren }) {
  return (
    <header class="page-head">
      <div>
        <p class="page-eyebrow">{props.eyebrow}</p>
        <h1 class="page-title display">{props.title}</h1>
        {props.description && <p class="page-desc">{props.description}</p>}
      </div>
      {props.actions && <div class="page-actions">{props.actions}</div>}
    </header>
  );
}

export interface LidFigureData {
  label: string;
  value: string;
  note?: ComponentChildren;
}

export function Lid(props: { eyebrow: string; number: string; unit?: string; sentence?: ComponentChildren; figures: LidFigureData[]; class?: string }) {
  return (
    <section class={`lid ${props.class ?? ''}`}>
      <p class="lid-eyebrow">{props.eyebrow}</p>
      <p class="lid-number display">
        {props.number}
        {props.unit && <small>{props.unit}</small>}
      </p>
      {props.sentence && <p class="lid-sentence">{props.sentence}</p>}
      <div class="lid-figures">
        {props.figures.map((figure) => (
          <div class="lid-figure" key={figure.label}>
            <span>{figure.label}</span>
            <strong>{figure.value}</strong>
            {figure.note && <em>{figure.note}</em>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function Empty(props: { title: string; text: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <BrandSquare />
      <h3 class="display">{props.title}</h3>
      <p>{props.text}</p>
      {props.children && <div class="empty-actions">{props.children}</div>}
    </div>
  );
}

export function Stat(props: { label: string; value: string; tone?: 'ok' | 'high' | 'critical' | 'neutral'; hint?: string }) {
  return (
    <div class={`stat stat-${props.tone ?? 'neutral'}`}>
      <span class="stat-label">{props.label}</span>
      <strong class="stat-value">{props.value}</strong>
      {props.hint && <small class="muted">{props.hint}</small>}
    </div>
  );
}

export function Dialog(props: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      class={`dialog${props.wide ? ' dialog-wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <header class="dialog-head">
        <h2 class="display">{props.title}</h2>
        <button type="button" class="icon-btn" aria-label="Fechar" onClick={props.onClose}>
          ✕
        </button>
      </header>
      <div class="dialog-body">{props.children}</div>
      {props.footer && <footer class="dialog-foot">{props.footer}</footer>}
    </dialog>
  );
}

export function Confirm(props: { title: string; text: string; confirm: string; danger?: boolean; requireText?: string; onConfirm: () => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button
            variant={props.danger ? 'danger' : 'primary'}
            onClick={() => {
              if (props.requireText && input.current?.value.trim().toUpperCase() !== props.requireText) {
                input.current?.focus();
                return;
              }
              props.onConfirm();
              props.onClose();
            }}
          >
            {props.confirm}
          </Button>
        </>
      }
    >
      <p>{props.text}</p>
      {props.requireText && (
        <Field label={`Digite ${props.requireText} para confirmar`}>
          <input ref={input} class="input" autoComplete="off" />
        </Field>
      )}
    </Dialog>
  );
}
