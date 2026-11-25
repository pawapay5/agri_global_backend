import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { useEffect } from "react";
import { Button } from "@/components/ui/primitives";
import { useFeedback } from "./feedback";

/** Click the buttons: toasts stack (max 3), pause on hover or focus, swipe right to dismiss; F8 jumps to them. */
function Demo({ auto }: { auto?: "success" | "error" }) {
  const f = useFeedback();
  useEffect(() => {
    // Deferred: a state update during the first commit makes @storybook/addon-themes lose its theme class.
    const id = setTimeout(() => {
      if (auto === "success") f.success("Your alert is set. We'll notify you when the price crosses your threshold.");
      if (auto === "error") f.error("Email or password is incorrect.");
    }, 50);
    return () => clearTimeout(id);
  }, [auto, f]);
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => f.success("Your alert is set. We'll notify you when the price crosses your threshold.")}>Success</Button>
      <Button variant="outline" onClick={() => f.error("Email or password is incorrect.")}>Error</Button>
      <Button variant="outline" onClick={() => f.success("Password updated. You can now sign in.", { actionLabel: "Sign in", onAction: () => {} })}>With action</Button>
      <Button variant="ghost" onClick={() => void f.confirm({ title: "Sign out everywhere", description: "Ends every session, including this one.", confirmLabel: "Sign out everywhere", destructive: true })}>Confirm (destructive)</Button>
    </div>
  );
}

const meta = { title: "UI/Feedback (toasts)", component: Demo, tags: ["autodocs"], args: { auto: "success" } } satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
/**
 * Storybook-only quirk: @storybook/addon-themes loses its <html> class once a toast opens (the app, which uses
 * next-themes, keeps it; verified on the production build). This story applies the dark class itself.
 */
function ForceDark({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("dark");
    const keep = new MutationObserver(() => { if (!el.classList.contains("dark")) el.classList.add("dark"); });
    keep.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => { keep.disconnect(); el.classList.remove("dark"); };
  }, []);
  return <>{children}</>;
}

export const Dark: Story = {
  globals: { theme: "dark" },
  decorators: [(S) => <ForceDark><S /></ForceDark>],
  args: { auto: undefined },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Error" }));
    await expect(await canvas.findByText("Email or password is incorrect.")).toBeVisible();
  },
};
export const RTL: Story = { globals: { locale: "ar" } };
