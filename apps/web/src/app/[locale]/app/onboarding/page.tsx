import { Suspense } from "react";
import { Onboarding } from "@/features/onboarding";

/** /app/onboarding: full-screen first-run setup (outside the sidebar shell). */
export default function OnboardingPage() {
  return <Suspense><Onboarding /></Suspense>;
}
