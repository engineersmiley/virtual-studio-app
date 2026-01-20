import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Monitor, Download, Shield, Users, ArrowLeft, Laptop, Zap, Settings } from "lucide-react";
import { Link } from "wouter";

export default function RemoteControl() {
  const downloadLinks = {
    windows: "https://github.com/rustdesk/rustdesk/releases/download/1.3.8/rustdesk-1.3.8-x86_64.exe",
    mac: "https://github.com/rustdesk/rustdesk/releases/download/1.3.8/rustdesk-1.3.8-x86_64.dmg",
    linux: "https://github.com/rustdesk/rustdesk/releases/download/1.3.8/rustdesk-1.3.8-x86_64.deb"
  };

  return (
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

        {/* Virtual Studio Agent - Coming Soon */}
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Virtual Studio Agent
              <Badge variant="secondary" className="ml-2">Coming Soon</Badge>
            </CardTitle>
            <CardDescription>
              Our integrated remote control solution - control your artist's computer directly from Virtual Studio with audio streaming included.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 bg-background/50 rounded-lg">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  How It Will Work
                </h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Artist downloads and installs Virtual Studio Agent</li>
                  <li>Agent connects to your Virtual Studio session</li>
                  <li>Engineer clicks "Full Control" in the session</li>
                  <li>Artist approves the control request</li>
                  <li>Engineer can now control the artist's computer - with audio!</li>
                </ol>
              </div>
              <p className="text-sm text-muted-foreground">
                <strong>Why is this better?</strong> Unlike RustDesk/AnyDesk, Virtual Studio Agent integrates directly with your session - 
                so you get remote control AND audio streaming in one seamless experience. No separate apps needed.
              </p>
            </div>
          </CardContent>
        </Card>
        
        <div className="text-center mb-6">
          <p className="text-muted-foreground">While we finish developing Virtual Studio Agent, use one of these free tools:</p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Option 1: RustDesk
            </CardTitle>
            <CardDescription>
              Free, open-source remote control software. Recommended for most users.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <Button 
                asChild 
                size="lg" 
                variant="outline" 
                className="w-full flex-col gap-1"
                data-testid="button-download-windows"
              >
                <a href={downloadLinks.windows} target="_blank" rel="noopener noreferrer">
                  <Laptop className="w-6 h-6" />
                  <span>Windows</span>
                  <Badge variant="secondary" className="text-xs">Recommended</Badge>
                </a>
              </Button>
              <Button 
                asChild 
                size="lg" 
                variant="outline" 
                className="w-full flex-col gap-1"
                data-testid="button-download-mac"
              >
                <a href={downloadLinks.mac} target="_blank" rel="noopener noreferrer">
                  <Laptop className="w-6 h-6" />
                  <span>macOS</span>
                </a>
              </Button>
              <Button 
                asChild 
                size="lg" 
                variant="outline" 
                className="w-full flex-col gap-1"
                data-testid="button-download-linux"
              >
                <a href={downloadLinks.linux} target="_blank" rel="noopener noreferrer">
                  <Laptop className="w-6 h-6" />
                  <span>Linux</span>
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Can't find your version?{" "}
              <a 
                href="https://rustdesk.com/download" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-primary hover:underline"
                data-testid="link-all-downloads"
              >
                View all downloads
              </a>
            </p>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Option 2: AnyDesk
            </CardTitle>
            <CardDescription>
              Another free remote control option. Great for older systems (macOS 10.9-10.11, older Windows).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <Button 
                asChild 
                size="lg" 
                variant="outline" 
                className="w-full flex-col gap-1"
                data-testid="button-download-anydesk-windows"
              >
                <a href="https://anydesk.com/en/downloads/windows" target="_blank" rel="noopener noreferrer">
                  <Laptop className="w-6 h-6" />
                  <span>Windows</span>
                </a>
              </Button>
              <Button 
                asChild 
                size="lg" 
                variant="outline" 
                className="w-full flex-col gap-1"
                data-testid="button-download-anydesk-mac"
              >
                <a href="https://anydesk.com/en/downloads/mac-os" target="_blank" rel="noopener noreferrer">
                  <Laptop className="w-6 h-6" />
                  <span>macOS</span>
                </a>
              </Button>
              <Button 
                asChild 
                size="lg" 
                variant="outline" 
                className="w-full flex-col gap-1"
                data-testid="button-download-anydesk-linux"
              >
                <a href="https://anydesk.com/en/downloads/linux" target="_blank" rel="noopener noreferrer">
                  <Laptop className="w-6 h-6" />
                  <span>Linux</span>
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              For older macOS (10.9-10.11), download{" "}
              <a 
                href="https://anydesk.en.uptodown.com/mac/versions" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-primary hover:underline"
                data-testid="link-anydesk-older-versions"
              >
                version 6.5.0 or earlier
              </a>
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                For Artists
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal list-inside space-y-2">
                <li>Download and install RustDesk</li>
                <li>Open RustDesk - you'll see your <strong>ID</strong> and <strong>Password</strong></li>
                <li>Share both with your engineer (via text, email, or in session chat)</li>
                <li>Accept the connection when prompted</li>
                <li>Your engineer can now control your computer!</li>
              </ol>
              <div className="p-3 bg-primary/5 rounded-lg mt-4">
                <p className="text-xs text-muted-foreground">
                  <strong>Tip:</strong> You can set a permanent password in RustDesk settings 
                  so you don't need to share a new one each session.
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
                <li>Download and install RustDesk</li>
                <li>Ask your artist for their <strong>ID</strong> and <strong>Password</strong></li>
                <li>Enter the ID in the "Remote Desktop" field</li>
                <li>Click Connect and enter the password</li>
                <li>You now have full control of their computer!</li>
              </ol>
              <div className="p-3 bg-primary/5 rounded-lg mt-4">
                <p className="text-xs text-muted-foreground">
                  <strong>Tip:</strong> Use this alongside Virtual Studio's screen sharing 
                  to see the artist's screen in the browser while controlling via RustDesk.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-500" />
              Security & Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>RustDesk is open-source</strong> - the code is publicly available for anyone to audit.
            </p>
            <p>
              <strong>End-to-end encrypted</strong> - all connections are secured with strong encryption.
            </p>
            <p>
              <strong>You're in control</strong> - the artist must accept each connection and can disconnect anytime.
            </p>
            <p>
              <strong>No account required</strong> - works immediately after installation.
            </p>
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
  );
}
