import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Smartphone, 
  MousePointer, 
  Keyboard, 
  X, 
  Command, 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight,
  CornerDownLeft,
  Delete,
  Space,
  ChevronUp,
  ChevronDown
} from "lucide-react";

interface PhoneControlProps {
  sessionCode: string;
  isConnected: boolean;
  agentConnected: boolean;
  controlEnabled: boolean;
  onSendControl: (message: any) => void;
  onRequestControl: () => void;
  onEndControl: () => void;
  screenWidth?: number;
  screenHeight?: number;
}

export function PhoneControl({
  sessionCode,
  isConnected,
  agentConnected,
  controlEnabled,
  onSendControl,
  onRequestControl,
  onEndControl,
  screenWidth = 1920,
  screenHeight = 1080
}: PhoneControlProps) {
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [modifiers, setModifiers] = useState({ ctrl: false, alt: false, shift: false, cmd: false });
  const [mousePosition, setMousePosition] = useState({ x: screenWidth / 2, y: screenHeight / 2 });
  const touchPadRef = useRef<HTMLDivElement>(null);
  const lastTouchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const sensitivity = 2;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!controlEnabled) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, [controlEnabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!controlEnabled || !lastTouchRef.current) return;
    e.preventDefault();
    
    const touch = e.touches[0];
    const deltaX = (touch.clientX - lastTouchRef.current.x) * sensitivity;
    const deltaY = (touch.clientY - lastTouchRef.current.y) * sensitivity;
    
    const newX = Math.max(0, Math.min(screenWidth, mousePosition.x + deltaX));
    const newY = Math.max(0, Math.min(screenHeight, mousePosition.y + deltaY));
    
    setMousePosition({ x: newX, y: newY });
    
    onSendControl({
      type: 'mouse-move',
      x: newX,
      y: newY
    });
    
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, [controlEnabled, mousePosition, screenWidth, screenHeight, onSendControl, sensitivity]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!controlEnabled || !touchStartRef.current) return;
    
    const touchDuration = Date.now() - touchStartRef.current.time;
    const touch = e.changedTouches[0];
    const moveDistance = Math.sqrt(
      Math.pow(touch.clientX - touchStartRef.current.x, 2) +
      Math.pow(touch.clientY - touchStartRef.current.y, 2)
    );
    
    if (moveDistance < 10 && touchDuration < 300) {
      onSendControl({ type: 'mouse-click', button: 'left' });
    }
    
    touchStartRef.current = null;
    lastTouchRef.current = null;
  }, [controlEnabled, onSendControl]);

  const handleLongPress = useCallback(() => {
    if (!controlEnabled) return;
    onSendControl({ type: 'mouse-click', button: 'right' });
  }, [controlEnabled, onSendControl]);

  const handleScroll = useCallback((direction: 'up' | 'down') => {
    if (!controlEnabled) return;
    onSendControl({ type: 'mouse-scroll', deltaY: direction === 'up' ? -3 : 3 });
  }, [controlEnabled, onSendControl]);

  const handleClick = useCallback((button: 'left' | 'right') => {
    if (!controlEnabled) return;
    onSendControl({ type: 'mouse-click', button });
  }, [controlEnabled, onSendControl]);

  const handleDoubleClick = useCallback(() => {
    if (!controlEnabled) return;
    onSendControl({ type: 'mouse-double-click' });
  }, [controlEnabled, onSendControl]);

  const handleKeyPress = useCallback((key: string) => {
    if (!controlEnabled) return;
    onSendControl({ type: 'key-press', key });
  }, [controlEnabled, onSendControl]);

  const handleTypeText = useCallback(() => {
    if (!controlEnabled || !textInput) return;
    onSendControl({ type: 'key-type', text: textInput });
    setTextInput("");
  }, [controlEnabled, textInput, onSendControl]);

  const handleShortcut = useCallback((keys: string[]) => {
    if (!controlEnabled) return;
    keys.forEach((key, index) => {
      setTimeout(() => {
        onSendControl({ type: 'key-press', key });
      }, index * 50);
    });
  }, [controlEnabled, onSendControl]);

  const toggleModifier = useCallback((mod: 'ctrl' | 'alt' | 'shift' | 'cmd') => {
    setModifiers(prev => ({ ...prev, [mod]: !prev[mod] }));
  }, []);

  if (!isConnected) {
    return (
      <Card className="border-muted">
        <CardContent className="p-6 text-center text-muted-foreground">
          <Smartphone className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Join a session to use phone control</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`${agentConnected ? 'border-primary/30' : 'border-muted'}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-lg">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-primary" />
            Phone Control
          </div>
          {controlEnabled ? (
            <Button size="sm" variant="destructive" onClick={onEndControl} data-testid="button-end-control">
              <X className="w-4 h-4 mr-1" />
              End Control
            </Button>
          ) : (
            <Button 
              size="sm" 
              onClick={onRequestControl} 
              data-testid="button-request-control"
              className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 text-white border-0"
            >
              Request Control
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!agentConnected && (
          <div className="py-3 px-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-sm mb-2">
            <p className="font-bold mb-2">Setup Required:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Artist opens <a href="/remote-control" target="_blank" className="text-primary underline">this link</a> on their COMPUTER</li>
              <li>Artist downloads and runs the Desktop Agent app</li>
              <li>Artist enters room code: <span className="font-mono text-primary">{sessionCode}</span></li>
              <li>Then you can request control from here!</li>
            </ol>
            <p className="text-xs mt-2 text-muted-foreground">You control from your phone. Artist runs app on their computer.</p>
          </div>
        )}
        {!controlEnabled ? (
          <div className="text-center py-6 text-muted-foreground">
            <MousePointer className="w-10 h-10 mx-auto mb-3 opacity-50" />
            {agentConnected ? (
              <>
                <p className="font-semibold text-primary">Agent Connected!</p>
                <p className="text-xs mt-1">Click "Request Control" above - artist will see a popup to allow you</p>
              </>
            ) : (
              <>
                <p>Waiting for artist to connect Desktop Agent</p>
                <p className="text-xs mt-1">See setup steps above</p>
              </>
            )}
          </div>
        ) : (
          <>
            <div 
              ref={touchPadRef}
              className="relative bg-muted/50 rounded-lg border-2 border-dashed border-primary/30 touch-none select-none"
              style={{ height: '200px' }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              data-testid="touchpad-area"
            >
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none">
                <div className="text-center">
                  <MousePointer className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Swipe to move mouse</p>
                  <p className="text-xs">Tap to click</p>
                </div>
              </div>
              <Badge className="absolute bottom-2 right-2 text-xs" variant="outline">
                {Math.round(mousePosition.x)}, {Math.round(mousePosition.y)}
              </Badge>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => handleClick('left')}
                data-testid="button-left-click"
              >
                Left Click
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => handleClick('right')}
                data-testid="button-right-click"
              >
                Right Click
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={handleDoubleClick}
                data-testid="button-double-click"
              >
                Double
              </Button>
              <div className="flex gap-1">
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => handleScroll('up')}
                  data-testid="button-scroll-up"
                >
                  <ChevronUp className="w-4 h-4" />
                </Button>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => handleScroll('down')}
                  data-testid="button-scroll-down"
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant={showKeyboard ? "default" : "outline"}
                onClick={() => setShowKeyboard(!showKeyboard)}
                data-testid="button-toggle-keyboard"
              >
                <Keyboard className="w-4 h-4 mr-1" />
                Keyboard
              </Button>
            </div>

            {showKeyboard && (
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div className="flex gap-2">
                  <Input
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Type text to send..."
                    className="flex-1"
                    data-testid="input-text"
                  />
                  <Button size="sm" onClick={handleTypeText} data-testid="button-send-text">
                    Send
                  </Button>
                </div>

                <div className="flex flex-wrap gap-1">
                  <Button 
                    size="sm" 
                    variant={modifiers.ctrl ? "default" : "outline"}
                    onClick={() => toggleModifier('ctrl')}
                    className="text-xs"
                    data-testid="button-ctrl"
                  >
                    Ctrl
                  </Button>
                  <Button 
                    size="sm" 
                    variant={modifiers.alt ? "default" : "outline"}
                    onClick={() => toggleModifier('alt')}
                    className="text-xs"
                    data-testid="button-alt"
                  >
                    Alt
                  </Button>
                  <Button 
                    size="sm" 
                    variant={modifiers.shift ? "default" : "outline"}
                    onClick={() => toggleModifier('shift')}
                    className="text-xs"
                    data-testid="button-shift"
                  >
                    Shift
                  </Button>
                  <Button 
                    size="sm" 
                    variant={modifiers.cmd ? "default" : "outline"}
                    onClick={() => toggleModifier('cmd')}
                    className="text-xs"
                    data-testid="button-cmd"
                  >
                    <Command className="w-3 h-3 mr-1" />
                    Cmd
                  </Button>
                </div>

                <div className="grid grid-cols-4 gap-1">
                  <Button size="sm" variant="outline" onClick={() => handleKeyPress('Escape')} className="text-xs">
                    Esc
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleKeyPress('Tab')} className="text-xs">
                    Tab
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleKeyPress('Backspace')} className="text-xs">
                    <Delete className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleKeyPress('Enter')} className="text-xs">
                    <CornerDownLeft className="w-3 h-3" />
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-1">
                  <div></div>
                  <Button size="sm" variant="outline" onClick={() => handleKeyPress('ArrowUp')}>
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <div></div>
                  <Button size="sm" variant="outline" onClick={() => handleKeyPress('ArrowLeft')}>
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleKeyPress('ArrowDown')}>
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleKeyPress('ArrowRight')}>
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>

                <Button 
                  size="sm" 
                  variant="outline" 
                  className="w-full"
                  onClick={() => handleKeyPress('Space')}
                >
                  <Space className="w-4 h-4 mr-2" />
                  Space
                </Button>

                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-2">Common Shortcuts:</p>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleShortcut(['Meta', 'c'])} className="text-xs">
                      Copy
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleShortcut(['Meta', 'v'])} className="text-xs">
                      Paste
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleShortcut(['Meta', 'z'])} className="text-xs">
                      Undo
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleShortcut(['Meta', 's'])} className="text-xs">
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleShortcut(['Meta', 'a'])} className="text-xs">
                      Select All
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
