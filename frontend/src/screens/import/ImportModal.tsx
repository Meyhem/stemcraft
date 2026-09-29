import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { type CreatedImport, ImportForm } from './ImportForm';
import type { ImportLinkState } from './importLink';

export function ImportModal() {
  const navigate = useNavigate();
  const location = useLocation();
  const background = (location.state as ImportLinkState | null)?.background;
  const [created, setCreated] = useState<CreatedImport | null>(null);

  // Back to the page it was opened over; a direct visit has none, so go home.
  const close = () => (background ? navigate(-1) : navigate('/', { replace: true }));

  void created; // Task 10 renders the progress view from this.
  return <ImportForm onCreated={setCreated} onClose={close} />;
}
