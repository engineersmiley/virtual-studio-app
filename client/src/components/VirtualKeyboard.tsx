import { useState } from 'react';
import { X, ArrowUp, Delete, CornerDownLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VirtualKeyboardProps {
  onKeyPress: (key: string, modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean; cmd?: boolean }) => void;
  onType: (text: string) => void;
  onClose: () => void;
}

export function VirtualKeyboard({ onKeyPress, onType, onClose }: VirtualKeyboardProps) {
  const [shift, setShift] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  
  // For letters: shift XOR capsLock determines case
  // For symbols/numbers: only shift matters
  const isLetterUpperCase = shift !== capsLock;
  
  const handleKey = (key: string) => {
    if (key === 'Shift') {
      setShift(!shift);
      return;
    }
    if (key === 'CapsLock') {
      setCapsLock(!capsLock);
      return;
    }
    if (key === 'Backspace' || key === 'Tab' || key === 'Enter' || key === 'Escape') {
      onKeyPress(key, { shift });
      if (shift) setShift(false);
      return;
    }
    
    // Check if it's a letter (a-z)
    const isLetter = /^[a-zA-Z]$/.test(key);
    const char = isLetter 
      ? (isLetterUpperCase ? key.toUpperCase() : key.toLowerCase())
      : key; // Symbols/numbers are sent as-is (already processed for shift)
    onType(char);
    if (shift) setShift(false);
  };
  
  const handleSpecialKey = (key: string, display: string) => {
    onKeyPress(key, { shift });
    if (shift) setShift(false);
  };

  const keyClass = "min-h-[36px] sm:min-h-[40px] px-1.5 sm:px-2 text-xs sm:text-sm font-medium rounded border transition-colors flex items-center justify-center";
  const normalKey = `${keyClass} bg-background/80 border-border hover:bg-muted`;
  const activeKey = `${keyClass} bg-primary/20 border-primary text-primary`;
  const specialKey = `${keyClass} bg-muted/50 border-border hover:bg-muted text-muted-foreground`;
  
  const mainKeys = [
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
  ];
  
  const shiftSymbols: Record<string, string> = {
    '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+',
    '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?'
  };

  return (
    <div className="w-full bg-card/95 backdrop-blur-sm border border-border rounded-lg p-2 sm:p-3 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">Virtual Keyboard</span>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6" data-testid="button-close-virtual-keyboard">
          <X size={14} />
        </Button>
      </div>
      
      <div className="flex gap-2 sm:gap-3">
        {/* Main Keyboard */}
        <div className="flex-1 flex flex-col gap-1">
          {/* Number Row */}
          <div className="flex gap-0.5 sm:gap-1">
            {mainKeys[0].map((key) => (
              <button
                key={key}
                onClick={() => handleKey(shift && shiftSymbols[key] ? shiftSymbols[key] : key)}
                className={`${normalKey} flex-1`}
                data-testid={`key-${key}`}
              >
                {shift && shiftSymbols[key] ? shiftSymbols[key] : key}
              </button>
            ))}
            <button
              onClick={() => handleSpecialKey('Backspace', '⌫')}
              className={`${specialKey} flex-[1.5]`}
              data-testid="key-backspace"
            >
              <Delete size={14} />
            </button>
          </div>
          
          {/* Tab + QWERTY Row */}
          <div className="flex gap-0.5 sm:gap-1">
            <button
              onClick={() => handleSpecialKey('Tab', 'Tab')}
              className={`${specialKey} flex-[1.2]`}
              data-testid="key-tab"
            >
              Tab
            </button>
            {mainKeys[1].map((key) => {
              const isLetter = /^[a-z]$/.test(key);
              const displayKey = isLetter 
                ? (isLetterUpperCase ? key.toUpperCase() : key)
                : (shift && shiftSymbols[key] ? shiftSymbols[key] : key);
              return (
                <button
                  key={key}
                  onClick={() => handleKey(displayKey)}
                  className={`${normalKey} flex-1`}
                  data-testid={`key-${key}`}
                >
                  {displayKey}
                </button>
              );
            })}
          </div>
          
          {/* Caps + ASDF Row */}
          <div className="flex gap-0.5 sm:gap-1">
            <button
              onClick={() => handleKey('CapsLock')}
              className={`${capsLock ? activeKey : specialKey} flex-[1.5]`}
              data-testid="key-capslock"
            >
              Caps
            </button>
            {mainKeys[2].map((key) => {
              const isLetter = /^[a-z]$/.test(key);
              const displayKey = isLetter 
                ? (isLetterUpperCase ? key.toUpperCase() : key)
                : (shift && shiftSymbols[key] ? shiftSymbols[key] : key);
              return (
                <button
                  key={key}
                  onClick={() => handleKey(displayKey)}
                  className={`${normalKey} flex-1`}
                  data-testid={`key-${key}`}
                >
                  {displayKey}
                </button>
              );
            })}
            <button
              onClick={() => handleSpecialKey('Enter', '↵')}
              className={`${specialKey} flex-[1.8]`}
              data-testid="key-enter"
            >
              <CornerDownLeft size={14} />
            </button>
          </div>
          
          {/* Shift + ZXCV Row */}
          <div className="flex gap-0.5 sm:gap-1">
            <button
              onClick={() => handleKey('Shift')}
              className={`${shift ? activeKey : specialKey} flex-[2]`}
              data-testid="key-shift"
            >
              <ArrowUp size={14} />
            </button>
            {mainKeys[3].map((key) => {
              const isLetter = /^[a-z]$/.test(key);
              const displayKey = isLetter 
                ? (isLetterUpperCase ? key.toUpperCase() : key)
                : (shift && shiftSymbols[key] ? shiftSymbols[key] : key);
              return (
                <button
                  key={key}
                  onClick={() => handleKey(displayKey)}
                  className={`${normalKey} flex-1`}
                  data-testid={`key-${key}`}
                >
                  {displayKey}
                </button>
              );
            })}
            <button
              onClick={() => handleKey('Shift')}
              className={`${shift ? activeKey : specialKey} flex-[2]`}
              data-testid="key-shift-right"
            >
              <ArrowUp size={14} />
            </button>
          </div>
          
          {/* Space Row */}
          <div className="flex gap-0.5 sm:gap-1">
            <button
              onClick={() => handleSpecialKey('Escape', 'Esc')}
              className={`${specialKey} flex-[1.2]`}
              data-testid="key-escape"
            >
              Esc
            </button>
            <button
              onClick={() => onType(' ')}
              className={`${normalKey} flex-[8]`}
              data-testid="key-space"
            >
              Space
            </button>
            <button
              onClick={() => handleSpecialKey('ArrowLeft', '←')}
              className={`${specialKey} flex-1`}
              data-testid="key-arrow-left"
            >
              ←
            </button>
            <button
              onClick={() => handleSpecialKey('ArrowUp', '↑')}
              className={`${specialKey} flex-1`}
              data-testid="key-arrow-up"
            >
              ↑
            </button>
            <button
              onClick={() => handleSpecialKey('ArrowDown', '↓')}
              className={`${specialKey} flex-1`}
              data-testid="key-arrow-down"
            >
              ↓
            </button>
            <button
              onClick={() => handleSpecialKey('ArrowRight', '→')}
              className={`${specialKey} flex-1`}
              data-testid="key-arrow-right"
            >
              →
            </button>
          </div>
        </div>
        
        {/* Number Pad - Desktop (side) */}
        <div className="hidden sm:grid grid-cols-4 gap-1 w-[140px]">
          <button onClick={() => handleSpecialKey('NumLock', 'Num')} className={`${specialKey}`} data-testid="key-numlock">Num</button>
          <button onClick={() => onType('/')} className={`${normalKey}`} data-testid="key-numpad-divide">/</button>
          <button onClick={() => onType('*')} className={`${normalKey}`} data-testid="key-numpad-multiply">*</button>
          <button onClick={() => onType('-')} className={`${normalKey}`} data-testid="key-numpad-minus">-</button>
          
          <button onClick={() => onType('7')} className={`${normalKey}`} data-testid="key-numpad-7">7</button>
          <button onClick={() => onType('8')} className={`${normalKey}`} data-testid="key-numpad-8">8</button>
          <button onClick={() => onType('9')} className={`${normalKey}`} data-testid="key-numpad-9">9</button>
          <button onClick={() => onType('+')} className={`${normalKey} row-span-2`} data-testid="key-numpad-plus">+</button>
          
          <button onClick={() => onType('4')} className={`${normalKey}`} data-testid="key-numpad-4">4</button>
          <button onClick={() => onType('5')} className={`${normalKey}`} data-testid="key-numpad-5">5</button>
          <button onClick={() => onType('6')} className={`${normalKey}`} data-testid="key-numpad-6">6</button>
          
          <button onClick={() => onType('1')} className={`${normalKey}`} data-testid="key-numpad-1">1</button>
          <button onClick={() => onType('2')} className={`${normalKey}`} data-testid="key-numpad-2">2</button>
          <button onClick={() => onType('3')} className={`${normalKey}`} data-testid="key-numpad-3">3</button>
          <button onClick={() => handleSpecialKey('Enter', '↵')} className={`${specialKey} row-span-2`} data-testid="key-numpad-enter">↵</button>
          
          <button onClick={() => onType('0')} className={`${normalKey} col-span-2`} data-testid="key-numpad-0">0</button>
          <button onClick={() => onType('.')} className={`${normalKey}`} data-testid="key-numpad-dot">.</button>
        </div>
      </div>
      
      {/* Number Pad - Mobile (bottom row) */}
      <div className="sm:hidden grid grid-cols-6 gap-0.5 mt-1">
        <button onClick={() => onType('7')} className={`${normalKey}`} data-testid="key-numpad-mobile-7">7</button>
        <button onClick={() => onType('8')} className={`${normalKey}`} data-testid="key-numpad-mobile-8">8</button>
        <button onClick={() => onType('9')} className={`${normalKey}`} data-testid="key-numpad-mobile-9">9</button>
        <button onClick={() => onType('/')} className={`${normalKey}`} data-testid="key-numpad-mobile-divide">/</button>
        <button onClick={() => onType('*')} className={`${normalKey}`} data-testid="key-numpad-mobile-multiply">*</button>
        <button onClick={() => onType('-')} className={`${normalKey}`} data-testid="key-numpad-mobile-minus">-</button>
        
        <button onClick={() => onType('4')} className={`${normalKey}`} data-testid="key-numpad-mobile-4">4</button>
        <button onClick={() => onType('5')} className={`${normalKey}`} data-testid="key-numpad-mobile-5">5</button>
        <button onClick={() => onType('6')} className={`${normalKey}`} data-testid="key-numpad-mobile-6">6</button>
        <button onClick={() => onType('1')} className={`${normalKey}`} data-testid="key-numpad-mobile-1">1</button>
        <button onClick={() => onType('2')} className={`${normalKey}`} data-testid="key-numpad-mobile-2">2</button>
        <button onClick={() => onType('3')} className={`${normalKey}`} data-testid="key-numpad-mobile-3">3</button>
        
        <button onClick={() => onType('0')} className={`${normalKey} col-span-2`} data-testid="key-numpad-mobile-0">0</button>
        <button onClick={() => onType('.')} className={`${normalKey}`} data-testid="key-numpad-mobile-dot">.</button>
        <button onClick={() => onType('+')} className={`${normalKey}`} data-testid="key-numpad-mobile-plus">+</button>
        <button onClick={() => handleSpecialKey('Enter', '↵')} className={`${specialKey} col-span-2`} data-testid="key-numpad-mobile-enter">↵</button>
      </div>
    </div>
  );
}
