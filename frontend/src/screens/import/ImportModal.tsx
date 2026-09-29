import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { type CreatedImport, ImportForm } from './ImportForm';
import { ImportProgress } from './ImportProgress';
import type { ImportLinkState } from './importLink';

export function ImportModal() {
  const navigate = useNavigate();
  const location = useLocation();
  const background = (location.state as ImportLinkState | null)?.background;
  const [created, setCreated] = useState<CreatedImport | null>(null);

  // Back to the page it was opened over; a direct visit has none, so go home.
  const close = () => (background ? navigate(-1) : navigate('/', { replace: true }));

  return created ? (
    <ImportProgress created={created} onClose={close} />
  ) : (
    <ImportForm onCreated={setCreated} onClose={close} />
  );
}
