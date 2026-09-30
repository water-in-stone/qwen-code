import { randomUUID } from 'node:crypto';

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60;
const DEFAULT_IDLE_TTL_SECONDS = 5 * 60;
const SESSION_INVALID_CODES = new Set([
  'authorization_context_expired',
  'session_unavailable',
]);
const INVOKE = Symbol('BrowserUse.invoke');
const ASSERT_HANDLE = Symbol('BrowserUse.assertHandle');

async function loadCuaDriver() {
  return import('@qwen-code/cua-sdk');
}

export class BrowserUseError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'BrowserUseError';
    this.code = info.code;
    this.details = info.details;
  }
}

function requireAbortSignal(signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new BrowserUseError('signal must be an AbortSignal');
  }
}

function requirePositiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BrowserUseError(`${name} must be a positive integer`);
  }
  return value;
}

function requireNonEmptyString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BrowserUseError(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalBoolean(name, value) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new BrowserUseError(`${name} must be a boolean`);
  }
  return value;
}

function optionalFiniteNumber(name, value) {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new BrowserUseError(`${name} must be a finite number`);
  }
  return value;
}

function optionalString(name, value) {
  if (value === undefined) return undefined;
  return requireNonEmptyString(name, value);
}

function requireProfileName(value) {
  const name = requireNonEmptyString('profileName', value);
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(name)) {
    throw new BrowserUseError(
      'profileName must contain 1-64 ASCII letters, digits, dots, underscores, or hyphens',
    );
  }
  return name;
}

function requireBrowserUrl(value) {
  const text = requireNonEmptyString('url', value);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new BrowserUseError('url must be a valid http, https, or about URL');
  }
  if (!['http:', 'https:', 'about:'].includes(url.protocol)) {
    throw new BrowserUseError('url must use http, https, or about');
  }
  return text;
}

function beginOperation(method, signal) {
  requireAbortSignal(signal);
  const operation = {
    id: randomUUID(),
    state: 'accepted',
    dispatched: false,
    committed: false,
    cancellationRequested: signal?.aborted === true,
  };
  const onAbort = () => {
    operation.cancellationRequested = true;
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    operation,
    release: () => signal?.removeEventListener('abort', onAbort),
  };
}

function operationSnapshot(operation) {
  return Object.freeze({ ...operation });
}

function cancelledBeforeDispatch(method, operation) {
  operation.state = 'completed';
  throw new BrowserUseError(`${method} was cancelled before dispatch`, {
    code: 'call_cancelled',
    details: { operation: operationSnapshot(operation) },
  });
}

function awaitNativeTerminal(value, signal) {
  const promise = Promise.resolve(value);
  const waitUntil = signal?.waitUntil;
  return typeof waitUntil === 'function'
    ? waitUntil.call(signal, promise)
    : promise;
}

function parseStructured(result) {
  if (
    typeof result?.structuredJson !== 'string' ||
    result.structuredJson === ''
  ) {
    return undefined;
  }
  try {
    return JSON.parse(result.structuredJson);
  } catch {
    return undefined;
  }
}

function refusalText(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^refused \(([a-z0-9_]+)\):\s*(.*)$/su.exec(value);
  return match ? { code: match[1], message: match[2] } : undefined;
}

function refusalFrom(result, structured) {
  const textRefusal = refusalText(result?.text);
  const refusal =
    structured?.refusal &&
    typeof structured.refusal === 'object' &&
    !Array.isArray(structured.refusal)
      ? structured.refusal
      : undefined;
  if (
    result?.isError !== true &&
    structured?.status !== 'refused' &&
    structured?.effect !== 'refused' &&
    refusal === undefined &&
    textRefusal === undefined
  ) {
    return undefined;
  }
  const code =
    (typeof refusal?.code === 'string' && refusal.code) ||
    (typeof structured?.code === 'string' && structured.code) ||
    result?.errorCode ||
    textRefusal?.code ||
    undefined;
  const message =
    (typeof refusal?.message === 'string' && refusal.message) ||
    (typeof structured?.message === 'string' && structured.message) ||
    textRefusal?.message ||
    result?.text ||
    'browser operation was refused';
  return { code, message };
}

function requireObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrowserUseError(`${name} must be an object`, {
      code: 'invalid_browser_result',
      details: { value },
    });
  }
  return value;
}

function requireArray(name, value) {
  if (!Array.isArray(value)) {
    throw new BrowserUseError(`${name} must be an array`, {
      code: 'invalid_browser_result',
      details: { value },
    });
  }
  return value;
}

function configuredOptions(sdk, options) {
  const finiteLifetime =
    options.sessionTtlSeconds !== undefined ||
    options.idleTtlSeconds !== undefined;
  const sessionTtlSeconds = finiteLifetime
    ? requirePositiveInteger(
        'sessionTtlSeconds',
        options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
      )
    : 0;
  const idleTtlSeconds = finiteLifetime
    ? requirePositiveInteger(
        'idleTtlSeconds',
        options.idleTtlSeconds ?? DEFAULT_IDLE_TTL_SECONDS,
      )
    : 0;
  if (idleTtlSeconds > sessionTtlSeconds) {
    throw new BrowserUseError('idleTtlSeconds cannot exceed sessionTtlSeconds');
  }
  const publicSession =
    options.session ?? `browser-use-${process.pid}-${randomUUID().slice(0, 8)}`;
  requireNonEmptyString('session', publicSession);
  const session = {
    publicSession,
    mode: sdk.SessionPermissionMode.Standard,
    ttlSeconds: BigInt(sessionTtlSeconds),
    idleTtlSeconds: BigInt(idleTtlSeconds),
    capabilityManifestPath: undefined,
    boundedManifestPath: undefined,
  };
  return {
    publicSession,
    session,
    driver: {
      claudeCodeCompatibility: false,
      authorization: {
        allowedModes: [sdk.SessionPermissionMode.Standard],
        compatibilityMode: sdk.SessionPermissionMode.Standard,
        compatibilityCapabilityManifestPath: undefined,
        compatibilityBoundedManifestPath: undefined,
        unrestrictedAcknowledged: false,
        maxSessionTtlSeconds: session.ttlSeconds,
        maxIdleTtlSeconds: session.idleTtlSeconds,
      },
    },
  };
}

async function createSession(sdk, owner, options) {
  if (typeof sdk.createTrustedSessionAsync !== 'function') {
    throw new BrowserUseError(
      'typed CUA SDK lacks asynchronous session binding',
      {
        code: 'typed_sdk_method_unavailable',
      },
    );
  }
  return sdk.createTrustedSessionAsync(owner, options);
}

