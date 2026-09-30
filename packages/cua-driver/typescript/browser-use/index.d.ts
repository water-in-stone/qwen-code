export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface BrowserUseOptions {
  session?: string;
  sessionTtlSeconds?: number;
  idleTtlSeconds?: number;
  signal?: AbortSignal;
}

export interface BrowserUseConnectOptions extends BrowserUseOptions {
  socketPath?: string;
}

export interface BrowserCallOptions {
  signal?: AbortSignal;
}

export interface BrowserUseOperationResult {
  id: string;
  state: 'accepted' | 'dispatched' | 'committed' | 'completed';
  dispatched: boolean;
  committed: boolean;
  cancellationRequested: boolean;
}

export interface BrowserImage {
  mimeType?: string;
  dataBase64?: string;
}

export interface BrowserAppInfo {
  [key: string]: unknown;
  pid?: number;
  name?: string;
  bundle_id?: string;
  running?: boolean;
}

export interface BrowserWindowInfo {
  [key: string]: unknown;
  pid?: number;
  window_id?: number;
  title?: string;
  app_name?: string;
  is_on_screen?: boolean;
}

export interface BrowserListWindowsOptions extends BrowserCallOptions {
  pid?: number;
  onScreenOnly?: boolean;
}

export interface BrowserPrepareIsolatedOptions extends BrowserCallOptions {
  pid: number;
  profileName?: string;
}

export interface BrowserPrepareResult {
  status: 'ok';
  prepared: boolean;
  preparedPid?: number;
  action?: string;
  message: string;
  endpointOwnership?: unknown;
  sideEffects?: unknown;
  operation: BrowserUseOperationResult;
}

export interface BrowserBindOptions extends BrowserCallOptions {
  pid: number;
  windowId: number;
}

export interface BrowserTabInfo {
  readonly tabId: string;
  readonly title?: string;
  readonly url?: string;
  readonly active: boolean | null;
}

export interface BrowserRef {
  readonly ref: string;
  readonly role?: string;
  readonly name?: string;
  readonly value?: unknown;
  readonly states?: unknown;
  readonly actions: readonly string[];
  readonly frame?: string;
  readonly visibility?: string;
}

export interface BrowserScreenshot {
  source?: string;
  scope?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  coordinateSpace?: string;
  viewportCssWidth?: number;
  viewportCssHeight?: number;
  pixelToCssScaleX?: number;
  pixelToCssScaleY?: number;
  images: BrowserImage[];
}

export interface BrowserObservation {
  status: 'ok';
  targetId: string;
  tabId: string;
  page: unknown;
  outline: string;
  refs: BrowserRef[];
  contentRefs: BrowserRef[];
  snapshot: unknown;
  continuation?: string;
  oopif?: unknown;
  screenshot?: BrowserScreenshot;
  operation: BrowserUseOperationResult;
}

export interface BrowserResult {
  status: 'ok';
  text: string;
  data: JsonObject;
  images: BrowserImage[];
  operation: BrowserUseOperationResult;
}

export type BrowserInputRoute = 'trusted' | 'dom_event';

export type BrowserClickOptions = BrowserCallOptions &
  (
    | {
        ref: string;
        x?: never;
        y?: never;
        inputRoute?: BrowserInputRoute;
      }
    | {
        ref?: never;
        x: number;
        y: number;
        inputRoute?: 'trusted';
      }
  );

export interface BrowserTypeOptions extends BrowserCallOptions {
  ref: string;
  text: string;
  mode?: 'insert_text' | 'keystrokes';
  replace?: boolean;
}

interface BrowserPointerRefBase extends BrowserCallOptions {
  ref: string;
  x?: never;
  y?: never;
  inputRoute?: BrowserInputRoute;
}

interface BrowserPointerTrustedRefBase extends BrowserCallOptions {
  ref: string;
  x?: never;
  y?: never;
  inputRoute?: 'trusted';
}

interface BrowserPointerCoordinateBase extends BrowserCallOptions {
  ref?: never;
  x: number;
  y: number;
  inputRoute?: 'trusted';
}

type BrowserPointerOrigin =
  | BrowserPointerRefBase
  | BrowserPointerCoordinateBase;

type BrowserScrollDelta =
  | { deltaX: number; deltaY?: number }
  | { deltaX?: number; deltaY: number };

export type BrowserPointerOptions =
  | (BrowserPointerOrigin & {
      action: 'hover' | 'right_click' | 'double_click';
      destinationRef?: never;
      toX?: never;
      toY?: never;
      deltaX?: never;
      deltaY?: never;
    })
  | (BrowserPointerOrigin &
      BrowserScrollDelta & {
        action: 'scroll';
        destinationRef?: never;
        toX?: never;
        toY?: never;
      })
  | (BrowserPointerRefBase & {
      action: 'drag';
      destinationRef: string;
      toX?: never;
      toY?: never;
      deltaX?: never;
      deltaY?: never;
    })
  | ((BrowserPointerTrustedRefBase | BrowserPointerCoordinateBase) &
      (
        | {
            action: 'drag';
            destinationRef: string;
            toX?: never;
            toY?: never;
            deltaX?: never;
            deltaY?: never;
          }
        | {
            action: 'drag';
            destinationRef?: never;
            toX: number;
            toY: number;
            deltaX?: never;
            deltaY?: never;
          }
      ));

export interface BrowserObserveOptions extends BrowserCallOptions {
  scopeRef?: string;
  query?: string;
  continuation?: string;
  includeScreenshot?: boolean;
}

export interface BrowserDialogState {
  status: 'ok';
  present: boolean;
  dialogId?: string;
  kind?: string;
  operation: BrowserUseOperationResult;
}

export class BrowserUseError extends Error {
  readonly code?: string;
  readonly details?: unknown;
}

export class BrowserUse {
  private constructor();

  static create(options?: BrowserUseOptions): Promise<BrowserUse>;
  static connect(options?: BrowserUseConnectOptions): Promise<BrowserUse>;

  listApps(options?: BrowserCallOptions): Promise<readonly BrowserAppInfo[]>;
  listWindows(
    options?: BrowserListWindowsOptions,
  ): Promise<readonly BrowserWindowInfo[]>;
  prepareIsolated(
    options: BrowserPrepareIsolatedOptions,
  ): Promise<BrowserPrepareResult>;
  bindWindow(options: BrowserBindOptions): Promise<BrowserBinding>;
  close(): Promise<void>;
}

export class BrowserBinding {
  private constructor();

  readonly targetId: string;
  readonly bindingQuality: 'exact' | 'heuristic';
  readonly mutationAllowed: boolean;
  readonly nativeTitle?: string;
  readonly tabs: readonly BrowserTabInfo[];

  getTab(tabId: string): BrowserTab;
}

export class BrowserTab {
  private constructor();

  readonly tabId: string;
  readonly title?: string;
  readonly url?: string;
  readonly active: boolean | null;

  observe(options?: BrowserObserveOptions): Promise<BrowserObservation>;
  navigate(url: string, options?: BrowserCallOptions): Promise<BrowserResult>;
  click(options: BrowserClickOptions): Promise<BrowserResult>;
  type(options: BrowserTypeOptions): Promise<BrowserResult>;
  pointer(options: BrowserPointerOptions): Promise<BrowserResult>;
  inspectDialog(options?: BrowserCallOptions): Promise<BrowserDialogState>;
}
