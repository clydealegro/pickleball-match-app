import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useSessionStore } from '../store/sessionStore';

interface State {
  failed: boolean;
}

/** Catches render errors so a bad screen (or bad saved data) can't brick the app on reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  startOver = () => {
    useSessionStore.getState().reset();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="stack" role="alert">
        <h1 className="screen-title">Something went wrong</h1>
        <p className="muted">
          The app hit an unexpected problem. Starting over clears the current session; your saved players are kept.
        </p>
        <button type="button" className="btn btn-primary" onClick={this.startOver}>
          Start over
        </button>
      </div>
    );
  }
}
