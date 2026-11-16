import type { Meta, StoryObj } from "@storybook/react";
import { Stack, Grid, Flex, Container, Spacer } from "../components/Layout";

const meta = {
  title: "Layout/Stack",
  component: Stack,
  tags: ["autodocs"],
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {
  args: {
    direction: "vertical",
    gap: "md",
  },
  render: (args) => (
    <Stack {...args}>
      <div style={{ padding: "16px", background: "#f0f0f0" }}>Item 1</div>
      <div style={{ padding: "16px", background: "#f0f0f0" }}>Item 2</div>
      <div style={{ padding: "16px", background: "#f0f0f0" }}>Item 3</div>
    </Stack>
  ),
};

export const Horizontal: Story = {
  args: {
    direction: "horizontal",
    gap: "md",
  },
  render: (args) => (
    <Stack {...args}>
      <div style={{ padding: "16px", background: "#f0f0f0" }}>Item 1</div>
      <div style={{ padding: "16px", background: "#f0f0f0" }}>Item 2</div>
      <div style={{ padding: "16px", background: "#f0f0f0" }}>Item 3</div>
    </Stack>
  ),
};

export const WithGaps: Story = {
  render: () => (
    <>
      <Stack direction="vertical" gap="xs">
        <div>Extra Small Gap</div>
        <div style={{ padding: "8px", background: "#f0f0f0" }}>Item</div>
        <div style={{ padding: "8px", background: "#f0f0f0" }}>Item</div>
      </Stack>
      <Spacer size="lg" />
      <Stack direction="vertical" gap="xl">
        <div>Extra Large Gap</div>
        <div style={{ padding: "8px", background: "#f0f0f0" }}>Item</div>
        <div style={{ padding: "8px", background: "#f0f0f0" }}>Item</div>
      </Stack>
    </>
  ),
};

export const GridExample: Story = {
  render: () => (
    <Grid columns={3} gap="md">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} style={{ padding: "24px", background: "#e0e0e0", textAlign: "center" }}>
          Card {i}
        </div>
      ))}
    </Grid>
  ),
};

export const FlexExample: Story = {
  render: () => (
    <>
      <Flex justifyContent="space-between" alignItems="center">
        <div>Left</div>
        <div>Center</div>
        <div>Right</div>
      </Flex>
      <Spacer size="lg" />
      <Flex direction="column" gap="8px">
        <div style={{ padding: "12px", background: "#f0f0f0" }}>Flex Column</div>
        <div style={{ padding: "12px", background: "#f0f0f0" }}>Item 2</div>
      </Flex>
    </>
  ),
};

export const ContainerExample: Story = {
  render: () => (
    <Container size="md" padding centered>
      <div style={{ background: "#f0f0f0", padding: "24px", textAlign: "center" }}>
        Centered Container (MD)
      </div>
    </Container>
  ),
};
