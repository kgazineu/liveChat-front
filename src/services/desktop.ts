export function desktopBridge() {
  return typeof window === 'undefined' ? undefined : window.liveChatDesktop;
}

export function updateDesktopCallState(active: boolean, title?: string) {
  const bridge = desktopBridge();
  if (!bridge) return;
  void bridge.call.setState({ active, ...(title ? { title } : {}) }).catch(() => undefined);
}

export function subscribeDesktopCallOpen(listener: () => void) {
  return desktopBridge()?.call.onOpen(listener) ?? (() => undefined);
}

export function subscribeDesktopUpdateReady(listener: (version: string) => void) {
  return desktopBridge()?.updater.onReady(listener) ?? (() => undefined);
}

export function installDesktopUpdate() {
  return desktopBridge()?.updater.install() ?? Promise.resolve();
}

export function showDesktopNotification(notification: {
  title: string;
  body: string;
  kind: 'message' | 'call';
}) {
  const bridge = desktopBridge();
  if (!bridge) return;
  void bridge.notifications.show(notification).catch(() => undefined);
}
