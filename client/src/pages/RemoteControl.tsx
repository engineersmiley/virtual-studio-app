import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Monitor, Shield, Users, ArrowLeft, Laptop, Zap, Settings, CheckCircle, AppWindow, Apple, Terminal, Smartphone, MousePointer, Keyboard, Hand } from "lucide-react";
import { Link } from "wouter";
import { SubscriptionGate } from "@/components/SubscriptionGate";

const AGENT_VERSION = "1.0.0";

// Download URLs - GitHub releases
const GITHUB_REPO = "engineersmiley/virtual-studio-app";
const DOWNLOAD_URLS = {
  windows: `https://github.com/${GITHUB_REPO}/releases/latest/download/Virtual.Studio.Agent.Setup.exe`,
  mac: `https://github.com/${GITHUB_REPO}/releases/latest/download/Virtual.Studio.Agent.dmg`,
  // Legacy build - works on macOS 10.11+ (El Capitan), from GitHub releases
  macLegacy: `https://github.com/${GITHUB_REPO}/releases/latest/download/Virtual.Studio.Agent-Legacy.dmg`,
  linux: `https://github.com/${GITHUB_REPO}/releases/latest/download/Virtual.Studio.Agent.AppImage`,
};

export default function RemoteControl() {
  return (
    <SubscriptionGate>
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <Link href="/">
          <Button variant="ghost" className="mb-6" data-testid="button-back-home">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Virtual Studio
          </Button>
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Monitor className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Remote Desktop Control</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Allow your engineer to take control of your computer during sessions. 
            Perfect for adjusting DAW settings, mixing, and real-time collaboration.
          </p>
        </div>

        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Virtual Studio Agent
              <Badge variant="outline" className="ml-2">v{AGENT_VERSION}</Badge>
            </CardTitle>
            <CardDescription>
              Control your artist's computer directly from Virtual Studio with audio streaming included - all in one integrated experience.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-muted/50 rounded-lg mb-4">
              <p className="text-sm text-muted-foreground">
                Download the Virtual Studio Agent for your operating system. After installation, enter your session code to connect with your collaborators.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <a 
                href={DOWNLOAD_URLS.windows}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full"
              >
                <Button 
                  size="lg" 
                  className="w-full h-auto py-4 flex-col gap-2"
                  data-testid="button-download-agent-windows"
                >
                  <AppWindow className="w-8 h-8" />
                  <span className="font-semibold">Windows</span>
                  <span className="text-xs opacity-70">.exe installer</span>
                </Button>
              </a>
              <div className="flex flex-col gap-2">
                <a 
                  href={DOWNLOAD_URLS.mac}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button 
                    size="lg" 
                    className="w-full h-auto py-4 flex-col gap-2"
                    data-testid="button-download-agent-mac"
                  >
                    <Apple className="w-8 h-8" />
                    <span className="font-semibold">macOS 11+</span>
                    <span className="text-xs opacity-70">.dmg installer</span>
                  </Button>
                </a>
                <a 
                  href={DOWNLOAD_URLS.macLegacy}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="w-full text-xs"
                    data-testid="button-download-agent-mac-legacy"
                  >
                    <span>macOS 10.11-10.14 (Legacy .zip)</span>
                  </Button>
                </a>
              </div>
              <a 
                href={DOWNLOAD_URLS.linux}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full"
              >
                <Button 
                  size="lg" 
                  className="w-full h-auto py-4 flex-col gap-2"
                  data-testid="button-download-agent-linux"
                >
                  <Terminal className="w-8 h-8" />
                  <span className="font-semibold">Linux</span>
                  <span className="text-xs opacity-70">.AppImage file</span>
                </Button>
              </a>
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Version {AGENT_VERSION} - Download the installer for your operating system above
            </p>
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-xs text-yellow-200/80 text-center">
                <strong>Legacy Mac Note:</strong> The legacy macOS version uses older software that no longer receives security updates. 
                We recommend upgrading to macOS 11 or later for best security.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-cyan-500/30 bg-cyan-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-cyan-400" />
              Phone Control
              <Badge variant="outline" className="ml-2 border-cyan-500/50 text-cyan-400">No Download Needed</Badge>
            </CardTitle>
            <CardDescription>
              Control your artist's computer directly from your phone - no app download required!
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Hand className="w-4 h-4 text-cyan-400" />
                  Touch Controls
                </h3>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-center gap-2">
                    <MousePointer className="w-4 h-4" />
                    <span>Swipe on touchpad to move mouse</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-4 h-4 flex items-center justify-center text-xs">1x</span>
                    <span>Tap once to left-click</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-4 h-4 flex items-center justify-center text-xs">2x</span>
                    <span>Double-tap to double-click</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-4 h-4 flex items-center justify-center text-xs font-bold">H</span>
                    <span>Long press for right-click</span>
                  </li>
                </ul>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-cyan-400" />
                  Virtual Keyboard
                </h3>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li>Full keyboard with all keys</li>
                  <li>Modifier keys: Ctrl, Alt, Shift, Cmd</li>
                  <li>Arrow keys for navigation</li>
                  <li>Quick shortcuts: Copy, Paste, Undo, Save</li>
                </ul>
              </div>
            </div>
            <div className="mt-4 p-4 bg-primary/10 border border-primary/30 rounded-lg">
              <h4 className="font-semibold mb-2 text-sm">How to Use Phone Control:</h4>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                <li>Join a session as an Engineer on your phone</li>
                <li>Scroll down to find the "Phone Control" panel</li>
                <li>Click "Request Control" to ask the artist for permission</li>
                <li>Once approved, use the touchpad and keyboard to control their computer</li>
              </ol>
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Works on any phone or tablet - iPhone, Android, iPad, and more!
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                For Artists
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal list-inside space-y-2">
                <li>Download Virtual Studio Agent above</li>
                <li>Install and open the app</li>
                <li>Enter your session code and email</li>
                <li>Click "Connect" to link with your session</li>
                <li>When your engineer requests control, click "Allow"</li>
              </ol>
              <div className="p-3 bg-primary/5 rounded-lg mt-4">
                <p className="text-xs text-muted-foreground">
                  <strong>You're always in control:</strong> You must approve each control request, 
                  and you can stop control anytime by pressing Escape.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Monitor className="w-5 h-5 text-primary" />
                For Engineers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal list-inside space-y-2">
                <li>Join the Virtual Studio session as usual</li>
                <li>Wait for the artist to connect their Agent app</li>
                <li>You'll see "Agent Connected" in the session</li>
                <li>Click "Full Control" to request control</li>
                <li>Once the artist approves, you have full control!</li>
              </ol>
              <div className="p-3 bg-primary/5 rounded-lg mt-4">
                <p className="text-xs text-muted-foreground">
                  <strong>Audio included:</strong> Unlike other remote tools, you get the artist's 
                  screen AND audio all in one place.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                For Producers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal list-inside space-y-2">
                <li>Join the Virtual Studio session as usual</li>
                <li>Watch the artist's screen and listen to audio</li>
                <li>Communicate via the built-in chat or voice</li>
                <li>The engineer handles all recording controls</li>
              </ol>
              <div className="p-3 bg-primary/5 rounded-lg mt-4">
                <p className="text-xs text-muted-foreground">
                  <strong>No download needed:</strong> Producers have view-only access. 
                  If you need remote control, join as an Engineer instead.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="w-5 h-5" />
              System Permissions
            </CardTitle>
            <CardDescription>
              The agent needs permission to control your mouse and keyboard
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-4">
            <div className="flex items-start gap-3">
              <Laptop className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">Windows</p>
                <p className="text-muted-foreground">Run the installer as Administrator. If prompted by Windows Security, click "More info" then "Run anyway".</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Laptop className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">macOS</p>
                <p className="text-muted-foreground">Go to System Preferences &gt; Security & Privacy &gt; Privacy &gt; Accessibility, and add Virtual Studio Agent to the allowed apps.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Laptop className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">Linux</p>
                <p className="text-muted-foreground">Make the AppImage executable: <code className="bg-muted px-1 rounded">chmod +x virtual-studio-agent.AppImage</code></p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AppWindow className="w-5 h-5" />
              Create Desktop Icons
            </CardTitle>
            <CardDescription>
              Add Virtual Studio and the Agent to your desktop for quick access
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-6">
            <div>
              <h3 className="font-semibold mb-3">Virtual Studio (Web App)</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <AppWindow className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">Windows (Chrome/Edge)</p>
                    <p className="text-muted-foreground">Open Virtual Studio in your browser, click the menu (3 dots) in the top right, select "Install Virtual Studio" or "Create shortcut". Check "Open as window" for an app-like experience.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Apple className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">macOS (Safari)</p>
                    <p className="text-muted-foreground">Open Virtual Studio in Safari, click File menu, select "Add to Dock". For Chrome: click menu (3 dots), "Save and Share", then "Create Shortcut".</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Terminal className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">Linux (Chrome/Firefox)</p>
                    <p className="text-muted-foreground">In Chrome: click menu (3 dots), select "Install Virtual Studio". In Firefox: bookmark the page, then drag the bookmark to your desktop.</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="border-t pt-4">
              <h3 className="font-semibold mb-3">Virtual Studio Agent (Desktop App)</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <AppWindow className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">Windows</p>
                    <p className="text-muted-foreground">After running the installer, the Agent is added to your Start Menu automatically. Right-click it and select "Pin to taskbar" or "Create desktop shortcut".</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Apple className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">macOS</p>
                    <p className="text-muted-foreground">Open the .dmg file, drag "Virtual Studio Agent" to your Applications folder. Then drag it from Applications to your Dock for quick access.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Terminal className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">Linux</p>
                    <p className="text-muted-foreground">Move the .AppImage file to a permanent location (like ~/Applications). Right-click and select "Allow executing as program". You can use AppImageLauncher to integrate it with your app menu.</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-500" />
              Security & Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <p><strong>Explicit consent required</strong> - The artist must approve each control request</p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <p><strong>Session-bound</strong> - Control only works within your active Virtual Studio session</p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <p><strong>Instant disconnect</strong> - Press Escape anytime to immediately stop control</p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <p><strong>Engineer verification</strong> - Only verified engineers in your session can request control</p>
            </div>
          </CardContent>
        </Card>

        <div className="text-center mt-8">
          <p className="text-sm text-muted-foreground mb-4">
            Questions about remote control? Contact us at support@virtualstudio.sale
          </p>
          <Link href="/">
            <Button data-testid="button-return-studio">
              Return to Virtual Studio
            </Button>
          </Link>
        </div>
      </div>
    </div>
    </SubscriptionGate>
  );
}
