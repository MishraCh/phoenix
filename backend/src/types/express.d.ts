import type { AuthenticatedUser, WorkspaceContext } from "../auth/types.js";
import type { RequestTimingState } from "../observability/requestTiming.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      requestTiming?: RequestTimingState;
      user?: AuthenticatedUser;
      workspace?: WorkspaceContext;
    }
  }
}

export {};
