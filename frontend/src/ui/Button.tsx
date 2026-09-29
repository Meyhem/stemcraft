import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

import styles from './Button.module.css';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonTier = 'setup' | 'perform';

const VARIANT: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: styles.primary,
  ghost: styles.ghost,
  danger: styles.danger,
};

function buttonClass(variant: ButtonVariant, tier: ButtonTier, extra?: string): string {
  return [styles.btn, VARIANT[variant], tier === 'perform' ? styles.perform : undefined, extra]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  tier?: ButtonTier;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', tier = 'setup', className, type = 'button', ...rest },
  ref,
) {
  // type defaults to 'button', not the HTML default 'submit': most buttons in this app
  // sit inside a <form> and are not its submit.
  return <button ref={ref} type={type} className={buttonClass(variant, tier, className)} {...rest} />;
});

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  tier?: ButtonTier;
}

/** A navigation target that reads as a control. Prose links use TextLink instead. */
export function ButtonLink({
  variant = 'default',
  tier = 'setup',
  className,
  ...rest
}: ButtonLinkProps) {
  return <Link className={buttonClass(variant, tier, className)} {...rest} />;
}
