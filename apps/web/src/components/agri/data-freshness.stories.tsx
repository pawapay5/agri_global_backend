import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DataFreshness } from "./data-freshness";

const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
const meta = {
  title: "Agri/DataFreshness", component: DataFreshness, tags: ["autodocs"],
  args: { at: twoHoursAgo, sources: ["WFP", "MoFA SRID"] },
} satisfies Meta<typeof DataFreshness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
/** The API reports no source for this value, so nothing is claimed. */
export const TimeOnly: Story = { args: { sources: undefined } };