async function destroySession(session) {
  let failure;
  try {
    if (typeof session?.closeAsync === 'function') await session.closeAsync();
    else if (typeof session?.close === 'function') session.close();
  } catch (error) {
    failure = error;
  }
  try {
    session?.uniffiDestroy?.();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

async function destroyOwner(owner) {
  let failure;
  try {
    if (typeof owner?.shutdown === 'function') await owner.shutdown();
  } catch (error) {
    failure = error;
  }
  try {
    owner?.uniffiDestroy?.();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

function normalizeImages(images) {
  return Array.isArray(images) ? images : [];
}

function resultValue(result) {
  const data = requireObject('browser action result', result.structured);
  return {
    status: 'ok',
    text: result.text,
    data,
    images: result.images,
    operation: result.operation,
  };
}

function normalizeRecords(name, value) {
  return Object.freeze(
    requireArray(name, value).map((entry, index) =>
      Object.freeze({ ...requireObject(`${name}[${index}]`, entry) }),
    ),
  );
}

function normalizeTabs(value) {
  return requireArray('tabs', value).map((entry, index) => {
    const tab = requireObject(`tabs[${index}]`, entry);
    const active =
      tab.active === true ? true : tab.active === false ? false : null;
    return Object.freeze({
      tabId: requireNonEmptyString(`tabs[${index}].tab_id`, tab.tab_id),
      title: typeof tab.title === 'string' ? tab.title : undefined,
      url: typeof tab.url === 'string' ? tab.url : undefined,
      active,
    });
  });
}

function normalizeRefs(name, value) {
  return requireArray(name, value ?? []).map((entry, index) => {
    const ref = requireObject(`${name}[${index}]`, entry);
    return Object.freeze({
      ref: requireNonEmptyString(`${name}[${index}].ref`, ref.ref),
      role: typeof ref.role === 'string' ? ref.role : undefined,
      name: typeof ref.name === 'string' ? ref.name : undefined,
      value: ref.value,
      states: ref.states,
      actions: Array.isArray(ref.actions)
        ? ref.actions.filter((action) => typeof action === 'string')
        : [],
      frame: typeof ref.frame === 'string' ? ref.frame : undefined,
      visibility:
        typeof ref.visibility === 'string' ? ref.visibility : undefined,
    });
  });
}

function requireMutationAllowed(mutationAllowed) {
  if (!mutationAllowed) {
    throw new BrowserUseError('heuristic browser bindings are read-only', {
      code: 'browser_binding_not_exact',
    });
  }
}

export class BrowserUse {
  #driver;
  #owner;
  #ownsSession;
  #publicSession;
  #generation = 1;
  #closed = false;
  #invalidated = false;
  #activeCalls = new Set();
  #closePromise;

  constructor(
    driver,
    { owner = driver, ownsSession = false, publicSession } = {},
  ) {
    if (!driver || typeof driver.callTool !== 'function') {
      throw new BrowserUseError('BrowserUse requires a CuaDriver session');
    }
    this.#driver = driver;
    this.#owner = owner;
    this.#ownsSession = ownsSession;
    this.#publicSession =
      publicSession ?? `browser-use-test-${randomUUID().slice(0, 8)}`;
  }

  static async create(options = {}) {
    requireAbortSignal(options.signal);
    if (options.signal?.aborted) {
      throw new BrowserUseError('create was cancelled before dispatch', {
        code: 'call_cancelled',
      });
    }
    const sdk = await loadCuaDriver();
    const configured = configuredOptions(sdk, options);
    const owner = sdk.CuaDriver.createConfigured(configured.driver);
    try {
      const session = await awaitNativeTerminal(
        createSession(sdk, owner, configured.session),
        options.signal,
      );
      return new BrowserUse(session, {
        owner,
        ownsSession: true,
        publicSession: configured.publicSession,
      });
    } catch (error) {
      await destroyOwner(owner);
      throw error;
    }
  }

  static async connect(options = {}) {
    requireAbortSignal(options.signal);
    if (options.signal?.aborted) {
      throw new BrowserUseError('connect was cancelled before dispatch', {
        code: 'call_cancelled',
      });
    }
    const sdk = await loadCuaDriver();
    const configured = configuredOptions(sdk, options);
    const owner = sdk.CuaDriver.connect(options.socketPath);
    try {
      const session = await awaitNativeTerminal(
        createSession(sdk, owner, configured.session),
        options.signal,
      );
      return new BrowserUse(session, {
        owner,
        ownsSession: true,
        publicSession: configured.publicSession,
      });
    } catch (error) {
      await destroyOwner(owner);
      throw error;
    }
  }

  #requireOpen() {
    if (this.#closed)
      throw new BrowserUseError('BrowserUse instance is closed');
    if (this.#invalidated) {
      throw new BrowserUseError(
        'BrowserUse session is invalid; create and bind a new instance',
        {
          code: 'browser_session_invalid',
        },
      );
    }
  }

  #invalidate() {
    if (!this.#invalidated) {
      this.#invalidated = true;
      this.#generation += 1;
    }
  }

  [ASSERT_HANDLE](generation) {
    this.#requireOpen();
    if (generation !== this.#generation) {
      throw new BrowserUseError('browser binding is stale', {
        code: 'browser_binding_stale',
      });
    }
  }

  async [INVOKE](generation, tool, args, { signal, mutating = false } = {}) {
    this[ASSERT_HANDLE](generation);
    return this.#invoke(tool, args, { signal, mutating });
  }

  async #invoke(tool, args, { signal, mutating = false } = {}) {
    this.#requireOpen();
    const lifecycle = beginOperation(tool, signal);
    const { operation } = lifecycle;
    let nativePromise;
    try {
      if (operation.cancellationRequested)
        cancelledBeforeDispatch(tool, operation);
      operation.state = 'dispatched';
      operation.dispatched = true;
      nativePromise = Promise.resolve(
        this.#driver.callTool(
          tool,
          JSON.stringify({ ...args, session: this.#publicSession }),
        ),
      );
      this.#activeCalls.add(nativePromise);
      let value;
      try {
        value = await awaitNativeTerminal(nativePromise, signal);
      } catch (error) {
        this.#invalidate();
        operation.state = 'completed';
        if (operation.cancellationRequested) {
          throw new BrowserUseError(
            `${tool} failed after dispatch; the browser action outcome is unknown`,
            {
              code: 'browser_action_outcome_unknown',
              details: {
                cause: error,
                operation: operationSnapshot(operation),
              },
            },
          );
        }
        throw new BrowserUseError(`${tool} transport failed`, {
          code: error?.code ?? 'browser_transport_failed',
          details: { cause: error, operation: operationSnapshot(operation) },
        });
      } finally {
        this.#activeCalls.delete(nativePromise);
      }
      const structured = parseStructured(value);
      const refusal = refusalFrom(value, structured);
      if (refusal) {
        if (SESSION_INVALID_CODES.has(refusal.code)) this.#invalidate();
        operation.state = 'completed';
        throw new BrowserUseError(refusal.message, {
          code: refusal.code,
          details: {
            ...(structured && typeof structured === 'object'
              ? structured
              : { result: structured }),
            refusal: structured?.refusal ?? {
              code: refusal.code,
              message: refusal.message,
            },
            operation: operationSnapshot(operation),
          },
        });
      }
      if (mutating) {
        operation.state = 'committed';
        operation.committed = true;
      }
      operation.state = 'completed';
      return {
        text: value?.text ?? '',
        structured,
        images: normalizeImages(value?.images),
        operation: operationSnapshot(operation),
      };
    } finally {
      lifecycle.release();
    }
  }

  async listApps({ signal } = {}) {
    const result = await this.#invoke('list_apps', {}, { signal });
    const apps = result.structured?.apps ?? result.structured;
    return normalizeRecords('apps', apps);
  }

  async listWindows({ pid, onScreenOnly, signal } = {}) {
    const args = {};
    if (pid !== undefined) args.pid = requirePositiveInteger('pid', pid);
    if (onScreenOnly !== undefined) {
      args.on_screen_only = optionalBoolean('onScreenOnly', onScreenOnly);
    }
    const result = await this.#invoke('list_windows', args, { signal });
    const windows = result.structured?.windows ?? result.structured;
    return normalizeRecords('windows', windows);
  }

  async prepareIsolated({ pid, profileName, signal } = {}) {
    const args = {
      pid: requirePositiveInteger('pid', pid),
      allow_launch: true,
      profile:
        profileName === undefined
          ? { mode: 'isolated_new' }
          : {
              mode: 'isolated_named',
              name: requireProfileName(profileName),
            },
    };
    try {
      const result = await this.#invoke('browser_prepare', args, {
        signal,
        mutating: true,
      });
      this.#generation += 1;
      const data = requireObject('browser_prepare result', result.structured);
      return {
        status: 'ok',
        prepared: data.prepared === true,
        preparedPid:
          data.prepared_pid == null
            ? undefined
            : requirePositiveInteger('prepared_pid', data.prepared_pid),
        action: typeof data.action === 'string' ? data.action : undefined,
        message: typeof data.message === 'string' ? data.message : result.text,
        endpointOwnership: data.endpoint_ownership,
        sideEffects: data.side_effects,
        operation: result.operation,
      };
    } catch (error) {
      if (error?.details?.operation?.dispatched) this.#generation += 1;
      throw error;
    }
  }

  async bindWindow({ pid, windowId, signal } = {}) {
    const result = await this.#invoke(
      'get_browser_state',
      {
        pid: requirePositiveInteger('pid', pid),
        window_id: requirePositiveInteger('windowId', windowId),
      },
      { signal },
    );
    const data = requireObject('browser bind result', result.structured);
    if (data.mode !== 'bind') {
      throw new BrowserUseError('get_browser_state did not return bind mode', {
        code: 'invalid_browser_result',
        details: data,
      });
    }
    const targetId = requireNonEmptyString('target_id', data.target_id);
    const bindingQuality =
      data.binding_quality === 'exact' || data.binding_quality === 'heuristic'
        ? data.binding_quality
        : undefined;
    if (!bindingQuality) {
      throw new BrowserUseError('browser binding quality is invalid', {
        code: 'invalid_browser_result',
        details: data,
      });
    }
    return new BrowserBinding(this, this.#generation, {
      targetId,
      bindingQuality,
      mutationAllowed: data.mutation_allowed === true,
      nativeTitle:
        typeof data.native_title === 'string' ? data.native_title : undefined,
      tabs: normalizeTabs(data.tabs),
    });
  }

  async close() {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#generation += 1;
    this.#closePromise = (async () => {
      await Promise.allSettled([...this.#activeCalls]);
      let failure;
      if (this.#ownsSession && typeof this.#driver?.endSession === 'function') {
        try {
          await this.#driver.endSession({ session: this.#publicSession });
        } catch (error) {
          failure = error;
        }
      }
      if (this.#ownsSession) {
        try {
          await destroySession(this.#driver);
        } catch (error) {
          failure ??= error;
        }
      }
      try {
        await destroyOwner(this.#owner);
      } catch (error) {
        failure ??= error;
      }
      if (failure) throw failure;
    })();
    return this.#closePromise;
  }
}

export class BrowserBinding {
  #browser;
  #generation;

  constructor(browser, generation, data) {
    this.#browser = browser;
    this.#generation = generation;
    this.targetId = data.targetId;
    this.bindingQuality = data.bindingQuality;
    this.mutationAllowed = data.mutationAllowed;
    this.nativeTitle = data.nativeTitle;
    this.tabs = Object.freeze([...data.tabs]);
    Object.freeze(this);
  }

  getTab(tabId) {
    this.#browser[ASSERT_HANDLE](this.#generation);
    const id = requireNonEmptyString('tabId', tabId);
    const tab = this.tabs.find((entry) => entry.tabId === id);
    if (!tab) {
      throw new BrowserUseError(`tab ${id} does not belong to this binding`, {
        code: 'browser_tab_not_found',
      });
    }
    return new BrowserTab(this.#browser, this.#generation, {
      targetId: this.targetId,
      mutationAllowed: this.mutationAllowed,
      tab,
    });
  }
}

