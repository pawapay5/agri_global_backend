import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SeasonalBars } from "./seasonal-bars";

// Illustrative values for the component only (not market data).
const avg = ["12.4", "13.1", "14.8", "16.2", "17.5", "15.9", "13.0", "11.2", "10.4", "10.9", null, "11.8"];
const meta = {
  title: "Agri/SeasonalBars", component: SeasonalBars, tags: ["autodocs"],
  args: { monthlyAverage: avg, peakMonths: [5], lowMonths: [9], currency: "GHS", unit: "kg", title: "Typical price through the year" },
} satisfies Meta<typeof SeasonalBars>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
/** No monthly series from the API: an empty state, never zero bars. */
export const Empty: Story = { args: { monthlyAverage: Array(12).fill(null), peakMonths: [], lowMonths: [] } };
