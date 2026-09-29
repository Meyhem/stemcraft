// The Theory tab (D-19): a tool rail and the chosen tool. /theory redirects to
// the tool used last (theory.json's last_tool). theory.json failures are shown
// here, above whichever tool is open: a failed read is an error banner with the
// verbatim reason, Try again, and a confirmed reset (U-09, N-08); its title says
// whether the API reported the file unreadable or could not be reached. A failed
// save is a warning with Retry, and the unsaved change stays in memory.
import { useEffect } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';

import styles from '../theory/Theory.module.css';
import { TheoryDocProvider, useTheoryDoc } from '../theory/TheoryDoc';
import { ToolRail } from '../theory/ToolRail';
import { toolBySlug } from '../theory/tools';
import { Banner, Button } from '../ui';

export function Theory() {
  return (
    <TheoryDocProvider>
      <TheoryScreen />
    </TheoryDocProvider>
  );
}

function TheoryScreen() {
  const { tool } = useParams();
  const { search } = useLocation();
  const { doc, loadError, fileUnreadable, reload, saveError, update, retry, resetToDefaults } = useTheoryDoc();
  const def = toolBySlug(tool);

  useEffect(() => {
    if (def && doc && doc.last_tool !== def.slug) update((d) => ({ ...d, last_tool: def.slug }));
  }, [def, doc, update]);

  if (!tool) {
    if (!doc && !loadError) return null;
    const last = toolBySlug(doc?.last_tool)?.slug ?? 'scale-finder';
    return <Navigate to={{ pathname: `/theory/${last}`, search }} replace />;
  }

  const reset = () => {
    if (window.confirm('Replace theory.json with the defaults? Your instrument setting and quiz history will be lost.')) {
      void resetToDefaults();
    }
  };

  return (
    <div className={styles.layout}>
      <ToolRail />
      <section className={styles.content}>
        {loadError && (
          <Banner tone="error" title={fileUnreadable ? "theory.json can't be read" : "Couldn't load theory.json"} trace={loadError}>
            Your settings and quiz history were not loaded, and nothing has been overwritten.{' '}
            <Button onClick={reload}>Try again</Button>{' '}
            <Button variant="danger" onClick={reset}>
              Reset to defaults…
            </Button>
          </Banner>
        )}
        {saveError && (
          <Banner tone="warn" title="Couldn't save" trace={saveError}>
            Your changes are kept here until a save succeeds. <Button onClick={retry}>Retry</Button>
          </Banner>
        )}
        {/* A tool draws with the player's instrument, so it waits for theory.json (or its error) instead of flashing the default bass. */}
        {!doc && !loadError ? null : def ? (
          <def.Component />
        ) : (
          <p>
            There is no tool called “{tool}”. <Link to="/theory/scale-finder">Open Scale finder</Link>
          </p>
        )}
      </section>
    </div>
  );
}
