"use client";

import { AnimatePresence, motion } from "framer-motion";
import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import Image from "next/image";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, User2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { getFriendlyErrorMessage } from "@/lib/product";
import { cn } from "@/lib/utils";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import { bootstrapSession, seedBootstrapCaches } from "@/services/authSetup";
import { canEnterAppFromOnboarding } from "@/services/onboarding";
import { apiBaseUrl } from "@/services/apiClient";

type AuthMode = "signin" | "signup";
type StatusTone = "neutral" | "success" | "error";

const DEFAULT_STATUS: Record<AuthMode, string> = {
  signin: "Sign in to continue into your Gideon workspace.",
  signup: "Create your account to start building your Gideon workspace.",
};

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
      <path
        d="M21.8 12.23c0-.76-.07-1.49-.2-2.19H12v4.15h5.49a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.77 3.05-4.38 3.05-7.6Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.76 0 5.07-.91 6.75-2.47l-3.3-2.56c-.92.62-2.09 1-3.45 1-2.65 0-4.9-1.79-5.7-4.2H2.9v2.64A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.3 13.77A6 6 0 0 1 6 12c0-.61.1-1.2.3-1.77V7.6H2.9A10 10 0 0 0 2 12c0 1.61.39 3.14 1.08 4.41l3.22-2.64Z"
        fill="#FBBC04"
      />
      <path
        d="M12 5.98c1.5 0 2.84.52 3.9 1.55l2.92-2.92C17.07 2.98 14.76 2 12 2A10 10 0 0 0 2.9 7.6L6.3 10.23c.8-2.4 3.05-4.25 5.7-4.25Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function GideonMark({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-10 w-10", className)}>
      <div className="absolute inset-0 rounded-full border-[5px] border-[#2D1FDB]" />
      <div className="absolute inset-[6px] rounded-full border-[4px] border-[#0B1C30] border-r-transparent border-t-transparent" />
      <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#4C3DFF]" />
    </div>
  );
}

