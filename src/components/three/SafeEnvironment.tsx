// SafeEnvironment — uses local HDRI files (public/hdri/) instead of relying on
// raw.githubusercontent.com, which is often blocked in mainland China.
// Wraps the loader in an ErrorBoundary so any unexpected failure gracefully
// degrades to basic scene lighting instead of crashing the Canvas.
import { createLogger } from '@/lib/logger';
import { Component, type ReactNode, Suspense } from 'react';
import { Environment } from '@react-three/drei';

const log = createLogger('Env');

/** Mapping from our EnvironmentPreset to local HDRI file paths.
 *  Files downloaded from drei-assets and placed under public/hdri/. */
const LOCAL_HDRI: Record<string, string> = {
  studio: '/hdri/studio_small_03_1k.hdr',
  sunset: '/hdri/venice_sunset_1k.hdr',
  warehouse: '/hdri/empty_warehouse_01_1k.hdr',
  night: '/hdri/dikhololo_night_1k.hdr',
  city: '/hdri/potsdamer_platz_1k.hdr',
};

interface Props {
  preset?: 'studio' | 'sunset' | 'warehouse' | 'night' | 'city';
  files?: string;
  environmentIntensity?: number;
  background?: boolean | 'only';
  children?: ReactNode;
}

interface State {
  hasError: boolean;
}

class EnvErrorBoundary extends Component<{ children: ReactNode }, State> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    log.warn('HDRI load failed, using fallback lighting:', error.message.slice(0, 80));
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function SafeEnvironment({ preset, files, environmentIntensity, background }: Props) {
  const bgProp = background === 'only' ? 'only' : background ? undefined : false;

  // Resolve the file path: explicit `files` > local HDRI mapping > direct preset
  const resolvedFiles = files ?? (preset ? LOCAL_HDRI[preset] : undefined);

  return (
    <EnvErrorBoundary>
      <Suspense fallback={null}>
        {resolvedFiles ? (
          <Environment
            files={resolvedFiles}
            environmentIntensity={environmentIntensity}
            background={bgProp as any}
          />
        ) : (
          // Fallback: use drei built-in preset (downloads from CDN)
          <Environment
            preset={preset}
            environmentIntensity={environmentIntensity}
            background={bgProp as any}
          />
        )}
      </Suspense>
    </EnvErrorBoundary>
  );
}
