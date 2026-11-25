import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { sampleCommodities, sampleMarkets } from "@/stories/fixtures";
import { AlertForm } from "./alert-form";

const meta = {
  title: "Agri/AlertForm", component: AlertForm, tags: ["autodocs"],
  args: { commodities: sampleCommodities, markets: sampleMarkets.map((m) => ({ id: m.id, label: m.name.en ?? m.id })), currencyUnit: "GHS/kg", onSubmit: fn() },
  decorators: [(S) => <div className="max-w-sm rounded-2xl bg-card p-4"><S /></div>],
} satisfies Meta<typeof AlertForm>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Submit it empty to see the inline errors. */
export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
