import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface WaitlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WaitlistModal({ open, onOpenChange }: WaitlistModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Join the Waitlist</DialogTitle>
          <DialogDescription>
            Sign up below to be notified when purchasing opens.
          </DialogDescription>
        </DialogHeader>
        <iframe
          src="https://form.jotform.com/261445647881164"
          className="flex-1 w-full border-0"
          title="Join Waitlist"
          allow="geolocation; microphone; camera"
        />
      </DialogContent>
    </Dialog>
  );
}
