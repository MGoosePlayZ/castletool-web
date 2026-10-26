import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Castle look: monochrome pills. "default" = white fill / black text, "outline" = thin separator outline.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground rounded-full px-[18px] py-[9px] text-sm hover:bg-primary/90 disabled:bg-border",
        outline: "border border-border rounded-full px-[18px] py-[9px] text-sm hover:bg-accent disabled:opacity-50",
        destructive: "border border-border text-destructive rounded-full px-[18px] py-[9px] text-sm hover:bg-accent",
        ghost: "hover:bg-accent rounded-lg",
        icon: "rounded-full hover:bg-accent active:bg-accent disabled:opacity-30",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant }), className)} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
