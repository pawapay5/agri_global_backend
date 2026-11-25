import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "./empty-state";

const meta = {
  title: "Agri/EmptyState", component: EmptyState, tags: ["autodocs"],
  args: { icon: AlertTriangle, title: "Not enough data for a forecast", reasons: ["insufficient_history", "stale_data"] },
  decorators: [(S) => <div className="max-w-lg"><S /></div>],
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Reason codes come from the API and are shown in plain language. */
export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const Generic: Story = { args: { icon: undefined, title: undefined, reasons: undefined } };
