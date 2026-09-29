// The tool rail (D-19): "from a song" on top, the tools by group, the
// instrument footer at the bottom. Links keep the query string, which is how
// the shared selection carries from one tool to the next.
import { NavLink, useLocation } from 'react-router-dom';

import { InstrumentFooter } from './InstrumentFooter';
import styles from './Theory.module.css';
import { GROUPS, TOOLS } from './tools';

export function ToolRail() {
  const { search } = useLocation();
  return (
    <nav className={styles.rail} aria-label="Theory tools">
      {GROUPS.map((group) => {
        const tools = TOOLS.filter((t) => t.group === group);
        if (tools.length === 0) return null;
        return [
          <span key={group} className={`${styles.cap} ${styles.railGroup}`}>
            {group}
          </span>,
          ...tools.map((t) => (
            <NavLink key={t.slug} to={{ pathname: `/theory/${t.slug}`, search }} className={styles.railLink}>
              {t.label}
            </NavLink>
          )),
        ];
      })}
      <InstrumentFooter />
    </nav>
  );
}
