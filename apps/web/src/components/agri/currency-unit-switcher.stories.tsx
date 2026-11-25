import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { CurrencyUnitSwitcher } from "./currency-unit-switcher";

const meta = {
  title: "Agri/CurrencyUnitSwitcher", component: CurrencyUnitSwitcher, tags: ["autodocs"],
  args: { currencies: ["GHS", "USD", "XOF"], units: ["kg", "bag_50kg", "crate"], onChange: fn() },
} satisfies Meta<typeof CurrencyUnitSwitcher>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
