import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * Per-route error boundary (2026-10-29 crash-proofing sweep).
 *
 * The app-level ErrorBoundary is the backstop for shell failures;
 * this one wraps the routed page so a single page's render crash
 * degrades to an in-app, plain-language card with a way forward —
 * the rest of the app (header, nav, other pages) never tears down,
 * and navigating to another route clears the error automatically
 * (resetKey = pathname). No raw error text is ever shown.
 *
 * Chunk-load failures (a stale build after a deploy) usually heal
 * with one reload — lib/chunkRecovery already reloads once on
 * vite:preloadError; if the failure still reaches this boundary,
 * "Try again" reloads the page so the fresh chunks are fetched.
 */

interface Props {
  resetKey: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  resetKey: string;
}

const CHUNK_ERROR =
  /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isChunkLoadError(error?: Error | null): boolean {
  return !!error && CHUNK_ERROR.test(error.message || "");
}

class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Navigating to a different route clears a crashed page's error.
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, error: undefined, resetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Page error:", error, errorInfo);
  }

  handleRetry = () => {
    if (isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center px-4 py-16">
          <div className="text-center max-w-md">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">
              This page hit a problem
            </h1>
            <p className="text-muted-foreground mb-6">
              Something went wrong while loading this page. Your money and
              your account are safe — try again, or head back to your
              dashboard.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={this.handleRetry}>Try again</Button>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
              >
                Go to Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PageErrorBoundary;
