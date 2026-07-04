// SafeEnvironment — wraps @react-three/drei <Environment> so HDRI load failures
// gracefully degrade instead of crashing the entire Canvas.
//
// On networks that block raw.githack.com (e.g. mainland China), the default
// drei Environment preset will throw during useLoader. This boundary catches
// that error and renders nothing (no envmap), preserving the scene with basic
// ambient + directional lighting only.
import { Component, type ReactNode, Suspense } from 'react';
import { Environment } from '@react-three/drei';

interface Props {
  preset: 'studio' | 'sunset' | 'warehouse' | 'night' | 'city';
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
    // eslint-disable-next-line no-console
    console.warn('[VREEN] HDRI load failed, using fallback lighting:', error.message.slice(0, 80));
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function SafeEnvironment({ preset, environmentIntensity, background }: Props) {
  const bgProp = background === 'only' ? 'only' : background ? undefined : false;

  return (
    <EnvErrorBoundary>
      <Suspense fallback={null}>
        <Environment
          preset={preset}
          environmentIntensity={environmentIntensity}
          background={bgProp as any}
        />
      </Suspense>
    </EnvErrorBoundary>
  );
}
