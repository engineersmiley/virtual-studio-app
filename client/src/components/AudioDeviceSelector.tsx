import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Volume2, Mic, Speaker } from 'lucide-react';

interface AudioDeviceSelectorProps {
  onInputChange?: (deviceId: string) => void;
  onOutputChange?: (deviceId: string) => void;
  className?: string;
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
        
        if (inputs.length > 0 && !selectedInput) {
          const defaultInput = inputs.find(d => d.deviceId === 'default') || inputs[0];
          setSelectedInput(defaultInput.deviceId);
        }
        
        if (outputs.length > 0 && !selectedOutput) {
          const defaultOutput = outputs.find(d => d.deviceId === 'default') || outputs[0];
          setSelectedOutput(defaultOutput.deviceId);
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

  const handleInputChange = (deviceId: string) => {
    setSelectedInput(deviceId);
    onInputChange?.(deviceId);
  };

  const handleOutputChange = (deviceId: string) => {
    setSelectedOutput(deviceId);
    onOutputChange?.(deviceId);
    
    const audioElements = document.querySelectorAll('audio, video');
    audioElements.forEach((el: any) => {
      if (el.setSinkId) {
        el.setSinkId(deviceId).catch((err: Error) => {
          console.error('Error setting audio output:', err);
        });
      }
    });
  };

  if (!hasPermission) {
    return (
      <div className={`p-3 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground ${className}`}>
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
