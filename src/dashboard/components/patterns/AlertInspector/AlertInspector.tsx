'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { SecurityAlert } from '../../../types';
import { serializeDiagnosticEvent } from '../../../utils';
import { KryptonCodeBlock, KryptonIconButton } from '../../primitives';

export interface AlertInspection {
  readonly alert: SecurityAlert;
  readonly view: 'raw' | 'folder';
}
export interface AlertInspectorProps {
  readonly selection: AlertInspection | null;
  readonly protectedWorkspaceRoot?: string;
  readonly onClose: () => void;
  readonly onReturnFocus: () => void;
}

/** Read-only diagnostics; a blocked target never substitutes for a missing allowed folder. */
export function AlertInspector({
  selection,
  protectedWorkspaceRoot,
  onClose,
  onReturnFocus,
}: AlertInspectorProps): React.JSX.Element {
  const raw = selection ? serializeDiagnosticEvent(selection.alert) : undefined;
  return (
    <Dialog.Root
      open={selection !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-krypton-muted-overlay" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
          className="fixed inset-0 z-50 m-auto h-fit max-h-screen w-full max-w-2xl overflow-y-auto rounded-krypton-radius-card border border-krypton-control-border bg-krypton-bg-surface p-krypton-space-5 text-krypton-fg-primary shadow-2xl shadow-krypton-shadow"
        >
          <header className="flex items-center justify-between gap-krypton-space-4">
            <Dialog.Title className="text-lg font-bold">
              {selection?.view === 'folder' ? 'Allowed Folder' : 'Raw Event (JSON)'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <KryptonIconButton aria-label="Close event inspector" icon={<X />} size="lg" />
            </Dialog.Close>
          </header>
          <Dialog.Description className="mt-krypton-space-2 text-sm leading-6 text-krypton-fg-secondary">
            {selection?.view === 'folder'
              ? 'The current allowed folder reported by the connected native runtime. This is not a historical event snapshot.'
              : 'The retained dashboard event. The original native ledger may contain additional fields. Unknown process details stay unavailable.'}
          </Dialog.Description>
          {selection?.view === 'folder' ? (
            protectedWorkspaceRoot ? (
              <KryptonCodeBlock label="Current allowed folder" code={protectedWorkspaceRoot} />
            ) : (
              <p role="status" className="mt-krypton-space-4 text-sm text-krypton-fg-secondary">
                Allowed folder unavailable. Update or restart the native runtime and refresh. Pages
                demos cannot inspect local folders.
              </p>
            )
          ) : raw?.ok ? (
            <KryptonCodeBlock label="Retained event JSON" code={raw.value} />
          ) : (
            <p role="alert" className="mt-krypton-space-4 text-sm text-krypton-danger-foreground">
              Event details could not be displayed.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
