export interface OverlayRouteNode {
  system_id: string;
  display_name: string;
  distance_ly: number;
  via_gate: boolean;
}

export interface OverlayPlayerMarker {
  system_id: string;
  display_name: string;
  is_docked: boolean;
}

export interface OverlayHighlightedSystem {
  system_id: string;
  display_name: string;
  category: string;
  note?: string;
}

export interface OverlayHudHint {
  id: string;
  text: string;
  dismissible: boolean;
  active: boolean;
}

export interface OverlayCameraPose {
  position: { x: number; y: number; z: number };
  look_at: { x: number; y: number; z: number };
  up?: { x: number; y: number; z: number };
  fov_degrees?: number;
}

export interface OverlayState {
  version: number;
  generated_at_ms: number;
  route: OverlayRouteNode[];
  notes?: string;
  player_marker?: OverlayPlayerMarker;
  highlighted_systems?: OverlayHighlightedSystem[];
  camera_pose?: OverlayCameraPose;
  hud_hints?: OverlayHudHint[];
  follow_mode_enabled?: boolean;
  active_route_node_id?: string;
}

export interface OverlayEventRecord {
  id: number;
  type: number;
  timestamp_ms: number;
  payload: string;
}

export interface HelperBridgeHello {
  type: 'hello';
  version: number;
  features: string[];
  http_port?: number;
  ws_port?: number;
}

export interface HelperBridgeOptions {
  host?: string;
  httpPort?: number;
  wsPort?: number;
  token?: string;
  reconnectDelayMs?: number;
  autoStart?: boolean;
  protocol?: 'ws' | 'wss';
  autoReconnect?: boolean;
}

export interface HelperBridgeState {
  phase: 'idle' | 'connecting' | 'connected' | 'not_found' | 'error' | 'closed';
  host: string;
  httpPort: number;
  wsPort: number;
  lastError?: string;
  reconnectAttempt: number;
  lastHello?: HelperBridgeHello;
  latestOverlayState?: OverlayState;
  lastOverlayAt?: number;
  lastEventId?: number;
  droppedEvents?: number;
  lastPingAt?: number;
}

type Listener = (state: HelperBridgeState) => void;

const DEFAULT_HTTP_PORT = 38765;
const DEFAULT_WS_OFFSET = 1;

function cloneState(state: HelperBridgeState): HelperBridgeState {
  return { ...state };
}

export interface HelperBridge {
  readonly state: HelperBridgeState;
  connect(): void;
  disconnect(): void;
  subscribe(listener: Listener): () => void;
  isConnected(): boolean;
}

