import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Page-wide "one editor at a time" lock for the FSP Information page.
 *
 * The rule: while ANY inline edit pane is open (Plan details, a standards
 * regime Overview, a regime's Layers, …), every OTHER action button on the
 * page is disabled — only the buttons belonging to the pane that's actually
 * being edited stay live. Because the panes live in different, independently
 * mounted tab components (and nested panels), a plain boolean prop can't
 * reach them all; a context that any descendant can read/register into can.
 *
 * There is a single {@link EditLockContextValue.activeEditor} slot: only one
 * pane can hold the lock, which is exactly what enforces "no second edit
 * while one is open" — every pane's own Edit button reads {@link useEditLock}
 * and disables itself once someone else holds the lock.
 */
export interface EditLockContextValue {
  /** id of the pane currently being edited, or null when nothing is. */
  activeEditor: string | null;
  /** Claim the lock for {@code id} (no-op if another pane already holds it). */
  begin: (id: string) => void;
  /** Release the lock if {@code id} currently holds it. */
  end: (id: string) => void;
}

const NOOP = () => {};

const EditLockContext = createContext<EditLockContextValue | null>(null);

/** Stable pane ids so panes can tell "is it me editing?" apart. */
export const EDIT_PANE = {
  infoPlan: 'info-plan',
  stdOverview: 'std-overview',
  stdLayers: 'std-layers',
} as const;

/**
 * Owner hook — held by the FSP Information page. Returns the provider
 * {@code value} plus the derived {@code anyEditing} flag the page header
 * reads directly (the page renders the provider, so it can't consume it).
 */
export function useProvideEditLock() {
  const [activeEditor, setActiveEditor] = useState<string | null>(null);
  const begin = useCallback(
    (id: string) => setActiveEditor((cur) => cur ?? id),
    [],
  );
  const end = useCallback(
    (id: string) => setActiveEditor((cur) => (cur === id ? null : cur)),
    [],
  );
  const value = useMemo<EditLockContextValue>(
    () => ({ activeEditor, begin, end }),
    [activeEditor, begin, end],
  );
  return { activeEditor, anyEditing: activeEditor !== null, value, Provider };
}

function Provider({
  value,
  children,
}: {
  value: EditLockContextValue;
  children: ReactNode;
}) {
  return (
    <EditLockContext.Provider value={value}>{children}</EditLockContext.Provider>
  );
}

/**
 * Descendant hook. {@code anyEditing} is true whenever some pane holds the
 * lock; {@code lockedFor(myId)} is true when a pane OTHER than {@code myId}
 * holds it — pass your own pane id so your active-pane buttons stay live,
 * omit it for buttons that must die whenever anything is being edited.
 */
export function useEditLock() {
  const ctx = useContext(EditLockContext);
  const activeEditor = ctx?.activeEditor ?? null;
  const lockedFor = useCallback(
    (myId?: string) => activeEditor !== null && activeEditor !== myId,
    [activeEditor],
  );
  return {
    activeEditor,
    anyEditing: activeEditor !== null,
    lockedFor,
    begin: ctx?.begin ?? NOOP,
    end: ctx?.end ?? NOOP,
  };
}

/**
 * Registers a pane's local {@code editing} flag into the lock: claims it
 * while editing, releases on exit and unmount. Safe to call with no provider
 * (e.g. a tab rendered in isolation in a test) — it just no-ops.
 */
export function useEditRegistration(id: string, editing: boolean) {
  const { begin, end } = useEditLock();
  useEffect(() => {
    if (editing) begin(id);
    else end(id);
    return () => end(id);
  }, [editing, id, begin, end]);
}