export class BrowserTab {
  #browser;
  #generation;
  #targetId;
  #mutationAllowed;

  constructor(browser, generation, data) {
    this.#browser = browser;
    this.#generation = generation;
    this.#targetId = data.targetId;
    this.#mutationAllowed = data.mutationAllowed;
    this.tabId = data.tab.tabId;
    this.title = data.tab.title;
    this.url = data.tab.url;
    this.active = data.tab.active;
    Object.freeze(this);
  }

  #base() {
    this.#browser[ASSERT_HANDLE](this.#generation);
    return { target_id: this.#targetId, tab_id: this.tabId };
  }

  #mutatingBase() {
    const base = this.#base();
    requireMutationAllowed(this.#mutationAllowed);
    return base;
  }

  async observe({
    scopeRef,
    query,
    continuation,
    includeScreenshot,
    signal,
  } = {}) {
    if (
      continuation !== undefined &&
      (scopeRef !== undefined || query !== undefined)
    ) {
      throw new BrowserUseError(
        'continuation cannot be combined with scopeRef or query',
      );
    }
    const args = {
      ...this.#base(),
      snapshot_format: 'semantic_v2',
    };
    if (scopeRef !== undefined)
      args.scope_ref = optionalString('scopeRef', scopeRef);
    if (query !== undefined) args.query = optionalString('query', query);
    if (continuation !== undefined) {
      args.continuation = optionalString('continuation', continuation);
    }
    if (includeScreenshot !== undefined) {
      args.include_screenshot = optionalBoolean(
        'includeScreenshot',
        includeScreenshot,
      );
    }
    const result = await this.#browser[INVOKE](
      this.#generation,
      'get_browser_state',
      args,
      { signal },
    );
    const data = requireObject('browser observation', result.structured);
    if (data.mode !== 'snapshot') {
      throw new BrowserUseError(
        'get_browser_state did not return snapshot mode',
        {
          code: 'invalid_browser_result',
          details: data,
        },
      );
    }
    return {
      status: 'ok',
      targetId: this.#targetId,
      tabId: this.tabId,
      page: data.page ?? {},
      outline: typeof data.outline === 'string' ? data.outline : '',
      refs: normalizeRefs('refs', data.refs),
      contentRefs: normalizeRefs('content_refs', data.content_refs),
      snapshot: data.snapshot ?? {},
      continuation:
        typeof data.snapshot?.continuation === 'string'
          ? data.snapshot.continuation
          : undefined,
      oopif: data.oopif,
      screenshot:
        result.images.length > 0
          ? {
              source:
                typeof data.screenshot?.source === 'string'
                  ? data.screenshot.source
                  : undefined,
              scope:
                typeof data.screenshot?.scope === 'string'
                  ? data.screenshot.scope
                  : undefined,
              width:
                typeof data.screenshot_width === 'number'
                  ? data.screenshot_width
                  : undefined,
              height:
                typeof data.screenshot_height === 'number'
                  ? data.screenshot_height
                  : undefined,
              mimeType:
                typeof data.screenshot_mime_type === 'string'
                  ? data.screenshot_mime_type
                  : undefined,
              coordinateSpace:
                typeof data.screenshot?.coordinate_space === 'string'
                  ? data.screenshot.coordinate_space
                  : undefined,
              viewportCssWidth:
                typeof data.screenshot?.viewport_css_width === 'number'
                  ? data.screenshot.viewport_css_width
                  : undefined,
              viewportCssHeight:
                typeof data.screenshot?.viewport_css_height === 'number'
                  ? data.screenshot.viewport_css_height
                  : undefined,
              pixelToCssScaleX:
                typeof data.screenshot?.pixel_to_css_scale_x === 'number'
                  ? data.screenshot.pixel_to_css_scale_x
                  : undefined,
              pixelToCssScaleY:
                typeof data.screenshot?.pixel_to_css_scale_y === 'number'
                  ? data.screenshot.pixel_to_css_scale_y
                  : undefined,
              images: result.images,
            }
          : undefined,
      operation: result.operation,
    };
  }

  async navigate(url, { signal } = {}) {
    const destination = requireBrowserUrl(url);
    const result = await this.#browser[INVOKE](
      this.#generation,
      'browser_navigate',
      { ...this.#mutatingBase(), url: destination },
      { signal, mutating: true },
    );
    return resultValue(result);
  }

  async click(options = {}) {
    const { ref, x, y, inputRoute, signal } = options;
    const hasRef = ref !== undefined;
    const hasCoordinates = x !== undefined || y !== undefined;
    if (hasRef === hasCoordinates) {
      throw new BrowserUseError('click requires either ref or both x and y');
    }
    const args = this.#mutatingBase();
    if (hasRef) args.ref = requireNonEmptyString('ref', ref);
    else {
      args.x = optionalFiniteNumber('x', x);
      args.y = optionalFiniteNumber('y', y);
      if (args.x === undefined || args.y === undefined) {
        throw new BrowserUseError('click requires both x and y');
      }
    }
    if (inputRoute !== undefined) {
      if (inputRoute !== 'trusted' && inputRoute !== 'dom_event') {
        throw new BrowserUseError('inputRoute must be trusted or dom_event');
      }
      if (inputRoute === 'dom_event' && !hasRef) {
        throw new BrowserUseError('inputRoute dom_event requires ref');
      }
      args.input_route = inputRoute;
    }
    const result = await this.#browser[INVOKE](
      this.#generation,
      'browser_click',
      args,
      { signal, mutating: true },
    );
    return resultValue(result);
  }

  async type({ ref, text, mode, replace, signal } = {}) {
    const args = {
      ...this.#mutatingBase(),
      ref: requireNonEmptyString('ref', ref),
      text: typeof text === 'string' ? text : undefined,
    };
    if (args.text === undefined)
      throw new BrowserUseError('text must be a string');
    if (mode !== undefined) {
      if (mode !== 'insert_text' && mode !== 'keystrokes') {
        throw new BrowserUseError('mode must be insert_text or keystrokes');
      }
      args.mode = mode;
    }
    if (replace !== undefined)
      args.replace = optionalBoolean('replace', replace);
    const result = await this.#browser[INVOKE](
      this.#generation,
      'browser_type',
      args,
      { signal, mutating: true },
    );
    return resultValue(result);
  }

  async pointer(options = {}) {
    const { action, inputRoute, signal } = options;
    const supported = new Set([
      'hover',
      'right_click',
      'double_click',
      'scroll',
      'drag',
    ]);
    if (!supported.has(action)) {
      throw new BrowserUseError(
        'action must be hover, right_click, double_click, scroll, or drag',
      );
    }
    const args = { ...this.#mutatingBase(), action };
    for (const [publicName, driverName] of [
      ['ref', 'ref'],
      ['x', 'x'],
      ['y', 'y'],
      ['destinationRef', 'destination_ref'],
      ['toX', 'to_x'],
      ['toY', 'to_y'],
      ['deltaX', 'delta_x'],
      ['deltaY', 'delta_y'],
    ]) {
      const value = options[publicName];
      if (value === undefined) continue;
      args[driverName] =
        publicName === 'ref' || publicName.endsWith('Ref')
          ? requireNonEmptyString(publicName, value)
          : optionalFiniteNumber(publicName, value);
    }
    const hasRef = args.ref !== undefined;
    const hasCoordinates = args.x !== undefined || args.y !== undefined;
    if (hasRef === hasCoordinates) {
      throw new BrowserUseError('pointer requires either ref or both x and y');
    }
    if (hasCoordinates && (args.x === undefined || args.y === undefined)) {
      throw new BrowserUseError('pointer requires both x and y');
    }
    if (inputRoute === 'dom_event' && !hasRef) {
      throw new BrowserUseError('inputRoute dom_event requires ref');
    }
    if (
      action === 'scroll' &&
      args.delta_x === undefined &&
      args.delta_y === undefined
    ) {
      throw new BrowserUseError('scroll requires deltaX or deltaY');
    }
    if (
      action !== 'drag' &&
      (args.destination_ref !== undefined ||
        args.to_x !== undefined ||
        args.to_y !== undefined)
    ) {
      throw new BrowserUseError(
        'destinationRef, toX, and toY are valid only for drag',
      );
    }
    if (
      action !== 'scroll' &&
      (args.delta_x !== undefined || args.delta_y !== undefined)
    ) {
      throw new BrowserUseError('deltaX and deltaY are valid only for scroll');
    }
    if (action === 'drag') {
      const hasDestinationRef = args.destination_ref !== undefined;
      const hasDestinationCoordinates =
        args.to_x !== undefined || args.to_y !== undefined;
      if (hasDestinationRef === hasDestinationCoordinates) {
        throw new BrowserUseError(
          'drag requires either destinationRef or both toX and toY',
        );
      }
      if (
        hasDestinationCoordinates &&
        (args.to_x === undefined || args.to_y === undefined)
      ) {
        throw new BrowserUseError('drag requires both toX and toY');
      }
      if (inputRoute === 'dom_event' && !hasDestinationRef) {
        throw new BrowserUseError(
          'inputRoute dom_event drag requires destinationRef',
        );
      }
    }
    if (inputRoute !== undefined) {
      if (inputRoute !== 'trusted' && inputRoute !== 'dom_event') {
        throw new BrowserUseError('inputRoute must be trusted or dom_event');
      }
      args.input_route = inputRoute;
    }
    const result = await this.#browser[INVOKE](
      this.#generation,
      'browser_pointer',
      args,
      { signal, mutating: true },
    );
    return resultValue(result);
  }

  async inspectDialog({ signal } = {}) {
    const result = await this.#browser[INVOKE](
      this.#generation,
      'browser_dialog',
      { ...this.#base(), action: 'inspect' },
      { signal },
    );
    const data = requireObject('browser dialog result', result.structured);
    return {
      status: 'ok',
      present: data.present === true,
      dialogId: typeof data.dialog_id === 'string' ? data.dialog_id : undefined,
      kind: typeof data.kind === 'string' ? data.kind : undefined,
      operation: result.operation,
    };
  }
}
