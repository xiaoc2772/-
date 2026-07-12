"use client";

import { useEffect } from "react";

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type CompatWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: (deadline: IdleDeadlineLike) => void,
      options?: { timeout?: number }
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

type WritableAbortSignal = {
  aborted: boolean;
  reason?: unknown;
  onabort: ((this: AbortSignal, ev: Event) => unknown) | null;
  addEventListener: EventTarget["addEventListener"];
  removeEventListener: EventTarget["removeEventListener"];
  dispatchEvent: EventTarget["dispatchEvent"];
  throwIfAborted: () => void;
};

function installRequestIdleCallback(win: CompatWindow) {
  if (typeof win.requestIdleCallback === "function") return;

  win.requestIdleCallback = (callback, options) => {
    const start = Date.now();
    const timeout = Math.max(1, options?.timeout ?? 1);

    return win.setTimeout(() => {
      callback({
        didTimeout: Date.now() - start >= timeout,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      });
    }, timeout);
  };

  win.cancelIdleCallback = (handle) => win.clearTimeout(handle);
}

function installQueueMicrotask(win: Window & typeof globalThis) {
  if (typeof win.queueMicrotask === "function") return;

  win.queueMicrotask = (callback) => {
    Promise.resolve()
      .then(callback)
      .catch((error) => {
        win.setTimeout(() => {
          throw error;
        }, 0);
      });
  };
}

function installCssEscape(win: Window & typeof globalThis) {
  if (!win.CSS) return;

  const css = win.CSS as typeof win.CSS & { escape?: (value: string) => string };
  if (typeof css.escape === "function") return;

  css.escape = (value: string) =>
    value.replace(/[\0-\x1F\x7F]|^-?\d|^-$|[^\w-]/g, (character, offset) => {
      if (character === "\0") return "\uFFFD";
      const shouldEscapeAsCodePoint =
        character.length === 1 &&
        (character.charCodeAt(0) < 0x20 ||
          character.charCodeAt(0) === 0x7f ||
          (offset === 0 && /[-\d]/.test(character)));

      if (shouldEscapeAsCodePoint) {
        return `\\${character.charCodeAt(0).toString(16)} `;
      }

      return `\\${character}`;
    });
}

function installRandomUUID(win: Window & typeof globalThis) {
  const crypto = win.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (!crypto || typeof crypto.randomUUID === "function") return;

  crypto.randomUUID = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  };
}

function installAbortController(win: Window & typeof globalThis) {
  if (typeof win.AbortController === "function") return;

  class CompatAbortController {
    private readonly writableSignal: WritableAbortSignal;

    readonly signal: AbortSignal;

    constructor() {
      const target = document.createDocumentFragment();
      const writableSignal: WritableAbortSignal = {
        aborted: false,
        reason: undefined,
        onabort: null,
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatchEvent: target.dispatchEvent.bind(target),
        throwIfAborted: () => {
          if (!writableSignal.aborted) return;
          throw writableSignal.reason ?? new Error("AbortError");
        },
      };

      this.writableSignal = writableSignal;
      this.signal = writableSignal as AbortSignal;
    }

    abort(reason?: unknown) {
      if (this.writableSignal.aborted) return;

      this.writableSignal.aborted = true;
      this.writableSignal.reason = reason ?? new Error("AbortError");

      const event =
        typeof Event === "function"
          ? new Event("abort")
          : document.createEvent("Event");

      if (!("type" in event) || event.type !== "abort") {
        event.initEvent("abort", false, false);
      }

      this.writableSignal.onabort?.call(this.signal, event);
      this.writableSignal.dispatchEvent(event);
    }
  }

  win.AbortController = CompatAbortController as typeof AbortController;
}

