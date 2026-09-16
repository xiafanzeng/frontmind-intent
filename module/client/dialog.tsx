import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogHeader(props: ComponentProps<"header">) { return <header {...props} />; }
export function DialogFooter(props: ComponentProps<"footer">) { return <footer {...props} />; }
export function DialogContent({ children, showCloseButton = true, ...props }: ComponentProps<typeof DialogPrimitive.Content> & {showCloseButton?: boolean}) {
 return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="intent-dialog-overlay" /><DialogPrimitive.Content {...props}>{children}{showCloseButton && <DialogPrimitive.Close aria-label="关闭" className="intent-dialog-close">×</DialogPrimitive.Close>}</DialogPrimitive.Content></DialogPrimitive.Portal>;
}
