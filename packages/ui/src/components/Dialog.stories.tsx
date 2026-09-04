import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./Dialog.js";

const meta: Meta<typeof Dialog> = {
  title: "Overlays/Dialog",
  component: Dialog
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const InviteConfirmation: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir convite</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Convite para transferência</DialogTitle>
        <DialogDescription>
          Um dispositivo deseja estabelecer uma sessão de compartilhamento.
        </DialogDescription>
      </DialogContent>
    </Dialog>
  )
};
