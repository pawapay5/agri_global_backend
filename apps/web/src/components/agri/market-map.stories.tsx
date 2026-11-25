import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleMarkets } from "@/stories/fixtures";
import { MarketMap } from "./market-map";

const meta = {
  title: "Agri/MarketMap", component: MarketMap, tags: ["autodocs"],
  args: { markets: sampleMarkets, height: 360 },
  // Loads OpenFreeMap tiles over the network, so axe findings here are reported but don't fail the run.
  parameters: { a11y: { test: "todo" } },
  decorators: [(S) => <div className="max-w-3xl"><S /></div>],
} satisfies Meta<typeof MarketMap>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
