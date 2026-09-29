import type { InputHTMLAttributes, ReactNode } from 'react';

import styles from './TextField.module.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Required: the label is bound with htmlFor, and screen tests query by label. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Class for the wrapper, e.g. a screen's grid-column sizing. */
  fieldClassName?: string;
}

export function TextField({ id, label, hint, fieldClassName, className, ...rest }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={[styles.field, fieldClassName].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={[styles.input, className].filter(Boolean).join(' ')}
        aria-describedby={hintId}
        {...rest}
      />
      {hint && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
