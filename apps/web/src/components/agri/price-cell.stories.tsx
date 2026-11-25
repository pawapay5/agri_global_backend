import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PriceCell } from "./price-cell";

const meta = { title: "Agri/PriceCell", component: PriceCell, tags: ["autodocs"], args: { amount: "14.2", currency: "GHS", unit: "kg" } } satisfies Meta<typeof PriceCell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const Headline: Story = { args: { size: "lg", unit: "bag_50kg", amount: "612.5" } };
export const Missing: Story = { args: { amount: null } };
