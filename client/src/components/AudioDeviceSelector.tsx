import { useState, useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mic, Speaker } from 'lucide-react';

interface AudioDeviceSelectorProps {
  onInputChange?: (deviceId: string) => void;
  onOutputChange?: (deviceId: string) => void;
  className?: string;
}

const STORAGE_KEY_INPUT = 'virtualstudio-audio-input';
const STORAGE_KEY_OUTPUT = 'virtualstudio-audio-output';

function applyOutputToAllElements(deviceId: string) {
  const audioElements = document.querySelectorAll('audio, video');
  audioElements.forEach((el: any) => {
    if (el.setSinkId && typeof el.setSinkId === 'function') {
      el.setSinkId(deviceId).catch((err: Error) => {
        console.error('Error setting audio output:', err);
      });
    }
  });
}

export function AudioDeviceSelector({ 
  onInputChange, 
  onOutputChange,
  className = "" 
}: AudioDeviceSelectorProps) {
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [hasPermission, setHasPermission] = useState(false);
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    async function getDevices() {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setHasPermission(true);
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        
        setInputDevices(inputs);
        setOutputDevices(outputs);
        
        const savedInput = localStorage.getItem(STORAGE_KEY_INPUT);
        const savedOutput = localStorage.getItem(STORAGE_KEY_OUTPUT);
        
        if (inputs.length > 0) {
          const inputToUse = savedInput && inputs.some(d => d.deviceId === savedInput)
            ? savedInput
            : inputs.find(d => d.deviceId === 'default')?.deviceId || inputs[0].deviceId;
          setSelectedInput(inputToUse);
        }
        
        if (outputs.length > 0) {
          const outputToUse = savedOutput && outputs.some(d => d.deviceId === savedOutput)
            ? savedOutput
            : outputs.find(d => d.deviceId === 'default')?.deviceId || outputs[0].deviceId;
          setSelectedOutput(outputToUse);
          applyOutputToAllElements(outputToUse);
        }
      } catch (err) {
        console.error('Error getting audio devices:', err);
      }
    }
    
    getDevices();
    
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, []);

  useEffect(() => {
    if (!selectedOutput || !hasPermission) return;
    
    observerRef.current = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            const audioElements = node.querySelectorAll('audio, video');
            audioElements.forEach((el: any) => {
              if (el.setSinkId && typeof el.setSinkId === 'function') {
                el.setSinkId(selectedOutput).catch(console.error);
              }
            });
            if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') {
              const el = node as any;
              if (el.setSinkId && typeof el.setSinkId === 'function') {
                el.setSinkId(selectedOutput).catch(console.error);
              }
            }
          }
        });
      });
    });

    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [selectedOutput, hasPermission]);

  const handleInputChange = (deviceId: string) => {
    setSelectedInput(deviceId);
    localStorage.setItem(STORAGE_KEY_INPUT, deviceId);
    onInputChange?.(deviceId);
  };

  const handleOutputChange = (deviceId: string) => {
    setSelectedOutput(deviceId);
    localStorage.setItem(STORAGE_KEY_OUTPUT, deviceId);
    onOutputChange?.(deviceId);
    applyOutputToAllElements(deviceId);
  };

  if (!hasPermission) {
    return (
      <div 
        className={`p-3 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground cursor-pointer hover:bg-white/10 transition-colors ${className}`}
        onClick={async () => {
          try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            setHasPermission(true);
          } catch (err) {
            console.error('Permission denied:', err);
          }
        }}
        data-testid="audio-permission-request"
      >
        <p className="flex items-center gap-2">
          <Mic size={16} /> Click to enable audio device selection
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`} data-testid="audio-device-selector">
      <div className="space-y-2">
        <label className="text-xs font-tech uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Mic size={14} /> Input Device
        </label>
        <Select value={selectedInput} onValueChange={handleInputChange}>
          <SelectTrigger 
            className="w-full bg-black/40 border-white/20" 
            data-testid="select-audio-input"
          >
            <SelectValue placeholder="Select microphone" />
          </SelectTrigger>
          <SelectContent>
            {inputDevices.map((device) => (
              <SelectItem 
                key={device.deviceId} 
                value={device.deviceId}
                data-testid={`input-device-${device.deviceId}`}
              >
                {device.label || `Microphone ${inputDevices.indexOf(device) + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-tech uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Speaker size={14} /> Output Device
        </label>
        <Select value={selectedOutput} onValueChange={handleOutputChange}>
          <SelectTrigger 
            className="w-full bg-black/40 border-white/20"
            data-testid="select-audio-output"
          >
            <SelectValue placeholder="Select speakers" />
          </SelectTrigger>
          <SelectContent>
            {outputDevices.map((device) => (
              <SelectItem 
                key={device.deviceId} 
                value={device.deviceId}
                data-testid={`output-device-${device.deviceId}`}
              >
                {device.label || `Speaker ${outputDevices.indexOf(device) + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
