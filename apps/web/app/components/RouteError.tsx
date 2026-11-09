import { isRouteErrorResponse, useRouteError } from "react-router";
import { ErrorState } from "./States";

/** Per-route error boundary: keeps the shell and explains what failed. */
export function RouteError({ what }: { what: string }) {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <div className="mx-auto max-w-2xl py-10">
      {status === 404 ? (
        <ErrorState title={`${what} not found`}>It may not exist, or the season hasn't been scheduled yet.</ErrorState>
      ) : (
        <ErrorState title={`Couldn't load ${what.toLowerCase()}`}>
          League data is temporarily unavailable. Please try again shortly.
        </ErrorState>
      )}
    </div>
  );
}
