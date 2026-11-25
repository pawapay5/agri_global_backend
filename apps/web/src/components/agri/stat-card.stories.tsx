import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Store } from "lucide-react";
import { NOW } from "@/stories/fixtures";
import { DataFreshness } from "./data-freshness";
import { PriceCell } from "./price-cell";
import { StatCard } from "./stat-card";

const meta = {
  title: "Agri/StatCard", component: StatCard, tags: ["autodocs"],
  args: {
    label: "Median wholesale price", value: <PriceCell amount="14.2" currency="GHS" unit="kg" />,
    delta: { value: 4.2, period: "7d" }, trend: [12, 12.4, 12.1, 12.9, 13.4, 13.1, 13.8, 14, 13.7, 14.1, 14.4, 14.2],
    footer: <DataFreshness at={new Date(NOW - 2 * 3_600_000).toISOString()} />,
  },
  decorators: [(S) => <div className="max-w-xs"><S /></div>],
} satisfies Meta<typeof StatCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const Count: Story = { args: { label: "Markets reporting", value: "38", icon: <Store className="size-4" />, delta: undefined, trend: undefined, footer: undefined } };
