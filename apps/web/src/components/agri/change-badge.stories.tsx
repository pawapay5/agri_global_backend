import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChangeBadge } from "./change-badge";

const meta = { title: "Agri/ChangeBadge", component: ChangeBadge, tags: ["autodocs"], args: { value: 4.2, period: "7d" } } satisfies Meta<typeof ChangeBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const Down: Story = { args: { value: -3.1 } };
export const Pill: Story = { args: { variant: "pill", value: -1.8 } };
export const UpIsBad: Story = { args: { value: 6, upIsGood: false, period: "vs last month" } };
export const NoData: Story = { args: { value: null } };
