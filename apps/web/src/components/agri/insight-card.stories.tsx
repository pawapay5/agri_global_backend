import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CloudRain } from "lucide-react";
import { NOW } from "@/stories/fixtures";
import { DataFreshness } from "./data-freshness";
import { InsightCard } from "./insight-card";

const meta = {
  title: "Agri/InsightCard", component: InsightCard, tags: ["autodocs"],
  args: {
    title: "Prices usually peak in the lean season",
    children: "Over the last 3 years, tomato prices in this market were highest from April to June (sample text).",
    meta: <DataFreshness at={new Date(NOW).toISOString()} />,
  },
  decorators: [(S) => <div className="max-w-md"><S /></div>],
} satisfies Meta<typeof InsightCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const Weather: Story = { args: { icon: CloudRain, tone: "caution", title: "Heavy rain expected next week", children: "Transport delays may raise prices in northern markets (sample text)." } };
