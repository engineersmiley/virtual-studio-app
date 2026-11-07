export type PollingTransportState = 'connecting' | 'open' | 'closed';

export interface PollingTransportEvents {
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: (event: Event) => void;
  onclose?: (event: { code: number; reason: string }) => void;
}

export class PollingTransport implements PollingTransportEvents {
  public onopen?: () => void;
  public onmessage?: (event: { data: string }) => void;
  public onerror?: (event: Event) => void;
  public onclose?: (event: { code: number; reason: string }) => void;
  
  private _readyState: number = 0; // 0=CONNECTING, 1=OPEN, 3=CLOSED
  private roomId: string | null = null;
  private userId: string | null = null;
  private role: string | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private closed = false;
  private joinRetry: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Set<AbortController>();

  private async post(path: string, body: unknown) {
    const controller = new AbortController();
    this.pendingRequests.add(controller);
    const deadline = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json();
      return { response, data };
    } finally {
      clearTimeout(deadline);
      this.pendingRequests.delete(controller);
    }
  }
  
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  
  get readyState(): number {
    return this._readyState;
  }
  
  constructor() {
    console.log('[Polling] Transport created');
  }
  
  async send(data: string): Promise<void> {
    if (this._readyState !== PollingTransport.OPEN) {
      console.error('[Polling] Cannot send - not connected');
      return;
    }
    
    try {
      const message = JSON.parse(data);
      
      if (message.type === 'join') {
        await this.handleJoin(message);
      } else if (message.type === 'leave') {
        await this.handleLeave();
      } else {
        await this.sendSignal(message);
      }
    } catch (err) {
      console.error('[Polling] Send error:', err);
    }
  }
  
  private async handleJoin(message: any): Promise<void> {
    if (this.closed) return;
    if (this.joinRetry) clearTimeout(this.joinRetry);
    this.joinRetry = null;
    this.roomId = message.roomId;
    this.userId = message.userId;
    this.role = message.role;
    
    try {
      const { response: res, data } = await this.post('/api/signal/join', {
          roomId: this.roomId,
          userId: this.userId,
          role: this.role
      });
      if (this.closed) return;
      
      if (!res.ok) {
        throw new Error(`Join failed: ${res.status}`);
      }
      
      console.log('[Polling] Joined room:', data.roomId);
      
      // Send room-state message with existing participants
      if (this.onmessage) {
        this.onmessage({
          data: JSON.stringify({
            type: 'room-state',
            roomId: data.roomId,
            participants: data.participants || []
          })
        });
      }
      
      // Start polling for messages
      this.startPolling();
    } catch (err: any) {
      if (this.closed) return;
      console.error('[Polling] Join error:', err);
      this.triggerError(err);
      this.joinRetry = setTimeout(() => {
        this.joinRetry = null;
        void this.handleJoin(message);
      }, 2000);
    }
  }
  
  private async handleLeave(): Promise<void> {
    this.stopPolling();
    
    if (!this.roomId || !this.userId) return;
    
    try {
      await fetch('/api/signal/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          userId: this.userId
        })
      });
      console.log('[Polling] Left room');
    } catch (err) {
      console.error('[Polling] Leave error:', err);
    }
  }
  
  // Control message types that need special handling
  private static controlMessageTypes = new Set([
    'control-request', 'mouse-move', 'mouse-click', 'mouse-double-click',
    'mouse-scroll', 'key-press', 'key-type', 'control-end'
  ]);
  
  private async sendSignal(message: any): Promise<void> {
    if (!this.roomId || !this.userId) return;
    
    try {
      // For control messages, send the entire message as payload so server can extract all fields
      const isControlMessage = PollingTransport.controlMessageTypes.has(message.type);
      
      await fetch('/api/signal/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          userId: this.userId,
          role: this.role,
          type: message.type,
          payload: isControlMessage ? message : message.payload
        })
      });
      
      if (isControlMessage && message.type !== 'mouse-move') {
        console.log('[Polling] Sent control command:', message.type);
      }
    } catch (err) {
      console.error('[Polling] Send signal error:', err);
    }
  }
  
  private startPolling(): void {
    if (this.pollInterval) return;
    
    console.log('[Polling] Starting poll loop');
    this.pollInterval = setInterval(() => this.poll(), 500);
    this.poll(); // Initial poll
  }
  
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
  }
  
  private async poll(): Promise<void> {
    if (this.isPolling || this.closed || !this.roomId || !this.userId) return;
    
    this.isPolling = true;
    
    try {
      const { response: res, data } = await this.post('/api/signal/poll', {
          roomId: this.roomId,
          userId: this.userId
      });
      if (this.closed) return;
      
      if (!res.ok) {
        if (res.status === 404) {
          // A stale transport lease is not an expired collaboration session.
          // Rejoin the same room; capture/consent are revalidated by the server.
          console.log('[Polling] Membership lost, rejoining the same room');
          this.onmessage?.({ data: JSON.stringify({
            type: 'agent-status', connected: false, controlActive: false,
          }) });
          await this.handleJoin({ roomId: this.roomId, userId: this.userId, role: this.role });
          return;
        }
        throw new Error(`Poll failed: ${res.status}`);
      }
      
      
      // Emit agent status as a synthetic message so frontend can track it
      if (this.onmessage) {
        this.onmessage({ 
          data: JSON.stringify({ 
            type: 'agent-status', 
            connected: data.agentConnected || false,
            controlActive: data.controlActive || false,
            controlMode: data.controlMode || null,
          }) 
        });
      }
      
      // Deliver messages
      for (const message of data.messages || []) {
        if (this.onmessage) {
          this.onmessage({ data: JSON.stringify(message) });
        }
      }
    } catch (err: any) {
      console.error('[Polling] Poll error:', err);
    } finally {
      this.isPolling = false;
    }
  }
  
  connect(): void {
    console.log('[Polling] Connecting via HTTP polling fallback');
    this._readyState = PollingTransport.CONNECTING;
    
    setTimeout(() => {
      if (!this.closed) {
        this._readyState = PollingTransport.OPEN;
        console.log('[Polling] Connected successfully');
        this.onopen?.();
      }
    }, 100);
  }
  
  close(code: number = 1000, reason: string = ''): void {
    if (this.closed) return;
    
    console.log('[Polling] Closing:', code, reason);
    this.closed = true;
    if (this.joinRetry) clearTimeout(this.joinRetry);
    this.joinRetry = null;
    this.pendingRequests.forEach(controller => controller.abort());
    this.stopPolling();
    this.handleLeave();
    this._readyState = PollingTransport.CLOSED;
    this.onclose?.({ code, reason });
  }
  
  private triggerError(err: Error): void {
    const event = new ErrorEvent('error', { error: err, message: err.message });
    this.onerror?.(event);
  }
}
