import { Suspense } from "react";
import { AuthActionPage } from "@/components/auth/AuthActionPage";

export const metadata = {
  title: "Gideon - Secure Authentication",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#FCFCFF]">Loading...</div>}>
      <AuthActionPage />
    </Suspense>
  );
}