export function createHelperBridge(options: HelperBridgeOptions = {}): HelperBridge {
  const host = options.host ?? '127.0.0.1';
  let httpPort = options.httpPort ?? DEFAULT_HTTP_PORT;
  let wsPort = options.wsPort ?? (httpPort + DEFAULT_WS_OFFSET);
  const reconnectDelay = Math.max(500, options.reconnectDelayMs ?? 2500);
  const autoReconnect = options.autoReconnect ?? false;
  const hasWindow = typeof window !== 'undefined';
  const protocol = options.protocol ?? (hasWindow && typeof window.location !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws');

  const listeners = new Set<Listener>();
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let requestedClose = false;
  let lastEventSince = 0;

  const state: HelperBridgeState = {
    phase: 'idle',
    host,
    httpPort,
    wsPort,
    reconnectAttempt: 0,
  };

  function notify() {
    const snapshot = cloneState(state);
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[helper-bridge] listener error', error);
      }
    });
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(reason?: string) {
    if (requestedClose) {
      return;
    }
    if (!autoReconnect) {
      state.phase = 'not_found';
      state.lastError = reason ?? state.lastError ?? 'Helper not detected';
      state.reconnectAttempt += 1;
      notify();
      return;
    }
    if (reconnectTimer) {
      return;
    }
    state.phase = 'error';
    state.lastError = reason ?? state.lastError ?? 'Helper connection lost';
    state.reconnectAttempt += 1;
    notify();

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
  }

  function handleMessage(data: unknown) {
    if (!data || typeof data !== 'object') {
      return;
    }
    const message = data as Record<string, unknown>;
    const type = message.type;

    switch (type) {
      case 'hello': {
        const hello: HelperBridgeHello = {
          type: 'hello',
          version: Number(message.version ?? 0),
          features: Array.isArray(message.features) ? (message.features as string[]) : [],
          http_port: typeof message.http_port === 'number' ? message.http_port : undefined,
          ws_port: typeof message.ws_port === 'number' ? message.ws_port : undefined,
        };
        state.lastHello = hello;
        if (hello.http_port && hello.http_port !== state.httpPort) {
          state.httpPort = hello.http_port;
          httpPort = hello.http_port;
        }
        if (hello.ws_port && hello.ws_port !== state.wsPort) {
          state.wsPort = hello.ws_port;
          wsPort = hello.ws_port;
        }
        notify();
        break;
      }
      case 'overlay_state': {
        const payload = message.state as OverlayState;
        if (payload) {
          state.latestOverlayState = payload;
          state.lastOverlayAt = Date.now();
          notify();
        }
        break;
      }
      case 'overlay_events': {
        const events = Array.isArray(message.events) ? (message.events as OverlayEventRecord[]) : [];
        if (events.length) {
          const last = events[events.length - 1];
          if (typeof last.id === 'number') {
            lastEventSince = last.id;
            state.lastEventId = last.id;
          }
        }
        if (typeof message.next_since === 'number') {
          lastEventSince = Math.max(lastEventSince, message.next_since as number);
          state.lastEventId = lastEventSince;
        }
        if (typeof message.dropped === 'number') {
          state.droppedEvents = message.dropped as number;
        }
        notify();
        break;
      }
      case 'ping': {
        state.lastPingAt = Date.now();
        notify();
        break;
      }
      case 'error': {
        if (typeof message.message === 'string') {
          state.lastError = message.message as string;
          notify();
        }
        break;
      }
      default: {
        console.debug('[helper-bridge] unhandled message', message);
        break;
      }
    }
  }

  function connect() {
    if (socket) {
      return;
    }

    clearReconnectTimer();

    requestedClose = false;
    state.phase = 'connecting';
    state.lastError = undefined;
    if (!autoReconnect) {
      state.reconnectAttempt = 0;
    }
    notify();

    const query = new URLSearchParams();
    if (lastEventSince > 0) {
      query.set('since', String(lastEventSince));
    }
    if (options.token) {
      query.set('token', options.token);
    }

    if (typeof WebSocket === 'undefined') {
      state.lastError = 'WebSocket unavailable in this environment';
      state.phase = 'error';
      notify();
      return;
    }

    const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    const url = `${protocol}://${hostPart}:${wsPort}/overlay/stream${query.toString() ? `?${query.toString()}` : ''}`;

    try {
      socket = new WebSocket(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Helper not detected';
      state.lastError = message;
      scheduleReconnect('Helper not detected');
      return;
    }

    socket.onopen = () => {
      state.phase = 'connected';
      state.reconnectAttempt = 0;
      state.lastError = undefined;
      notify();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        handleMessage(payload);
      } catch (error) {
        console.warn('[helper-bridge] failed to parse message', error);
      }
    };

    socket.onerror = () => {
      state.lastError = 'WebSocket error';
    };

    socket.onclose = (event) => {
      socket = null;
      if (requestedClose) {
        state.phase = 'closed';
        notify();
        return;
      }
      const closeReason = event?.reason || (event && typeof event.code === 'number' && event.code === 1006
        ? 'Helper not detected'
        : undefined);
      if (!autoReconnect) {
        state.phase = 'not_found';
        state.lastError = closeReason ?? state.lastError ?? 'Helper not detected';
        notify();
        return;
      }
      state.phase = 'error';
      state.lastError = closeReason ?? state.lastError ?? 'Helper connection closed';
      notify();
      scheduleReconnect(state.lastError);
    };
  }

  function disconnect() {
    requestedClose = true;
    clearReconnectTimer();
    if (socket) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      socket = null;
    }
    state.phase = 'closed';
    notify();
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    listener(cloneState(state));
    return () => listeners.delete(listener);
  }

  if (options.autoStart !== false) {
    setTimeout(connect, 20);
  }

  const bridge: HelperBridge = {
    get state() {
      return cloneState(state);
    },
    connect,
    disconnect,
    subscribe,
    isConnected() {
      return state.phase === 'connected';
    },
  };

  if (hasWindow) {
    try {
      (window as unknown as Record<string, unknown>).__efHelperBridge = bridge;
    } catch {
      /* ignore */
    }
  }

  return bridge;
}
