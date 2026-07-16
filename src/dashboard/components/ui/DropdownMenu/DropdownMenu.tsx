'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import { forwardRef } from 'react';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export type DropdownMenuContentProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
>;

export type DropdownMenuItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Item
>;

export type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Separator
>;

/**
 * Renders portaled Shadcn-style dropdown content beside its trigger.
 *
 * @param {DropdownMenuContentProps} props - Radix placement, behavior, and styling properties.
 * @returns {React.JSX.Element} Accessible menu content with a high-contrast desktop treatment.
 * @example
 * <DropdownMenuContent align="end">Menu actions</DropdownMenuContent>
 * // => renders a right-aligned local action menu
 */
export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={clsx(
          'z-50 min-w-52 overflow-hidden rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-main p-1.5 text-slate-100 shadow-2xl shadow-black/60',
          className
        )}
        ref={ref}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

/**
 * Renders an accessible action row inside a shared dropdown menu.
 *
 * @param {DropdownMenuItemProps} props - Radix selection behavior and item styling properties.
 * @returns {React.JSX.Element} A keyboard- and pointer-selectable menu item.
 * @example
 * <DropdownMenuItem>Download Signature</DropdownMenuItem>
 * // => renders one selectable dropdown action
 */
export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(function DropdownMenuItem({ className, ...props }, ref): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      className={clsx(
        'relative flex cursor-pointer select-none items-center gap-krypton-space-2 rounded-krypton-radius-control px-2.5 py-krypton-space-2 text-sm font-medium outline-none transition-colors focus:bg-slate-800 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

/**
 * Renders a subtle visual divider between related dropdown action groups.
 *
 * @param {DropdownMenuSeparatorProps} props - Radix separator and styling properties.
 * @returns {React.JSX.Element} A non-interactive horizontal menu divider.
 * @example
 * <DropdownMenuSeparator />
 * // => renders a slate divider between menu items
 */
export const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  DropdownMenuSeparatorProps
>(function DropdownMenuSeparator({ className, ...props }, ref): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Separator
      className={clsx('-mx-1 my-1 h-px bg-krypton-border-muted', className)}
      ref={ref}
      {...props}
    />
  );
});
