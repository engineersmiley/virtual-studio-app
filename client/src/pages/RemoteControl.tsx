import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Monitor, Shield, Users, ArrowLeft, Laptop, Zap, Settings, CheckCircle, AppWindow, Apple, Terminal } from "lucide-react";
import { Link } from "wouter";
import { SubscriptionGate } from "@/components/SubscriptionGate";

const AGENT_VERSION = "1.0.0";

// Download URLs - Google Drive direct download links
const DOWNLOAD_URLS = {
  windows: "https://drive.google.com/uc?export=download&id=1NkHstI37uzDUA81kShLlegdZbSHUIHsC",
  mac: "https://drive.google.com/uc?export=download&id=1xAE4a0BqKh8IdmMFxeNrHfSaooqrb369",
  macLegacy: "", // Will be populated after legacy build is created
  linux: "https://drive.google.com/uc?export=download&id=1g8UoPaABGbtPnV_uOLAqvGApXUbjNdHS",
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
                {DOWNLOAD_URLS.macLegacy && (
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
                      <span>macOS 10.11-10.14 (Legacy)</span>
                    </Button>
                  </a>
                )}
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
            {DOWNLOAD_URLS.macLegacy && (
              <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <p className="text-xs text-yellow-200/80 text-center">
                  <strong>Legacy Mac Note:</strong> The legacy macOS version uses older software that no longer receives security updates. 
                  We recommend upgrading to macOS 11 or later for best security.
                </p>
              </div>
            )}
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
