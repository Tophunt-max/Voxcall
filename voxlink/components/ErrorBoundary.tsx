import { ErrorBoundary as SharedErrorBoundary } from "@workspace/shared-ui/components";
import type { ErrorFallbackProps } from "@workspace/shared-ui/components";
import { ErrorFallback } from "@/components/ErrorFallback";
import { ComponentType, PropsWithChildren } from "react";

export type { ErrorFallbackProps };

export type ErrorBoundaryProps = PropsWithChildren<{
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, stackTrace: string) => void;
}>;

export class ErrorBoundary extends SharedErrorBoundary {
  static defaultProps = {
    FallbackComponent: ErrorFallback,
  };
}
