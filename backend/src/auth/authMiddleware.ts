import type { NextFunction, Request, Response } from "express";

import { getFirebaseAuth, getFirebaseDb } from "../config/firebaseAdmin.js";
import { coalesceUserRead, getCachedUser, setCachedUser } from "../cache/requestStateCache.js";
import { setRequestTimingMetadata, timeRequestPhase } from "../observability/requestTiming.js";
import { UserRepository } from "../repositories/userRepository.js";
import { ApiError } from "../utils/apiError.js";

function getBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authorizationHeader.slice("Bearer ".length).trim();
}

export async function authMiddleware(request: Request, _response: Response, next: NextFunction) {
  try {
    const token = await timeRequestPhase(request, "auth.token_extract", async () =>
      getBearerToken(request.header("authorization")),
    );

    if (!token) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "A Firebase ID token is required.",
        status: 401,
      });
    }

    const decodedToken = await timeRequestPhase(request, "auth.verify_id_token", async () =>
      getFirebaseAuth().verifyIdToken(token),
    );

    if (!decodedToken.email) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: "Authenticated users must have an email address.",
        status: 401,
      });
    }

    const userRepository = new UserRepository(getFirebaseDb());
    const cachedUser = getCachedUser(decodedToken.uid);
    let user: NonNullable<ReturnType<typeof getCachedUser>>;
    if (cachedUser) {
      user = cachedUser;
    } else {
      const existingUser = await timeRequestPhase(request, "auth.user_read", () =>
        coalesceUserRead(decodedToken.uid, () => userRepository.getUser(decodedToken.uid)),
      );
      user = await timeRequestPhase(request, "auth.user_sync", async () =>
        userRepository.syncFromAuth(
          {
            id: decodedToken.uid,
            email: decodedToken.email!,
            displayName: decodedToken.name,
            photoURL: decodedToken.picture,
          },
          existingUser,
        ),
      );
      setCachedUser(user);
    }

    request.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      defaultWorkspaceId: user.defaultWorkspaceId,
    };
    setRequestTimingMetadata(request, "auth.uid", user.id);
    setRequestTimingMetadata(request, "auth.defaultWorkspaceId", user.defaultWorkspaceId ?? null);

    next();
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
      return;
    }

    console.error("[AuthMiddleware Error]:", error);

    next(
      new ApiError({
        code: "UNAUTHORIZED",
        message: "Firebase authentication failed.",
        status: 401,
      }),
    );
  }
}

export function requireUser(request: Request) {
  if (!request.user) {
    throw new ApiError({
      code: "UNAUTHORIZED",
      message: "Authentication is required.",
      status: 401,
    });
  }

  return request.user;
}
