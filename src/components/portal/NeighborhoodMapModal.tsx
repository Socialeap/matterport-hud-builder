import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { buildNeighborhoodMapUrl } from "./types";

interface NeighborhoodMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: string;
  propertyName?: string;
}

export function NeighborhoodMapModal({
  open,
  onOpenChange,
  location,
  propertyName,
}: NeighborhoodMapModalProps) {
  const isMobile = useIsMobile();
  const mapUrl = buildNeighborhoodMapUrl(location);
  const title = propertyName ? `${propertyName} — Neighborhood` : "Neighborhood";

  if (!mapUrl) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 px-4 pb-4">
            <iframe
              src={mapUrl}
              title={title}
              className="h-full w-full rounded-2xl border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-3xl border-white/10 bg-background/80 p-0 backdrop-blur-md">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-6">
          <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
            <iframe
              src={mapUrl}
              title={title}
              className="h-full w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