function installResizeObserver(win: Window & typeof globalThis) {
  if (typeof win.ResizeObserver === "function") return;

  class CompatResizeObserver {
    private readonly callback: ResizeObserverCallback;
    private readonly elements = new Set<Element>();
    private rafId: number | null = null;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe = (target: Element) => {
      this.elements.add(target);
      win.addEventListener("resize", this.schedule, { passive: true });
      this.schedule();
    };

    unobserve = (target: Element) => {
      this.elements.delete(target);
      if (this.elements.size === 0) {
        win.removeEventListener("resize", this.schedule);
      }
    };

    disconnect = () => {
      this.elements.clear();
      win.removeEventListener("resize", this.schedule);
      if (this.rafId !== null) {
        win.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    };

    private schedule = () => {
      if (this.rafId !== null) return;
      this.rafId = win.requestAnimationFrame(() => {
        this.rafId = null;
        this.flush();
      });
    };

    private flush() {
      if (this.elements.size === 0) return;

      const entries = Array.from(this.elements).map((target) => ({
        target,
        contentRect: target.getBoundingClientRect(),
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      })) as ResizeObserverEntry[];

      this.callback(entries, this as unknown as ResizeObserver);
    }
  }

  win.ResizeObserver = CompatResizeObserver as unknown as typeof ResizeObserver;
}

function supportsCss(query: string) {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports(query);
}

function setRootClass(name: string, enabled: boolean) {
  document.documentElement.classList.toggle(name, enabled);
}

function detectBrowserFeatures() {
  const root = document.documentElement;
  const ua = navigator.userAgent.toLowerCase();
  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = ua.includes("android");
  const isTouch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  const isWebView =
    ua.includes("; wv") ||
    ua.includes("micromessenger") ||
    ua.includes("qqbrowser") ||
    ua.includes("miuibrowser") ||
    ua.includes("huawei") ||
    ua.includes("honor") ||
    ua.includes("heytap") ||
    ua.includes("vivobrowser");

  root.classList.add("compat-js");
  setRootClass("compat-ios", isIOS);
  setRootClass("compat-android", isAndroid);
  setRootClass("compat-touch", isTouch);
  setRootClass("compat-mobile", isIOS || isAndroid || isTouch);
  setRootClass("compat-webview", isWebView);
  setRootClass("compat-no-dvh", !supportsCss("height: 100dvh"));
  setRootClass(
    "compat-no-backdrop-filter",
    !supportsCss("(backdrop-filter: blur(1px))") &&
      !supportsCss("(-webkit-backdrop-filter: blur(1px))")
  );
  setRootClass("compat-no-touch-action", !supportsCss("touch-action: manipulation"));
  setRootClass("compat-no-overflow-clip", !supportsCss("overflow: clip"));
  setRootClass("compat-no-resize-observer", typeof ResizeObserver !== "function");
  setRootClass("compat-no-intersection-observer", typeof IntersectionObserver !== "function");
  setRootClass("compat-no-abort-controller", typeof AbortController !== "function");

  try {
    const storageKey = "__lucky_compat_storage__";
    localStorage.setItem(storageKey, "1");
    localStorage.removeItem(storageKey);
    setRootClass("compat-no-storage", false);
  } catch {
    setRootClass("compat-no-storage", true);
  }
}

function updateViewportVars() {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const width = viewport?.width ?? window.innerWidth;
  const rootStyle = document.documentElement.style;

  rootStyle.setProperty("--app-vh", `${height * 0.01}px`);
  rootStyle.setProperty("--app-vw", `${width * 0.01}px`);
  rootStyle.setProperty("--app-visual-height", `${height}px`);
  rootStyle.setProperty("--app-visual-width", `${width}px`);

  setRootClass("compat-keyboard-open", Boolean(viewport && height < window.innerHeight * 0.78));
}

function detectWebpSupport() {
  const image = new Image();
  image.onload = () => setRootClass("compat-webp", image.width === 1);
  image.onerror = () => setRootClass("compat-no-webp", true);
  image.src =
    "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
}

export default function BrowserCompatibility() {
  useEffect(() => {
    const win = window as CompatWindow;

    installRequestIdleCallback(win);
    installQueueMicrotask(win);
    installCssEscape(win);
    installRandomUUID(win);
    installAbortController(win);
    installResizeObserver(win);
    detectBrowserFeatures();
    updateViewportVars();
    detectWebpSupport();

    const viewport = window.visualViewport;
    let viewportFrame: number | null = null;
    const onViewportChange = () => {
      if (viewportFrame !== null) return;
      viewportFrame = window.requestAnimationFrame(() => {
        viewportFrame = null;
        updateViewportVars();
      });
    };

    window.addEventListener("resize", onViewportChange, { passive: true });
    window.addEventListener("orientationchange", onViewportChange, { passive: true });
    viewport?.addEventListener("resize", onViewportChange, { passive: true });
    viewport?.addEventListener("scroll", onViewportChange, { passive: true });

    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
      if (viewportFrame !== null) {
        window.cancelAnimationFrame(viewportFrame);
      }
    };
  }, []);

  return null;
}
