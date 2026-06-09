"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  onIdTokenChanged,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

import { AuthContext } from "@/hooks/useAuth";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import { getFriendlyErrorMessage } from "@/lib/product";

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      window.localStorage.removeItem("gideon:firebaseIdToken");
      setAuthError("Sign-in is not configured for this environment yet.");
      setLoading(false);
      return;
    }

    const auth = getFirebaseAuth();

    if (!auth) {
      setAuthError("We couldn't start the sign-in experience yet.");
      setLoading(false);
      return;
    }

    return onIdTokenChanged(
      auth,
      async (nextUser) => {
        setUser(nextUser);

        if (!nextUser) {
          setIdToken(null);
          window.localStorage.removeItem("gideon:firebaseIdToken");
          setLoading(false);
          return;
        }

        const token = await nextUser.getIdToken();
        setIdToken(token);
        window.localStorage.setItem("gideon:firebaseIdToken", token);
        setLoading(false);
      },
      (error) => {
        setAuthError(getFriendlyErrorMessage(error, "We couldn't verify your sign-in yet."));
        setLoading(false);
      },
    );
  }, []);

  const value = useMemo(
    () => ({
      user,
      idToken,
      loading,
      authReady: !loading && !authError,
      authError,
      signOut: async () => {
        const auth = getFirebaseAuth();

        if (auth) {
          await firebaseSignOut(auth);
        }

        window.localStorage.removeItem("gideon:firebaseIdToken");
      },
    }),
    [authError, idToken, loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
