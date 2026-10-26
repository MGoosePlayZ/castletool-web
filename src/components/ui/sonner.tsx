import { Toaster as Sonner } from "sonner";

// Castle snackbar: black, thin separator outline, small white text.
export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      duration={3500}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "flex w-[calc(100vw-32px)] max-w-[420px] items-center rounded-[10px] border border-border bg-background px-4 py-3 text-[13px] text-foreground font-body",
        },
      }}
    />
  );
}
