/**
 * PropertyMapperChooserDialog — primary entry point for creating a Property
 * Mapper template from inside the Production Vault → Property Mapper tab.
 *
 * Renders the 3-card WizardHub (Smart AI Blueprint / Pre-Built Template /
 * Pro Developer Setup) inside a dialog. Picking a card dismisses the chooser
 * and hands control back to the parent, which mounts the existing
 * WizardModal pre-seeded with the chosen path.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WizardHub } from "@/components/vault/wizard/WizardHub";
import type { WizardPath } from "@/components/vault/wizard/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (path: WizardPath) => void;
  disabled?: boolean;
}

export function PropertyMapperChooserDialog({
  open,
  onOpenChange,
  onPick,
  disabled,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add a Property Mapper</DialogTitle>
          <DialogDescription>
            Build a reusable map of facts your clients' AI Chat will pull from
            their uploaded property documents. Pick how you want to start.
          </DialogDescription>
        </DialogHeader>
        <div className="pt-2">
          <WizardHub
            onPick={(path) => {
              onOpenChange(false);
              onPick(path);
            }}
            disabled={disabled}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