function SocialButton({
  label,
  icon,
  onClick,
  disabled = false,
  badge,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-[#CFCBEA] bg-white px-5 text-[15px] font-semibold tracking-[0.01em] text-[#0B1C30] shadow-[0_10px_30px_-24px_rgba(53,37,205,0.38)] transition-all duration-200",
        disabled
          ? "cursor-not-allowed opacity-75"
          : "hover:-translate-y-0.5 hover:border-[#B4ADEA] hover:shadow-[0_20px_40px_-28px_rgba(53,37,205,0.32)] active:translate-y-0",
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F8F9FF] ring-1 ring-[#E9E6FB] transition-transform duration-200 group-hover:scale-105">
        {icon}
      </span>
      <span>{label}</span>
      {badge ? (
        <span className="ml-auto rounded-full bg-[#EFEAFE] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5A49E5]">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function HeroArtwork() {
  return (
    <div className="relative mx-auto flex w-full max-w-[31rem] items-center justify-center pt-3 lg:max-w-[33.5rem]">
      <motion.div
        className="absolute bottom-3 h-32 w-[80%] rounded-[50%] bg-[radial-gradient(circle,rgba(91,61,245,0.3)_0%,rgba(91,61,245,0.09)_50%,rgba(91,61,245,0)_78%)] blur-2xl"
        animate={{ scale: [1, 1.06, 1], opacity: [0.5, 0.72, 0.5] }}
        transition={{ duration: 5.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />

      <div className="absolute bottom-2 h-24 w-[72%] rounded-[999px] bg-[linear-gradient(180deg,rgba(255,255,255,0.99)_0%,rgba(239,235,255,0.97)_100%)] shadow-[0_28px_44px_-28px_rgba(91,61,245,0.44)] ring-1 ring-white/80" />
      <div className="absolute bottom-0 h-24 w-[72%] rounded-[999px] border border-[#8C80F5]/20" />

      <motion.div
        className="absolute right-[7.5%] top-[18%] z-0 h-[17.5rem] w-[12.85rem] rounded-[2rem] border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.42)_0%,rgba(226,220,255,0.76)_100%)] opacity-70 shadow-[0_22px_46px_-34px_rgba(91,61,245,0.35)]"
        animate={{ y: [0, 5, 0], rotate: [5.5, 7, 5.5] }}
        transition={{ duration: 6.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        style={{ transformOrigin: "bottom left" }}
      >
        <div className="space-y-4 px-6 py-8">
          <div className="h-3 w-24 rounded-full bg-[#D9D2FF]" />
          <div className="h-3 w-20 rounded-full bg-[#D9D2FF]" />
          <div className="mt-10 space-y-3">
            <div className="h-3 w-full rounded-full bg-[#D9D2FF]" />
            <div className="h-3 w-[82%] rounded-full bg-[#D9D2FF]" />
            <div className="h-3 w-[76%] rounded-full bg-[#D9D2FF]" />
            <div className="h-3 w-[88%] rounded-full bg-[#D9D2FF]" />
            <div className="h-3 w-[70%] rounded-full bg-[#D9D2FF]" />
          </div>
        </div>
      </motion.div>

      <motion.div
        className="relative z-10"
        animate={{ y: [0, -7, 0], rotate: [-1.5, 0.25, -1.5] }}
        transition={{ duration: 7, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      >
        <div className="relative h-[23.5rem] w-[16.8rem] rounded-[2rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.99)_0%,rgba(250,248,255,0.97)_100%)] p-5 shadow-[0_28px_58px_-30px_rgba(53,37,205,0.34)]">
          <GideonMark className="h-11 w-11" />
          <div className="mt-4 h-2.5 w-16 rounded-full bg-[#ECE7FF]" />

          <div className="relative mt-7 h-[9.35rem] overflow-hidden rounded-[1.45rem] border border-[#ECE7FF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F9F7FF_100%)] px-4 py-4">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(91,61,245,0.05),transparent_45%)]" />
            <div className="absolute inset-x-5 bottom-4 top-5">
              <div className="absolute inset-y-0 left-[18%] border-l border-dashed border-[#E2DCFF]" />
              <div className="absolute inset-y-0 left-[43%] border-l border-dashed border-[#E2DCFF]" />
              <div className="absolute inset-y-0 left-[68%] border-l border-dashed border-[#E2DCFF]" />
              <div className="absolute inset-y-0 left-[89%] border-l border-dashed border-[#E2DCFF]" />
            </div>
            <svg className="relative z-10 h-full w-full" viewBox="0 0 220 120" fill="none">
              <path d="M10 93C34 74 52 84 71 64C90 44 109 38 130 60C152 84 176 61 209 16" stroke="url(#auth-hero-line)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="10" cy="93" r="6.5" fill="#5B3DF5" />
              <circle cx="209" cy="16" r="7" fill="#5B3DF5" />
              <defs>
                <linearGradient id="auth-hero-line" x1="10" y1="93" x2="209" y2="16" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6C5BFF" />
                  <stop offset="1" stopColor="#3A28E0" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <div className="mt-6 space-y-3.5">
            <div className="flex items-center gap-3">
              <div className="h-3.5 w-3.5 rounded-full bg-[#DDD6FF]" />
              <div className="h-3 w-[70%] rounded-full bg-[#E7E2FF]" />
            </div>
            <div className="h-3 w-[86%] rounded-full bg-[#E7E2FF]" />
            <div className="h-3 w-[74%] rounded-full bg-[#E7E2FF]" />
            <div className="flex items-center gap-3">
              <div className="h-3.5 w-3.5 rounded-full bg-[#DDD6FF]" />
              <div className="h-3 w-[60%] rounded-full bg-[#E7E2FF]" />
            </div>
            <div className="h-3 w-[67%] rounded-full bg-[#E7E2FF]" />
          </div>
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-[4.2rem] right-[14.5%] z-20 w-[17.4rem] rounded-[1.5rem] border border-white/75 bg-white/96 p-4 shadow-[0_28px_52px_-28px_rgba(91,61,245,0.34)]"
        animate={{ y: [0, -6, 0], rotate: [0, -1, 0] }}
        transition={{ duration: 5.9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: 0.15 }}
      >
        <div className="flex items-center gap-3.5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[conic-gradient(from_210deg,#A394FF_0deg,#4A34F0_140deg,#DDD6FF_140deg,#DDD6FF_360deg)]">
            <div className="h-7 w-7 rounded-full bg-white" />
          </div>
          <div className="flex-1 space-y-3">
            <div className="h-3 w-full rounded-full bg-[#DFD8FF]" />
            <div className="h-3 w-[76%] rounded-full bg-[#DFD8FF]" />
          </div>
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-[5.1rem] right-[1.5%] z-30 flex h-[5.6rem] w-[5.6rem] items-center justify-center rounded-[1.7rem] bg-[linear-gradient(145deg,#6246FF_0%,#4126EA_100%)] text-white shadow-[0_24px_42px_-18px_rgba(65,38,234,0.6)]"
        animate={{ y: [0, -9, 0], rotate: [0, 2, 0] }}
        transition={{ duration: 4.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      >
        <Sparkles className="h-8 w-8" />
      </motion.div>
    </div>
  );
}

export function AuthPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const requestedNextPath = searchParams.get("next") ?? "/command-center";
  const requestedMode = searchParams.get("mode");
  const nextPath = requestedNextPath.startsWith("/") ? requestedNextPath : "/command-center";
  const { idToken, loading, user } = useAuth();

  const [mode, setMode] = useState<AuthMode>(requestedMode === "signup" ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState(DEFAULT_STATUS[requestedMode === "signup" ? "signup" : "signin"]);
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [submitting, setSubmitting] = useState(false);
  const [sessionHandled, setSessionHandled] = useState(false);

  const getRedirectPath = useCallback((onboardingCompleted: boolean) => {
    if (!onboardingCompleted) {
      return "/onboarding";
    }

    if (nextPath === "/" || nextPath === "/auth" || nextPath === "/onboarding") {
      return "/command-center";
    }

    return nextPath;
  }, [nextPath]);

  const bootstrapAndRedirect = useCallback(async (nextToken: string) => {
    const payload = await bootstrapSession(nextToken);
    seedBootstrapCaches(queryClient, nextToken, payload);
    setSessionHandled(true);
    router.replace(getRedirectPath(canEnterAppFromOnboarding(payload.onboarding)));
  }, [getRedirectPath, queryClient, router]);

  useEffect(() => {
    if (requestedMode === "signup" || requestedMode === "signin") {
      setMode(requestedMode);
    }
  }, [requestedMode]);


  async function handleEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatusTone("neutral");
    setStatus(mode === "signin" ? "Signing you in..." : "Creating your account...");

    try {
      const auth = getFirebaseAuth();
      const normalizedEmail = email.trim();

      if (!auth || !isFirebaseConfigured()) {
        throw new Error("Sign-in is not configured for this environment yet.");
      }

      if (!normalizedEmail) {
        throw new Error("Enter your work email to continue.");
      }

      const credential =
        mode === "signin"
          ? await signInWithEmailAndPassword(auth, normalizedEmail, password)
          : await createUserWithEmailAndPassword(auth, normalizedEmail, password);

      if (mode === "signup" && name.trim()) {
        await updateProfile(credential.user, { displayName: name.trim() });
      }

      const token = await credential.user.getIdToken(mode === "signup");
      window.localStorage.setItem("gideon:firebaseIdToken", token);
      await bootstrapAndRedirect(token);
    } catch (error: any) {
      const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";

      if (mode === "signup" && errorCode === "auth/email-already-in-use") {
        setMode("signin");
        setStatusTone("neutral");
        setStatus("Welcome back! We found your account. Just enter your password to continue.");
      } else {
        setStatusTone("error");
        if (mode === "signin" && (errorCode === "auth/invalid-credential" || errorCode === "auth/wrong-password" || errorCode === "auth/user-not-found")) {
          setStatus("Invalid email or password. Please try again.");
        } else if (errorCode === "auth/weak-password") {
          setStatus("Your password is too weak. Please use at least 6 characters.");
        } else {
          setStatus(getFriendlyErrorMessage(error, mode === "signin" ? "We couldn't complete sign-in yet." : "We couldn't create the account yet."));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleAuth() {
    setSubmitting(true);
    setStatusTone("neutral");
    setStatus("Opening Google sign-in...");

    try {
      const auth = getFirebaseAuth();

      if (!auth || !isFirebaseConfigured()) {
        throw new Error("Sign-in is not configured for this environment yet.");
      }

      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      const token = await credential.user.getIdToken();
      window.localStorage.setItem("gideon:firebaseIdToken", token);
      await bootstrapAndRedirect(token);
    } catch (error) {
      setStatusTone("error");
      setStatus(getFriendlyErrorMessage(error, "We couldn't complete Google sign-in yet."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setStatusTone("error");
      setStatus("Enter your work email first and then request a reset link.");
      return;
    }

    setSubmitting(true);
    setStatusTone("neutral");
    setStatus("Sending your password reset link...");

    try {
      const auth = getFirebaseAuth();

      if (!auth || !isFirebaseConfigured()) {
        throw new Error("Password reset is not configured for this environment yet.");
      }

      const res = await fetch(`${apiBaseUrl}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          origin: window.location.origin,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw errorData.error || new Error("Failed to request password reset.");
      }

      setStatusTone("success");
      setStatus("A password reset link has been sent to your email.");
    } catch (error: any) {
      setStatusTone("error");

      const errorCode = error?.code || "";

      if (errorCode === "auth/user-not-found") {
        setStatus("No account found with this email address.");
      } else if (errorCode === "auth/invalid-email") {
        setStatus("Please enter a valid email address.");
      } else {
        setStatus(getFriendlyErrorMessage(error, "We couldn't send the reset email yet."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (loading || submitting || sessionHandled || !user || !idToken) {
      return;
    }

    void bootstrapAndRedirect(idToken).catch((error: Error) => {
      setStatusTone("error");
      setStatus(getFriendlyErrorMessage(error, "We couldn't open your workspace yet."));
    });
  }, [bootstrapAndRedirect, idToken, loading, sessionHandled, submitting, user]);

  return (
    <main className="min-h-screen bg-[#FCFCFF] text-[#0B1C30] lg:h-screen lg:overflow-hidden">
      <section className="grid min-h-screen lg:h-screen lg:grid-cols-[minmax(0,1fr)_minmax(32rem,52vw)]">
        <div className="relative flex min-h-screen flex-col bg-white lg:min-h-0 lg:overflow-hidden">
          <div className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col px-6 py-6 sm:px-8 lg:justify-between lg:px-10 lg:py-7">
            <div className="flex items-center justify-between">
              <Image src="/logo.svg" alt="Gideon" width={180} height={51} className="h-auto w-[8.8rem] sm:w-[10rem]" priority />
              <div className="rounded-full border border-[#E4E2F4] bg-[#F7F7FD] p-1 shadow-[0_10px_25px_-22px_rgba(53,37,205,0.45)]">
                <div className="relative grid grid-cols-2 gap-1">
                  {(["signin", "signup"] as const).map((nextMode) => (
                    <button
                      key={nextMode}
                      type="button"
                      onClick={() => setMode(nextMode)}
                      className={cn(
                        "relative z-10 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200",
                        mode === nextMode
                          ? "bg-[#3525CD] text-white shadow-[0_10px_24px_-12px_rgba(53,37,205,0.65)]"
                          : "text-[#6B6784] hover:text-[#3525CD]",
                      )}
                    >
                      {nextMode === "signin" ? "Sign in" : "Sign up"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 flex-1 lg:mt-6 lg:flex lg:flex-col lg:justify-center">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              >
                <div className="min-h-[7.6rem]">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={mode}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      <h1 className="text-[2.05rem] font-semibold tracking-[-0.05em] text-[#0B1C30] sm:text-[2.35rem]">
                        {mode === "signin" ? "Welcome Back!" : "Create your workspace."}
                      </h1>
                      <p className="mt-2.5 max-w-[29rem] text-[0.99rem] leading-7 text-[#5F6072]">
                        {mode === "signin"
                          ? "Sign in to continue to Gideon and pick up where your team left off."
                          : "Set up your account and start operating from one unified workspace."}
                      </p>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>

              <div className="mt-6 lg:hidden">
                <div className="overflow-hidden rounded-[1.75rem] border border-[#E6E4F7] bg-[linear-gradient(135deg,rgba(241,239,255,0.92)_0%,rgba(236,242,255,0.92)_100%)] p-4 shadow-[0_30px_70px_-48px_rgba(53,37,205,0.35)]">
                  <HeroArtwork />
                  <div className="mt-4">
                    <h2 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.04em] text-[#0B1C30]">
                      Empower your team with <span className="text-[#3525CD]">data-driven clarity.</span>
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[#5E6174]">
                      Gideon&apos;s neural engine turns operational complexity into clear next steps for your team.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-7 space-y-3">
                <SocialButton label="Continue with Google" icon={<GoogleIcon />} onClick={handleGoogleAuth} disabled={submitting} />
              </div>

              <div className="mt-6 flex items-center gap-4">
                <div className="h-px flex-1 bg-[#D9D5EE]" />
                <span className="text-sm font-medium text-[#807B97]">or</span>
                <div className="h-px flex-1 bg-[#D9D5EE]" />
              </div>

              <form className="mt-6 space-y-4.5" onSubmit={handleEmailAuth}>
                <div className="min-h-[5.3rem]">
                  <AnimatePresence mode="wait" initial={false}>
                    {mode === "signup" ? (
                      <motion.div
                        key="signup-name"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                      >
                        <label className="mb-2 block text-sm font-semibold tracking-[0.02em] text-[#0B1C30]" htmlFor="name">
                          Name
                        </label>
                        <div className="group flex h-12 items-center gap-3 rounded-xl border border-[#CBC7E7] bg-[#F8F9FF] px-4 transition-all duration-200 focus-within:border-[#8F82F3] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(91,61,245,0.1)]">
                          <User2 className="h-4 w-4 text-[#727288]" />
                          <input
                            id="name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className="min-w-0 flex-1 bg-transparent text-[15px] text-[#0B1C30] outline-none placeholder:text-[#81879A]"
                            placeholder="Enter your name"
                            autoComplete="name"
                            required={mode === "signup"}
                          />
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="signin-note"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="rounded-xl border border-dashed border-[#DAD7EF] bg-[#FAFAFF] px-4 py-3.5 text-sm leading-6 text-[#6A6880]"
                      >
                        Use your workspace email and password to continue into Gideon.
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold tracking-[0.02em] text-[#0B1C30]" htmlFor="email">
                    Work email
                  </label>
                  <div className="group flex h-12 items-center gap-3 rounded-xl border border-[#CBC7E7] bg-[#F8F9FF] px-4 transition-all duration-200 focus-within:border-[#8F82F3] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(91,61,245,0.1)]">
                    <Mail className="h-4 w-4 text-[#727288]" />
                    <input
                      id="email"
                      value={email}
                      type="email"
                      onChange={(event) => setEmail(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-[15px] text-[#0B1C30] outline-none placeholder:text-[#81879A]"
                      placeholder="name@company.com"
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <label className="text-sm font-semibold tracking-[0.02em] text-[#0B1C30]" htmlFor="password">
                      Password
                    </label>
                    <AnimatePresence mode="wait" initial={false}>
                      {mode === "signin" ? (
                        <motion.button
                          key="forgot-password"
                          type="button"
                          onClick={() => void handleForgotPassword()}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.18, ease: "easeOut" }}
                          className="text-[13px] font-medium text-[#5747E8] transition-colors hover:text-[#3525CD]"
                        >
                          Forgot password?
                        </motion.button>
                      ) : (
                        <motion.span
                          key="password-helper"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.18, ease: "easeOut" }}
                          className="text-[13px] text-[#7A7791]"
                        >
                          8+ characters recommended
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="group flex h-12 items-center gap-3 rounded-xl border border-[#CBC7E7] bg-[#F8F9FF] px-4 transition-all duration-200 focus-within:border-[#8F82F3] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(91,61,245,0.1)]">
                    <LockKeyhole className="h-4 w-4 text-[#727288]" />
                    <input
                      id="password"
                      value={password}
                      type={showPassword ? "text" : "password"}
                      onChange={(event) => setPassword(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-[15px] text-[#0B1C30] outline-none placeholder:text-[#81879A]"
                      placeholder={mode === "signin" ? "Enter your password" : "Create a password"}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="text-[#6F7185] transition-colors hover:text-[#3525CD]"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="group mt-1 h-12 w-full rounded-xl border-0 bg-[linear-gradient(90deg,#3525CD_0%,#4835E9_100%)] text-[15px] font-semibold tracking-[0.02em] text-white shadow-[0_18px_38px_-22px_rgba(53,37,205,0.62)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_26px_46px_-24px_rgba(53,37,205,0.72)]"
                >
                  {mode === "signin" ? "Sign In" : "Create account"}
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Button>
              </form>

              {statusTone !== "neutral" ? (
                <motion.div
                  key={`${statusTone}-${status}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className={cn(
                    "mt-4 rounded-2xl border px-4 py-3 text-sm leading-6",
                    statusTone === "error" && "border-[#F1C7D0] bg-[#FFF6F8] text-[#A64257]",
                    statusTone === "success" && "border-[#CDEAD9] bg-[#F4FFF8] text-[#216A47]",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    {statusTone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : null}
                    <p>{status}</p>
                  </div>
                </motion.div>
              ) : (
                <div className="mt-4 flex items-center gap-2 text-sm text-[#6A6880]">
                  <ShieldCheck className="h-4 w-4 text-[#6A5AE8]" />
                  <span>{status}</span>
                </div>
              )}

              <div className="mt-6 min-h-[1.75rem]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={`switch-${mode}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="text-[0.98rem] text-[#5F6072]"
                  >
                    {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
                    <button
                      type="button"
                      onClick={() => {
                        const nextMode = mode === "signin" ? "signup" : "signin";
                        setMode(nextMode);
                        setStatus(DEFAULT_STATUS[nextMode]);
                        setStatusTone("neutral");
                      }}
                      className="font-semibold text-[#3F2DE4] transition-colors hover:text-[#2E20B7]"
                    >
                      {mode === "signin" ? "Sign up" : "Sign in"}
                    </button>
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>

            <div className="mt-8 border-t border-[#E7EAF8] pt-4 text-sm text-[#66657A]">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span>Privacy Policy</span>
                <span>Terms</span>
                <span>Support</span>
              </div>
            </div>
          </div>
        </div>

        <div className="relative hidden overflow-hidden bg-[linear-gradient(135deg,rgba(225,224,255,0.95)_0%,rgba(229,238,255,0.95)_100%)] lg:flex lg:h-screen">
          <div className="absolute -top-20 right-[-4.5rem] h-80 w-80 rounded-full bg-[#E2DFFF] opacity-55 blur-[34px]" />
          <div className="absolute bottom-[-5rem] left-[-3rem] h-72 w-72 rounded-full bg-[rgba(96,99,238,0.82)] opacity-25 blur-[34px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_18%,rgba(255,255,255,0.45),transparent_32%),radial-gradient(circle_at_20%_80%,rgba(91,61,245,0.08),transparent_28%)]" />

          <div className="relative flex w-full flex-col justify-between px-10 py-8 xl:px-12 xl:py-10">
            <div className="mx-auto flex w-full max-w-[33rem] flex-1 flex-col justify-center">
              <HeroArtwork />
              <motion.div
                className="mx-auto mt-8 max-w-[31rem]"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: "easeOut", delay: 0.08 }}
              >
                <h2 className="text-[2.55rem] font-semibold leading-[1.02] tracking-[-0.06em] text-[#0B1C30] xl:text-[2.95rem]">
                  Empower your team with <span className="text-[#3525CD]">data-driven</span> clarity.
                </h2>
                <p className="mt-4 max-w-[28rem] text-[1rem] leading-7 text-[#53576A]">
                  Gideon turns operating noise into structured dashboards, workflow signals, and decision-ready follow
                  through for your team.
                </p>
              </motion.div>
            </div>

            <div className="flex items-center justify-between pt-6 text-[#68738B]/75">
              <div className="flex items-center gap-[-0.5rem]">
                <span className="h-10 w-10 rounded-full border-2 border-white/80 bg-[#CBDBF5]/70" />
                <span className="-ml-3 h-10 w-10 rounded-full border-2 border-white/80 bg-[#E2DFFF]/80" />
                <span className="-ml-3 h-10 w-10 rounded-full border-2 border-white/80 bg-[#E1E0FF]/85" />
              </div>
              <p className="text-[0.86rem] font-medium uppercase tracking-[0.26em] text-[#475065]/80">
                Trusted by 2K+ companies
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
