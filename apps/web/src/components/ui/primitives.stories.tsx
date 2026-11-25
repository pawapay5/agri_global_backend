import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "./primitives";

/** The base layer (shadcn-style, Radix where behaviour matters). Domain components are under "Agri". */
function Kit() {
  return (
    <div className="grid max-w-2xl gap-6">
      <div className="flex flex-wrap gap-3">
        <Button>Primary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>Neutral</Badge>
        <Badge tone="up">Up</Badge>
        <Badge tone="down">Down</Badge>
        <Badge tone="forecast">Forecast</Badge>
      </div>
      <Card className="space-y-3">
        <CardTitle>Card title</CardTitle>
        <div className="space-y-1.5">
          <Label htmlFor="kit-email">Email</Label>
          <Input id="kit-email" type="email" placeholder="you@example.com" aria-invalid aria-describedby="kit-email-err" />
          <FieldError><span id="kit-email-err">Enter a valid email address</span></FieldError>
        </div>
        <Skeleton className="h-6 w-2/3" />
      </Card>
    </div>
  );
}

const meta = { title: "UI/Primitives", component: Kit, tags: ["autodocs"] } satisfies Meta<typeof Kit>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
