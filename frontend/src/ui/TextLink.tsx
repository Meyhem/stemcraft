import { Link, type LinkProps } from 'react-router-dom';

import styles from './TextLink.module.css';

/**
 * A link inside prose or a text row. A link that stands on its own as a navigation
 * target is a control, not prose -- use ButtonLink so it gets a real hit target.
 */
export function TextLink({ className, ...rest }: LinkProps) {
  return <Link className={[styles.link, className].filter(Boolean).join(' ')} {...rest} />;
}
