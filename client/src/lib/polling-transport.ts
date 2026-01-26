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
    this.roomId = message.roomId;
    this.userId = message.userId;
    this.role = message.role;
    
    try {
      const res = await fetch('/api/signal/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          userId: this.userId,
          role: this.role
        })
      });
      
      if (!res.ok) {
        throw new Error(`Join failed: ${res.status}`);
      }
      
      const data = await res.json();
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
      console.error('[Polling] Join error:', err);
      this.triggerError(err);
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
      const res = await fetch('/api/signal/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          userId: this.userId
        })
      });
      
      if (!res.ok) {
        if (res.status === 404) {
          console.log('[Polling] Room not found, closing');
          this.close(1000, 'Room closed');
          return;
        }
        throw new Error(`Poll failed: ${res.status}`);
      }
      
      const data = await res.json();
      
      // Emit agent status as a synthetic message so frontend can track it
      if (this.onmessage) {
        this.onmessage({ 
          data: JSON.stringify({ 
            type: 'agent-status', 
            connected: data.agentConnected || false,
            controlActive: data.controlActive || false
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
