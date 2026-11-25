import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleHistory } from "@/stories/fixtures";
import { PriceChart } from "./price-chart";

const meta = {
  title: "Agri/Charts/PriceChart", component: PriceChart, tags: ["autodocs"],
  args: { history: sampleHistory(26), currency: "GHS", unit: "kg", title: "Tomato, Kumasi Central (sample data)" },
  decorators: [(S) => <div className="max-w-3xl rounded-2xl bg-card p-4"><S /></div>],
} satisfies Meta<typeof PriceChart>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Hover or focus the chart and use the arrow keys, Home and End to read each week; "View as table" shows every value. */
export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const Narrow: Story = { decorators: [(S) => <div className="w-[320px]"><S /></div>] };
export const Empty: Story = { args: { history: [] } };
