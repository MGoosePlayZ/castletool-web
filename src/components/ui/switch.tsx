import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

// Castle switch: black thumb on a white track when on, gray thumb on black when off.
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-muted-foreground transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-background data-[state=unchecked]:translate-x-1" />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;
export { Switch };
