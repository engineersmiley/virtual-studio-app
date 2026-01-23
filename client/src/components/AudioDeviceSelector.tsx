import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [isLoading, setIsLoading] = useState(true);
  const observerRef = useRef<MutationObserver | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput' && d.deviceId);
      const outputs = devices.filter(d => d.kind === 'audiooutput' && d.deviceId);
      
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
      console.error('Error loading devices:', err);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    setIsLoading(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setHasPermission(true);
      await loadDevices();
    } catch (err) {
      console.error('Permission denied:', err);
    } finally {
      setIsLoading(false);
    }
  }, [loadDevices]);

  useEffect(() => {
    async function checkPermissionAndLoad() {
      try {
        // Try to enumerate devices first - if we get labels, we have permission
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasLabels = devices.some(d => d.label);
        
        if (hasLabels) {
          setHasPermission(true);
          await loadDevices();
        }
      } catch (err) {
        console.error('Error checking permissions:', err);
      } finally {
        setIsLoading(false);
      }
    }
    
    checkPermissionAndLoad();
    
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
    };
  }, [loadDevices]);

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

  if (isLoading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground animate-pulse">
          Loading audio devices...
        </div>
      </div>
    );
  }

  if (!hasPermission) {
    return (
      <div className={`space-y-3 ${className}`}>
        <button 
          onClick={requestPermission}
          className="w-full p-4 rounded-lg bg-primary/20 border border-primary/30 text-sm text-primary hover:bg-primary/30 transition-colors flex items-center justify-center gap-2"
          data-testid="audio-permission-request"
        >
          <Mic size={18} />
          <span className="font-medium">Enable Audio Devices</span>
        </button>
        <p className="text-xs text-muted-foreground text-center">
          Click to select your microphone and speakers
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
            {inputDevices.length === 0 ? (
              <SelectItem value="none" disabled>No microphones found</SelectItem>
            ) : (
              inputDevices.map((device) => (
                <SelectItem 
                  key={device.deviceId} 
                  value={device.deviceId}
                  data-testid={`input-device-${device.deviceId}`}
                >
                  {device.label || `Microphone ${inputDevices.indexOf(device) + 1}`}
                </SelectItem>
              ))
            )}
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
            {outputDevices.length === 0 ? (
              <SelectItem value="none" disabled>No speakers found</SelectItem>
            ) : (
              outputDevices.map((device) => (
                <SelectItem 
                  key={device.deviceId} 
                  value={device.deviceId}
                  data-testid={`output-device-${device.deviceId}`}
                >
                  {device.label || `Speaker ${outputDevices.indexOf(device) + 1}`}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
